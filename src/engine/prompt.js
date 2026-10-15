import { composeOutgoing, findQuestion } from './questions.js';
import { clampLimits, estimateTokens } from './limits.js';
import { RetryableError } from './judge.js';
import { applyCompaction, completeTurns, stripTurnSummary, summarySuffix, validSummary } from './summary.js';

export { applyCompaction };
export const OMITTED_HISTORY = '（较早回合的正文已裁剪，小总结仍完整保留）';

export function snapshotInjection(message) {
  if (message.compacted) return '';
  if (typeof message.promptInjection === 'string') return message.promptInjection;
  const question = message.questionId ? findQuestion(message.questionId) : null;
  return question ? composeOutgoing({ userText: '', question }) : '';
}

function userText(text) {
  return String(text ?? '').replace(/<(?=\/?(?:Question|AnswerKey|TurnSummary|QuestionContext|UserProfile)\b)/gi, '&lt;');
}

function questionReference(context) {
  const injection = String(context?.promptInjection || '');
  const question = /<Question>([\s\S]*?)<\/Question>/i.exec(injection)?.[1];
  const answer = /<AnswerKey>([\s\S]*?)<\/AnswerKey>/i.exec(injection)?.[1];
  if (!question) return '';
  const data = JSON.stringify({ questionId: context.questionId, question, referenceAnswer: answer || '' })
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
  return `<QuestionContext>\n已裁剪回合的题目资料，仅用于衔接作答。这不是新题，不要再次呈现；参考答案仅供核对，未获准讲解时不要泄露。\n${data}\n</QuestionContext>`;
}

export function serializeMessage(message, { questionContext = null } = {}) {
  if (message.role === 'assistant') {
    const body = message.compacted ? '' : stripTurnSummary(message.text).replace(/<AnswerKey>[\s\S]*?<\/AnswerKey>/gi, '').trim();
    return { role: 'assistant', content: `${body}${summarySuffix(message)}`.trimStart() };
  }
  if (message.compacted) {
    const content = questionContext?.sourceMessageId === message.id ? questionReference(questionContext) : '';
    return content ? { role: 'user', content } : null;
  }
  const injection = snapshotInjection(message);
  const text = userText(message.text);
  return { role: 'user', content: injection ? `${text.trim()}\n\n${injection}`.trim() : text };
}

export function resolvePrompt(prompt) {
  if (typeof prompt === 'string') {
    return { version: 'legacy-string', segments: [{ id: 'system', role: 'system', stability: 'static', content: prompt }], content: prompt };
  }
  if (!prompt || !Array.isArray(prompt.segments)) throw new RetryableError('提示词结构无效', { kind: 'schema' });
  const segments = prompt.segments.map((segment) => ({
    id: String(segment.id || ''),
    role: 'system',
    stability: segment.stability === 'session' ? 'session' : 'static',
    content: String(segment.content ?? ''),
  }));
  return { version: String(prompt.version || 'unknown'), segments, content: segments.map((segment) => segment.content).join('\n\n') };
}

