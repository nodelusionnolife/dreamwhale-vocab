import { normalizeSpeechOptions, selectSpeechVoice, missingVoiceMessage, splitSpeechText, englishText } from '../engine/speech.js';
import { normalizeVoiceService, validateVoiceService, voiceSegments, VOICE_PROVIDERS } from '../engine/voice-service.js';
import { synthesizeCloudSpeech, playSpeechAudio } from './cloud-speech.js';

export function nativeRuntime() { return globalThis.__dreamwhaleNative || null; }
export function appStorage() { return nativeRuntime()?.storage || globalThis.localStorage; }
export function appFetch(...args) { return (nativeRuntime()?.fetch || globalThis.fetch)(...args); }
export async function flushStorage() { await nativeRuntime()?.storage.flush(); }
export function supportsSpeech() {
  return Boolean(nativeRuntime()?.speak || ('speechSynthesis' in globalThis && 'SpeechSynthesisUtterance' in globalThis));
}
let speechRun = 0;
let finishUtterance = null;
let cloudController = null;
export function stopSpeech() {
  speechRun++;
  cloudController?.abort(); cloudController = null;
  finishUtterance?.(); finishUtterance = null;
  if (nativeRuntime()?.stopSpeech) return nativeRuntime().stopSpeech();
  globalThis.speechSynthesis?.cancel();
}
export async function listSpeechVoices() {
  if (nativeRuntime()?.speechVoices) return nativeRuntime().speechVoices();
  if (!supportsSpeech()) return [];
  const synth = globalThis.speechSynthesis;
  if (!synth.getVoices().length) await new Promise(resolve => {
    const done = () => { clearTimeout(timer); synth.removeEventListener('voiceschanged', done); resolve(); };
    const timer = setTimeout(done, 1500); synth.addEventListener('voiceschanged', done);
    if (synth.getVoices().length) done();
  });
  return synth.getVoices().map(v => ({ id: v.voiceURI, name: v.name, lang: v.lang, local: v.localService, default: v.default }));
}
export async function prepareSpeech(raw = {}) {
  const options = normalizeSpeechOptions(raw);
  if (nativeRuntime()?.prepareSpeech) return nativeRuntime().prepareSpeech(options);
  const voice = selectSpeechVoice(await listSpeechVoices(), options);
  if (!voice) throw new Error(missingVoiceMessage(options));
  return voice;
}
export async function speakText(text, raw = {}, { onVoice, onNotice, service: serviceRaw } = {}) {
  const options = normalizeSpeechOptions(raw);
  if (!String(text).trim()) return;
  if (String(text).length > 12000) throw new Error('这段文字太长，请选取较短的段落朗读。');
  const stopping = stopSpeech();
  const run = speechRun;
  await stopping;
  if (run !== speechRun) return;
  const service = normalizeVoiceService(serviceRaw);
  if (service.provider !== 'system' && !options.speechOffline) {
    const controller = new AbortController(); cloudController = controller;
    const segments = voiceSegments(text, options.speechAccent);
    let index = 0;
    try {
      for (const segment of segments) validateVoiceService(service, segment.language);
      onVoice?.({ name: VOICE_PROVIDERS[service.provider].name, cloud: true, local: false, lang: options.speechAccent });
      for (; index < segments.length; index++) {
        controller.signal.throwIfAborted();
        const blob = await synthesizeCloudSpeech(service, segments[index], options.speechRate, { fetchImpl: appFetch, signal: controller.signal });
        controller.signal.throwIfAborted();
        await playSpeechAudio(blob, controller.signal);
      }
      return;
    } catch (error) {
      if (controller.signal.aborted || run !== speechRun) return;
      if (!service.fallback) throw error;
      text = englishText(segments.slice(index).map(segment => segment.text).join(' '));
      if (!text) throw error;
      onNotice?.(`${error.message} 正在尝试系统英文朗读。`);
    } finally { if (cloudController === controller) cloudController = null; }
  } else if (service.provider !== 'system' && options.speechOffline) {
    onNotice?.('仅离线模式：使用系统英文朗读。');
  }
  text = englishText(text);
  if (!text) throw new Error('系统朗读目前支持英文；中文请配置在线语音服务。');
  await speakSystemText(text, options, run, onVoice);
}
async function speakSystemText(text, options, run, onVoice) {
  if (!supportsSpeech()) throw new Error('当前设备不支持朗读，请尝试应用版或其他浏览器。');
  const voice = await prepareSpeech(options);
  if (run !== speechRun) return;
  onVoice?.(voice);
  for (const chunk of splitSpeechText(text)) {
    if (run !== speechRun) return;
    if (nativeRuntime()?.speak) { await nativeRuntime().speak(chunk, { ...options, voiceId: voice.id }); continue; }
    await new Promise((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(chunk);
      utterance.lang = options.speechAccent; utterance.rate = options.speechRate;
      utterance.voice = globalThis.speechSynthesis.getVoices().find(v => v.voiceURI === voice.id) || null;
      if (!utterance.voice) { reject(new Error(missingVoiceMessage(options))); return; }
      let timer;
      const done = error => { clearTimeout(timer); if (finishUtterance === cancel) finishUtterance = null; error ? reject(error) : resolve(); };
      const cancel = () => done(); finishUtterance = cancel;
      utterance.onend = () => done();
      utterance.onerror = event => done(['interrupted', 'canceled'].includes(event.error) ? null : new Error('读音播放失败，请检查英语语音包。'));
      timer = setTimeout(() => { done(new Error('朗读超时，请重试或检查系统语音服务。')); globalThis.speechSynthesis.cancel(); }, 90000);
      globalThis.speechSynthesis.speak(utterance);
    });
  }
}
export async function saveTextFile(name, content, type = 'application/json') {
  if (nativeRuntime()?.saveFile) return nativeRuntime().saveFile(name, content, type);
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a'); link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return true;
}
export async function pickTextFile(maxBytes = 24000000) {
  if (nativeRuntime()?.pickFile) return nativeRuntime().pickFile(maxBytes);
  return new Promise((resolve, reject) => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.json,application/json';
    input.addEventListener('cancel', () => resolve(null), { once: true });
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return resolve(null);
      try { if (file.size > maxBytes) throw new Error('文件超过允许大小。'); resolve(await file.text()); }
      catch (error) { reject(error); }
    }, { once: true });
    input.click();
  });
}
export async function copyText(text) {
  if (nativeRuntime()?.copyText) return nativeRuntime().copyText(text);
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const input = document.createElement('textarea'); input.value = text; document.body.append(input); input.select();
  const ok = document.execCommand('copy'); input.remove();
  if (!ok) throw new Error('无法访问剪贴板，请选中消息文字后复制。');
}
