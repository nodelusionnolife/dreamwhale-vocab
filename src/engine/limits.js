// 上下文限额与历史窗口。纯逻辑，不得 import 浏览器 API。
//
// 两件事：
//   1. token 估算——只在拿不到真实用量时兜底，宁可高估（早裁比晚裁安全）
//   2. 窗口裁剪——用滞后策略，避免每轮都挪窗口把前缀缓存打碎
//
// 关于滞后：朴素的「永远保留最近 N 条」会让系统提示词之后的第一个消息每轮都变，
// 于是前缀缓存每轮失效。改成「只在超出预算时才裁，一次裁到目标比例」，
// 两次裁剪之间窗口起点不动，前缀保持字节稳定，缓存才吃得满。

export const DEFAULT_LIMITS = {
  enabled: true,
  renderLimit: 120,        // 界面最多渲染多少条消息（纯显示，不影响发送）
  historyLimit: 60,        // 发送给模型的历史消息条数上限
  maxContextTokens: 32000, // 上下文 token 预算（估算）
  trimRatio: 0.7,          // 触发裁剪后保留到预算的这个比例
};

const CJK = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/;

/**
 * 估算一段文本的 token 数。
 * 中日韩字符按 1 个/字，其余按约 3.5 字符/token，再加每条消息的固定开销。
 * 这是个估算，不是精确计数——界面与文档都必须标明。
 */
export function estimateTokens(text) {
  const s = String(text ?? '');
  if (!s) return 2;
  let cjk = 0;
  let other = 0;
  for (const ch of s) {
    if (CJK.test(ch)) cjk += 1;
    else other += 1;
  }
  return cjk + Math.ceil(other / 3.5) + 2;
}

export function clampLimits(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const int = (v, min, max, fb) => {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return fb;
    return Math.min(max, Math.max(min, n));
  };
  const ratio = Number(c.trimRatio);
  return {
    enabled: c.enabled !== false,
    renderLimit: int(c.renderLimit, 10, 2000, DEFAULT_LIMITS.renderLimit),
    historyLimit: int(c.historyLimit, 2, 500, DEFAULT_LIMITS.historyLimit),
    maxContextTokens: int(c.maxContextTokens, 1000, 1000000, DEFAULT_LIMITS.maxContextTokens),
    trimRatio: Number.isFinite(ratio) ? Math.min(0.95, Math.max(0.3, ratio)) : DEFAULT_LIMITS.trimRatio,
  };
}

/**
 * 系统提示词的 token 估算。真实用量优先——如果上一轮拿到过真实 prompt 用量，
 * 可以用它减去当时的历史估算，反推系统提示词的真实开销，比纯字符估算准。
 */
export function systemTokensFor({ systemText, lastRealPromptTokens = null, lastHistoryEstimate = null }) {
  if (Number.isFinite(lastRealPromptTokens) && Number.isFinite(lastHistoryEstimate)) {
    const derived = lastRealPromptTokens - lastHistoryEstimate;
    if (derived > 0) return derived;
  }
  return estimateTokens(systemText);
}

/** 从 fromIndex 起到末尾的估算总量。 */
export function estimateFrom(messages, fromIndex) {
  let sum = 0;
  for (let i = Math.max(0, fromIndex); i < messages.length; i += 1) {
    sum += estimateTokens(messages[i]?.text || '');
  }
  return sum;
}

/**
 * 计算这一轮应该从哪里开始保留历史。返回的 cursor 应写回会话，
 * 下一轮若没超预算就直接沿用（这就是滞后）。
 *
 * @param {object} opts
 * @param {Array} opts.messages    全部消息
 * @param {number} opts.systemTokens 系统提示词的 token 估算
 * @param {number} opts.cursor     上一轮确定的起点
 * @param {object} opts.limits
 * @returns {{cursor:number, trimmed:boolean, droppedCount:number, estimatedTokens:number}}
 */
export function nextTrimCursor({ messages, systemTokens = 0, cursor = 0, limits = DEFAULT_LIMITS }) {
  const lim = clampLimits(limits);
  const total = messages.length;
  let start = Math.min(Math.max(0, cursor), total);

  // 条数上限：无论 token 如何，历史消息条数不超过 historyLimit
  const byCount = Math.max(0, total - lim.historyLimit);
  start = Math.max(start, byCount);

  const used = systemTokens + estimateFrom(messages, start);
  if (!lim.enabled || used <= lim.maxContextTokens) {
    // 没超预算就不动窗口——保持前缀稳定，缓存才有效
    return {
      cursor: start,
      trimmed: start > 0,
      droppedCount: start,
      estimatedTokens: used,
    };
  }

  // 超预算了：从尾部往前装，装到目标预算为止，起点落在哪里就从哪里开始
  const budget = Math.max(1, Math.floor(lim.maxContextTokens * lim.trimRatio));
  let acc = systemTokens;
  let i = total;
  while (i > start && acc + estimateTokens(messages[i - 1]?.text || '') <= budget) {
    acc += estimateTokens(messages[i - 1]?.text || '');
    i -= 1;
  }
  // 至少保留最后一条（当前这轮用户消息），否则模型没东西可回
  if (i >= total) i = Math.max(0, total - 1);

  return {
    cursor: i,
    trimmed: i > 0,
    droppedCount: i,
    estimatedTokens: systemTokens + estimateFrom(messages, i),
  };
}

/** 界面渲染窗口：只渲染最近 renderLimit 条，并报告被折叠的条数。 */
export function renderWindow(messages, limits = DEFAULT_LIMITS) {
  const lim = clampLimits(limits);
  const total = messages.length;
  if (!lim.enabled || total <= lim.renderLimit) {
    return { items: messages, hiddenCount: 0, startIndex: 0 };
  }
  const startIndex = total - lim.renderLimit;
  return { items: messages.slice(startIndex), hiddenCount: startIndex, startIndex };
}
