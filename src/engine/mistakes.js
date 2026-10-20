export const MISTAKE_INTERVAL = 86400000;
export const mistakeKey = (questionId, version = 1) => `${questionId}@${version}`;

export function mistakeArchive(state, questions = []) {
  const bank = new Map(questions.map((q) => [mistakeKey(q.id, q.version), q]));
  const entries = new Map();
  for (const event of [...state.events].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))) {
    if (!event.questionId || ['skipped', 'uncertain'].includes(event.status)) continue;
    const key = mistakeKey(event.questionId, event.questionVersion);
    let entry = entries.get(key);
    if (event.status === 'incorrect') {
      if (!entry) {
        entry = { key, questionId: event.questionId, word: event.word, question: event.question || bank.get(key) || null,
          firstWrongAt: event.at, wrongCount: 0, successes: 0, lastSuccessAt: null, lastSuccessInstance: null, archivedAt: null };
        entries.set(key, entry);
      }
      entry.question = event.question || entry.question;
      entry.wrongCount++;
      entry.lastWrongAt = event.at;
      entry.lastWrongAnswer = event.answer || '';
      entry.successes = 0;
      entry.lastSuccessAt = null;
      entry.lastSuccessInstance = null;
      entry.archivedAt = null;
    } else if (entry && event.status === 'correct' && !event.assisted) {
      const instanceId = event.instanceId || event.id;
      if (entry.successes < 2 && instanceId !== entry.lastSuccessInstance && (entry.lastSuccessAt === null || event.at - entry.lastSuccessAt >= MISTAKE_INTERVAL)) {
        entry.successes++;
        entry.lastSuccessAt = event.at;
        entry.lastSuccessInstance = instanceId;
        if (entry.successes === 2) entry.archivedAt = event.at;
      }
    } else if (entry && (event.status === 'revealed' || event.status === 'correct' && event.assisted)) {
      entry.successes = 0;
      entry.lastSuccessAt = null;
      entry.lastSuccessInstance = null;
      entry.archivedAt = null;
    }
  }
  return [...entries.values()].sort((a, b) => b.lastWrongAt - a.lastWrongAt || a.key.localeCompare(b.key));
}
