import { RetryableError, parseJsonLoose } from '../engine/judge.js';
import { normalizeUsage, cacheHitRate } from '../engine/usage.js';
import { providerRequest } from './providers.js';

export { normalizeUsage, cacheHitRate };
import { DEFAULT_ENDPOINT, DEFAULT_MODEL, PROFILE_PRESETS, emptyProfile, normalizeModelProfile } from './providers.js';

export { DEFAULT_ENDPOINT, DEFAULT_MODEL, PROFILE_PRESETS, emptyProfile, normalizeModelProfile };

function endpointUrl(endpoint) {
  try {
    const url = new URL(endpoint);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

export function isLocalEndpoint(endpoint) {
  const url = endpointUrl(endpoint);
  return Boolean(url && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
}

export function normalizeEndpoint(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const url = endpointUrl(s);
  if (!url) return s;
  const path = url.pathname.replace(/\/+$/, '');
  const lastSeg = path.split('/').filter(Boolean).pop() || '';
  if (!path || /^v\d+[a-z0-9]*$/i.test(lastSeg)) {
    url.pathname = `${path}/chat/completions`;
  } else if (/\/chat\/completions$/i.test(path)) {
    url.pathname = path;
  }
  return url.toString();
}

export function modelReadiness(profile) {
  const endpoint = normalizeEndpoint(profile?.endpoint);
  if (!endpoint) return { ready: false, kind: 'no-endpoint', message: '尚未配置模型端点' };
  if (!endpointUrl(endpoint)) {
    return { ready: false, kind: 'invalid-endpoint', message: '模型端点须为有效的 HTTP 或 HTTPS 地址，且不能包含用户名或密码' };
  }
  if (!String(profile?.apiKey || '').trim() && !isLocalEndpoint(endpoint)) {
    return { ready: false, kind: 'no-key', message: '尚未填写 API Key' };
  }
  return { ready: true };
}

export function assertModelReady(profile) {
  const r = modelReadiness(profile);
  if (!r.ready) throw new RetryableError(r.message, { kind: r.kind });
  return true;
}

function hostOf(endpoint) {
  return endpointUrl(endpoint)?.host || '模型端点';
}

function requestOptions(options, fetchImpl) {
  const endpoint = normalizeEndpoint(options.endpoint);
  const apiKey = String(options.apiKey || '').trim();
  assertModelReady({ endpoint, apiKey });
  if (typeof fetchImpl !== 'function') {
    throw new RetryableError('当前环境不支持 fetch', { kind: 'no-fetch' });
  }
  if (typeof options.model !== 'string' || !options.model.trim()) {
    throw new RetryableError('尚未填写模型名称', { kind: 'schema' });
  }
  if (options.temperature !== undefined && (typeof options.temperature !== 'number' || !Number.isFinite(options.temperature)
    || options.temperature < 0 || options.temperature > 2)) {
    throw new RetryableError('温度须为 0 到 2 之间的数值', { kind: 'schema' });
  }
  if (options.timeoutMs !== undefined && (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0 || options.timeoutMs > 2147483647)) {
    throw new RetryableError('请求超时时间须为有效的正整数', { kind: 'schema' });
  }
  return { endpoint, apiKey };
}

function outputLimit(maxOutputTokens) {
  if (maxOutputTokens === undefined || maxOutputTokens === null) return {};
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens <= 0) {
    throw new RetryableError('输出 token 上限须为正整数', { kind: 'schema' });
  }
  return { max_tokens: maxOutputTokens };
}

async function postCompletion({ endpoint, apiKey, body, signal, fetchImpl, timeoutMs }) {
  if (signal?.aborted) {
    throw new RetryableError(`请求 ${hostOf(endpoint)} 已取消`, { kind: 'cancelled' });
  }
  const controller = new AbortController();
  let rejectAbort;
  const interrupted = new Promise((_, reject) => { rejectAbort = reject; });
  const abort = (kind) => {
    if (controller.signal.aborted) return;
    controller.abort();
    rejectAbort(new RetryableError(
      `请求 ${hostOf(endpoint)} ${kind === 'timeout' ? '超时' : '已取消'}`,
      { kind },
    ));
  };
  const onAbort = () => abort('cancelled');
  signal?.addEventListener('abort', onAbort, { once: true });
  const timeout = setTimeout(() => abort('timeout'), timeoutMs);
  try {
    return await Promise.race([
      (async () => {
        const res = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        const text = await res.text();
        return { res, text };
      })(),
      interrupted,
    ]);
  } catch (err) {
    if (err instanceof RetryableError) throw err;
    throw new RetryableError(`无法连接 ${hostOf(endpoint)}：${err?.message || err}`, { kind: 'network' });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onAbort);
  }
}

function httpError({ res, text }, endpoint) {
  let msg = text.slice(0, 300);
  try { msg = String(JSON.parse(text)?.error?.message || msg).slice(0, 300); } catch {}
  return new RetryableError(`${hostOf(endpoint)} 返回 ${res.status}：${msg}`, { raw: text, kind: 'http' });
}

function responseMetadata({ res, text }, request) {
  request.status = res.status;
  let payload;
  try { payload = JSON.parse(text); } catch { return null; }
  if (typeof payload?.id === 'string') request.responseId = payload.id.slice(0, 200);
  const reason = payload?.choices?.[0]?.finish_reason;
  if (typeof reason === 'string') request.finishReason = reason;
  return normalizeUsage(payload?.usage);
}

function requestError(error, request, usage) {
  error.request = { ...request };
  error.usage = usage;
  return error;
}

function readCompletion(text, endpoint) {
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new RetryableError(`${hostOf(endpoint)} 返回的不是 JSON（可能是反向代理或登录页）`, { raw: text, kind: 'not-json' });
  }
  const choice = payload?.choices?.[0];
  if (choice?.finish_reason === 'length') {
    throw new RetryableError('模型回复达到长度上限，请缩短输入或调整上下文限额后重试', { raw: text, kind: 'length' });
  }
  const content = choice?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    const detail = payload?.error?.message || 'choices[0].message.content 为空或不是文本';
    throw new RetryableError(`模型未返回内容：${detail}`, { raw: text, kind: 'empty' });
  }
  return { content, usage: normalizeUsage(payload.usage) };
}

