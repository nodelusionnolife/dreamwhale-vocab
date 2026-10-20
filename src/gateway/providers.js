import { RetryableError } from '../engine/judge.js';

export const DEFAULT_ENDPOINT = 'https://api.deepseek.com/chat/completions';
export const DEFAULT_MODEL = 'deepseek-flash';

export const API_FORMATS = { chat: 'OpenAI Chat Completions', responses: 'OpenAI Responses', anthropic: 'Anthropic Messages', gemini: 'Gemini generateContent' };
export const AUTH_MODES = ['auto', 'bearer', 'api-key', 'x-api-key', 'x-goog-api-key', 'none'];

const preset = (id, provider, label, endpoint, model, apiFormat = 'chat', extra = {}) => ({
  id, provider, label, endpoint, model, apiFormat, authMode: 'auto', cacheMode: 'auto',
  sendTemperature: false, streamUsage: true, jsonMode: 'auto', tokenField: 'max_tokens', ...extra,
});

export const PROFILE_PRESETS = [
  preset('deepseek', 'deepseek', 'DeepSeek', DEFAULT_ENDPOINT, DEFAULT_MODEL),
  preset('deepseek-responses', 'deepseek', 'DeepSeek · Responses', 'https://api.deepseek.com/responses', DEFAULT_MODEL, 'responses'),
  preset('openai', 'openai', 'OpenAI · Chat Completions', 'https://api.openai.com/v1/chat/completions', 'gpt-4o-mini', 'chat', { tokenField: 'max_completion_tokens' }),
  preset('openai-responses', 'openai', 'OpenAI · Responses', 'https://api.openai.com/v1/responses', 'gpt-4o-mini', 'responses'),
  preset('anthropic', 'anthropic', 'Anthropic / Claude', 'https://api.anthropic.com/v1/messages', 'claude-sonnet-5-5', 'anthropic'),
  preset('gemini', 'gemini', 'Google Gemini', 'https://generativelanguage.googleapis.com/v1beta', 'gemini-3.8-flash', 'gemini'),
  preset('qwen', 'qwen', '阿里云百炼 / 通义千问', 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', 'qwen-plus'),
  preset('qwen-intl', 'qwen', '阿里云百炼 · 国际', 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions', 'qwen-plus'),
  preset('moonshot', 'moonshot', 'Kimi / Moonshot', 'https://api.moonshot.cn/v1/chat/completions', 'kimi-k3'),
  preset('doubao', 'doubao', '火山方舟 / 豆包', 'https://ark.cn-beijing.volces.com/api/v3/chat/completions', 'doubao-seed-2-0-mini-260428'),
  preset('minimax', 'minimax', 'MiniMax', 'https://api.minimax.cn/v1/chat/completions', 'MiniMax-M3', 'chat', { tokenField: 'max_completion_tokens' }),
  preset('siliconflow', 'siliconflow', '硅基流动 / SiliconFlow', 'https://api.siliconflow.cn/v1/chat/completions', 'deepseek-ai/DeepSeek-V3.2'),
  preset('groq', 'groq', 'Groq', 'https://api.groq.com/openai/v1/chat/completions', 'openai/gpt-oss-120b', 'chat', { tokenField: 'max_completion_tokens' }),
  preset('xai', 'xai', 'xAI / Grok · Responses', 'https://api.x.ai/v1/responses', 'grok-4.7', 'responses'),
  preset('mistral', 'mistral', 'Mistral', 'https://api.mistral.ai/v1/chat/completions', 'mistral-small-latest', 'chat', { streamUsage: false }),
  preset('openrouter', 'openrouter', 'OpenRouter', 'https://openrouter.ai/api/v1/chat/completions', 'openai/gpt-4o-mini'),
  preset('ollama', 'ollama', '本地 Ollama', 'http://localhost:11434/v1/chat/completions', 'qwen2.5:7b'),
  preset('lmstudio', 'lmstudio', '本地 LM Studio', 'http://localhost:1234/v1/chat/completions', ''),
  preset('custom', 'custom', '自定义接口', '', ''),
];

const PROVIDERS = new Set(PROFILE_PRESETS.map((preset) => preset.provider));
const LEGACY_OPENAI_CACHE_MODELS = new Set([
  'gpt-4o-mini', 'gpt-4o-mini-2024-07-18',
  'gpt-4o', 'gpt-4o-2024-08-06', 'gpt-4o-2024-11-20',
]);

function parsedEndpoint(endpoint) {
  try { return new URL(endpoint); } catch { return null; }
}

function inferredProvider(endpoint) {
  const url = parsedEndpoint(endpoint);
  if (url?.origin === 'https://api.deepseek.com') return 'deepseek';
  if (url?.origin === 'https://api.openai.com') return 'openai';
  if (url?.origin === 'https://openrouter.ai') return 'openrouter';
  if (url && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return 'ollama';
  return 'custom';
}

export function normalizeModelProfile(raw = {}) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const endpoint = typeof source.endpoint === 'string' ? source.endpoint : DEFAULT_ENDPOINT;
  return {
    ...source,
    endpoint,
    model: typeof source.model === 'string' ? source.model : DEFAULT_MODEL,
    apiKey: typeof source.apiKey === 'string' ? source.apiKey : '',
    usePrefill: source.usePrefill !== false,
    apiFormat: Object.hasOwn(API_FORMATS, source.apiFormat) ? source.apiFormat : 'chat',
    authMode: AUTH_MODES.includes(source.authMode) ? source.authMode : 'auto',
    sendTemperature: source.sendTemperature !== false,
    streamUsage: source.streamUsage !== false,
    jsonMode: source.jsonMode === 'off' ? 'off' : 'auto',
    tokenField: source.tokenField === 'max_completion_tokens' ? 'max_completion_tokens' : 'max_tokens',
    provider: PROVIDERS.has(source.provider) ? source.provider : inferredProvider(endpoint),
    cacheMode: source.cacheMode === 'standard' || source.cacheMode === 'off' ? 'standard' : 'auto',
  };
}

export function emptyProfile() {
  return normalizeModelProfile();
}

function stableRoutingKey(sessionId, promptVersion, model) {
  let hash = 14695981039346656037n;
  for (const byte of new TextEncoder().encode(JSON.stringify([sessionId, promptVersion, model]))) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 1099511628211n);
  }
  return `dw-${hash.toString(16).padStart(16, '0')}`;
}

