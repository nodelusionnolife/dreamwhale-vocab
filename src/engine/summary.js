export const SUMMARY_MIN_LENGTH = 20;
export const SUMMARY_MAX_LENGTH = 50;

export function summaryLength(value) {
  return [...String(value ?? '').replace(/\s/gu, '')].length;
}

export function validSummary(value) {
  if (typeof value !== 'string' || /[<>]/u.test(value)) return false;
  const length = summaryLength(value);
  return length >= SUMMARY_MIN_LENGTH && length <= SUMMARY_MAX_LENGTH;
}

export function stripTurnSummary(value) {
  const text = String(value ?? '');
  const tags = /<\/?TurnSummary\b[^>]*(?:>|$)/gi;
  let depth = 0;
  let cursor = 0;
  let result = '';
  for (const match of text.matchAll(tags)) {
    const closing = /^<\//.test(match[0]);
    if (!closing) {
      if (depth === 0) result += text.slice(cursor, match.index);
      depth += 1;
    } else if (depth > 0) {
      depth -= 1;
    } else {
      result += text.slice(cursor, match.index);
    }
    cursor = match.index + match[0].length;
  }
  if (depth === 0) result += text.slice(cursor);
  return result;
}

export function parseTurnSummary(value) {
  const source = String(value ?? '');
  const tags = source.match(/<\/?TurnSummary\b/gi) || [];
  const match = /<TurnSummary>([\s\S]*?)<\/TurnSummary>\s*$/i.exec(source);
  if (tags.length === 2 && match && validSummary(match[1].trim())) {
    const text = source.slice(0, match.index).trimEnd();
    return {
      text,
      summary: match[1].trim(),
      summaryRaw: source.slice(text.length),
      summaryStatus: 'valid',
    };
  }
  return {
    text: stripTurnSummary(source).trimEnd(),
    summary: null,
    summaryRaw: '',
    summaryStatus: tags.length ? 'invalid' : 'missing',
  };
}

export function normalizeSummaryMessage(message) {
  if (message.role !== 'assistant') return message;
  if (validSummary(message.summary) && message.summaryStatus !== 'invalid') {
    const parsed = parseTurnSummary(message.summaryRaw);
    return {
      ...message,
      text: stripTurnSummary(message.text),
      summary: message.summary.trim(),
      summaryRaw: parsed.summary === message.summary.trim() && !parsed.text.trim() ? message.summaryRaw : `\n<TurnSummary>${message.summary.trim()}</TurnSummary>`,
      summaryStatus: 'valid',
    };
  }
  const parsed = parseTurnSummary(message.text);
  return { ...message, ...parsed, summaryStatus: message.summaryStatus === 'invalid' ? 'invalid' : parsed.summaryStatus };
}

export function summarySuffix(message) {
  if (message.summaryStatus !== 'valid' || !validSummary(message.summary)) return '';
  const parsed = parseTurnSummary(message.summaryRaw);
  return parsed.summary === message.summary.trim() && !parsed.text.trim()
    ? message.summaryRaw
    : `\n<TurnSummary>${message.summary.trim()}</TurnSummary>`;
}

export function completeTurns(messages) {
  const turns = [];
  for (let i = 0; i < messages.length - 1; i += 1) {
    const user = messages[i];
    const assistant = messages[i + 1];
    if (user.role !== 'user' || assistant.role !== 'assistant') continue;
    if (assistant.parentId && assistant.parentId !== user.id) continue;
    turns.push({ user, assistant, index: i });
    i += 1;
  }
  return turns;
}

export function applyCompaction(session, plan = {}) {
  const selected = new Set(plan.messageIds || []);
  let questionContext = plan.questionContext ?? session.questionContext ?? null;
  const list = session.messages || [];
  const historical = list.at(-1)?.role === 'user' ? list.slice(0, -1) : list;
  const latestQuestion = [...historical].reverse().find((message) => message.role === 'user' && message.questionId);
  let protectedId = null;
  if (latestQuestion && selected.has(latestQuestion.id)) {
    if (questionContext?.sourceMessageId !== latestQuestion.id) {
      if (typeof latestQuestion.promptInjection === 'string' && /<Question>[\s\S]*?<\/Question>/i.test(latestQuestion.promptInjection)) {
        questionContext = { sourceMessageId: latestQuestion.id, questionId: latestQuestion.questionId, promptInjection: latestQuestion.promptInjection };
      } else {
        protectedId = latestQuestion.id;
      }
    }
  }
  const turns = completeTurns(list).filter(({ user, assistant }) =>
    selected.has(user.id) && selected.has(assistant.id)
    && user.id !== protectedId
    && !user.compacted && !assistant.compacted && validSummary(assistant.summary)
    && assistant.summaryStatus === 'valid');
  if (!turns.length) return session;
  const ids = new Set(turns.flatMap(({ user, assistant }) => [user.id, assistant.id]));
  const at = plan.at ?? session.updatedAt ?? 0;
  return {
    ...session,
    trimCursor: 0,
    messages: session.messages.map((message) => ids.has(message.id) ? {
      ...message,
      text: '',
      ...(message.role === 'user' ? { promptInjection: '' } : {}),
      compacted: true,
      compactedAt: at,
    } : message),
    questionContext,
    compaction: {
      version: 1,
      epoch: (session.compaction?.epoch || 0) + 1,
      at,
      turnCount: turns.length,
      totalTurns: (session.compaction?.totalTurns || 0) + turns.length,
    },
  };
}
