import { DEFAULT_PLAN, validateStudy, validatePracticeInstance } from './study-state.js';
import { matchesBank } from './banks.js';
import { resolvedProgressKey, resolvedAcceptedAnswers } from '../content/question-metadata.js';

export const DAY = 86400000;
export const SKILLS = { recognition: '认义', reading: '语境理解', recall: '拼写回忆', usage: '搭配用法', formation: '词形', production: '表达', listening: '听辨' };

export function emptyLearning() {
  return { version: 1, revision: 0, events: [], active: {}, favorites: [], plan: { ...DEFAULT_PLAN }, round: null, pausedRounds: [], closedRounds: [], preferences: { topic: 'all', type: 'all', difficulty: 'all', queue: 'mixed' } };
}

export function normalizeAnswer(value) {
  return String(value ?? '').normalize('NFKC').trim().toLowerCase().replace(/[‘’]/g, "'").replace(/[.!?。！？]+$/g, '').replace(/\s+/g, ' ');
}

export function createQuestionInstance(question, { id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`, now = Date.now(), rng = Math.random } = {}) {
  const snapshot = JSON.parse(JSON.stringify(question));
  if (snapshot.options) {
    for (let i = snapshot.options.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [snapshot.options[i], snapshot.options[j]] = [snapshot.options[j], snapshot.options[i]];
    }
  }
  return { id, question: snapshot, createdAt: now, hintLevel: 0, tries: 0, status: 'pending', response: '', result: null };
}

export function gradeAnswer(question, input) {
  let value = normalizeAnswer(input);
  if (!value) throw new Error('先写下你的答案。');
  if (question.options && /^[a-h]$/.test(value)) value = normalizeAnswer(question.options[value.charCodeAt(0) - 97] || value);
  const accepted = resolvedAcceptedAnswers(question).map(normalizeAnswer);
  if (question.grading === 'semantic') return { status: 'needs-model', answer: String(input) };
  return { status: accepted.includes(value) ? 'correct' : 'incorrect', answer: String(input), explanation: question.explanation || '' };
}

export function normalizeAssessment(raw) {
  if (!raw || !['correct', 'incorrect', 'uncertain'].includes(raw.status) || typeof raw.explanation !== 'string' || !raw.explanation.trim()) {
    throw new Error('评价格式不完整，请重试；这次没有计入学习记录。');
  }
  return { status: raw.status, explanation: raw.explanation.slice(0, 800) };
}

export function progressKey(question) {
  return resolvedProgressKey(question, `${question.senseId || (question.targetWords || [question.answer])[0] + ':core'}|${question.skill || 'recall'}`);
}

export function learningProgress(state) {
  const map = Object.create(null);
  for (const event of [...state.events].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))) {
    if (['skipped', 'uncertain'].includes(event.status)) continue;
    const key = resolvedProgressKey(event, event.key);
    const p = map[key] || { key, word: event.word, seen: 0, independent: 0, streak: 0, lastAt: 0, dueAt: 0, skill: key.split('|').at(-1), lastStatus: '' };
    p.seen += 1;
    p.lastAt = event.at;
    p.lastStatus = event.status;
    if (event.status === 'correct' && !event.assisted) {
      p.independent += 1;
      if (!p.streak || event.at >= p.dueAt) {
        p.streak += 1;
        p.dueAt = event.at + [1, 3, 7, 14, 30][Math.min(p.streak - 1, 4)] * DAY;
      }
    } else {
      p.streak = 0;
      p.dueAt = event.at + (event.status === 'correct' ? DAY : 10 * 60000);
    }
    map[key] = p;
  }
  return map;
}

export function recordOutcome(state, instance, result, { now = Date.now(), source = 'practice' } = {}) {
  if (!['correct', 'incorrect', 'revealed', 'skipped', 'uncertain'].includes(result.status)) throw new Error('学习结果无效。');
  const q = instance.question;
  if (state.events.some((e) => e.id === `${instance.id}:${instance.tries}`)) return state;
  const event = {
    id: `${instance.id}:${instance.tries}`, instanceId: instance.id, questionId: q.id, questionVersion: q.version || 1,
    key: progressKey(q), word: (q.targetWords || [q.answer])[0], skill: q.skill || 'recall',
    group: q.variantGroup || q.id, status: result.status, answer: String(result.answer || ''),
    assisted: instance.hintLevel > 0 || instance.tries > 0 || result.status === 'revealed',
    at: now, source, hintLevel: instance.hintLevel,
    ...(result.status === 'incorrect' ? { question: JSON.parse(JSON.stringify(q)) } : {}),
  };
  return { ...state, events: [...state.events.filter((e) => e.id !== event.id), event] };
}

export function selectQuestion(questions, state, { bank = state.plan?.bank || 'cet4', frequency = state.plan?.frequency || 'all', topic = 'all', type = 'all', difficulty = 'all', queue = 'mixed', now = Date.now(), rng = Math.random, usedIds = [], audio = true, semantic = true } = {}) {
  let pool = questions.filter((q) => matchesBank(q, bank, frequency) && (topic === 'all' || q.topic === topic) && (type === 'all' || q.type === type)
    && (difficulty === 'all' || q.difficulty === difficulty) && (q.type !== 'listening' || audio) && (q.grading !== 'semantic' || semantic));
  const progress = learningProgress(state);
  const due = (q) => progress[progressKey(q)]?.dueAt <= now;
  if (queue === 'review') pool = pool.filter(due);
  if (queue === 'favorites') pool = pool.filter((q) => state.favorites.includes(q.targetWords?.[0]));
  if (!pool.length) return null;
  const duePool = pool.filter(due);
  if (duePool.length) pool = duePool;
  const recent = state.events.slice(-8);
  const recentGroups = new Set(recent.map((e) => e.group));
  const recentWords = new Set(recent.slice(-3).map((e) => e.word));
  const spaced = pool.filter((q) => !recentGroups.has(q.variantGroup || q.id) && !recentWords.has(q.targetWords?.[0]));
  if (spaced.length) pool = spaced;
  if (!duePool.length) {
    const seen = new Set([...state.events.map((e) => e.questionId), ...usedIds]);
    const unseen = pool.filter((q) => !seen.has(q.id));
    if (unseen.length) pool = unseen;
  }
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
}

export function learningSummary(state, now = Date.now()) {
  const progress = Object.values(learningProgress(state));
  const graded = state.events.filter((e) => ['correct', 'incorrect'].includes(e.status));
  const independent = graded.filter((e) => e.status === 'correct' && !e.assisted).length;
  return { words: new Set(progress.map((p) => p.word)).size, due: progress.filter((p) => p.dueAt <= now).length,
    independent, attempts: graded.length, steady: progress.filter((p) => p.streak >= 3).length };
}

export function validateLearning(raw) {
  if (!raw || raw.version !== 1 || !Array.isArray(raw.events) || !raw.active || typeof raw.active !== 'object' || Array.isArray(raw.active)
    || !Array.isArray(raw.favorites) || !raw.favorites.every((w) => typeof w === 'string')) throw new Error('学习记录格式不正确或版本不受支持。');
  const ids = new Set();
  for (const e of raw.events) {
    if (!e || typeof e.id !== 'string' || !e.id || ids.has(e.id) || typeof e.key !== 'string' || typeof e.word !== 'string'
      || !Object.keys(SKILLS).includes(e.skill) || !['correct','incorrect','revealed','skipped','uncertain'].includes(e.status)
      || !Number.isFinite(e.at) || typeof e.assisted !== 'boolean') throw new Error('学习记录包含损坏的作答。');
    ids.add(e.id);
    if (e.question !== undefined && (!e.question || e.question.id !== e.questionId || (e.question.version || 1) !== (e.questionVersion || 1)
      || typeof e.question.stem !== 'string' || typeof e.question.answer !== 'string' || typeof e.question.explanation !== 'string'
      || !Array.isArray(e.question.targetWords) || !e.question.targetWords.every((word) => typeof word === 'string')
      || (e.question.options !== undefined && (!Array.isArray(e.question.options) || !e.question.options.every((s) => typeof s === 'string')))
      || (e.question.accepts !== undefined && (!Array.isArray(e.question.accepts) || !e.question.accepts.every((s) => typeof s === 'string'))))) throw new Error('错题的题目快照已损坏。');
  }
  for (const a of Object.values(raw.active)) validatePracticeInstance(a);
  return { ...emptyLearning(), ...raw, ...validateStudy(raw), preferences: { ...emptyLearning().preferences, ...raw.preferences } };
}
