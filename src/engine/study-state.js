import { BANKS, FREQUENCIES } from './banks.js';

export const DEFAULT_PLAN = { bank: 'cet4', frequency: 'all', topic: 'all', newGoal: 10, reviewGoal: 10 };
export const ROUND_LABELS = { new: '新词学习', review: '复习与进阶', mistakes: '薄弱巩固', errors: '错题重练', favorites: '收藏练习', drill: '专项训练' };

export function validatePracticeInstance(a) {
  if (!a || typeof a.id !== 'string' || !a.id || !a.question || typeof a.question.stem !== 'string' || typeof a.question.answer !== 'string'
    || !['pending','correct','revealed','skipped'].includes(a.status) || !Number.isInteger(a.tries) || a.tries < 0
    || !Number.isInteger(a.hintLevel) || a.hintLevel < 0 || a.hintLevel > 2
    || (a.response !== undefined && typeof a.response !== 'string')
    || (a.question.options !== undefined && (!Array.isArray(a.question.options) || !a.question.options.every((x) => typeof x === 'string')))
    || (a.question.accepts !== undefined && (!Array.isArray(a.question.accepts) || !a.question.accepts.every((x) => typeof x === 'string')))
    || (a.result !== null && a.result !== undefined && (!['correct','incorrect','uncertain'].includes(a.result.status) || typeof a.result.explanation !== 'string'))) throw new Error('进行中的题目已损坏。');
}

export function validateStudy(raw) {
  const plan = { ...DEFAULT_PLAN, ...raw.plan };
  if (!Object.hasOwn(BANKS, plan.bank)) throw new Error('题库选择无效。');
  if (!Object.hasOwn(FREQUENCIES, plan.frequency)) throw new Error('词频范围无效。');
  if (typeof plan.topic !== 'string' || ![plan.newGoal, plan.reviewGoal].every((n) => Number.isInteger(n) && n >= 1 && n <= 30)) throw new Error('学习计划格式不正确。');
  const round = raw.round || null;
  const pausedRounds = raw.pausedRounds === undefined ? [] : raw.pausedRounds;
  const closedRounds = raw.closedRounds === undefined ? [] : raw.closedRounds;
  if (!Array.isArray(closedRounds) || !closedRounds.every(id => typeof id === 'string' && id) || new Set(closedRounds).size !== closedRounds.length) throw new Error('已结束的练习记录已损坏。');
  if (!Array.isArray(pausedRounds)) throw new Error('暂存练习列表已损坏。');
  const rounds = round ? [{ round, practice: raw.active.practice }] : [];
  for (const saved of pausedRounds) {
    if (!saved?.round || saved.round.finishedAt !== null) throw new Error('暂存练习记录已损坏。');
    validatePracticeInstance(saved.practice);
    rounds.push(saved);
  }
  const allIds = new Set();
  for (const { round, practice } of rounds) {
    if (!Object.hasOwn(ROUND_LABELS, round.kind) || !Array.isArray(round.items) || !round.items.length || round.items.length > 30 || round.id !== round.items[0]?.id
      || !Number.isInteger(round.index) || round.index < 0 || round.index > round.items.length
      || !Array.isArray(round.results) || round.results.length !== round.index
      || !['recall','answer'].includes(round.phase) || !Number.isFinite(round.startedAt)
      || (round.finishedAt !== null && !Number.isFinite(round.finishedAt))) throw new Error('分组练习记录不完整。');
    for (const item of round.items) {
      validatePracticeInstance(item);
      if (allIds.has(item.id) || !Array.isArray(item.question.targetWords) || !item.question.targetWords.every((w) => typeof w === 'string')) throw new Error('分组练习题目已损坏。');
      allIds.add(item.id);
    }
    for (let i = 0; i < round.results.length; i++) {
      const result = round.results[i];
      if (!result || result.instanceId !== round.items[i].id || !['correct','revealed','skipped'].includes(result.status) || typeof result.word !== 'string' || typeof result.independent !== 'boolean') throw new Error('分组练习结果已损坏。');
    }
    if (round.finishedAt === null && (round.index === round.items.length || practice?.id !== round.items[round.index]?.id)) throw new Error('分组练习与当前题目不一致。');
  }
  return { plan, round, pausedRounds, closedRounds };
}
