// 模型网关：OpenAI 兼容端点的 BYOK 直连。
// 只接受已编译好的 system / user 文本，看不到完整存档（见 AGENTS.md 目录约定）。

import { RetryableError, parseJsonLoose } from '../engine/judge.js';

export const DEFAULT_ENDPOINT = 'https://api.deepseek.com/chat/completions';
export const DEFAULT_MODEL = 'deepseek-chat';

export const PROFILE_PRESETS = [
  { id: 'deepseek', label: 'DeepSeek', endpoint: DEFAULT_ENDPOINT, model: DEFAULT_MODEL },
  { id: 'openai', label: 'OpenAI', endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini' },
  { id: 'ollama', label: '本地 Ollama', endpoint: 'http://localhost:11434/v1/chat/completions', model: 'qwen2.5:7b' },
  { id: 'custom', label: '自定义（任意 OpenAI 兼容端点）', endpoint: '', model: '' },
];

export function emptyProfile() {
  return { endpoint: DEFAULT_ENDPOINT, model: DEFAULT_MODEL, apiKey: '', usePrefill: true };
}

export function isLocalEndpoint(endpoint) {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(endpoint || '');
}

/**
 * 把用户填的地址归一化成真正要请求的端点。
 *
 * 大多数人的直觉是填 base URL（`https://api.deepseek.com/v1`），而不是完整路径。
 * 这里两种都接受：
 *   - 已经以 /chat/completions 结尾 → 原样使用
 *   - 路径为空、或是 /、或末段像版本号（v1 / v2 / v1beta…）→ 补上 /chat/completions
 *   - 其它自定义路径 → 不动它（可能是自建代理，猜反而会坏事）
 *
 * @param {string} raw
 * @returns {string}
 */
export function normalizeEndpoint(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const trimmed = s.replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(trimmed)) return trimmed;

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return trimmed; // 不是合法 URL，交给请求层报错，不在这里改写
  }
  const path = url.pathname.replace(/\/+$/, '');
  const lastSeg = path.split('/').filter(Boolean).pop() || '';
  const looksLikeBase = path === '' || /^v\d+[a-z0-9]*$/i.test(lastSeg);
  if (looksLikeBase) {
    url.pathname = `${path}/chat/completions`;
    return url.toString().replace(/\/$/, '');
  }
  return trimmed;
}

/**
 * 端点与 Key 是否就绪——唯一的判定来源。
 * 编排层与网关都调这一个，避免同一套规则散落多处（那种重复最典型的后果，
 * 是某处被改动后另一处静默失效）。
 * @returns {{ready:boolean, kind?:string, message?:string}}
 */
export function modelReadiness(profile) {
  const endpoint = normalizeEndpoint(profile?.endpoint);
  const apiKey = profile?.apiKey || '';
  if (!endpoint) {
    return { ready: false, kind: 'no-endpoint', message: '尚未配置模型端点' };
  }
  if (!apiKey && !isLocalEndpoint(endpoint)) {
    return { ready: false, kind: 'no-key', message: '尚未填写 API Key' };
  }
  return { ready: true };
}

/** 不就绪就抛可重试错误。 */
export function assertModelReady(profile) {
  const r = modelReadiness(profile);
  if (!r.ready) throw new RetryableError(r.message, { kind: r.kind });
  return true;
}

function hostOf(endpoint) {
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint || '（未填）';
  }
}

