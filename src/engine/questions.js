import { CET4_QUESTION_BANK } from '../content/cet4-questions.js';
import { LEARNING_QUESTIONS } from '../content/learning-bank.js';
import { emptyLearning, selectQuestion } from './learning.js';
import { matchesBank } from './banks.js';

export const DEFAULT_EVERY_N = 3;

/** 全部题目。 */
export function allQuestions() {
  return LEARNING_QUESTIONS;
}

/** 按 id 取题。 */
export function findQuestion(id) {
  return allQuestions().find((q) => q.id === id) || null;
}

/** 题库概览，供设置页展示。 */
export function describeBank() {
  const items = allQuestions();
  const byType = {};
  const byDifficulty = {};
  for (const q of items) {
    byType[q.type] = (byType[q.type] || 0) + 1;
    byDifficulty[q.difficulty] = (byDifficulty[q.difficulty] || 0) + 1;
  }
  return { total: items.length, byType, byDifficulty, id: CET4_QUESTION_BANK.id };
}

/**
 * 抽一道题，尽量避开本会话已出过的。
 * @param {object} opts
 * @param {object} opts.session    当前会话（读 usedQuestionIds）
 * @param {string} opts.difficulty 'all' | 'basic' | 'advanced'
 * @param {function} opts.rng
 */
export function drawQuestion({ session = null, difficulty = 'all', rng = Math.random, learning = emptyLearning(), bank = learning.plan?.bank || 'cet4', frequency = learning.plan?.frequency || 'all', topic = 'all', type = 'all' } = {}) {
  const used = new Set(session?.usedQuestionIds || []);
  let pool = allQuestions().filter(q => matchesBank(q, bank, frequency) && (topic === 'all' || q.topic === topic) && (type === 'all' || q.type === type) && q.type !== 'listening');
  if (difficulty && difficulty !== 'all') pool = pool.filter((q) => q.difficulty === difficulty);

  let fresh = pool.filter((q) => !used.has(q.id));
  if (!fresh.length) fresh = pool; // 出完了就允许重出
  if (!fresh.length) throw new Error('题库中没有可用的题目');
  const usedGroups = new Set(allQuestions().filter((q) => used.has(q.id)).map((q) => q.variantGroup));
  const spaced = fresh.filter((q) => !usedGroups.has(q.variantGroup));
  const picked = selectQuestion(spaced.length ? spaced : fresh, learning, { bank, frequency, difficulty, rng, topic, type, audio: false, usedIds: [...used] });
  if (!picked) throw new Error('当前筛选下没有可用的题目');
  return picked;
}

/** 把题目渲染成给模型看的文本块（选择题带选项，填空题附作答线索）。 */
export function renderQuestionBody(q) {
  const lines = [q.stem];
  if (q.promptHint) lines.push(`提示：${q.promptHint}`);
  if (Array.isArray(q.options) && q.options.length) {
    const letters = 'ABCDEFGH';
    q.options.forEach((opt, i) => lines.push(`${letters[i]}. ${opt}`));
  }
  return lines.join('\n');
}

/**
 * 把用户消息与题目拼成一段发给模型的文本。
 * 题目由 <Question>…</Question> 包裹；参考答案作为私有参考附在后面。
 */
export function composeOutgoing({ userText, question }) {
  const text = String(userText ?? '').trim();
  if (!question) return text;
  const block = [`<Question>`, renderQuestionBody(question), `</Question>`].join('\n');
  const key = question.answer
    ? `\n\n<AnswerKey>${question.answer}</AnswerKey>\n<TeachingReference>${JSON.stringify({ accepts: question.accepts, explanation: question.explanation, hint: question.hint, rubric: question.rubric, type: question.type }).replace(/</g, '\\u003c')}</TeachingReference>`
    : '';
  return `${text}\n\n${block}${key}`.trim();
}

