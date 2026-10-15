import { RetryableError } from '../engine/judge.js';

export const DEFAULT_ENDPOINT = 'https://api.deepseek.com/chat/completions';
export const DEFAULT_MODEL = 'deepseek-chat';

export const PROFILE_PRESETS = [
  { id: 'deepseek', provider: 'deepseek', label: 'DeepSeek', endpoint: DEFAULT_ENDPOINT, model: DEFAULT_MODEL, cacheMode: 'auto' },
  { id: 'openai', provider: 'openai', label: 'OpenAI', endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini', cacheMode: 'auto' },
  { id: 'openrouter', provider: 'openrouter', label: 'OpenRouter', endpoint: 'https://openrouter.ai/api/v1/chat/completions', model: 'openai/gpt-4o-mini', cacheMode: 'auto' },
  { id: 'ollama', provider: 'ollama', label: '本地 Ollama', endpoint: 'http://localhost:11434/v1/chat/completions', model: 'qwen2.5:7b', cacheMode: 'auto' },
  { id: 'custom', provider: 'custom', label: '自定义（OpenAI 兼容）', endpoint: '', model: '', cacheMode: 'auto' },
];

const PROVIDERS = new Set(PROFILE_PRESETS.map((preset) => preset.id));
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

  const { provider, cacheMode } = normalizeModelProfile({ ...options, endpoint });
  const request = { provider, cacheMode, model: options.model, routing: 'none', attempts: 0 };
  const params = {};
  const url = parsedEndpoint(endpoint);
  if (cacheMode === 'auto' && requestContext?.sessionId) {
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
