import { createQuestionInstance, learningProgress, progressKey, recordOutcome } from './learning.js';
import { mistakeArchive, mistakeKey } from './mistakes.js';
import { matchesBank } from './banks.js';

import { DEFAULT_PLAN, ROUND_LABELS } from './study-state.js';
export const wordOf = (q) => q.targetWords?.[0] || q.answer;

export function catalogOf(questions) {
  const entries = new Map();
  for (const question of questions) {
    const word = wordOf(question);
    if (!entries.has(word)) entries.set(word, { word, topics: [], questions: [] });
    const entry = entries.get(word);
    if (!entry.topics.includes(question.topic)) entry.topics.push(question.topic);
    entry.questions.push(question);
  }
  return [...entries.values()];
}

export function dayStart(now = Date.now()) {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

export function studyOverview(questions, state, now = Date.now()) {
  const plan = { ...DEFAULT_PLAN, ...state.plan };
  const bankQuestions = questions.filter(q => matchesBank(q, plan.bank, plan.frequency));
  const bankKeys = new Set(bankQuestions.map(progressKey));
  const byId = new Map(questions.map(q => [q.id, q]));
  const catalog = catalogOf(bankQuestions).filter((entry) => plan.topic === 'all' || entry.topics.includes(plan.topic));
  const words = new Set(catalog.map((entry) => entry.word));
  const firstSeen = new Map();
  const todayNew = new Set();
  const todayReview = new Set();
  const start = dayStart(now);
  for (const event of [...state.events].sort((a, b) => a.at - b.at)) {
    if (!words.has(event.word) || !matchesBank(event.question || byId.get(event.questionId) || { targetWords: [event.word] }, plan.bank, plan.frequency) || ['skipped', 'uncertain'].includes(event.status)) continue;
    if (!firstSeen.has(event.word)) firstSeen.set(event.word, event.at);
    if (event.at < start || event.at > now || !['correct', 'revealed'].includes(event.status)) continue;
    if (firstSeen.get(event.word) >= start) todayNew.add(event.word);
    if (firstSeen.get(event.word) < start || ['study:review', 'study:mistakes', 'study:errors'].includes(event.source)) todayReview.add(event.word);
  }
  const progress = Object.values(learningProgress(state)).filter((p) => words.has(p.word) && bankKeys.has(p.key));
  const newAvailable = catalog.filter((entry) => !firstSeen.has(entry.word)).length;
  const due = new Set(progress.filter((p) => p.dueAt <= now).map((p) => p.word)).size;
  const newTarget = Math.min(plan.newGoal, newAvailable + todayNew.size);
  const reviewTarget = Math.min(plan.reviewGoal, due + todayReview.size);
  return {
    plan, total: catalog.length, seen: firstSeen.size,
    newAvailable, due, newTarget, reviewTarget,
    weak: new Set(progress.filter((p) => p.streak === 0).map((p) => p.word)).size,
    newDone: todayNew.size, reviewDone: todayReview.size,
    newRemaining: Math.max(0, newTarget - todayNew.size),
    reviewRemaining: Math.max(0, reviewTarget - todayReview.size),
  };
}

export function roundPending(state) {
  return Boolean(state.round && state.round.index < state.round.items.length && state.round.finishedAt === null);
}

export function startRound(questions, state, { kind = 'new', count = 10, bank = state.plan?.bank || 'cet4', frequency = state.plan?.frequency || 'all', topic = state.plan?.topic || 'all', type = 'all', difficulty = 'all', word = null, questionKey = null, now = Date.now(), rng = Math.random, audio = true, semantic = false } = {}) {
  if (roundPending(state)) throw new Error('还有一组练习没有完成，请先继续或结束这一组。');
  if (!ROUND_LABELS[kind]) throw new Error('练习类型无效。');
  const bankKeys = new Set(questions.filter(q => matchesBank(q, bank, frequency)).map(progressKey));
  const progress = Object.fromEntries(Object.entries(learningProgress(state)).filter(([key]) => bankKeys.has(key)));
  const seenWords = new Set(Object.values(progress).map((p) => p.word));
  const source = kind === 'errors' ? mistakeArchive(state, questions).filter((entry) => entry.archivedAt === null && entry.question).map((entry) => entry.question) : questions;
  let pool = source.filter((q) => matchesBank(q, bank, frequency) && (!questionKey || mistakeKey(q.id, q.version) === questionKey) && (topic === 'all' || q.topic === topic) && (type === 'all' || q.type === type)
    && (difficulty === 'all' || q.difficulty === difficulty) && (!word || wordOf(q) === word)
    && (audio || q.type !== 'listening') && (semantic || q.grading !== 'semantic'));
  if (kind === 'new') pool = pool.filter((q) => !seenWords.has(wordOf(q)) && q.type !== 'listening');
  if (kind === 'review') pool = pool.filter((q) => progress[progressKey(q)]?.dueAt <= now);
  if (kind === 'mistakes') pool = pool.filter((q) => progress[progressKey(q)]?.streak === 0);
  if (kind === 'favorites') pool = pool.filter((q) => state.favorites.includes(wordOf(q)));
  const shuffled = pool.map((q) => ({ q, order: rng() }));
  shuffled.sort((a, b) => {
    if (kind === 'review') return progress[progressKey(a.q)].dueAt - progress[progressKey(b.q)].dueAt || a.order - b.order;
    if (kind === 'new') return Number(!a.q.options) - Number(!b.q.options) || a.order - b.order;
    return a.order - b.order;
  });
  const selected = [];
  const selectedWords = new Set();
  for (const { q } of shuffled) {
    if (selectedWords.has(wordOf(q))) continue;
    selected.push(createQuestionInstance(q, { now, rng }));
    selectedWords.add(wordOf(q));
    if (selected.length >= Math.max(1, Math.min(30, count))) break;
  }
  if (!selected.length) throw new Error(kind === 'review' ? '当前范围没有到期的词，稍后再来复习。' : '当前范围没有可练习的词，请换个主题或题型。');
  return { ...state, round: { id: selected[0].id, kind, bank, frequency, topic, type, items: selected, index: 0, results: [], phase: 'recall', startedAt: now, finishedAt: null, endedEarly: false }, active: { ...state.active, practice: selected[0] } };
}

export function resumeLegacyPractice(state, now = Date.now()) {
  if (state.round || !state.active.practice) return state;
  const current = state.active.practice;
  return { ...state, round: { id: current.id, kind: 'drill', topic: 'all', type: 'all', items: [current], index: 0, results: [], phase: 'answer', startedAt: now, finishedAt: null, endedEarly: false } };
}

export function advanceRound(state, { now = Date.now(), end = false, expectedId = null } = {}) {
  if (expectedId && state.active.practice?.id !== expectedId) throw new Error('当前题目已在另一页面变化，请查看最新进度后继续。');
  if (!roundPending(state)) return state;
  const current = state.active.practice;
  if (!current || current.id !== state.round.items[state.round.index]?.id) throw new Error('这一组的进度已变化，请重新打开后继续。');
  let updated = state;
  if (current.status === 'pending') updated = recordOutcome(state, current, { status: 'skipped' }, { now, source: `study:${state.round.kind}` });
  const result = { instanceId: current.id, questionId: current.question.id, word: wordOf(current.question), status: current.status === 'pending' ? 'skipped' : current.status, independent: current.status === 'correct' && current.hintLevel === 0 && current.tries === 1 };
  const index = state.round.index + 1;
  const finished = end || index === state.round.items.length;
  const active = { ...updated.active };
  if (finished) delete active.practice;
  else active.practice = state.round.items[index];
  return { ...updated, active, round: { ...state.round, index, results: [...state.round.results, result], phase: 'recall', finishedAt: finished ? now : null, endedEarly: end && index < state.round.items.length } };
}
