// 存档与设置。这是唯一允许触碰 localStorage 的模块。
// 平台适配留在这里：iNeed 类托管环境的沙箱无同源，localStorage 可能被垫片顶替，
// 垫片有约 1MB 配额，所以存档必须保持紧凑。

import { toSaveable, fromSaveable } from '../engine/state.js';
import { emptyStats, normalizeStats } from '../engine/stats.js';
import { toSaveable as chatToSaveable, fromSaveable as chatFromSaveable, normalizeProfile } from '../engine/chat.js';
import { FACE_HOSTS, DEFAULT_FACE_HOST } from '../content/emotions.js';

const RUN_KEY = 'word-blade:run';
const PROFILE_KEY = 'word-blade:profile';       // 模型端点与 Key
const STATS_KEY = 'word-blade:stats';
const USER_KEY = 'word-blade:user-profile';     // user 档案：称呼与性别
const CHAT_KEY = 'word-blade:chat-session';     // 对话模式的会话
const MODE_KEY = 'word-blade:mode';             // 玩法模式
const FACE_HOST_KEY = 'word-blade:face-host';   // 表情图床（默认/备用）

function store() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null; // 无同源沙箱下访问会抛错
  }
}

export function storageAvailable() {
  const s = store();
  if (!s) return false;
  try {
    s.setItem('word-blade:probe', '1');
    s.removeItem('word-blade:probe');
    return true;
  } catch {
    return false;
  }
}

