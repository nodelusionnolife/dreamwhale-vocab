import { appStorage } from '../platform/runtime.js';
import { loadSessionList, loadChatSession, importChatSessions, loadProfile, loadUserProfile } from './save.js';
import { normalizeProfile } from '../engine/chat.js';
import { loadLearning, exportLearning, prepareLearningSave, finishLearningSave } from './learning.js';
import { mergePendingRounds, pendingRounds } from '../engine/study.js';
import { loadModels, loadPreferences, loadCompanion } from './client.js';
import { validateLearning } from '../engine/learning.js';
import { modelEntry, newId, normalizePreferences, normalizeCompanion, validateConversation } from '../engine/client.js';
import { loadVoiceService, VOICE_SERVICE_KEY } from './voice-service.js';
import { normalizeVoiceService } from '../engine/voice-service.js';

const scrub = value => JSON.parse(JSON.stringify(value, (key, v) => ['apiKey', 'authorization', '__proto__', 'constructor', 'prototype'].includes(key) ? undefined : v));

export function createBackup(storage = appStorage()) {
  const list = loadSessionList();
  const chats = list.sessions.map(s => {
    const full = loadChatSession(s.id);
    if (!full) throw new Error('有对话无法读取，请先检查会话列表。');
    return scrub(full);
  });
  if (JSON.stringify(loadSessionList()) !== JSON.stringify(list)) throw new Error('备份期间另一页面更新了对话，请重试。');
  return { kind:'dreamwhale-client', version:1, id:newId('backup'), createdAt:new Date().toISOString(),
    chats, learning:JSON.parse(exportLearning(loadLearning(storage).state, { includeRounds: true })),
    models:loadModels(loadProfile(),storage).entries.map(e=>modelEntry(e,{secrets:false})),
    preferences:loadPreferences(storage), companion:loadCompanion(storage), userProfile:loadUserProfile(),
    voiceService:normalizeVoiceService(loadVoiceService(storage), { secrets:false }),
  };
}

export function parseBackup(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > 64 * 1024 * 1024) throw new Error('备份不能超过 64 MB。');
  const data = scrub(JSON.parse(text));
  if (data.kind !== 'dreamwhale-client' || data.version !== 1 || typeof data.id !== 'string' || !data.id || data.id.length > 200 || !Array.isArray(data.chats) || data.chats.length > 1000) throw new Error('备份格式或版本不受支持。');
  const chats = data.chats.map(validateConversation);
  if (new Set(chats.map(s=>s.id)).size !== chats.length) throw new Error('备份中有重复对话。');
  const learning = validateLearning(data.learning);
  if (!Array.isArray(data.models) || data.models.length > 30) throw new Error('模型配置格式不正确。');
  if (data.models.some(e=>!e || typeof e.id!=='string' || !e.id || !e.profile || typeof e.profile.endpoint!=='string' || typeof e.profile.model!=='string') || new Set(data.models.map(e=>e.id)).size!==data.models.length) throw new Error('模型配置编号重复或内容无效。');
  return { ...data, chats, learning, models:data.models.map(e=>modelEntry(e,{secrets:false})), preferences:normalizePreferences(data.preferences), companion:normalizeCompanion(data.companion),
    ...(data.voiceService ? { voiceService:normalizeVoiceService(data.voiceService, { secrets:false }) } : {}) };
}

export function restoreBackup(data, { includeSettings = false, storage = appStorage() } = {}) {
  data = parseBackup(JSON.stringify(data));
  const list = loadSessionList();
  const existing = list.sessions.map(s=>loadChatSession(s.id));
  if (existing.some(s=>!s)) throw new Error('现有对话无法读取，未导入。');
  const ids = new Set(existing.map(s=>s.id));
  const sources = new Set(existing.map(s=>s.importSource));
  const models = loadModels(loadProfile(),storage);
  const entries = [...models.entries];
  const modelIds = new Map();
  for (const entry of data.models) {
    let match = entries.find(e=>['endpoint','model','apiFormat','authMode'].every(key=>e.profile[key] === entry.profile[key]));
    if (!match && includeSettings) { match={...entry,id:newId('model')}; entries.push(match); }
    modelIds.set(entry.id,match?.id || '');
  }
  if (entries.length > 30) throw new Error('合并后超过 30 个模型配置，请减少配置后再导入。');
  const chats = [];
  for (const incoming of data.chats) {
    const source = `${data.id}/${incoming.id}`;
    if (sources.has(source)) continue;
    const same = existing.find(s=>s.id === incoming.id);
    if (same && JSON.stringify(scrub(same)) === JSON.stringify(incoming)) continue;
    const id = ids.has(incoming.id) ? newId('import') : incoming.id;
    ids.add(id);
    chats.push({ ...incoming, id, modelId:modelIds.get(incoming.modelId) || '', importSource:source, title:String(incoming.title || '导入对话').slice(0,40), titleManual:true });
  }
  const current = loadLearning(storage);
  const events = new Map(data.learning.events.map(e=>[e.id,e]));
  for (const event of current.state.events) events.set(event.id,event);
  const merged = validateLearning({ ...current.state,
    ...mergePendingRounds(current.state, data.learning),
    ...(includeSettings ? { plan: { ...data.learning.plan }, preferences: { ...data.learning.preferences } } : {}),
    events:[...events.values()].sort((a,b)=>a.at-b.at || a.id.localeCompare(b.id)), favorites:[...new Set([...current.state.favorites,...data.learning.favorites])] });
  const prepared = prepareLearningSave(merged, current.raw, storage);
  const writes = [...prepared.writes];
  const add = (key,value) => writes.push({ key, expected:storage.getItem(key), value:JSON.stringify(value) });
  if (includeSettings) {
    if (data.voiceService) {
      const incoming = normalizeVoiceService(data.voiceService, { secrets:false });
      const currentVoice = loadVoiceService(storage);
      for (const id of Object.keys(incoming.profiles)) incoming.profiles[id].apiKey = currentVoice.profiles[id].apiKey;
      add(VOICE_SERVICE_KEY,incoming);
    }
    add('dreamwhale:client-preferences:v1',data.preferences);
    add('dreamwhale:companion:v1',data.companion);
    add('dreamwhale:models:v1',{...models,entries});
    if (!loadUserProfile() && normalizeProfile(data.userProfile)) add('word-blade:user-profile',normalizeProfile(data.userProfile));
  }
  const count = importChatSessions(chats,writes);
  finishLearningSave(prepared, storage);
  return { chats:count, events:merged.events.length-current.state.events.length, rounds:pendingRounds(merged).length-pendingRounds(current.state).length };
}