export function providerRequest(options, endpoint, requestContext) {
  if (options.provider !== undefined && !PROVIDERS.has(options.provider)) {
    throw new RetryableError('模型服务商选项无效', { kind: 'schema' });
  }
  if (options.cacheMode !== undefined && !['auto', 'standard', 'off'].includes(options.cacheMode)) {
    throw new RetryableError('请求模式选项无效', { kind: 'schema' });
  }
  if (requestContext !== undefined && (!requestContext || typeof requestContext !== 'object' || Array.isArray(requestContext))) {
    throw new RetryableError('请求会话信息无效', { kind: 'schema' });
  }
  for (const field of ['sessionId', 'promptVersion']) {
    const value = requestContext?.[field];
    if (value !== undefined && (typeof value !== 'string' || !value.trim() || value.length > 256)) {
      throw new RetryableError('请求会话信息无效', { kind: 'schema' });
    }
  }

  const { provider, cacheMode, apiFormat } = normalizeModelProfile({ ...options, endpoint });
  const request = { provider, cacheMode, apiFormat, model: options.model, routing: 'none', attempts: 0 };
  const params = {};
  const url = parsedEndpoint(endpoint);
  if (apiFormat === 'chat' && cacheMode === 'auto' && requestContext?.sessionId) {
    let field;
    if (provider === 'openai' && url?.origin === 'https://api.openai.com'
      && url.pathname === '/v1/chat/completions' && LEGACY_OPENAI_CACHE_MODELS.has(options.model)) {
      field = 'prompt_cache_key';
    } else if (provider === 'openrouter' && url?.origin === 'https://openrouter.ai'
      && url.pathname === '/api/v1/chat/completions') {
      field = 'session_id';
    }
    if (field) {
      const key = stableRoutingKey(requestContext.sessionId, requestContext.promptVersion || '1', options.model);
      params[field] = key;
      request.routing = field;
      request.routingKey = key;
    }
  }
  return { params, request };
}
