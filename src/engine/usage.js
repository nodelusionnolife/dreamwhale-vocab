function tokenCount(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

function firstCount(...values) {
  for (const value of values) {
    const n = tokenCount(value);
    if (n !== null) return n;
  }
  return null;
}

export function normalizeUsageShape(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const prompt = tokenCount(usage.prompt);
  const completion = tokenCount(usage.completion);
  const total = tokenCount(usage.total)
    ?? (prompt !== null && completion !== null ? tokenCount(prompt + completion) : null);
  let cached = tokenCount(usage.cached);
  if (prompt !== null && cached !== null && cached > prompt) cached = null;
  let cacheWrite = tokenCount(usage.cacheWrite);
  if (prompt !== null && cacheWrite !== null && (cacheWrite > prompt || (cached !== null && cached + cacheWrite > prompt))) cacheWrite = null;
  let uncached = tokenCount(usage.uncached);
  if (prompt !== null && uncached !== null && (uncached > prompt || (cached !== null && uncached + cached > prompt)
    || (cacheWrite !== null && uncached + cacheWrite > prompt)
    || (cached !== null && cacheWrite !== null && uncached + cached + cacheWrite > prompt))) uncached = null;
  if (prompt === null && completion === null && total === null && cached === null && cacheWrite === null && uncached === null) return null;
  return {
    prompt, completion, total, cached,
    ...(cacheWrite !== null ? { cacheWrite } : {}),
    ...(uncached !== null ? { uncached } : {}),
  };
}

export function normalizeUsage(raw, format = 'chat') {
  if (!raw || typeof raw !== 'object') return null;
  let prompt = firstCount(raw.prompt_tokens, raw.input_tokens, raw.promptTokenCount, raw.prompt_eval_count);
  let completion = firstCount(raw.completion_tokens, raw.output_tokens, raw.candidatesTokenCount, raw.eval_count);
  if (format === 'anthropic' && prompt !== null) prompt += (tokenCount(raw.cache_read_input_tokens) || 0) + (tokenCount(raw.cache_creation_input_tokens) || 0);
  if (format === 'gemini' && completion !== null) completion += tokenCount(raw.thoughtsTokenCount) || 0;
  return normalizeUsageShape({
    prompt, completion,
    total: firstCount(raw.total_tokens, raw.totalTokenCount),
    cached: firstCount(
      raw.prompt_cache_hit_tokens,
      raw.prompt_tokens_details?.cached_tokens,
      raw.input_tokens_details?.cached_tokens,
      raw.cachedContentTokenCount,
      raw.cache_read_input_tokens,
      raw.cached_tokens,
    ),
    cacheWrite: firstCount(raw.prompt_tokens_details?.cache_write_tokens, raw.cache_write_tokens, raw.cache_creation_input_tokens),
    uncached: firstCount(raw.prompt_cache_miss_tokens),
  });
}

export function cacheHitRate(usage) {
  const normalized = normalizeUsageShape(usage);
  if (!normalized || normalized.cached === null || !normalized.prompt) return null;
  return normalized.cached / normalized.prompt;
}
