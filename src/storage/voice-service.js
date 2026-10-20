import { appStorage } from '../platform/runtime.js';
import { normalizeVoiceService } from '../engine/voice-service.js';

export const VOICE_SERVICE_KEY = 'dreamwhale:voice-service:v1';
export function loadVoiceService(storage = appStorage()) {
  const raw = storage.getItem(VOICE_SERVICE_KEY);
  if (!raw) return normalizeVoiceService();
  try { return normalizeVoiceService(JSON.parse(raw)); }
  catch { throw new Error('语音服务设置无法读取，请先导出备份。'); }
}
export function saveVoiceService(value, storage = appStorage()) {
  storage.setItem(VOICE_SERVICE_KEY, JSON.stringify(normalizeVoiceService(value)));
}
