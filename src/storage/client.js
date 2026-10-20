import { appStorage } from '../platform/runtime.js';
import { modelEntry, normalizeCompanion, normalizePreferences } from '../engine/client.js';

const PREFS = 'dreamwhale:client-preferences:v1';
const MODELS = 'dreamwhale:models:v1';
const COMPANION = 'dreamwhale:companion:v1';
const DRAFTS = 'dreamwhale:chat-drafts:v1';

function read(key, fallback, storage = appStorage()) {
  const raw = storage.getItem(key);
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { throw new Error('本地设置无法读取，请先导出备份，不要覆盖原数据。'); }
}
export const loadPreferences = (storage) => normalizePreferences(read(PREFS, {}, storage));
export const savePreferences = (value, storage = appStorage()) => storage.setItem(PREFS, JSON.stringify(normalizePreferences(value)));
export const loadCompanion = (storage) => normalizeCompanion(read(COMPANION, {}, storage));
export const saveCompanion = (value, storage = appStorage()) => storage.setItem(COMPANION, JSON.stringify(normalizeCompanion(value)));

export function loadModels(legacy, storage) {
  const raw = read(MODELS, null, storage);
  if (!raw) { const model = modelEntry({ ...legacy, id: 'legacy-model', name: legacy?.model || '默认模型' }); return { version:1, activeId:model.id, entries:[model] }; }
  if (raw.version !== 1 || !Array.isArray(raw.entries) || !raw.entries.length || raw.entries.length > 30) throw new Error('模型配置版本或内容无效。');
  const entries = raw.entries.map(entry => modelEntry(entry));
  if (new Set(entries.map(e=>e.id)).size !== entries.length) throw new Error('模型配置编号重复。');
  return { version:1, entries, activeId:entries.some(e=>e.id===raw.activeId) ? raw.activeId : entries[0].id };
}
export function saveModels(value, storage = appStorage()) {
  if (!value.entries.length || value.entries.length > 30) throw new Error('请保留 1 到 30 个模型配置。');
  storage.setItem(MODELS, JSON.stringify({version:1,activeId:value.activeId,entries:value.entries.map(e=>modelEntry(e))}));
}

export const loadDraft = (id, storage) => { const drafts = read(DRAFTS, {}, storage); return drafts && Object.hasOwn(drafts, id) ? String(drafts[id]) : ''; };
export function saveDraft(id, text, storage = appStorage()) {
  if (!id) return;
  const drafts = { ...read(DRAFTS, {}, storage) };
  if (text) Object.defineProperty(drafts, id, { value: String(text).slice(0, 60000), enumerable: true, configurable: true }); else delete drafts[id];
  storage.setItem(DRAFTS, JSON.stringify(drafts));
}
export const clearDrafts = (storage = appStorage()) => storage.removeItem(DRAFTS);
