import { RetryableError } from '../engine/judge.js';
import { normalizeUsage } from '../engine/usage.js';
import { API_FORMATS, AUTH_MODES } from './providers.js';

export function validateProtocol(options) {
  for (const [key, values] of Object.entries({ apiFormat: Object.keys(API_FORMATS), authMode: AUTH_MODES, jsonMode: ['auto', 'off'], tokenField: ['max_tokens', 'max_completion_tokens'] })) {
    if (options[key] !== undefined && !values.includes(options[key])) throw new RetryableError('接口格式或自定义选项无效', { kind: 'schema' });
  }
  for (const key of ['sendTemperature', 'streamUsage']) {
    if (options[key] !== undefined && typeof options[key] !== 'boolean') throw new RetryableError('接口开关须为布尔值', { kind: 'schema' });
  }
}

export function requestHeaders(options, apiKey) {
  const format = options.apiFormat || 'chat';
  const mode = !options.authMode || options.authMode === 'auto'
    ? format === 'anthropic' ? 'x-api-key' : format === 'gemini' ? 'x-goog-api-key' : 'bearer'
    : options.authMode;
  return {
    'Content-Type': 'application/json',
    ...(apiKey && mode !== 'none' ? mode === 'bearer' ? { Authorization: `Bearer ${apiKey}` } : { [mode]: apiKey } : {}),
    ...(format === 'anthropic' ? { 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' } : {}),
  };
}

export function buildBody(options, messages, { jsonMode = false, temperature = 0.9, params = {} } = {}) {
  const format = options.apiFormat || 'chat';
  const limit = options.maxOutputTokens;
  if (limit !== undefined && limit !== null && (!Number.isSafeInteger(limit) || limit <= 0)) throw new RetryableError('输出 token 上限须为正整数', { kind: 'schema' });
  const sampling = options.sendTemperature === false ? {} : { temperature };
  const instructions = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
  const turns = messages.filter(m => m.role !== 'system');
  if (format === 'responses') return {
    model: options.model, store: false, ...(instructions ? { instructions } : {}),
    input: turns.map(m => ({ role: m.role, content: m.content })), ...sampling,
    ...(limit ? { max_output_tokens: limit } : {}), ...(jsonMode ? { text: { format: { type: 'json_object' } } } : {}),
  };
  if (format === 'anthropic') return {
    model: options.model, ...(instructions ? { system: instructions } : {}), messages: turns,
    max_tokens: limit || 4096, ...(options.sendTemperature === false ? {} : { temperature: Math.min(1, temperature) }),
  };
  if (format === 'gemini') return {
    ...(instructions ? { systemInstruction: { parts: [{ text: instructions }] } } : {}),
    contents: turns.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
    generationConfig: { ...sampling, ...(limit ? { maxOutputTokens: limit } : {}), ...(jsonMode ? { responseMimeType: 'application/json' } : {}) },
  };
  return {
    model: options.model, messages, ...sampling, ...params,
    ...(limit ? { [options.tokenField || 'max_tokens']: limit } : {}),
    ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
  };
}

export function streamingBody(body, options) {
  if (options.apiFormat === 'gemini') return body;
  return { ...body, stream: true, ...((options.apiFormat || 'chat') === 'chat' && options.streamUsage !== false ? { stream_options: { include_usage: true } } : {}) };
}

export function usageFrom(payload, format = 'chat') {
  return normalizeUsage(format === 'gemini' ? payload?.usageMetadata : payload?.usage, format);
}

export function finishReason(payload, format = 'chat') {
  if (format === 'responses') return payload?.incomplete_details?.reason || payload?.status;
  if (format === 'anthropic') return payload?.stop_reason;
  if (format === 'gemini') return payload?.candidates?.[0]?.finishReason || payload?.promptFeedback?.blockReason;
  return payload?.choices?.[0]?.finish_reason;
}

export function checkFinish(reason, format = 'chat') {
  if (['length', 'max_tokens', 'max_output_tokens', 'MAX_TOKENS'].includes(reason)) throw new RetryableError('模型回复达到长度上限，请缩短输入或调整上下文限额后重试', { kind: 'length' });
  const allowed = format === 'responses' ? ['completed'] : format === 'anthropic' ? ['end_turn', 'stop_sequence'] : format === 'gemini' ? ['STOP'] : ['stop'];
  if (reason && !allowed.includes(reason)) throw new RetryableError(`模型未完成文本回复（${reason}）`, { kind: 'incomplete' });
}

export function readPayload(payload, format = 'chat') {
  if (payload?.error) throw new RetryableError(String(payload.error.message || '模型返回错误'), { kind: 'http' });
  checkFinish(finishReason(payload, format), format);
  let content;
  if (format === 'responses') content = (payload?.output || []).filter(item => item.type === 'message').flatMap(item => item.content || []).filter(item => item.type === 'output_text').map(item => item.text || '').join('');
  else if (format === 'anthropic') content = (payload?.content || []).filter(item => item.type === 'text').map(item => item.text || '').join('');
  else if (format === 'gemini') content = geminiText(payload);
  else content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new RetryableError('模型未返回文本，请检查请求格式、模型权限或内容限制', { kind: 'empty' });
  return { content, usage: usageFrom(payload, format) };
}

function geminiText(payload) {
  return (payload?.candidates?.[0]?.content?.parts || []).filter(p => !p.thought && typeof p.text === 'string').map(p => p.text).join('');
}

export function streamState(format = 'chat') {
  const state = { text: '', usage: null, finished: false, reason: null, rawUsage: {} };
  state.accept = (payload, event) => {
    if (payload.error || event === 'error') throw new RetryableError(String(payload.error?.message || payload.message || '模型生成失败'), { kind: 'http' });
    let delta = '';
    if (format === 'responses') {
      const type = payload.type || event;
      if (payload.response?.usage) state.usage = usageFrom(payload.response, format);
      if (type === 'response.output_text.delta' && typeof payload.delta === 'string') delta = payload.delta;
      if (['response.completed', 'response.incomplete', 'response.failed'].includes(type)) {
        const final = readPayload(payload.response, format);
        state.text = final.content; state.usage = final.usage || state.usage; state.finished = true;
      }
    } else if (format === 'anthropic') {
      const type = payload.type || event;
      const raw = payload.usage || payload.message?.usage;
      if (raw) { Object.assign(state.rawUsage, raw); state.usage = normalizeUsage(state.rawUsage, format); }
      if (type === 'content_block_start' && payload.content_block?.type === 'text') delta = payload.content_block.text || '';
      if (type === 'content_block_delta' && payload.delta?.type === 'text_delta') delta = payload.delta.text || '';
      if (type === 'message_delta' && payload.delta?.stop_reason) state.reason = payload.delta.stop_reason;
      if (type === 'message_stop') { checkFinish(state.reason, format); state.finished = true; }
    } else if (format === 'gemini') {
      const usage = usageFrom(payload, format); if (usage) state.usage = usage;
      delta = geminiText(payload);
      const reason = finishReason(payload, format);
      if (reason) { checkFinish(reason, format); state.reason = reason; }
    } else {
      if (payload.usage) state.usage = usageFrom(payload, format);
      const choice = payload.choices?.[0];
      if (typeof choice?.delta?.content === 'string') delta = choice.delta.content;
      if (choice?.finish_reason) state.reason = choice.finish_reason;
    }
    state.text += delta;
    if (state.text.length > 200000) throw new RetryableError('回复过长，已停止接收', { kind: 'length' });
  };
  state.complete = () => {
    checkFinish(state.reason, format);
    if (!state.finished && !(state.reason && ['chat', 'gemini'].includes(format))) throw new RetryableError('连接中断，回复尚未完整接收', { kind: 'network' });
    if (!state.text.trim()) throw new RetryableError('接口没有返回文本', { kind: 'empty' });
    return { text: state.text.trim(), usage: state.usage };
  };
  return state;
}
