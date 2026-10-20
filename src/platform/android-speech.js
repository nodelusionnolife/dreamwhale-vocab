export function migrateAndroidSpeechPreferences(storage) {
  const key = 'dreamwhale:client-preferences:v1';
  const text = storage.getItem(key);
  if (!text) return;
  let raw;
  try { raw = JSON.parse(text); } catch { return; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.speechPolicyVersion === 1) return;
  storage.setItem(key, JSON.stringify({ ...raw, speechOffline: false, speechPolicyVersion: 1 }));
}