export function loadRun() {
  const s = store();
  if (!s) return null;
  try {
    const raw = s.getItem(RUN_KEY);
    if (!raw) return null;
    return fromSaveable(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveRun(run) {
  const s = store();
  if (!s || !run) return false;
  try {
    s.setItem(RUN_KEY, JSON.stringify(toSaveable(run)));
    return true;
  } catch {
    return false; // 配额超限或沙箱拒绝，交给上层提示
  }
}

export function clearRun() {
  const s = store();
  if (!s) return;
  try {
    s.removeItem(RUN_KEY);
  } catch { /* ignore */ }
}

export function loadProfile() {
  const s = store();
  if (!s) return null;
  try {
    const raw = s.getItem(PROFILE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveProfile(profile) {
  const s = store();
  if (!s) return false;
  try {
    s.setItem(PROFILE_KEY, JSON.stringify(profile));
    return true;
  } catch {
    return false;
  }
}

/** 导出存档时默认不含 API Key（见总设计案的安全约定）。 */
export function exportRun(run) {
  return JSON.stringify({ kind: 'word-blade-save', ...toSaveable(run) }, null, 2);
}

export function loadStats() {
  const s = store();
  if (!s) return emptyStats();
  try {
    const raw = s.getItem(STATS_KEY);
    return raw ? normalizeStats(JSON.parse(raw)) : emptyStats();
  } catch {
    return emptyStats();
  }
}

export function saveStats(stats) {
  const s = store();
  if (!s) return false;
  try {
    s.setItem(STATS_KEY, JSON.stringify(stats));
    return true;
  } catch {
    return false;
  }
}

export function clearStats() {
  const s = store();
  if (!s) return;
  try {
    s.removeItem(STATS_KEY);
  } catch { /* ignore */ }
}

/* ---------------- 玩法模式 ---------------- */

export const MODES = { chat: 'chat', wordblade: 'wordblade' };
export const DEFAULT_MODE = MODES.chat; // 对话模式为默认项

export function loadMode() {
  const s = store();
  if (!s) return DEFAULT_MODE;
  try {
    const v = s.getItem(MODE_KEY);
    return v === MODES.wordblade ? MODES.wordblade : DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

export function saveMode(mode) {
  const s = store();
  if (!s) return false;
  try {
    s.setItem(MODE_KEY, mode === MODES.wordblade ? MODES.wordblade : MODES.chat);
    return true;
  } catch {
    return false;
  }
}

/* ---------------- 表情图床 ---------------- */

// 两个图床装的是同一批图，切换只换取图地址。存的是 id 不是 URL，
// 这样以后换图床域名不用清用户的存档。
export function loadFaceHost() {
  const s = store();
  if (!s) return DEFAULT_FACE_HOST;
  try {
    const v = s.getItem(FACE_HOST_KEY);
    return FACE_HOSTS.some((h) => h.id === v) ? v : DEFAULT_FACE_HOST;
  } catch {
    return DEFAULT_FACE_HOST;
  }
}

export function saveFaceHost(host) {
  const s = store();
  if (!s) return false;
  try {
    const ok = FACE_HOSTS.some((h) => h.id === host);
    s.setItem(FACE_HOST_KEY, ok ? host : DEFAULT_FACE_HOST);
    return true;
  } catch {
    return false;
  }
}

/* ---------------- user 档案 ---------------- */

export function loadUserProfile() {
  const s = store();
  if (!s) return null;
  try {
    const raw = s.getItem(USER_KEY);
    return raw ? normalizeProfile(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function saveUserProfile(profile) {
  const s = store();
  if (!s) return false;
  try {
    s.setItem(USER_KEY, JSON.stringify(profile));
    return true;
  } catch {
    return false;
  }
}

/* ---------------- 对话会话（多会话 + 拆分存储 + 版本校验） ----------------
//
// 存储布局（v2）：
//   word-blade:chat-index        顶层索引：当前会话 id + 各会话摘要（小，侧栏直接读它）
//   word-blade:chat-sess:<id>    单个会话的元信息 + 消息 id 列表
//   word-blade:chat-msg:<id>     单条消息（id 全局唯一，天然可跨会话共享）
//
// 为什么这样拆：
//   - 追加消息只写「新消息 + 本会话 key + 顶层索引里那一条摘要」，与会话历史长度脱钩；
//   - 切会话不必读别的会话，侧栏也不必加载任何消息；
//   - 删会话只删它自己的 key 与消息，不牵连其他。
//
// revision 用于多标签页冲突检测：写入前比对顶层索引的 revision 与本次已知值，
// 不一致说明另一个标签页改过，拒绝写入并回报冲突，而不是静默覆盖。
*/

const CHAT_INDEX_KEY = 'word-blade:chat-index';
const CHAT_SESS_PREFIX = 'word-blade:chat-sess:';
const CHAT_MSG_PREFIX = 'word-blade:chat-msg:';

export const CHAT_STORE_VERSION = 2;

let knownRevision = null;

function metaOf(session) {
  const { messages, ...meta } = session;
  return meta;
}

function summarize(session) {
  return {
    id: session.id,
    title: session.title,
    updatedAt: session.updatedAt,
    messageCount: session.messages?.length || 0,
  };
}

function readIndex(s) {
  try {
    const raw = s.getItem(CHAT_INDEX_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function readMessage(s, id) {
  try {
    const raw = s.getItem(CHAT_MSG_PREFIX + id);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** 把旧版（单会话：v0 单 key / v1 索引+消息）迁移到 v2 多会话结构。 */
function migrateLegacy(s) {
  let raw = null;
  try {
    raw = s.getItem(CHAT_INDEX_KEY) || s.getItem(CHAT_KEY);
  } catch {
    raw = null;
  }
  if (!raw) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  // v1 形态：{ version:1, revision, sessionId, meta, messageIds }
  // v0 形态：整个会话对象（含 messages）
  const source = parsed?.meta
    ? { ...parsed.meta, messages: (parsed.messageIds || []).map((id) => readMessage(s, id)).filter(Boolean) }
    : parsed;
  const session = chatFromSaveable(source);
  if (!session) return null;

  try {
    const ids = [];
    for (const m of session.messages) {
      s.setItem(CHAT_MSG_PREFIX + m.id, JSON.stringify(m));
      ids.push(m.id);
    }
    s.setItem(CHAT_SESS_PREFIX + session.id, JSON.stringify({ ...metaOf(session), messageIds: ids }));
    const index = {
      version: CHAT_STORE_VERSION,
      revision: 1,
      currentId: session.id,
      sessions: [summarize(session)],
    };
    s.setItem(CHAT_INDEX_KEY, JSON.stringify(index));
    s.removeItem(CHAT_KEY);
    knownRevision = 1;
    return session;
  } catch {
    return null; // 迁移失败就保留原存档，不硬来
  }
}

/** 侧栏用：读全部会话摘要 + 当前会话 id。不加载任何消息。 */
export function loadSessionList() {
  const s = store();
  if (!s) return { currentId: null, sessions: [] };
  let index = readIndex(s);
  if (!index || index.version !== CHAT_STORE_VERSION) {
    migrateLegacy(s);
    index = readIndex(s);
  }
  if (!index) return { currentId: null, sessions: [] };
  knownRevision = index.revision ?? null;
  return { currentId: index.currentId || null, sessions: index.sessions || [] };
}

export function loadChatSession(id = null) {
  const s = store();
  if (!s) return null;
  const index = readIndex(s);
  if (!index || index.version !== CHAT_STORE_VERSION) {
    const migrated = migrateLegacy(s);
    return migrated || null;
  }
  knownRevision = index.revision ?? null;
  const target = id || index.currentId;
  if (!target) return null;
  let sess;
  try {
    const raw = s.getItem(CHAT_SESS_PREFIX + target);
    sess = raw ? JSON.parse(raw) : null;
  } catch {
    sess = null;
  }
  if (!sess) return null;
  const msgs = (sess.messageIds || []).map((mid) => readMessage(s, mid)).filter(Boolean);
  return chatFromSaveable({ ...sess, messages: msgs });
}

/**
 * 保存会话。只写新增消息 + 本会话 key + 顶层索引。
 * @returns {{ok:boolean, conflict?:boolean, full?:boolean, error?:string}}
 */
export function saveChatSession(session) {
  const s = store();
  if (!s || !session) return { ok: false, error: 'no-storage' };

  let index = readIndex(s);
  if (!index || index.version !== CHAT_STORE_VERSION) {
    migrateLegacy(s);
    index = readIndex(s);
  }
  const prevRevision = index?.revision ?? null;

  if (index && knownRevision !== null && prevRevision !== knownRevision) {
    return { ok: false, conflict: true };
  }

  let prevIds = [];
  try {
    const raw = s.getItem(CHAT_SESS_PREFIX + session.id);
    if (raw) prevIds = JSON.parse(raw)?.messageIds || [];
  } catch { prevIds = []; }
  const written = new Set(prevIds);

  const ids = [];
  try {
    for (const m of session.messages) {
      ids.push(m.id);
      if (written.has(m.id)) continue;
      s.setItem(CHAT_MSG_PREFIX + m.id, JSON.stringify(m));
    }
    // 清理被删掉的消息 key。不做这一步，删消息只会在会话里消失、
    // 存储里却留着孤儿条目，反复删除会持续占用配额。
    const stillHere = new Set(ids);
    for (const oldId of prevIds) {
      if (!stillHere.has(oldId)) s.removeItem(CHAT_MSG_PREFIX + oldId);
    }
    s.setItem(CHAT_SESS_PREFIX + session.id, JSON.stringify({ ...metaOf(session), messageIds: ids }));

    const others = (index?.sessions || []).filter((x) => x.id !== session.id);
    const next = {
      version: CHAT_STORE_VERSION,
      revision: (prevRevision ?? 0) + 1,
      currentId: session.id,
      sessions: [...others, summarize(session)],
    };
    s.setItem(CHAT_INDEX_KEY, JSON.stringify(next));
    knownRevision = next.revision;
  } catch (err) {
    const full = err?.name === 'QuotaExceededError' || /quota/i.test(String(err?.message || ''));
    return { ok: false, full, error: full ? 'quota' : String(err?.message || err) };
  }
  return { ok: true };
}

/** 切换当前会话（只动顶层索引里的 currentId）。 */
export function setCurrentSession(id) {
  const s = store();
  if (!s || !id) return false;
  const index = readIndex(s);
  if (!index || index.version !== CHAT_STORE_VERSION) return false;
  index.currentId = id;
  index.revision = (index.revision ?? 0) + 1;
  try {
    s.setItem(CHAT_INDEX_KEY, JSON.stringify(index));
    knownRevision = index.revision;
    return true;
  } catch {
    return false;
  }
}

/** 删掉一个会话及其全部消息。 */
export function deleteChatSession(id) {
  const s = store();
  if (!s || !id) return false;
  const index = readIndex(s);
  if (!index || index.version !== CHAT_STORE_VERSION) return false;
  let messageIds = [];
  try {
    const raw = s.getItem(CHAT_SESS_PREFIX + id);
    if (raw) messageIds = JSON.parse(raw)?.messageIds || [];
  } catch { messageIds = []; }
  try {
    for (const mid of messageIds) s.removeItem(CHAT_MSG_PREFIX + mid);
    s.removeItem(CHAT_SESS_PREFIX + id);
    const rest = index.sessions.filter((x) => x.id !== id);
    index.sessions = rest;
    if (index.currentId === id) index.currentId = rest[0]?.id || null;
    index.revision = (index.revision ?? 0) + 1;
    s.setItem(CHAT_INDEX_KEY, JSON.stringify(index));
    knownRevision = index.revision;
    return true;
  } catch {
    return false;
  }
}

export function clearChatSession() {
  const s = store();
  if (!s) return;
  try {
    const index = readIndex(s);
    for (const sess of index?.sessions || []) {
      try {
        const raw = s.getItem(CHAT_SESS_PREFIX + sess.id);
        for (const mid of (raw ? JSON.parse(raw)?.messageIds : []) || []) {
          s.removeItem(CHAT_MSG_PREFIX + mid);
        }
      } catch { /* 单会话损坏不影响整体清理 */ }
      s.removeItem(CHAT_SESS_PREFIX + sess.id);
    }
    s.removeItem(CHAT_INDEX_KEY);
    s.removeItem(CHAT_KEY);
    knownRevision = null;
  } catch { /* ignore */ }
}

/** 供测试与诊断：当前全部会话占用的存储体积估算（字符数）。 */
export function chatStorageSize() {
  const s = store();
  if (!s) return 0;
  const index = readIndex(s);
  if (!index) return 0;
  let n = (s.getItem(CHAT_INDEX_KEY) || '').length;
  for (const sess of index.sessions || []) {
    n += (s.getItem(CHAT_SESS_PREFIX + sess.id) || '').length;
  }
  return n;
}

/**
 * 清扫没有任何会话引用的消息 key。
 * 正常的删除路径已经会即时清掉，但崩溃、中断的写入或旧版本可能留下孤儿条目；
 * 它们只占配额、不影响正确性，所以放在启动时顺手收一次。
 * @returns {number} 清掉的条数
 */
export function sweepOrphanMessages() {
  const s = store();
  if (!s) return 0;
  const index = readIndex(s);
  if (!index || index.version !== CHAT_STORE_VERSION) return 0;

  const live = new Set();
  for (const sess of index.sessions || []) {
    try {
      const raw = s.getItem(CHAT_SESS_PREFIX + sess.id);
      for (const mid of (raw ? JSON.parse(raw)?.messageIds : []) || []) live.add(mid);
    } catch { /* 单个会话损坏不阻断清扫 */ }
  }

  const orphanKeys = [];
  try {
    for (let i = 0; i < s.length; i += 1) {
      const k = s.key(i);
      if (k && k.startsWith(CHAT_MSG_PREFIX)) orphanKeys.push(k);
    }
  } catch {
    return 0;
  }
  let removed = 0;
  for (const k of orphanKeys) {
    if (live.has(k.slice(CHAT_MSG_PREFIX.length))) continue;
    try {
      s.removeItem(k);
      removed += 1;
    } catch { /* ignore */ }
  }
  return removed;
}