/**
 * 判断这一轮要不要插题。
 * 依据「模型实际回复的轮数」：assistantReplyCount 是本会话已有的角色回复条数，
 * 每累计 everyN 条就出一道。
 */
export function shouldAsk({ assistantReplyCount, everyN = DEFAULT_EVERY_N, alreadyHasQuestion = false }) {
  if (alreadyHasQuestion) return false;
  const n = Number(everyN);
  if (!Number.isFinite(n) || n <= 0) return false;
  return assistantReplyCount > 0 && assistantReplyCount % n === 0;
}

/** 距离下一题还差几条角色回复，用于界面提示。 */
export function repliesUntilNext({ assistantReplyCount, everyN = DEFAULT_EVERY_N }) {
  const n = Number(everyN);
  if (!Number.isFinite(n) || n <= 0) return null;
  const rem = assistantReplyCount % n;
  return rem === 0 ? 0 : n - rem;
}

/* ---------------- 休息期 ---------------- */

export const DEFAULT_REST = {
  enabled: true,
  questionsBeforeRest: 10, // 出满这么多题后进入休息
  restTurns: 10,           // 休息期持续这么多轮对话
};

function clampInt(v, min, max, fallback) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** 从会话读出休息期配置与当前进度，缺省即默认值。 */
export function restState(session) {
  const c = session?.restConfig || {};
  return {
    enabled: c.enabled !== false,
    questionsBeforeRest: clampInt(c.questionsBeforeRest, 1, 100, DEFAULT_REST.questionsBeforeRest),
    restTurns: clampInt(c.restTurns, 1, 100, DEFAULT_REST.restTurns),
    questionsSinceRest: clampInt(session?.questionsSinceRest, 0, 10000, 0),
    restTurnsLeft: clampInt(session?.restTurnsLeft, 0, 10000, 0),
  };
}

/**
 * 决定这一轮要不要出题，并给出推进后的休息状态。
 *
 * 判定顺序：
 *   1. 在休息期里 → 不出题，休息轮数减一
 *   2. 没到出题节奏 → 不出题
 *   3. 到节奏了 → 出题；若这正好是本周期的最后一题，出完即进入休息期
 *
 * 注意：休息期从「最后一题发出去」的那一刻开始计时，而不是等它被答对。
 *
 * @returns {{inject:boolean, reason:string, next:object}}
 */
export function planInjection({ assistantReplyCount, everyN = DEFAULT_EVERY_N, session = null }) {
  const st = restState(session);

  if (st.restTurnsLeft > 0) {
    return { inject: false, reason: 'rest', next: { ...st, restTurnsLeft: st.restTurnsLeft - 1 } };
  }
  if (!shouldAsk({ assistantReplyCount, everyN })) {
    return { inject: false, reason: 'cadence', next: st };
  }

  const asked = st.questionsSinceRest + 1;
  if (st.enabled && asked >= st.questionsBeforeRest) {
    return {
      inject: true,
      reason: 'last-before-rest',
      next: { ...st, questionsSinceRest: 0, restTurnsLeft: st.restTurns },
    };
  }
  return { inject: true, reason: 'normal', next: { ...st, questionsSinceRest: asked } };
}

/** 把 planInjection 返回的 next 写回会话。 */
export function applyRestState(session, next) {
  return {
    ...session,
    restConfig: {
      enabled: next.enabled,
      questionsBeforeRest: next.questionsBeforeRest,
      restTurns: next.restTurns,
    },
    questionsSinceRest: next.questionsSinceRest,
    restTurnsLeft: next.restTurnsLeft,
  };
}

/** 供界面显示的一句话状态。 */
export function restLabel(session) {
  const st = restState(session);
  if (!st.enabled) return { text: '休息期已关', resting: false };
  if (st.restTurnsLeft > 0) return { text: `休息期 剩 ${st.restTurnsLeft} 轮`, resting: true };
  return { text: `本周期已出 ${st.questionsSinceRest}/${st.questionsBeforeRest} 题`, resting: false };
}
