import { appStorage } from '../platform/runtime.js';
import { fromSaveable as chatFromSaveable, normalizeProfile } from '../engine/chat.js';
import { FACE_HOSTS, DEFAULT_FACE_HOST, FACE_STYLES, DEFAULT_FACE_STYLE } from '../content/emotions.js';

const PROFILE_KEY = 'word-blade:profile';       // 模型端点与 Key
const USER_KEY = 'word-blade:user-profile';     // user 档案：称呼与性别
const CHAT_KEY = 'word-blade:chat-session';     // 对话模式的会话
const MODE_KEY = 'word-blade:mode';             // 玩法模式
const FACE_HOST_KEY = 'word-blade:face-host';   // 表情图床（默认/备用）
const FACE_STYLE_KEY = 'word-blade:face-style';

function store() {
  try {
    return appStorage() || null;
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

/* ---------------- 玩法模式 ---------------- */

export const MODES = { learn: 'learn', library: 'library', practice: 'practice', chat: 'chat' };
export const DEFAULT_MODE = MODES.learn;

export function loadMode() {
  const s = store();
  if (!s) return DEFAULT_MODE;
  try {
    const v = s.getItem(MODE_KEY);
    return Object.values(MODES).includes(v) ? v : DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

export function saveMode(mode) {
  const s = store();
  if (!s) return false;
  try {
    s.setItem(MODE_KEY, Object.values(MODES).includes(mode) ? mode : DEFAULT_MODE);
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

export function loadFaceStyle() {
  const s = store();
  if (!s) return DEFAULT_FACE_STYLE;
  try {
    const style = s.getItem(FACE_STYLE_KEY);
    return FACE_STYLES.some((item) => item.id === style) ? style : DEFAULT_FACE_STYLE;
  } catch {
    return DEFAULT_FACE_STYLE;
  }
}

export function saveFaceStyle(style) {
  const s = store();
  if (!s) return false;
  try {
    const next = FACE_STYLES.some((item) => item.id === style) ? style : DEFAULT_FACE_STYLE;
    s.setItem(FACE_STYLE_KEY, next);
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

/* ---------------- 对话会话 ---------------- */

const CHAT_INDEX_KEY = 'word-blade:chat-index';
const CHAT_SESS_PREFIX = 'word-blade:chat-sess:';
const CHAT_MSG_PREFIX = 'word-blade:chat-msg:';
const SNAPSHOT = Symbol('chat-storage-snapshot');
const STAGING_GRACE_MS = 60_000;

export const CHAT_STORE_VERSION = 3;

function metaOf(session) {
  const { messages, messageIds, ...meta } = session;
  return meta;
}

function summarize(session) {
  return {
    id: session.id,
    title: session.title,
    updatedAt: session.updatedAt,
    messageCount: session.messages?.length || 0,
    pinned: session.pinned === true,
    archived: session.archived === true,
    deletedAt: session.deletedAt || null,
    branchOf: session.branchOf || null,
  };
}

function parseIndex(raw) {
  if (!raw) return null;
  const index = JSON.parse(raw);
  return [2, CHAT_STORE_VERSION].includes(index?.version) && Array.isArray(index.sessions) ? index : null;
}

function recordKey(summary) {
  return CHAT_SESS_PREFIX + (summary.storageKey || summary.id);
}

function bindSnapshot(session, snapshot) {
  Object.defineProperty(session, SNAPSHOT, { value: snapshot, enumerable: true, writable: true, configurable: true });
  return session;
}

function readRecord(s, summary) {
  const key = recordKey(summary);
  const raw = s.getItem(key);
  if (!raw) throw new Error('missing-session');
  const value = JSON.parse(raw);
  if (!Array.isArray(value.messageIds)) throw new Error('invalid-session');
  return { key, raw, value };
}

function readMessages(s, ids) {
  return ids.map((id) => {
    const raw = s.getItem(CHAT_MSG_PREFIX + id);
    if (!raw) throw new Error('missing-message');
    return JSON.parse(raw);
  });
}

function readLegacy(s, indexRaw) {
  const indexed = indexRaw ? JSON.parse(indexRaw) : null;
  if (indexed && !(indexed.version === 1 && indexed.meta)) return null;
  const key = indexed ? CHAT_INDEX_KEY : CHAT_KEY;
  const raw = indexed ? indexRaw : s.getItem(CHAT_KEY);
  if (!raw) return null;
  const parsed = indexed || JSON.parse(raw);
  const source = indexed
    ? { ...parsed.meta, messages: readMessages(s, parsed.messageIds || []) }
    : parsed;
  const session = chatFromSaveable(source);
  return session ? { session: bindSnapshot(session, { id: session.id, legacyKey: key, raw }), key, raw, messageIds: indexed?.messageIds || [] } : null;
}

function liveKeys(s) {
  const raw = s.getItem(CHAT_INDEX_KEY);
  const index = parseIndex(raw);
  if (!index) {
    if (raw) {
      const legacy = readLegacy(s, raw);
      if (!legacy) return null;
      return new Set(legacy.messageIds.map((id) => CHAT_MSG_PREFIX + id));
    }
    return new Set();
  }
  const live = new Set();
  for (const summary of index.sessions) {
    const record = readRecord(s, summary);
    live.add(record.key);
    for (const id of record.value.messageIds) live.add(CHAT_MSG_PREFIX + id);
  }
  return live;
}

function cleanUnreferenced(s, keys) {
  try {
    const live = liveKeys(s);
    if (!live) return;
    for (const key of keys) {
      if (!live.has(key)) {
        try { s.removeItem(key); } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
}

function saveError(err) {
  const full = err?.name === 'QuotaExceededError' || /quota/i.test(String(err?.message || ''));
  return { ok: false, full, error: full ? 'quota' : String(err?.message || err) };
}

function commitSession(s, session, index, indexRaw, previous = null, legacy = null) {
  const staged = [];
  try {
    const nonce = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
    const token = `t_${Date.now().toString(36)}_${nonce}`;
    const previousMessages = new Map();
    for (const ref of previous?.value.messageIds || []) {
      const raw = s.getItem(CHAT_MSG_PREFIX + ref);
      if (!raw) throw new Error('missing-message');
      previousMessages.set(JSON.parse(raw).id, { ref, raw });
    }
    const ids = [];
    const seen = new Set();
    for (const message of session.messages) {
      if (!message?.id || seen.has(message.id)) throw new Error('invalid-message-id');
      seen.add(message.id);
      const raw = JSON.stringify(message);
      const old = previousMessages.get(message.id);
      if (old?.raw === raw) {
        ids.push(old.ref);
        continue;
      }
      const ref = `${message.id}:${token}`;
      const key = CHAT_MSG_PREFIX + ref;
      s.setItem(key, raw);
      staged.push(key);
      ids.push(ref);
    }
    const storageKey = `${session.id}:${token}`;
    const key = CHAT_SESS_PREFIX + storageKey;
    const raw = JSON.stringify({ ...metaOf(session), messageIds: ids });
    s.setItem(key, raw);
    staged.push(key);
    if (s.getItem(CHAT_INDEX_KEY) !== indexRaw || (legacy?.key === CHAT_KEY && s.getItem(CHAT_KEY) !== legacy.raw)) {
      cleanUnreferenced(s, staged);
      return { ok: false, conflict: true };
    }
    const next = {
      version: CHAT_STORE_VERSION,
      revision: (index?.revision || 0) + 1,
      currentId: session.id,
      sessions: [...(index?.sessions || []).filter((entry) => entry.id !== session.id), { ...summarize(session), storageKey }],
    };
    s.setItem(CHAT_INDEX_KEY, JSON.stringify(next));
    bindSnapshot(session, { id: session.id, key, raw });
    const obsolete = previous ? [previous.key, ...previous.value.messageIds.map((id) => CHAT_MSG_PREFIX + id)] : [];
    obsolete.push(...(legacy?.messageIds || []).map((id) => CHAT_MSG_PREFIX + id));
    cleanUnreferenced(s, obsolete);
    if (legacy?.key === CHAT_KEY) {
      try { s.removeItem(CHAT_KEY); } catch { /* ignore */ }
    }
    return { ok: true };
  } catch (err) {
    cleanUnreferenced(s, staged);
    return saveError(err);
  }
}

function migrateLegacy(s, indexRaw) {
  const legacy = readLegacy(s, indexRaw);
  if (!legacy) return null;
  const result = commitSession(s, legacy.session, null, indexRaw, null, legacy);
  return { ...legacy, result };
}

export function loadSessionList() {
  const s = store();
  const empty = { currentId: null, sessions: [] };
  if (!s) return empty;
  try {
    const raw = s.getItem(CHAT_INDEX_KEY);
    const index = parseIndex(raw);
    if (index) return { currentId: index.currentId || null, sessions: index.sessions.map(({ storageKey, ...summary }) => summary) };
    const legacy = migrateLegacy(s, raw);
    return legacy ? { currentId: legacy.session.id, sessions: [summarize(legacy.session)] } : empty;
  } catch { return empty; }
}

export function loadChatSession(id = null) {
  const s = store();
  if (!s) return null;
  try {
    const raw = s.getItem(CHAT_INDEX_KEY);
    const index = parseIndex(raw);
    if (!index) {
      const legacy = migrateLegacy(s, raw);
      return legacy && (!id || legacy.session.id === id) ? legacy.session : null;
    }
    const summary = index.sessions.find((entry) => entry.id === (id || index.currentId));
    if (!summary) return null;
    const record = readRecord(s, summary);
    const { messageIds, ...meta } = record.value;
    const session = chatFromSaveable({ ...meta, messages: readMessages(s, messageIds) });
    return session ? bindSnapshot(session, { id: session.id, key: record.key, raw: record.raw }) : null;
  } catch { return null; }
}

/** @returns {{ok:boolean, conflict?:boolean, full?:boolean, error?:string}} */
export function saveChatSession(session) {
  const s = store();
  if (!s || !session) return { ok: false, error: 'no-storage' };
  if (!session.id || !Array.isArray(session.messages)) return { ok: false, error: 'invalid-session' };
  try {
    let indexRaw = s.getItem(CHAT_INDEX_KEY);
    let index = parseIndex(indexRaw);
    const snapshot = session[SNAPSHOT];
    if (!index) {
      const legacy = readLegacy(s, indexRaw);
      if (legacy) {
        if (legacy.session.id === session.id) {
          if (snapshot?.legacyKey !== legacy.key || snapshot.raw !== legacy.raw) return { ok: false, conflict: true };
          return commitSession(s, session, null, indexRaw, null, legacy);
        }
        const migrated = commitSession(s, legacy.session, null, indexRaw, null, legacy);
        if (!migrated.ok) return migrated;
        indexRaw = s.getItem(CHAT_INDEX_KEY);
        index = parseIndex(indexRaw);
      } else if (indexRaw) {
        return { ok: false, error: 'unsupported-store' };
      }
    }
    const summary = index?.sessions.find((entry) => entry.id === session.id);
    const previous = summary ? readRecord(s, summary) : null;
    if (previous) {
      if (snapshot?.id !== session.id || snapshot.key !== previous.key || snapshot.raw !== previous.raw) return { ok: false, conflict: true };
    } else if (snapshot) {
      return { ok: false, conflict: true };
    }
    return commitSession(s, session, index, indexRaw, previous);
  } catch (err) { return saveError(err); }
}

export function setCurrentSession(id) {
  const s = store();
  if (!s || !id) return false;
  try {
    const raw = s.getItem(CHAT_INDEX_KEY);
    const index = parseIndex(raw);
    if (!index || !index.sessions.some((entry) => entry.id === id)) return false;
    index.currentId = id;
    index.revision = (index.revision || 0) + 1;
    if (s.getItem(CHAT_INDEX_KEY) !== raw) return false;
    s.setItem(CHAT_INDEX_KEY, JSON.stringify(index));
    return true;
  } catch { return false; }
}

export function importChatSessions(sessions, extraWrites = []) {
  const s = store();
  if (!s) throw new Error('浏览器存储不可用。');
  loadSessionList();
  const indexRaw = s.getItem(CHAT_INDEX_KEY);
  const index = parseIndex(indexRaw);
  if (indexRaw && !index) throw new Error('现有会话索引无法读取，未导入。');
  const staged = [];
  const written = [];
  try {
    const existing = new Set((index?.sessions || []).map(item => item.id));
    const summaries = [];
    for (const session of sessions) {
      if (existing.has(session.id)) throw new Error('导入会话编号冲突。');
      existing.add(session.id);
      const token = `t_${Date.now().toString(36)}_${globalThis.crypto.randomUUID()}`;
      const refs = [];
      for (const message of session.messages) {
        const ref = `${message.id}:${token}`;
        const key = CHAT_MSG_PREFIX + ref;
        s.setItem(key, JSON.stringify(message)); staged.push(key); refs.push(ref);
      }
      const storageKey = `${session.id}:${token}`;
      const key = CHAT_SESS_PREFIX + storageKey;
      s.setItem(key, JSON.stringify({ ...metaOf(session), messageIds: refs })); staged.push(key);
      summaries.push({ ...summarize(session), storageKey });
    }
    if (s.getItem(CHAT_INDEX_KEY) !== indexRaw || extraWrites.some(w => s.getItem(w.key) !== w.expected)) throw new Error('另一页面更新了数据，请重新导入。');
    for (const w of extraWrites) { s.setItem(w.key, w.value); written.push(w); }
    if (s.getItem(CHAT_INDEX_KEY) !== indexRaw) throw new Error('另一页面更新了会话，请重新导入。');
    s.setItem(CHAT_INDEX_KEY, JSON.stringify({ version: CHAT_STORE_VERSION, revision: (index?.revision || 0) + 1, currentId: index?.currentId || summaries[0]?.id || null, sessions: [...(index?.sessions || []), ...summaries] }));
    return summaries.length;
  } catch (error) {
    let rollbackFailed = false;
    for (const w of written.reverse()) {
      try { if (s.getItem(w.key) === w.value) { if (w.expected === null) s.removeItem(w.key); else s.setItem(w.key, w.expected); } else rollbackFailed = true; } catch { rollbackFailed = true; }
    }
    cleanUnreferenced(s, staged);
    if (rollbackFailed) throw new Error('导入失败，部分设置未能恢复。请保留备份，刷新后核对学习记录。');
    throw error;
  }
}

export function deleteChatSession(id) {
  const s = store();
  if (!s || !id) return false;
  try {
    const raw = s.getItem(CHAT_INDEX_KEY);
    const index = parseIndex(raw);
    const summary = index?.sessions.find((entry) => entry.id === id);
    if (!summary) return false;
    const record = readRecord(s, summary);
    index.sessions = index.sessions.filter((entry) => entry.id !== id);
    if (index.currentId === id) index.currentId = index.sessions[0]?.id || null;
    index.revision = (index.revision || 0) + 1;
    if (s.getItem(CHAT_INDEX_KEY) !== raw) return false;
    s.setItem(CHAT_INDEX_KEY, JSON.stringify(index));
    cleanUnreferenced(s, [record.key, ...record.value.messageIds.map((ref) => CHAT_MSG_PREFIX + ref)]);
    return true;
  } catch { return false; }
}

export function clearChatSession() {
  const s = store();
  if (!s) return false;
  try {
    const keys = [];
    for (let i = 0; i < s.length; i += 1) {
      const key = s.key(i);
      if (key?.startsWith(CHAT_SESS_PREFIX) || key?.startsWith(CHAT_MSG_PREFIX)) keys.push(key);
    }
    s.removeItem(CHAT_KEY);
    s.removeItem(CHAT_INDEX_KEY);
    cleanUnreferenced(s, keys);
    return true;
  } catch { return false; }
}

export function chatStorageSize() {
  const s = store();
  if (!s) return 0;
  try {
    const keys = liveKeys(s);
    if (!keys) return 0;
    let size = (s.getItem(CHAT_INDEX_KEY) || '').length + (s.getItem(CHAT_KEY) || '').length;
    for (const key of keys) size += (s.getItem(key) || '').length;
    return size;
  } catch { return 0; }
}

export function sweepOrphanMessages() {
  const s = store();
  if (!s) return 0;
  try {
    if (!parseIndex(s.getItem(CHAT_INDEX_KEY))) return 0;
    const live = liveKeys(s);
    if (!live) return 0;
    const orphans = [];
    for (let i = 0; i < s.length; i += 1) {
      const key = s.key(i);
      if (!key || live.has(key) || !(key.startsWith(CHAT_MSG_PREFIX) || key.startsWith(CHAT_SESS_PREFIX))) continue;
      const stagedAt = /:t_([0-9a-z]+)_/.exec(key);
      if (stagedAt && Date.now() - parseInt(stagedAt[1], 36) < STAGING_GRACE_MS) continue;
      orphans.push(key);
    }
    let removed = 0;
    for (const key of orphans) {
      try {
        s.removeItem(key);
        if (key.startsWith(CHAT_MSG_PREFIX)) removed += 1;
      } catch { /* ignore */ }
    }
    return removed;
  } catch { return 0; }
}
