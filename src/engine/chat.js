// 对话模式的会话与消息状态。纯逻辑，不得 import 浏览器 API。
//
// 一期范围：单会话、平铺消息列表、无删除、无分支。
// 消息里保留了 parentId 字段（一期恒为 null），三期做分支时无需迁移存档。

import { findQuestion, renderQuestionBody, composeOutgoing, DEFAULT_EVERY_N, DEFAULT_REST } from './questions.js';
import { DEFAULT_LIMITS } from './limits.js';

export const CHAT_SAVE_VERSION = 1;
export const GENDERS = ['男', '女', '自定义'];

let idSeq = 0;
function nextId(prefix) {
  idSeq += 1;
  return `${prefix}_${Date.now().toString(36)}_${idSeq.toString(36)}`;
}

/** 仅供测试：重置 id 计数器。 */
export function __resetIdSeq() {
  idSeq = 0;
}

/* ---------------- user 档案 ---------------- */

export function createProfile({ name = '', gender = '女', customGender = '' } = {}) {
  return { name: String(name).trim(), gender, customGender: String(customGender).trim() };
}

/** 档案是否填完：名字必填；选「自定义」时必须填自定义性别。 */
export function profileComplete(profile) {
  if (!profile || !String(profile.name || '').trim()) return false;
  if (profile.gender === '自定义' && !String(profile.customGender || '').trim()) return false;
  return true;
}

/** 实际展示用的性别文案。 */
export function genderLabel(profile) {
  if (!profile) return '';
  if (profile.gender === '自定义') return profile.customGender || '';
  return profile.gender || '';
}

export function normalizeProfile(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const p = createProfile(raw);
  return profileComplete(p) ? p : null;
}

/* ---------------- 会话 ---------------- */

export function createSession({
  profile = null,
  everyN = DEFAULT_EVERY_N,
  difficulty = 'all',
  restConfig = DEFAULT_REST,
  limits = DEFAULT_LIMITS,
  title = '新的对话',
} = {}) {
  return {
    version: CHAT_SAVE_VERSION,
    id: nextId('s'),
    title,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    profile,
    everyN,
    difficulty,
    restConfig: { ...DEFAULT_REST, ...(restConfig || {}) },
    limits: { ...DEFAULT_LIMITS, ...(limits || {}) },
    trimCursor: 0,          // 历史窗口起点，由滞后裁剪推进
    questionsSinceRest: 0,
    restTurnsLeft: 0,
    messages: [],
    usedQuestionIds: [],
  };
}

/** 消息列表（一期即全部消息）。 */
export function messages(session) {
  return session?.messages || [];
}

/** 角色实际回复的条数——插题节奏以此为准。 */
export function assistantReplyCount(session) {
  return messages(session).filter((m) => m.role === 'assistant').length;
}

/** 追加一条消息。parentId 一律取当前末尾；一期不做分支。 */
export function appendMessage(session, { role, text, questionId = null, usage = null }) {
  const last = session.messages[session.messages.length - 1] || null;
  const msg = {
    id: nextId('m'),
    parentId: last ? last.id : null,
    role,
    text: String(text ?? ''),
    questionId: questionId || null,
    at: Date.now(),
    // 这一轮请求的 token 用量。角色回复记全量；用户消息只留输入侧，
    // 便于气泡下方直接显示本轮成本。端点没返回用量时为 null。
    usage: normalizeUsageShape(usage),
  };
  return {
    ...session,
    messages: [...session.messages, msg],
    updatedAt: msg.at,
  };
}

function normalizeUsageShape(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const prompt = num(usage.prompt);
  const completion = num(usage.completion);
  const total = num(usage.total) ?? (prompt !== null && completion !== null ? prompt + completion : null);
  const cached = num(usage.cached);
  if (prompt === null && completion === null && total === null && cached === null) return null;
  return { prompt, completion, total, cached };
}

/** 会话累计用量。只统计留有用量的消息，缺用量的轮次不计入。 */
export function totalUsage(session) {
  let prompt = 0;
  let completion = 0;
  let cached = 0;
  let reportedPrompt = 0;
  let counted = 0;
  let cacheReports = 0;
  for (const m of messages(session)) {
    if (m.role !== 'assistant' || !m.usage) continue;
    if (m.usage.prompt !== null) prompt += m.usage.prompt;
    if (m.usage.completion !== null) completion += m.usage.completion;
    if (m.usage.cached !== null && m.usage.cached !== undefined) {
      cached += m.usage.cached;
      reportedPrompt += m.usage.prompt || 0;
      cacheReports += 1;
    }
    counted += 1;
  }
  return {
    prompt,
    completion,
    cached,
    total: prompt + completion,
    turns: counted,
    // 分母只用「报过缓存字段的轮次」的输入量：
    // 端点漏报缓存不等于未命中，拿它当分母会把命中率压低。
    cacheHitRate: cacheReports > 0 && reportedPrompt > 0 ? cached / reportedPrompt : null,
    cacheReports,
  };
}

