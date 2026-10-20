import { speakText, stopSpeech, prepareSpeech, nativeRuntime, flushStorage } from '../platform/runtime.js';
import { englishText, speechAccentMatches, speechVoiceStatus } from '../engine/speech.js';
import { loadPreferences } from '../storage/client.js';
import { loadVoiceService, saveVoiceService } from '../storage/voice-service.js';
import { speechText, chatSpeechText, normalizeVoiceService } from '../engine/voice-service.js';

let active = null;
let sequence = 0;
let notice;
function resetButton() {
  const stop = document.getElementById('btn-stop-reading'); if (stop) stop.disabled = true;
  if (active) { active.textContent = active.dataset.speechLabel; active.setAttribute('aria-label', active.dataset.speechAria); active.setAttribute('aria-pressed', 'false'); active = null; }
}
export function stopReading() {
  sequence++; resetButton();
  Promise.resolve(stopSpeech()).catch(showError);
}
function showError(error) {
  if (!notice) { notice = document.createElement('div'); notice.className = 'speech-notice'; notice.setAttribute('role', 'status'); document.body.append(notice); }
  notice.textContent = error?.message || String(error); notice.hidden = false;
  clearTimeout(notice.timer); notice.timer = setTimeout(() => { notice.hidden = true; }, 9000);
}
export async function readAloud(raw, control, { full = false, scope = 'learning', service: override, onComplete } = {}) {
  if (control && control === active) { stopReading(); return; }
  const text = scope === 'chat' ? chatSpeechText(raw) : full ? speechText(raw) : englishText(raw);
  if (!text) return;
  const request = ++sequence; resetButton(); if (notice) notice.hidden = true;
  const stop = document.getElementById('btn-stop-reading'); if (stop) stop.disabled = false;
  if (control) { active = control; control.textContent = '■ 停止'; control.setAttribute('aria-label', '停止朗读'); control.setAttribute('aria-pressed', 'true'); }
  try {
    const service = scope === 'chat' ? normalizeVoiceService(override || loadVoiceService()) : undefined;
    const preferences = service ? { speechAccent: service.speechAccent, speechRate: service.speechRate, speechOffline: false } : loadPreferences();
    await speakText(text, preferences, { service, onNotice: message => { if (request === sequence) showError(message); }, onVoice: voice => {
      if (request === sequence && !voice.cloud && (voice.local !== true || !speechAccentMatches(voice.lang, preferences.speechAccent))) showError(speechVoiceStatus(voice, preferences));
    } });
    if (request === sequence) onComplete?.(null);
  }
  catch (error) { if (request === sequence) { showError(error); onComplete?.(error); } }
  finally { if (request === sequence) resetButton(); }
}
export function speechButton(text, label = '朗读', accessible = label, options = {}) {
  const button = document.createElement('button'); button.type = 'button'; button.className = 'speech-button';
  button.textContent = `▶ ${label}`; button.dataset.speechLabel = button.textContent;
  button.dataset.speechAria = accessible; button.setAttribute('aria-label', accessible); button.setAttribute('aria-pressed', 'false');
  button.addEventListener('click', event => { event.stopPropagation(); return readAloud(typeof text === 'function' ? text() : text, button, options); });
  return button;
}
export function appendSpeech(host, text, label = '朗读英文', options = {}) {
  if (options.full ? speechText(text) : englishText(text)) host.append(speechButton(text, label, label, options));
}
export function autoReadReply(text) {
  try {
    if (document.hidden || !document.body.classList.contains('chat-mode') || document.getElementById('settings')?.open || !loadVoiceService().autoRead) return;
    return readAloud(text, null, { full: true, scope: 'chat' });
  } catch (error) { showError(error); }
}
export function initSpeechSettings({ getPreferences, save, notify }) {
  const $ = id => document.getElementById(id);
  const fields = { speechAccent: 'set-speech-accent', speechRate: 'set-speech-rate', speechOffline: 'set-speech-offline' };
  const sync = () => { const p = getPreferences(); for (const [key, id] of Object.entries(fields)) { const field = $(id); if (field.type === 'checkbox') field.checked = p[key]; else field.value = p[key]; } $('speech-rate-label').textContent = `${p.speechRate.toFixed(2)}×`; };
  let refreshId = 0;
  async function refresh() {
    const id = ++refreshId; $('speech-voice-status').textContent = '正在检查声音…';
    try {
      const prefs = getPreferences();
      const voice = await prepareSpeech(prefs); if (id !== refreshId) return; $('speech-voice-status').textContent = speechVoiceStatus(voice, prefs);
    }
    catch (error) { if (id === refreshId) $('speech-voice-status').textContent = error.message || String(error); }
  }
  for (const [key, id] of Object.entries(fields)) $(id).addEventListener('change', () => {
    try { save({ ...getPreferences(), [key]: $(id).type === 'checkbox' ? $(id).checked : key === 'speechRate' ? Number($(id).value) : $(id).value }); stopReading(); }
    catch (error) { notify(error.message); }
    sync(); refresh();
  });
  $('set-speech-rate').addEventListener('input', () => { $('speech-rate-label').textContent = `${Number($('set-speech-rate').value).toFixed(2)}×`; });
  $('btn-refresh-voices').addEventListener('click', refresh);
  const learningTest = $('speech-test');
  learningTest.dataset.speechLabel = learningTest.textContent; learningTest.dataset.speechAria = learningTest.textContent;
  learningTest.addEventListener('click', () => readAloud('Hello! Let us learn something new together.', learningTest));
  let draft = loadVoiceService();
  let provider = draft.provider;
  const serviceFields = { apiKey: 'voice-api-key', workspace: 'voice-workspace', model: 'voice-model', voiceUS: 'voice-us', voiceUK: 'voice-uk', voiceZH: 'voice-zh' };
  function capture() {
    if (provider !== 'system') for (const [key, id] of Object.entries(serviceFields)) draft.profiles[provider][key] = $(id).value;
    draft.provider = provider; draft.fallback = $('voice-fallback').checked; draft.autoRead = $('voice-auto-read').checked;
    draft.speechAccent = $('voice-accent').value; draft.speechRate = Number($('voice-rate').value);
  }
  function fill() {
    $('voice-provider').value = provider; $('voice-online-fields').hidden = provider === 'system'; $('voice-workspace-field').hidden = provider !== 'aliyun';
    $('voice-fallback').checked = draft.fallback; $('voice-auto-read').checked = draft.autoRead;
    $('voice-accent').value = draft.speechAccent; $('voice-rate').value = draft.speechRate;
    $('voice-rate-label').textContent = `${draft.speechRate.toFixed(2)}×`;
    $('voice-api-key').type = 'password'; $('voice-show-key').checked = false;
    if (provider === 'system') return;
    for (const [key, id] of Object.entries(serviceFields)) $(id).value = draft.profiles[provider][key];
    $('voice-provider-hint').textContent = provider === 'aliyun'
      ? '使用北京地域的 API Key 和业务空间 ID。预设模型支持 Abby 美式、Emily 英式、叶清禾中文音色。'
      : '默认英文音色未标注口音；需要英式时请填写平台确认的英式音色 ID。口音由所填音色决定。';
    const link = $('voice-docs'); link.href = provider === 'aliyun' ? 'https://help.aliyun.com/zh/model-studio/qwen-audio-tts-voice-list' : 'https://platform.minimax.cn/docs/faq/system-voice-id';
  }
  function saveService() {
    capture(); saveVoiceService(draft); draft = loadVoiceService(); stopReading();
    return sequence;
  }
  async function persist() {
    const request = saveService(); await flushStorage(); return request;
  }
  $('voice-provider').addEventListener('change', () => { capture(); provider = $('voice-provider').value; fill(); });
  $('voice-rate').addEventListener('input', () => { $('voice-rate-label').textContent = `${Number($('voice-rate').value).toFixed(2)}×`; });
  $('voice-show-key').addEventListener('change', () => { $('voice-api-key').type = $('voice-show-key').checked ? 'text' : 'password'; });
  $('voice-save').addEventListener('click', async () => {
    try { await persist(); $('voice-save-status').textContent = '聊天语音已保存。'; }
    catch (error) { $('voice-save-status').textContent = error.message; }
  });
  for (const [id, text] of [['voice-test-en', 'Hello! Let us learn something new together.'], ['voice-test-chat', '你好，我们一起学习。 Let us begin.']]) {
    const button = $(id); button.dataset.speechLabel = button.textContent; button.dataset.speechAria = button.textContent;
    button.addEventListener('click', async () => {
      if (active === button) { stopReading(); $('voice-test-status').textContent = '已停止试听。'; return; }
      try {
        const request = await persist();
        if (request !== sequence) return;
        $('voice-save-status').textContent = '聊天语音已保存。';
        $('voice-test-status').textContent = '正在试听…';
        await readAloud(text, button, { full: true, scope: 'chat', service: normalizeVoiceService({ ...draft, fallback: false }), onComplete: error => { $('voice-test-status').textContent = error ? error.message : '试听播放完成。'; } });
      } catch (error) { $('voice-test-status').textContent = error.message; }
    });
  }
  $('voice-storage-hint').textContent = nativeRuntime() ? 'Key 加密保存在本机，不随备份导出。在线合成会将朗读文本发送给所选服务商。' : 'Key 保存在当前浏览器，不随备份导出。在线合成会将朗读文本发送给所选服务商。';
  fill();
  sync();
  return { refresh, save: saveService, open() { draft = loadVoiceService(); provider = draft.provider; fill(); sync(); refresh(); } };
}
export function initSelectionSpeech() {
  document.getElementById('btn-stop-reading')?.addEventListener('click', stopReading);
  const panel = document.createElement('div'); panel.className = 'selection-speech'; panel.hidden = true;
  let selected = '';
  panel.append(speechButton(() => selected, '朗读选中英文'));
  const dismiss = document.createElement('button'); dismiss.type = 'button'; dismiss.textContent = '×'; dismiss.setAttribute('aria-label', '关闭选中朗读');
  dismiss.addEventListener('click', () => { panel.hidden = true; stopReading(); }); panel.append(dismiss); document.body.append(panel);
  document.addEventListener('selectionchange', () => {
    const selection = globalThis.getSelection();
    if (panel.contains(document.activeElement)) return;
    const element = selection?.anchorNode?.parentElement;
    if (!selection || selection.isCollapsed || !element?.closest('#view-learn, #view-chat') || element.closest('input,textarea,button,[contenteditable]')) { if (active !== panel.firstChild) panel.hidden = true; return; }
    selected = selection.toString().trim(); panel.hidden = !englishText(selected);
  });
  for (const event of ['dreamwhale:pause', 'pagehide']) globalThis.addEventListener(event, stopReading);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopReading(); });
  document.querySelector('.main-nav')?.addEventListener('click', () => { panel.hidden = true; stopReading(); });
  new MutationObserver(() => { if (active && !active.isConnected) stopReading(); }).observe(document.body, { childList: true, subtree: true });
}