const mentionsJsonMode = (text) => /response_format|json_object|json mode|response format/i.test(String(text || ''));
const mentionsPrefill = (text) => /prefill|prefix|assistant[^.]{0,20}(last|final|end)|end with[^.]{0,20}user|must be a user|最后一条|assistant 消息/i.test(String(text || ''));

export async function callJson(options, { system, user, prefill = '', signal, requestContext, fetchImpl = globalThis.fetch } = {}) {
  const { model, temperature = 0.2, timeoutMs = 90000 } = options;
  const { endpoint, apiKey } = requestOptions(options, fetchImpl);
  const limit = outputLimit(options.maxOutputTokens);
  const { params, request } = providerRequest(options, endpoint, requestContext);
  if (typeof system !== 'string' || typeof user !== 'string' || !user.trim() || typeof prefill !== 'string') {
    throw new RetryableError('待发送的提示词须为有效文本', { kind: 'schema' });
  }
  let useJsonMode = true;
  let usePrefill = Boolean(prefill);
  let last;
  let usage = null;

  try {
    for (let i = 0; i < 3; i += 1) {
      const messages = [{ role: 'system', content: system }, { role: 'user', content: user }];
      if (usePrefill) messages.push({ role: 'assistant', content: prefill });
      const body = { model, temperature, messages, ...limit, ...params };
      if (useJsonMode) body.response_format = { type: 'json_object' };
      request.attempts = i + 1;
      request.jsonMode = useJsonMode;
      request.prefill = usePrefill;
      delete request.status;
      delete request.responseId;
      delete request.finishReason;
      usage = null;
      const result = await postCompletion({ endpoint, apiKey, body, signal, fetchImpl, timeoutMs });
      const { res, text } = result;
      last = result;
      usage = responseMetadata(result, request);
      if (res.ok) {
        const { content } = readCompletion(text, endpoint);
        let data;
        try {
          data = parseJsonLoose(content);
        } catch (err) {
          if (!usePrefill) throw err;
          try { data = parseJsonLoose(prefill + content); } catch { throw err; }
        }
        return { data, rawText: content, used: { jsonMode: useJsonMode, prefill: usePrefill }, usage, request: { ...request } };
      }
      if (res.status === 400) {
        if ((useJsonMode && mentionsJsonMode(text)) || (usePrefill && mentionsPrefill(text))) {
          if (usage) request.priorUsage = [...(request.priorUsage || []), { attempt: i + 1, usage }];
          if (useJsonMode && mentionsJsonMode(text)) useJsonMode = false;
          else usePrefill = false;
          continue;
        }
      }
      break;
    }
    throw httpError(last, endpoint);
  } catch (error) {
    throw requestError(error, request, usage);
  }
}

export async function callText(options, { messages, signal, requestContext, fetchImpl = globalThis.fetch } = {}) {
  const { model, temperature = 0.9, timeoutMs = 120000 } = options;
  const { endpoint, apiKey } = requestOptions(options, fetchImpl);
  if (!Array.isArray(messages) || !messages.length) {
    throw new RetryableError('没有可发送的消息', { kind: 'schema' });
  }
  if (messages.some((message) => !message || !['system', 'user', 'assistant'].includes(message.role)
    || typeof message.content !== 'string')) {
    throw new RetryableError('消息须包含有效角色和文本', { kind: 'schema' });
  }
  const { params, request } = providerRequest(options, endpoint, requestContext);
  const body = { model, temperature, messages, ...outputLimit(options.maxOutputTokens), ...params };
  request.attempts = 1;
  let usage = null;
  try {
    const result = await postCompletion({ endpoint, apiKey, body, signal, fetchImpl, timeoutMs });
    usage = responseMetadata(result, request);
    if (!result.res.ok) throw httpError(result, endpoint);
    const { content } = readCompletion(result.text, endpoint);
    return { text: content.trim(), usage, request: { ...request } };
  } catch (error) {
    throw requestError(error, request, usage);
  }
}

export async function probe(options, { fetchImpl = globalThis.fetch } = {}) {
  const { data } = await callJson(
    { ...options, timeoutMs: 20000 },
    {
      system: '你只返回 JSON。',
      user: '只返回 {"ok":true,"hello":"world"}，不要任何其他内容。',
      fetchImpl,
    },
  );
  return { ok: true, preview: JSON.stringify(data).slice(0, 120) };
}
