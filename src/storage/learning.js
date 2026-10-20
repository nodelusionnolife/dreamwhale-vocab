import { appStorage } from '../platform/runtime.js';
import { emptyLearning, validateLearning } from '../engine/learning.js';

const KEY = 'dreamwhale:learning:v1';

export function loadLearning(storage = appStorage()) {
  const raw = storage.getItem(KEY);
  return { state: raw ? validateLearning(JSON.parse(raw)) : emptyLearning(), raw };
}

export function saveLearning(state, expectedRaw, storage = appStorage()) {
  const valid = validateLearning(state);
  if (storage.getItem(KEY) !== expectedRaw) throw new Error('另一页面更新了学习记录，请重新打开练习后再试。');
  const next = { ...valid, revision: (valid.revision || 0) + 1 };
  const raw = JSON.stringify(next);
  storage.setItem(KEY, raw);
  return { state: next, raw };
}

export function updateLearning(transform, storage = appStorage()) {
  const { state, raw } = loadLearning(storage);
  return saveLearning(transform(state), raw, storage).state;
}

export function exportLearning(state) {
  const valid = validateLearning(state);
  return JSON.stringify({ kind: 'dreamwhale-learning', ...valid, active: {}, round: null }, null, 2);
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
