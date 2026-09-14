// 副本运行的状态机。纯逻辑，不得 import 浏览器 API。
// 所有迁移都是纯函数：接收状态、返回新状态，方便测试与存档往返。
//
// 难度参数来自 src/content/difficulty.js，全部由代码控制，不经过模型。

import { getDifficulty, DEFAULT_DIFFICULTY } from '../content/difficulty.js';

export const SAVE_VERSION = 2;
const HISTORY_LIMIT = 60; // 存档体积受平台托管约 1MB 限制，历史只留最近若干条

const infinite = () => ({ left: null }); // left === null 表示无限

export function createRun({ tier = '基础', difficulty = DEFAULT_DIFFICULTY, runId } = {}) {
  const diff = getDifficulty(difficulty);
  return {
    version: SAVE_VERSION,
    runId: runId || `r_${Date.now().toString(36)}`,
    tier,
    difficulty: diff.id,
    sceneIndex: 1,
    outputTurns: 0,
    passedChallenges: 0,
    failures: 0,
    over: false,
    usedWords: [],
    usedScenes: [],
    items: {
      dice: infinite(),
      wildcard: diff.wildcardStart === null ? infinite() : { left: diff.wildcardStart },
    },
    current: null,
    lastScene: null,
    lastVerdict: null,
    history: [],
  };
}

export function difficultyOf(run) {
  return getDifficulty(run?.difficulty);
}

/** 失败上限；null 表示无限。 */
export function failureLimitOf(run) {
  return difficultyOf(run).failureLimit;
}

export function failuresLeft(run) {
  const limit = failureLimitOf(run);
  if (limit === null) return Infinity;
  return Math.max(0, limit - (run?.failures || 0));
}

export function wildcardsLeft(run) {
  const it = run?.items?.wildcard;
  if (!it) return 0;
  return it.left === null ? Infinity : it.left;
}

export function isOver(run) {
  return Boolean(run?.over);
}

export function itemLeft(run, key) {
  const it = run?.items?.[key];
  if (!it) return 0;
  return it.left === null ? Infinity : it.left;
}

export function useItem(run, key) {
  const left = itemLeft(run, key);
  if (left <= 0) throw new Error(`道具「${key}」已用尽`);
  const items = { ...run.items };
  if (items[key].left !== null) items[key] = { left: items[key].left - 1 };
  return { ...run, items };
}

function grantItem(run, key, n = 1) {
  const it = run.items?.[key];
  if (!it || it.left === null) return run; // 无限额度无需累加
  return { ...run, items: { ...run.items, [key]: { left: it.left + n } } };
}

/** 挂上一个新场景与手牌。lastScene 会保留到下一场景生成，供双栏展示使用。 */
export function setScene(run, { scene, pool }) {
  return {
    ...run,
    current: { scene, pool, selection: [] },
    lastScene: scene,
    lastVerdict: null,
  };
}

/** 骰子：重抽手牌（同一场景内目标词不变）。 */
export function reroll(run, { pool, charge = true }) {
  if (!run.current) throw new Error('没有进行中的场景');
  const base = charge ? useItem(run, 'dice') : run;
  return {
    ...base,
    current: { ...base.current, pool, selection: [] },
  };
}

export function isSelected(run, tileId) {
  return Boolean(run.current?.selection.includes(tileId));
}

/** 单击字母：未选中则追加到末尾，已选中则移除。顺序即点击顺序。 */
export function toggleTile(run, tileId) {
  if (!run.current) return run;
  const pool = run.current.pool.tiles.map((t) => t.id);
  if (!pool.includes(tileId)) return run;
  const sel = run.current.selection;
  const next = sel.includes(tileId) ? sel.filter((id) => id !== tileId) : [...sel, tileId];
  return { ...run, current: { ...run.current, selection: next } };
}

export function clearSelection(run) {
  if (!run.current) return run;
  return { ...run, current: { ...run.current, selection: [] } };
}

/** 撤销最后一个选中的字母。 */
export function undoSelection(run) {
  if (!run.current?.selection.length) return run;
  return { ...run, current: { ...run.current, selection: run.current.selection.slice(0, -1) } };
}

/** 当前拼出的单词。 */
export function selectedWord(run) {
  if (!run.current) return '';
  const byId = new Map(run.current.pool.tiles.map((t) => [t.id, t.ch]));
  return run.current.selection.map((id) => byId.get(id) || '').join('');
}

