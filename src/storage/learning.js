import { appStorage } from '../platform/runtime.js';
import { emptyLearning, validateLearning } from '../engine/learning.js';

const KEY = 'dreamwhale:learning:v1';
const HISTORY = 'dreamwhale:learning:history:';
const CHUNK_SIZE = 1000;

function historyOf(record) {
  if (record?.version !== 2) return [];
  if (!Array.isArray(record.history) || !record.current || record.current.version !== 1
    || record.history.some(part => !part || typeof part.key !== 'string' || !part.key.startsWith(HISTORY) || part.count !== CHUNK_SIZE)
    || new Set(record.history.map(part => part.key)).size !== record.history.length) throw new Error('学习历史索引已损坏，请保留数据并从备份恢复。');
  return record.history;
}

export function loadLearning(storage = appStorage()) {
  const raw = storage.getItem(KEY);
  if (!raw) return { state: emptyLearning(), raw };
  const record = JSON.parse(raw);
  const history = historyOf(record);
  const events = [];
  for (const part of history) {
    const chunk = JSON.parse(storage.getItem(part.key));
    if (!Array.isArray(chunk) || chunk.length !== part.count) throw new Error('学习历史缺失或已损坏，请保留数据并从备份恢复。');
    events.push(...chunk);
  }
  const current = record.version === 2 ? record.current : record;
  const state = validateLearning(current);
  if (history.length) state.events = [...events, ...state.events];
  if (storage.getItem(KEY) !== raw) throw new Error('另一页面更新了学习记录，请重新打开练习后再试。');
  return { state: history.length ? validateLearning(state) : state, raw };
}

export function prepareLearningSave(state, expectedRaw, storage = appStorage()) {
  const valid = validateLearning(state);
  if (storage.getItem(KEY) !== expectedRaw) throw new Error('另一页面更新了学习记录，请重新打开练习后再试。');
  const previous = expectedRaw ? historyOf(JSON.parse(expectedRaw)) : [];
  const next = { ...valid, revision: (valid.revision || 0) + 1 };
  const history = [], writes = [];
  let offset = 0;
  while (next.events.length - offset > CHUNK_SIZE * 2) {
    const value = JSON.stringify(next.events.slice(offset, offset + CHUNK_SIZE));
    const old = previous[history.length];
    if (old && storage.getItem(old.key) === value) history.push(old);
    else {
      const key = HISTORY + globalThis.crypto.randomUUID();
      history.push({ key, count: CHUNK_SIZE });
      writes.push({ key, expected: null, value });
    }
    offset += CHUNK_SIZE;
  }
  const raw = JSON.stringify(history.length ? { version: 2, history, current: { ...next, events: next.events.slice(offset) } } : next);
  writes.push({ key: KEY, expected: expectedRaw, value: raw });
  return { state: next, raw, writes, obsolete: previous.filter(part => !history.some(item => item.key === part.key)).map(part => part.key) };
}

export function finishLearningSave(prepared, storage = appStorage()) {
  if (storage.getItem(KEY) !== prepared.raw) return;
  for (const key of prepared.obsolete) { try { storage.removeItem(key); } catch {} }
}

export function saveLearning(state, expectedRaw, storage = appStorage()) {
  const prepared = prepareLearningSave(state, expectedRaw, storage);
  const written = [];
  try {
    for (const write of prepared.writes) {
      if (storage.getItem(KEY) !== expectedRaw || storage.getItem(write.key) !== write.expected) throw new Error('另一页面更新了学习记录，请重新打开练习后再试。');
      storage.setItem(write.key, write.value);
      written.push(write);
    }
  } catch (error) {
    for (const write of written.reverse()) {
      try { if (storage.getItem(write.key) === write.value) storage.removeItem(write.key); } catch {}
    }
    throw error;
  }
  finishLearningSave(prepared, storage);
  return { state: prepared.state, raw: prepared.raw };
}

export function updateLearning(transform, storage = appStorage()) {
  const { state, raw } = loadLearning(storage);
  return saveLearning(transform(state), raw, storage).state;
}

export function exportLearning(state, { includeRounds = false } = {}) {
  const valid = validateLearning(state);
  return JSON.stringify({ kind: 'dreamwhale-learning', ...valid, ...(includeRounds
    ? { active: valid.active.practice ? { practice: valid.active.practice } : {} }
    : { active: {}, round: null, pausedRounds: [] }) }, null, 2);
}

export function importLearning(text, storage = appStorage()) {
  const incoming = JSON.parse(text);
  if (incoming.kind !== 'dreamwhale-learning') throw new Error('这不是梦鲸学习记录。');
  const imported = validateLearning(incoming);
  return updateLearning((state) => {
    const events = new Map(imported.events.map((e) => [e.id, e]));
    for (const e of state.events) events.set(e.id, e);
    return { ...state, events: [...events.values()].sort((a,b) => a.at - b.at || a.id.localeCompare(b.id)), favorites: [...new Set([...state.favorites, ...imported.favorites])] };
  }, storage);
}
