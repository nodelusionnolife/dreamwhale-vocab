import { BANKS, FREQUENCIES } from './banks.js';

export const DEFAULT_PLAN = { bank: 'cet4', frequency: 'all', topic: 'all', newGoal: 10, reviewGoal: 10 };
export const ROUND_LABELS = { new: '新词学习', review: '到期复习', mistakes: '薄弱巩固', errors: '错题重练', favorites: '收藏练习', drill: '专项训练' };

export function validateStudy(raw) {
  const plan = { ...DEFAULT_PLAN, ...raw.plan };
  if (!Object.hasOwn(BANKS, plan.bank)) throw new Error('题库选择无效。');
  if (!Object.hasOwn(FREQUENCIES, plan.frequency)) throw new Error('词频范围无效。');
  if (typeof plan.topic !== 'string' || ![plan.newGoal, plan.reviewGoal].every((n) => Number.isInteger(n) && n >= 1 && n <= 30)) throw new Error('学习计划格式不正确。');
  const round = raw.round || null;
  if (round) {
    if (!Object.hasOwn(ROUND_LABELS, round.kind) || !Array.isArray(round.items) || !round.items.length || round.items.length > 30 || round.id !== round.items[0]?.id
      || !Number.isInteger(round.index) || round.index < 0 || round.index > round.items.length
      || !Array.isArray(round.results) || round.results.length !== round.index
      || !['recall','answer'].includes(round.phase) || !Number.isFinite(round.startedAt)
      || (round.finishedAt !== null && !Number.isFinite(round.finishedAt))) throw new Error('分组练习记录不完整。');
    const ids = new Set();
    for (const item of round.items) {
      if (!item || typeof item.id !== 'string' || ids.has(item.id) || !['pending','correct','revealed','skipped'].includes(item.status)
        || !Number.isInteger(item.tries) || item.tries < 0 || !Number.isInteger(item.hintLevel) || item.hintLevel < 0 || item.hintLevel > 2
        || typeof item.question?.stem !== 'string' || typeof item.question?.answer !== 'string'
        || !Array.isArray(item.question.targetWords) || !item.question.targetWords.every((w) => typeof w === 'string')
        || (item.question.options && (!Array.isArray(item.question.options) || !item.question.options.every((s) => typeof s === 'string')))
        || (item.question.accepts && (!Array.isArray(item.question.accepts) || !item.question.accepts.every((s) => typeof s === 'string')))) throw new Error('分组练习题目已损坏。');
      ids.add(item.id);
    }
    for (let i = 0; i < round.results.length; i++) {
      const result = round.results[i];
      if (!result || result.instanceId !== round.items[i].id || !['correct','revealed','skipped'].includes(result.status) || typeof result.word !== 'string' || typeof result.independent !== 'boolean') throw new Error('分组练习结果已损坏。');
    }
    if (round.finishedAt === null && (round.index === round.items.length || raw.active.practice?.id !== round.items[round.index]?.id)) throw new Error('分组练习与当前题目不一致。');
  }
  return { plan, round };
}