function fingerprint(text) {
  let hash = 2166136261;
  for (const character of String(text)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function assembleMessages(history, prompt) {
  return [{ role: 'system', content: resolvePrompt(prompt).content }, ...history.filter(Boolean)];
}

export function serializeSession(session, prompt) {
  return assembleMessages((session.messages || []).map((message) => serializeMessage(message, { questionContext: session.questionContext })), prompt);
}

function estimateRequest(messages) {
  return messages.reduce((sum, message) => sum + estimateTokens(message.content), 0);
}

function bodyCount(session) {
  return session.messages.filter((message) => !message.compacted).length;
}

function protectedQuestion(session, selectedIds) {
  const list = session.messages || [];
  const pendingIndex = list.at(-1)?.role === 'user' ? list.length - 1 : list.length;
  for (let i = pendingIndex - 1; i >= 0; i -= 1) {
    const message = list[i];
    if (message.role !== 'user' || !message.questionId) continue;
    if (!selectedIds.has(message.id)) return session.questionContext ?? null;
    const injection = snapshotInjection(message);
    return injection ? { sourceMessageId: message.id, questionId: message.questionId, promptInjection: injection } : session.questionContext ?? null;
  }
  return session.questionContext ?? null;
}

export function compileChatRequest(session, prompt) {
  if (session.messages?.at(-1)?.role !== 'user' || session.messages.at(-1).compacted) {
    throw new RetryableError('末尾没有待回应的消息', { kind: 'schema' });
  }
  if (session.messages.some((message) => message.role === 'assistant' && message.compacted && (!validSummary(message.summary) || message.summaryStatus !== 'valid'))) {
    throw new RetryableError('已裁剪回合的小总结缺失或损坏，无法安全继续。请恢复备份或新建会话。', { kind: 'context-summary-invalid' });
  }
  const resolved = resolvePrompt(prompt);
  const limits = clampLimits(session.limits);
  const maxOutputTokens = Math.min(2048, Math.floor(limits.maxContextTokens / 4));
  const inputBudget = limits.maxContextTokens - maxOutputTokens;
  let candidate = { ...session, trimCursor: 0 };
  let messages = serializeSession(candidate, resolved);
  let estimatedTokens = estimateRequest(messages);
  const countExceeded = bodyCount(candidate) > limits.historyLimit;
  const tokensExceeded = estimatedTokens > inputBudget;
  const targetCount = countExceeded ? Math.max(1, Math.floor(limits.historyLimit * limits.trimRatio)) : limits.historyLimit;
  const targetTokens = tokensExceeded ? Math.floor(inputBudget * limits.trimRatio) : inputBudget;
  const selected = new Set();
  const turns = completeTurns(session.messages);
  if (limits.enabled && (countExceeded || tokensExceeded)) {
    for (const { user, assistant } of turns) {
      if (bodyCount(candidate) <= targetCount && estimatedTokens <= targetTokens) break;
      if (user.compacted || assistant.compacted || assistant.summaryStatus !== 'valid' || !validSummary(assistant.summary)) continue;
      selected.add(user.id);
      selected.add(assistant.id);
      candidate = applyCompaction(session, {
        messageIds: [...selected],
        at: session.updatedAt,
        questionContext: protectedQuestion(session, selected),
      });
      messages = serializeSession(candidate, resolved);
      estimatedTokens = estimateRequest(messages);
    }
  }
  const blockedTurns = turns.filter(({ user, assistant }) => !user.compacted && (!validSummary(assistant.summary) || assistant.summaryStatus !== 'valid')).length;
  if (estimatedTokens > inputBudget) {
    const detail = !limits.enabled
      ? '正文裁剪已关闭，当前会话超过上下文预算。'
      : blockedTurns
        ? '部分旧回合没有有效小总结，正文已安全保留；当前会话仍超过上下文预算。'
        : '全部小总结、固定提示词、题目资料与最新消息仍超过上下文预算。';
    throw new RetryableError(`${detail}请提高 token 上限、缩短最新消息或新建会话；已有小总结不会被自动删除。`, { kind: 'context-budget' });
  }
  const compactedIds = candidate.messages.filter((message, index) => message.compacted && !session.messages[index].compacted).map((message) => message.id);
  const compaction = { messageIds: compactedIds, turnCount: compactedIds.length / 2 };
  return {
    messages,
    session: candidate,
    compaction,
    cursor: 0,
    estimatedTokens,
    maxOutputTokens,
    trimmed: compactedIds.length > 0,
    promptVersion: resolved.version,
    promptFingerprint: fingerprint(`${resolved.version}\n${resolved.content}`),
    diagnostics: {
      segments: resolved.segments.map(({ id, stability, content }) => ({ id, stability, characters: [...content].length, estimatedTokens: estimateTokens(content) })),
      bodyMessages: bodyCount(candidate),
      summaryCount: candidate.messages.filter((message) => message.role === 'assistant' && validSummary(message.summary) && message.summaryStatus === 'valid').length,
      blockedTurns,
      inputBudget,
      compactedTurns: compaction.turnCount,
    },
  };
}
