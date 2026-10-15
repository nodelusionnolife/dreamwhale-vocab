// 对话模式的会话与消息状态。纯逻辑，不得 import 浏览器 API。

import { findQuestion, renderQuestionBody, DEFAULT_EVERY_N, DEFAULT_REST } from './questions.js';
import { DEFAULT_LIMITS } from './limits.js';
import { serializeSession, snapshotInjection } from './prompt.js';
import { normalizeUsageShape, cacheHitRate } from './usage.js';
import { normalizeSummaryMessage, parseTurnSummary } from './summary.js';

export const CHAT_SAVE_VERSION = 2;
export const GENDERS = ['男', '女', '自定义'];

let idSeq = 0;
function nextId(prefix) {
  idSeq += 1;
  const nonce = globalThis.crypto?.randomUUID?.() || `${Math.random().toString(36).slice(2)}_${idSeq.toString(36)}`;
  return `${prefix}_${Date.now().toString(36)}_${nonce}`;
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
  debugSummaries = false,
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
    trimCursor: 0,
    debugSummaries: debugSummaries === true,
    questionContext: null,
    compaction: { version: 1, epoch: 0, totalTurns: 0 },
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

/** 追加一条消息，parentId 取当前末尾。 */
export function appendMessage(session, { role, text, questionId = null, usage = null }) {
  const last = session.messages[session.messages.length - 1] || null;
  const msg = {
    id: nextId('m'),
    parentId: last ? last.id : null,
    role,
    text: String(text ?? ''),
    compacted: false,
    ...(role === 'assistant' ? parseTurnSummary(text) : {}),
    questionId: questionId || null,
    ...(role === 'user' ? { promptInjection: snapshotInjection({ questionId }) } : {}),
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

/** 会话累计用量。只统计留有用量的消息，缺用量的轮次不计入。 */
export function totalUsage(session) {
  let prompt = 0;
  let completion = 0;
  let cached = 0;
  let reportedPrompt = 0;
  let counted = 0;
  let cacheReports = 0;
  let total = 0;
  for (const m of messages(session)) {
    const usage = normalizeUsageShape(m.usage);
    if (m.role !== 'assistant' || !usage) continue;
    if (usage.prompt === null && usage.completion === null && usage.total === null) continue;
    prompt += usage.prompt ?? 0;
    completion += usage.completion ?? 0;
    total += usage.total ?? ((usage.prompt ?? 0) + (usage.completion ?? 0));
    if (cacheHitRate(usage) !== null) {
      cached += usage.cached;
      reportedPrompt += usage.prompt;
      cacheReports += 1;
    }
    counted += 1;
  }
  return {
    prompt,
    completion,
    cached,
    total,
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

/** 删除一条消息。 */
export function deleteMessage(session, id) {
  const list = messages(session);
  const index = list.findIndex((m) => m.id === id);
  if (index < 0) return session;
  const next = list.filter((m) => m.id !== id);
  const cursor = Math.max(0, (session.trimCursor || 0) - (index < (session.trimCursor || 0) ? 1 : 0));
  return {
    ...session,
    messages: next,
    questionContext: session.questionContext?.sourceMessageId === id ? null : session.questionContext,
    trimCursor: Math.min(cursor, next.length),
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
    questionContext: next.some((message) => message.id === session.questionContext?.sourceMessageId) ? session.questionContext : null,
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

/** 组装发给模型的 messages。 */
export function buildChatMessages(session, systemPrompt) {
  return serializeSession(session, systemPrompt);
}

/* ---------------- 存档往返 ---------------- */

export function toSaveable(session) {
  return JSON.parse(JSON.stringify(session));
}

export function fromSaveable(obj) {
  if (!obj || ![1, CHAT_SAVE_VERSION].includes(obj.version)) return null;
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
    version: CHAT_SAVE_VERSION,
    profile: normalizeProfile(obj.profile),
    everyN: Number(obj.everyN) || DEFAULT_EVERY_N,
    difficulty: obj.difficulty || 'all',
    restConfig: { ...DEFAULT_REST, ...(obj.restConfig || {}) },
    limits: { ...DEFAULT_LIMITS, ...(obj.limits || {}) },
    trimCursor: 0,
    debugSummaries: obj.debugSummaries === true,
    questionContext: obj.questionContext && typeof obj.questionContext === 'object' ? {
      sourceMessageId: String(obj.questionContext.sourceMessageId || ''),
      questionId: obj.questionContext.questionId || null,
      promptInjection: String(obj.questionContext.promptInjection || ''),
    } : null,
    questionsSinceRest: Number(obj.questionsSinceRest) || 0,
    restTurnsLeft: Number(obj.restTurnsLeft) || 0,
    messages: Array.isArray(obj.messages) ? obj.messages.filter((m) => m && ['user', 'assistant'].includes(m.role)).map((m) => normalizeSummaryMessage({
      ...m,
      text: m.compacted === true ? '' : String(m.text ?? ''),
      compacted: m.compacted === true,
      usage: normalizeUsageShape(m.usage),
      ...(m.role === 'user' ? { promptInjection: snapshotInjection(m) } : {}),
    })) : [],
    usedQuestionIds: Array.isArray(obj.usedQuestionIds) ? obj.usedQuestionIds : [],
  };
}

/** 供界面显示的题目预览（题干首行）。 */
export function questionPreview(questionId) {
  const q = findQuestion(questionId);
  if (!q) return '';
  return renderQuestionBody(q).split('\n')[0];
}
