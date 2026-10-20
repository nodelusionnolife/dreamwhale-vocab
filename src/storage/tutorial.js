import { appStorage } from '../platform/runtime.js';
const KEY = 'dreamwhale:tutorial:v1';

export function loadTutorial(storage = appStorage()) {
  try {
    const value = JSON.parse(storage.getItem(KEY));
    return value?.version === 1 && ['active', 'completed', 'skipped'].includes(value.status) && typeof value.step === 'string' ? value : null;
  } catch { return null; }
}

export function saveTutorial(status, step, storage = appStorage()) {
  if (!['active', 'completed', 'skipped'].includes(status) || typeof step !== 'string') throw new Error('引导进度无效。');
  storage.setItem(KEY, JSON.stringify({ version: 1, status, step }));
}