/**
 * 万能词：从本轮目标词里随机取一个，作为「预设的正确答案」直接提交。
 * 它并不豁免判定——目标词是出题时保证能诠释挑战的词，所以本来就该通过。
 * 目标词为空时返回空串，由调用方提示。
 */
export function pickWildcardWord(scene, rng = Math.random) {
  const words = (scene?.words || []).map((w) => w?.word).filter((w) => typeof w === 'string' && w);
  if (!words.length) return '';
  return words[Math.min(words.length - 1, Math.floor(rng() * words.length))];
}

/**
 * 万能词提交。与普通提交的唯一区别是不经过字母面板，
 * 其余（计轮数、走判定、按判定结果推进或回滚）完全一致。
 */
export function wildcardSubmit(run, word) {
  const clean = String(word || '').trim().toLowerCase();
  if (!/^[a-z]+$/.test(clean)) throw new Error('万能词必须是 A–Z 字母');
  const charged = useItem(run, 'wildcard');
  return commitAttempt(charged, clean, { viaWildcard: true });
}

/** 轮数在这里 +1：失败也计入输出轮数（见总设计案）。 */
export function commitAttempt(run, word, { viaWildcard = false } = {}) {
  if (run.over) throw new Error('本局已结束，请重新开始');
  return {
    ...run,
    outputTurns: run.outputTurns + 1,
    pending: { word: String(word).toLowerCase(), viaWildcard, sceneIndex: run.sceneIndex },
  };
}

/**
 * 应用判定结果。全部规则由代码执行：
 *   通过：场景推进、通过数 +1、按难度发放万能词、已完成场景保留在 lastScene。
 *   失败：失败数 +1，按难度判断是否触顶结束本局；未触顶则重发手牌。
 */
export function applyVerdict(run, verdict, { nextPool } = {}) {
  const pending = run.pending;
  if (!pending) throw new Error('没有待判定的提交');

  const entry = {
    sceneIndex: pending.sceneIndex,
    word: pending.word,
    viaWildcard: pending.viaWildcard,
    passed: verdict.passed,
    reason: verdict.reason || '',
    meaning: verdict.wordMeaning || '',
    at: Date.now(),
  };
  const history = [...run.history, entry].slice(-HISTORY_LIMIT);
  let base = { ...run, pending: null, lastVerdict: verdict, history };

  if (!verdict.passed) {
    const failures = base.failures + 1;
    const limit = failureLimitOf(base);
    const over = limit !== null && failures >= limit;
    const current = base.current
      ? { ...base.current, pool: nextPool || base.current.pool, selection: [] }
      : null;
    return { ...base, failures, over, current };
  }

  base = { ...base, passedChallenges: base.passedChallenges + 1 };
  const every = difficultyOf(base).wildcardGrantEvery;
  if (every && base.passedChallenges % every === 0) {
    base = grantItem(base, 'wildcard', 1);
  }

  const words = base.current?.scene?.words?.map((w) => w.word) || [];
  // 场景描述现在长达数百字，摘要只留「梗＋挑战目标」，够防重复又不撑爆存档
  const sc = base.current?.scene;
  const summary = sc ? `${sc.meme ? `${sc.meme}｜` : ''}${sc.objective}` : '';
  return {
    ...base,
    sceneIndex: base.sceneIndex + 1,
    usedWords: [...new Set([...base.usedWords, ...words])],
    usedScenes: summary ? [...base.usedScenes, summary].slice(-40) : base.usedScenes,
    current: null,
  };
}

/** 存档往返：只保留可序列化字段，并丢弃 Infinity 之类的非法值。 */
export function toSaveable(run) {
  const clean = JSON.parse(JSON.stringify(run, (k, v) => (v === Infinity ? null : v)));
  delete clean.pending;
  return clean;
}

export function fromSaveable(obj) {
  if (!obj || obj.version !== SAVE_VERSION) return null;
  const brandNew = createRun({ tier: obj.tier, difficulty: obj.difficulty, runId: obj.runId });
  const restoreItem = (raw, fallback) => {
    if (!raw) return fallback;
    return raw.left === null || raw.left === undefined ? infinite() : { left: raw.left };
  };
  return {
    ...brandNew,
    ...obj,
    items: {
      dice: restoreItem(obj.items?.dice, brandNew.items.dice),
      wildcard: restoreItem(obj.items?.wildcard, brandNew.items.wildcard),
    },
    pending: null,
  };
}
