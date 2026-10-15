import { normalizeUsageShape } from '../engine/usage.js';

export function contentFingerprint(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function describeRequest(compiled, profile, previous = null) {
  const messages = compiled.messages.map(({ role, content }) => ({
    role, length: String(content).length, fingerprint: contentFingerprint(`${role}\n${content}`),
  }));
  let unchangedMessages = 0;
  const prior = previous?.messages || [];
  while (unchangedMessages < Math.min(prior.length, messages.length)
    && prior[unchangedMessages].fingerprint === messages[unchangedMessages].fingerprint
    && prior[unchangedMessages].length === messages[unchangedMessages].length) unchangedMessages++;
  let endpointHost = '';
  try { endpointHost = new URL(profile.endpoint).host; } catch { /* empty */ }
  return {
    endpointHost,
    model: String(profile.model || ''),
    promptVersion: compiled.promptVersion || 'legacy',
    fingerprint: contentFingerprint(JSON.stringify(messages)),
    messages,
    unchangedMessages: previous ? unchangedMessages : null,
    estimatedTokens: compiled.estimatedTokens,
    maxOutputTokens: compiled.maxOutputTokens,
    compactedTurns: compiled.compaction?.turnCount || 0,
  };
}

export function recordRequest(session, record) {
  return {
    ...session,
    lastRequest: record.request,
    requestLog: [...(Array.isArray(session.requestLog) ? session.requestLog : []), {
      at: record.at,
      durationMs: record.durationMs,
      status: record.status,
      kind: record.kind || null,
      provider: record.provider || 'custom',
      model: record.request.model,
      promptVersion: record.request.promptVersion,
      fingerprint: record.request.fingerprint,
      unchangedMessages: record.request.unchangedMessages,
      compactedTurns: record.request.compactedTurns,
      usage: normalizeUsageShape(record.usage),
    }].slice(-64),
  };
}
