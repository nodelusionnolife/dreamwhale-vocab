export function learningStatistics(state, questions) {
  const byId = new Map(questions.map(q => [q.id, q]));
  const first = new Map(), byQuestion = new Map();
  for (const event of [...state.events].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))) {
    if (!['correct', 'incorrect', 'revealed'].includes(event.status)) continue;
    const instance = event.instanceId || event.id;
    if (!first.has(instance)) first.set(instance, { event, hinted: false, revealed: false });
    const attempt = first.get(instance);
    attempt.hinted ||= event.hintLevel > 0;
    attempt.revealed ||= event.status === 'revealed';
  }
  for (const { event, hinted, revealed } of first.values()) {
    const q = event.question || byId.get(event.questionId);
    if (!q) continue;
    const key = `${event.questionId}@${event.questionVersion || 1}`;
    if (!byQuestion.has(key)) byQuestion.set(key, { questionId: event.questionId, version: event.questionVersion || 1, type: q.type,
      attempts: 0, correct: 0, hinted: 0, revealed: 0, errors: 0 });
    const row = byQuestion.get(key);
    row.attempts++;
    row.correct += Number(event.status === 'correct' && !event.assisted);
    row.hinted += Number(hinted);
    row.revealed += Number(revealed);
    row.errors += Number(event.status === 'incorrect');
  }
  const byType = new Map();
  for (const row of byQuestion.values()) {
    if (!byType.has(row.type)) byType.set(row.type, { type: row.type, attempts: 0, correct: 0, hinted: 0, revealed: 0, repeatedErrors: 0 });
    const total = byType.get(row.type);
    for (const key of ['attempts', 'correct', 'hinted', 'revealed']) total[key] += row[key];
    total.repeatedErrors += Number(row.errors >= 2);
  }
  return { questions: [...byQuestion.values()], types: [...byType.values()] };
}