async function postOnce({ endpoint, model, apiKey, temperature, useJsonMode, prefill, system, user, signal, fetchImpl, timeoutMs }) {
  const timer = new AbortController();
  const onAbort = () => timer.abort();
  if (signal) {
    if (signal.aborted) timer.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  const timeout = setTimeout(() => timer.abort(), timeoutMs);
  try {
    const messages = [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ];
    // 预填充：追加一条不完整的 assistant 消息，把模型锁进既定结构的开头
    if (prefill) messages.push({ role: 'assistant', content: prefill });

    const body = { model, temperature, messages };
    // 部分端点/代理不支持 response_format，降级时整个字段移除
    if (useJsonMode) body.response_format = { type: 'json_object' };

    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: timer.signal,
    });
    return res;
  } catch (err) {
    const aborted = timer.signal.aborted;
    throw new RetryableError(
      aborted ? `请求 ${hostOf(endpoint)} 超时或被取消` : `无法连接 ${hostOf(endpoint)}：${err?.message || err}`,
      { kind: aborted ? 'timeout' : 'network' },
    );
  } finally {
    clearTimeout(timeout);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

const mentionsJsonMode = (text) => /response_format|json_object|json mode|response format/i.test(String(text || ''));
const mentionsPrefill = (text) => /prefill|prefix|assistant[^.]{0,20}(last|final|end)|end with[^.]{0,20}user|must be a user|最后一条|assistant 消息/i.test(String(text || ''));

/**
 * 发一次要求 JSON 输出的调用。
 * 依次尝试「JSON 模式 + 预填充」，并在端点明确抱怨某一项时逐项降级，最多三次。
 * @returns {Promise<{data: object, rawText: string, used: {jsonMode: boolean, prefill: boolean}}>}
 */
export async function callJson(options, { system, user, prefill = '', signal, fetchImpl = globalThis.fetch } = {}) {
  const {
    model, apiKey, temperature = 0.2, timeoutMs = 90000,
  } = options;
  const endpoint = normalizeEndpoint(options.endpoint);
  assertModelReady({ endpoint, apiKey });
  if (typeof fetchImpl !== 'function') {
    throw new RetryableError('当前环境不支持 fetch', { kind: 'no-fetch' });
  }

  let useJsonMode = true;
  let usePrefill = Boolean(prefill);
  let last = null;

  for (let i = 0; i < 3; i += 1) {
    const res = await postOnce({
      endpoint, model, apiKey, temperature, useJsonMode,
      prefill: usePrefill ? prefill : '',
      system, user, signal, fetchImpl, timeoutMs,
    });
    const text = await res.text().catch(() => '');
    last = { res, text };

    if (res.ok) {
      return finish({ res, text, prefill: usePrefill ? prefill : '', endpoint, used: { jsonMode: useJsonMode, prefill: usePrefill } });
    }
    // 端点是别人的，兼容性得自己兜：只在明确抱怨某一项时才降级
    if (res.status === 400) {
      if (useJsonMode && mentionsJsonMode(text)) { useJsonMode = false; continue; }
      if (usePrefill && mentionsPrefill(text)) { usePrefill = false; continue; }
    }
    break;
  }

  const { res, text } = last;
  let msg = text.slice(0, 300);
  try {
    msg = JSON.parse(text)?.error?.message || msg;
  } catch { /* 保留原文 */ }
  throw new RetryableError(`${hostOf(endpoint)} 返回 ${res.status}：${msg}`, { raw: text, kind: 'http' });
}

function finish({ res, text, prefill, endpoint, used }) {
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new RetryableError(`${hostOf(endpoint)} 返回的不是 JSON（可能是反向代理或登录页）`, { raw: text, kind: 'not-json' });
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (!content) {
    const detail = payload?.error?.message || 'choices[0].message.content 为空';
    throw new RetryableError(`模型未返回内容：${detail}`, { raw: text, kind: 'empty' });
  }

  // 有的端点把预填充回显进 content，有的只返回续写部分。两种都要能解析。
  let data;
  try {
    data = parseJsonLoose(content);
  } catch (err) {
    if (prefill) {
      try {
        data = parseJsonLoose(prefill + content);
      } catch {
        throw err;
      }
    } else {
      throw err;
    }
  }
  return { data, rawText: content, used };
}

/**
 * 归一化 token 用量。
 * - 输入输出：OpenAI 兼容用 prompt_tokens / completion_tokens，Ollama 原生用 prompt_eval_count / eval_count
 * - 缓存命中：DeepSeek 用 prompt_cache_hit_tokens，OpenAI 用 prompt_tokens_details.cached_tokens，
 *   Anthropic 用 cache_read_input_tokens。三种都认。
 * 端点没返回用量时返回 null——不估算、不编造。
 */
export function normalizeUsage(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const prompt = num(raw.prompt_tokens ?? raw.prompt_eval_count);
  const completion = num(raw.completion_tokens ?? raw.eval_count);
  let total = num(raw.total_tokens);
  if (total === null && prompt !== null && completion !== null) total = prompt + completion;
  const cached = num(
    raw.prompt_cache_hit_tokens
    ?? raw.prompt_tokens_details?.cached_tokens
    ?? raw.cache_read_input_tokens
    ?? raw.cached_tokens,
  );
  if (prompt === null && completion === null && total === null && cached === null) return null;
  return { prompt, completion, total, cached };
}

/** 缓存命中率。没有缓存字段或没有输入量时返回 null——不猜。 */
export function cacheHitRate(usage) {
  if (!usage || usage.cached === null || usage.cached === undefined) return null;
  if (!usage.prompt) return null;
  return usage.cached / usage.prompt;
}

/**
 * 对话模式的纯文本调用：带完整消息历史，不要 JSON 模式、不要预填充。
 * 角色扮演要的是自由文本，任何结构约束都会让它说人话的能力下降。
 * @returns {Promise<{text: string, usage: {prompt:number|null,completion:number|null,total:number|null}|null}>}
 */
export async function callText(options, { messages, signal, fetchImpl = globalThis.fetch } = {}) {
  const {
    model, apiKey, temperature = 0.9, timeoutMs = 120000,
  } = options;
  const endpoint = normalizeEndpoint(options.endpoint);
  assertModelReady({ endpoint, apiKey });
  if (typeof fetchImpl !== 'function') {
    throw new RetryableError('当前环境不支持 fetch', { kind: 'no-fetch' });
  }
  if (!Array.isArray(messages) || !messages.length) {
    throw new RetryableError('没有可发送的消息', { kind: 'schema' });
  }

  const timer = new AbortController();
  const onAbort = () => timer.abort();
  if (signal) {
    if (signal.aborted) timer.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  const timeout = setTimeout(() => timer.abort(), timeoutMs);

  let res;
  try {
    res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ model, temperature, messages }),
      signal: timer.signal,
    });
  } catch (err) {
    const aborted = timer.signal.aborted;
    throw new RetryableError(
      aborted ? `请求 ${hostOf(endpoint)} 超时或被取消` : `无法连接 ${hostOf(endpoint)}：${err?.message || err}`,
      { kind: aborted ? 'timeout' : 'network' },
    );
  } finally {
    clearTimeout(timeout);
    if (signal) signal.removeEventListener('abort', onAbort);
  }

  const text = await res.text().catch(() => '');
  if (!res.ok) {
    let msg = text.slice(0, 300);
    try {
      msg = JSON.parse(text)?.error?.message || msg;
    } catch { /* 保留原文 */ }
    throw new RetryableError(`${hostOf(endpoint)} 返回 ${res.status}：${msg}`, { raw: text, kind: 'http' });
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new RetryableError(`${hostOf(endpoint)} 返回的不是 JSON（可能是反向代理或登录页）`, { raw: text, kind: 'not-json' });
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (!content || !String(content).trim()) {
    const detail = payload?.error?.message || 'choices[0].message.content 为空';
    throw new RetryableError(`模型未返回内容：${detail}`, { raw: text, kind: 'empty' });
  }
  return { text: String(content).trim(), usage: normalizeUsage(payload.usage) };
}

/**
 * 连通性测试：设置页用。发一条极小请求，确认端点、Key、模型名三者都能用。
 * @returns {Promise<{ok: true, preview: string}>}
 */
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
