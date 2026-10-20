export const SPEECH_DEFAULTS = { speechAccent: 'en-US', speechRate: 0.85, speechOffline: false, speechPolicyVersion: 1 };

export function normalizeSpeechOptions(raw = {}) {
  const rate = Number(raw.speechRate);
  return {
    speechAccent: raw.speechAccent === 'en-GB' ? 'en-GB' : 'en-US',
    speechRate: Number.isFinite(rate) && rate >= 0.5 && rate <= 1.5 ? Math.round(rate * 100) / 100 : 0.85,
    speechOffline: raw.speechOffline === true,
    speechPolicyVersion: 1,
  };
}

export function englishText(raw) {
  return (String(raw || '').replace(/https?:\/\/\S+/g, '').replace(/_{2,}/g, ' blank ')
    .match(/[A-Za-zÀ-ž][A-Za-zÀ-ž0-9\s.,!?;:'’"“”()\-–—/%]*/g) || [])
    .map(part => part.trim().replace(/[\s,;:\-]+$/, '')).filter(Boolean).join('. ').replace(/\s+/g, ' ').trim();
}

export function splitSpeechText(text, max = 220) {
  const chunks = [];
  let rest = String(text).replace(/\s+/g, ' ').trim();
  while (rest.length > max) {
    const head = rest.slice(0, max + 1);
    const sentence = [...head.matchAll(/[.!?;]\s/g)].at(-1);
    const at = sentence ? sentence.index + 1 : Math.max(head.lastIndexOf(' '), 1);
    const cut = at > 1 ? at : max;
    chunks.push(rest.slice(0, cut).trim()); rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

export function selectSpeechVoice(voices, raw) {
  const options = normalizeSpeechOptions(raw);
  return voices.filter(voice => speechAccentMatches(voice.lang, options.speechAccent)
    && (!options.speechOffline || voice.local === true))
    .sort((a, b) => Number(b.local) - Number(a.local) || Number(b.default) - Number(a.default) || String(a.id).localeCompare(String(b.id)))[0] || null;
}

export function speechAccentMatches(actual, requested) {
  return String(actual).replaceAll('_', '-').toLowerCase().split('-').slice(0, 2).join('-') === requested.toLowerCase();
}

export function speechVoiceStatus(voice, raw) {
  const options = normalizeSpeechOptions(raw);
  const connection = voice.local === true ? '可离线使用' : voice.local === false ? '需要联网' : '联网情况由系统决定';
  const accent = speechAccentMatches(voice.lang, options.speechAccent) ? '' : ` · 当前为 ${voice.lang || '系统默认英语'}，未匹配${options.speechAccent === 'en-GB' ? '英式' : '美式'}口音`;
  return `${voice.name || '系统默认声音'} · ${connection}${accent}`;
}

export function missingVoiceMessage(raw) {
  const options = normalizeSpeechOptions(raw);
  return `没有可用的${options.speechOffline ? '离线' : ''}${options.speechAccent === 'en-GB' ? '英式' : '美式'}英语声音。请安装系统英语语音包，并在“设置 → 常用 → 学习朗读”刷新声音。`;
}