/** 标记某题已出过，避免同一会话反复出同一题。 */
export function markQuestionUsed(session, questionId) {
  if (!questionId || session.usedQuestionIds.includes(questionId)) return session;
  return { ...session, usedQuestionIds: [...session.usedQuestionIds, questionId] };
}

/** 用第一条用户消息自动生成会话标题。 */
export function deriveTitle(session) {
  const first = messages(session).find((m) => m.role === 'user');
  if (!first) return session.title;
  const t = first.text.replace(/\s+/g, ' ').trim().slice(0, 18);
  return t || session.title;
}

/**
 * 删除一条消息。
 * 一期消息是平铺的（parentId 恒为 null），所以删掉它不影响其他消息。
 * 三期做分支后，这里要把它的子节点接到被删节点的父节点上——
 * 注释先留着，免得那时忘了还有这一层。
 * 顺带把历史窗口游标往回收，避免它指到已不存在的下标。
 */
export function deleteMessage(session, id) {
  const list = messages(session);
  if (!list.some((m) => m.id === id)) return session;
  const next = list.filter((m) => m.id !== id);
  return {
    ...session,
    messages: next,
    trimCursor: Math.min(session.trimCursor || 0, next.length),
    updatedAt: Date.now(),
  };
}

/** 删除末尾若干条（用于「重新生成」时把上一次的失败尝试清掉）。 */
export function deleteFrom(session, index) {
  const list = messages(session);
  const at = Math.max(0, Math.min(index, list.length));
  const next = list.slice(0, at);
  return {
    ...session,
    messages: next,
    trimCursor: Math.min(session.trimCursor || 0, next.length),
    updatedAt: Date.now(),
  };
}

export function renameSession(session, title) {
  const t = String(title || '').trim();
  return t ? { ...session, title: t.slice(0, 40) } : session;
}

/** 会话摘要，供侧栏列表使用。 */
export function summarizeSession(session) {
  return {
    id: session.id,
    title: session.title,
    updatedAt: session.updatedAt,
    messageCount: session.messages?.length || 0,
  };
}

/* ---------------- 请求组装 ---------------- */

/**
 * 组装发给模型的 messages。
 * 关键点：
 *   1. 用户消息在存档里只存原文，但发给模型时必须把当时那道题重新拼回去，
 *      否则模型会丢失「这一轮我出过什么题」的上下文。
 *   2. cursor 之前的历史按限额裁掉；被裁过就在窗口开头放一条省略说明，
 *      让模型知道自己缺了前文，而不是以为对话刚开头。
 *
 * @param {object} session
 * @param {string} systemPrompt
 * @param {{cursor?: number}} opts
 */
export function buildChatMessages(session, systemPrompt, { cursor = 0 } = {}) {
  const all = messages(session);
  const start = Math.min(Math.max(0, cursor), all.length);
  const out = [{ role: 'system', content: systemPrompt }];

  if (start > 0) {
    out.push({ role: 'user', content: '（更早的对话已省略，以下是最近的部分）' });
  }

  for (let i = start; i < all.length; i += 1) {
    const m = all[i];
    if (m.role !== 'user') {
      // 角色输出原样入上下文；防御性剥掉可能被回显的答案标签
      out.push({ role: 'assistant', content: stripAnswerKey(m.text) });
      continue;
    }
    const q = m.questionId ? findQuestion(m.questionId) : null;
    out.push({ role: 'user', content: q ? composeOutgoing({ userText: m.text, question: q }) : m.text });
  }
  return out;
}

function stripAnswerKey(text) {
  return String(text ?? '').replace(/<AnswerKey>[\s\S]*?<\/AnswerKey>/g, '').trim();
}

/* ---------------- 存档往返 ---------------- */

export function toSaveable(session) {
  return JSON.parse(JSON.stringify(session));
}

export function fromSaveable(obj) {
  if (!obj || obj.version !== CHAT_SAVE_VERSION) return null;
  const base = createSession({
    profile: obj.profile,
    everyN: obj.everyN,
    difficulty: obj.difficulty,
    restConfig: obj.restConfig,
    limits: obj.limits,
  });
  return {
    ...base,
    ...obj,
    profile: normalizeProfile(obj.profile),
    everyN: Number(obj.everyN) || DEFAULT_EVERY_N,
    difficulty: obj.difficulty || 'all',
    restConfig: { ...DEFAULT_REST, ...(obj.restConfig || {}) },
    limits: { ...DEFAULT_LIMITS, ...(obj.limits || {}) },
    trimCursor: Number(obj.trimCursor) || 0,
    questionsSinceRest: Number(obj.questionsSinceRest) || 0,
    restTurnsLeft: Number(obj.restTurnsLeft) || 0,
    messages: Array.isArray(obj.messages) ? obj.messages : [],
    usedQuestionIds: Array.isArray(obj.usedQuestionIds) ? obj.usedQuestionIds : [],
  };
}

/** 供界面显示的题目预览（题干首行）。 */
export function questionPreview(questionId) {
  const q = findQuestion(questionId);
  if (!q) return '';
  return renderQuestionBody(q).split('\n')[0];
}
