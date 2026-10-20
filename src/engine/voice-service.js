import { splitSpeechText, normalizeSpeechOptions } from './speech.js';

export const VOICE_PROVIDERS = {
  aliyun: { name: '阿里百炼', model: 'qwen-audio-3.1-tts-flash', voiceUS: 'Abby_v3.1', voiceUK: 'Emily_v3.1', voiceZH: 'yeqinghe_v3.1' },
  minimax: { name: 'MiniMax', model: 'speech-2.8-turbo', voiceUS: 'English_Graceful_Lady', voiceUK: '', voiceZH: 'female-tianmei' },
};

const string = (value, fallback = '', max = 256) => typeof value === 'string' ? value.trim().slice(0, max) : fallback;
export function normalizeVoiceService(raw = {}, { secrets = true } = {}) {
  raw = raw && typeof raw === 'object' ? raw : {};
  const profiles = {};
  for (const [id, defaults] of Object.entries(VOICE_PROVIDERS)) {
    const source = raw.profiles?.[id] || {};
    profiles[id] = {
      apiKey: secrets ? string(source.apiKey, '', 4096) : '', workspace: string(source.workspace, '', 100),
      model: string(source.model, defaults.model),
      voiceUS: string(source.voiceUS, defaults.voiceUS), voiceUK: string(source.voiceUK, defaults.voiceUK), voiceZH: string(source.voiceZH, defaults.voiceZH),
    };
  }
  const { speechAccent, speechRate } = normalizeSpeechOptions(raw);
  return { version: 1, speechAccent, speechRate, provider: Object.hasOwn(VOICE_PROVIDERS, raw.provider) ? raw.provider : 'system',
    fallback: raw.fallback !== false, autoRead: raw.autoRead === true, profiles };
}

export function validateVoiceService(service, language = 'en-US') {
  const profile = service.profiles[service.provider];
  if (!profile) return;
  if (!profile.apiKey || /[\r\n]/.test(profile.apiKey)) throw new Error('请在“设置 → 语音服务”填写有效的 API Key。');
  if (!profile.model) throw new Error('请填写语音模型名称。');
  if (service.provider === 'aliyun' && !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,99}$/.test(profile.workspace)) throw new Error('请填写阿里百炼北京地域的业务空间 ID。');
  if (!profile[language === 'zh-CN' ? 'voiceZH' : language === 'en-GB' ? 'voiceUK' : 'voiceUS']) throw new Error(`请填写${language === 'zh-CN' ? '中文' : language === 'en-GB' ? '英式' : '英文'}音色 ID。`);
}

export function speechText(raw) {
  return String(raw || '').replace(/<(TurnSummary|AnswerKey|TeachingReference|Face|Sticker)>[\s\S]*?(?:<\/\1>|$)/gi, '')
    .replace(/<[^>]*>/g, '').replace(/<[^>]*$/, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/https?:\/\/\S+/g, '')
    .replace(/_{2,}/g, ' blank ').replace(/[*`#~^|]/g, '').replace(/\s+/g, ' ').trim();
}

export function chatSpeechText(raw) {
  return speechText(String(raw || '').replace(/<Question>[\s\S]*?(?:<\/Question>|$)/gi, ' '));
}

export function voiceSegments(raw, accent = 'en-US') {
  const text = speechText(raw);
  const runs = [];
  let buffer = '', language = '';
  for (const char of text) {
    const next = /[\p{Script=Han}]/u.test(char) ? 'zh-CN' : /[A-Za-zÀ-ž]/.test(char) ? accent : language;
    if (language && next && next !== language) { if (buffer.trim()) runs.push({ text: buffer.trim(), language }); buffer = ''; }
    language = next || language; buffer += char;
  }
  if (buffer.trim()) runs.push({ text: buffer.trim(), language: language || accent });
  return runs.flatMap(run => splitSpeechText(run.text, 600).map(text => ({ text, language: run.language })));
}

export function voiceRequest(service, segment, rate) {
  validateVoiceService(service, segment.language);
  const p = service.profiles[service.provider];
  const voice = p[segment.language === 'zh-CN' ? 'voiceZH' : segment.language === 'en-GB' ? 'voiceUK' : 'voiceUS'];
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${p.apiKey}` };
  if (service.provider === 'aliyun') return {
    url: `https://${p.workspace}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer`, headers,
    body: { model: p.model, input: { text: segment.text, voice, format: 'mp3', sample_rate: 24000, rate, language_hints: [segment.language === 'zh-CN' ? 'zh' : 'en'] } },
  };
  return { url: 'https://api.minimax.cn/v1/t2a_v2', headers, body: {
    model: p.model, text: segment.text, stream: false, output_format: 'hex',
    voice_setting: { voice_id: voice, speed: rate, vol: 1, pitch: 0 },
    audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1 },
    language_boost: segment.language === 'zh-CN' ? 'Chinese' : 'English',
  } };
}
