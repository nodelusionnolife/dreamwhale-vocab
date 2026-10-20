import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeVoiceService, speechText, chatSpeechText, voiceSegments, voiceRequest } from '../src/engine/voice-service.js';
import { loadVoiceService, saveVoiceService } from '../src/storage/voice-service.js';
import { createBackup, parseBackup, restoreBackup } from '../src/storage/backup.js';
import { synthesizeCloudSpeech, playSpeechAudio } from '../src/platform/cloud-speech.js';
import { speakText, stopSpeech } from '../src/platform/runtime.js';
import { readAloud, autoReadReply } from '../src/ui/speech.js';
import { savePreferences, loadPreferences } from '../src/storage/client.js';

const service = provider => normalizeVoiceService({ provider, fallback: false, profiles: { [provider]: { apiKey: 'test-key-never-export', workspace: 'workspace-123' } } });
const json = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
const signal = () => new AbortController().signal;
const store = () => { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }; };

test('voice profiles persist independently, exclude secrets from backup and preserve existing keys on restore', () => {
  globalThis.localStorage = store();
  const saved = service('aliyun'); saved.profiles.minimax.apiKey = 'second-secret'; saved.autoRead = true;
  saved.speechAccent = 'en-GB'; saved.speechRate = 1.25;
  saveVoiceService(saved);
  assert.equal(loadVoiceService().profiles.aliyun.apiKey, 'test-key-never-export');
  const backup = createBackup(), serialized = JSON.stringify(backup);
  assert.ok(!serialized.includes('test-key-never-export')); assert.ok(!serialized.includes('second-secret'));
  const changed = loadVoiceService(); changed.profiles.aliyun.apiKey = 'local-new-secret'; changed.profiles.aliyun.voiceUS = 'David_v3.1'; saveVoiceService(changed);
  restoreBackup(backup, { includeSettings: true });
  assert.equal(loadVoiceService().profiles.aliyun.apiKey, 'local-new-secret');
  assert.equal(loadVoiceService().profiles.aliyun.voiceUS, 'Abby_v3.1');
  assert.equal(loadVoiceService().autoRead, true);
  assert.equal(loadVoiceService().speechAccent, 'en-GB'); assert.equal(loadVoiceService().speechRate, 1.25);
  delete backup.voiceService; const before = JSON.stringify(loadVoiceService());
  restoreBackup(backup, { includeSettings: true }); assert.equal(JSON.stringify(loadVoiceService()), before);
  assert.equal(parseBackup(serialized).voiceService.profiles.minimax.apiKey, '');
  globalThis.localStorage = store(); restoreBackup(JSON.parse(serialized), { includeSettings: true });
  assert.equal(loadVoiceService().provider, 'aliyun'); assert.equal(loadVoiceService().profiles.aliyun.apiKey, '');
});

test('learning reading ignores configured or damaged cloud settings and uses its own system preferences', async () => {
  const previousDocument = globalThis.document; const spoken = [];
  globalThis.document = { getElementById: () => null };
  globalThis.localStorage = store();
  savePreferences({ speechAccent: 'en-GB', speechRate: .65, speechOffline: true });
  saveVoiceService(service('minimax'));
  globalThis.__dreamwhaleNative = {
    stopSpeech() {}, prepareSpeech: async options => ({ id: 'local', lang: options.speechAccent, local: true }),
    speak: async (text, options) => spoken.push({ text, options }), fetch: () => assert.fail('learning must not request cloud TTS'),
  };
  try {
    for (const text of ['apple', 'This is an example.', 'Fill in the ___ now.']) {
      await readAloud(text, null, { service: service('minimax'), onComplete: error => assert.ifError(error) });
    }
    globalThis.localStorage.setItem('dreamwhale:voice-service:v1', '{broken');
    await readAloud('hello', null, { onComplete: error => assert.ifError(error) });
    assert.equal(spoken.length, 4); assert.match(spoken[2].text, /blank/);
    assert.ok(spoken.every(({ options }) => options.speechAccent === 'en-GB' && options.speechRate === .65 && options.speechOffline));
  } finally { stopSpeech(); delete globalThis.__dreamwhaleNative; globalThis.document = previousDocument; }
});

test('chat manual and auto reading use chat voice preferences independently of learning offline mode', async () => {
  const previousDocument = globalThis.document, previousAudio = globalThis.Audio; const requests = [];
  globalThis.document = { hidden: false, body: { classList: { contains: () => true } }, getElementById: () => null };
  globalThis.localStorage = store();
  savePreferences({ speechAccent: 'en-GB', speechRate: .55, speechOffline: true });
  saveVoiceService({ ...service('minimax'), speechRate: 1.2, autoRead: true });
  globalThis.Audio = class { play() { queueMicrotask(() => this.onended?.()); return Promise.resolve(); } pause() {} removeAttribute() {} };
  globalThis.__dreamwhaleNative = { fetch: async (_url, options) => { requests.push(JSON.parse(options.body)); return json({ data: { audio: '494433' } }); } };
  try {
    await readAloud('你好，hello', null, { full: true, scope: 'chat', onComplete: error => assert.ifError(error) });
    assert.deepEqual(requests.map(r => r.text), ['你好，', 'hello']);
    assert.ok(requests.every(r => r.voice_setting.speed === 1.2));
    assert.equal(requests[1].voice_setting.voice_id, 'English_Graceful_Lady');
    await autoReadReply('Another reply. <Question>Exercise word</Question><AnswerKey>hidden</AnswerKey>');
    assert.equal(requests.length, 3); assert.equal(requests[2].text, 'Another reply.');
    await autoReadReply('<Question>Only a question</Question>'); assert.equal(requests.length, 3);
    assert.equal(chatSpeechText('Hello. <Question>unfinished exercise'), 'Hello.');
    globalThis.document.hidden = true; await autoReadReply('Hidden.'); assert.equal(requests.length, 3);
    assert.equal(loadPreferences().speechOffline, true); assert.equal(loadPreferences().speechRate, .55);
    assert.equal(normalizeVoiceService({ speechRate: 10 }).speechRate, .85);
  } finally { stopSpeech(); delete globalThis.__dreamwhaleNative; globalThis.document = previousDocument; globalThis.Audio = previousAudio; }
});

test('mixed language uses matching voices and never includes hidden model metadata or answers', () => {
  const raw = '你好， **hello world**。 <AnswerKey>secret answer</AnswerKey><Question>The ___ is ready.</Question><TurnSummary>private';
  const text = speechText(raw);
  assert.ok(text.includes('你好')); assert.ok(text.includes('hello world')); assert.ok(text.includes('blank'));
  assert.ok(!text.includes('secret')); assert.ok(!text.includes('private'));
  const segments = voiceSegments(raw, 'en-GB');
  assert.deepEqual(segments.map(s => s.language), ['zh-CN', 'en-GB']);
  const requests = segments.map(segment => voiceRequest(service('aliyun'), segment, .65));
  assert.equal(requests[0].body.input.voice, 'yeqinghe_v3.1');
  assert.equal(requests[1].body.input.voice, 'Emily_v3.1');
  assert.equal(requests[1].body.input.rate, .65);
  assert.ok(voiceSegments('这是中文。'.repeat(500)).every(s => s.text.length <= 600));
});

test('MiniMax uses documented JSON parameters and decodes hex audio', async () => {
  let sent;
  const blob = await synthesizeCloudSpeech(service('minimax'), { text: 'hello', language: 'en-US' }, 1.25, {
    signal: signal(), fetchImpl: async (url, options) => { sent = { url, ...options }; return json({ base_resp: { status_code: 0 }, data: { audio: '49443300' } }); },
  });
  assert.equal(sent.url, 'https://api.minimax.cn/v1/t2a_v2');
  const body = JSON.parse(sent.body);
  assert.equal(body.voice_setting.speed, 1.25); assert.equal(body.voice_setting.voice_id, 'English_Graceful_Lady');
  assert.equal(body.stream, false); assert.equal(body.output_format, 'hex');
  assert.equal(sent.headers.Authorization, 'Bearer test-key-never-export');
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [73, 68, 51, 0]);
  assert.throws(() => voiceRequest(service('minimax'), { text: 'hello', language: 'en-GB' }, 1), /英式/);
});

test('Aliyun downloads HTTPS audio without forwarding credentials to the audio host', async () => {
  const requests = [];
  const blob = await synthesizeCloudSpeech(service('aliyun'), { text: 'test', language: 'en-US' }, .85, {
    signal: signal(), fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return requests.length === 1 ? json({ output: { audio: { url: 'http://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/audio.mp3?sig=sample' } } }) : new Response(new Uint8Array([1, 2, 3]));
    },
  });
  assert.match(requests[0].url, /^https:\/\/workspace-123.cn-beijing.maas.aliyuncs.com/);
  assert.match(requests[1].url, /^https:/); assert.equal(requests[1].options.headers, undefined);
  assert.equal(requests[1].options.redirect, 'error'); assert.equal(blob.size, 3);
});

test('invalid credentials, provider errors, malformed audio and foreign audio URLs fail without leaking keys', async () => {
  for (const response of [new Response('', { status: 401 }), json({ base_resp: { status_code: 1004, status_msg: 'test-key-never-export' } }), json({ data: { audio: 'oops' } })]) {
    await assert.rejects(synthesizeCloudSpeech(service('minimax'), { text: 'hi', language: 'en-US' }, 1, { signal: signal(), fetchImpl: async () => response }), error => !error.message.includes('test-key-never-export'));
  }
  for (const url of ['https://evil.example/audio.mp3', 'file:///secret', 'https://evil-aliyuncs.com/a', 'https://user:password@a.aliyuncs.com/audio']) {
    let count = 0;
    await assert.rejects(synthesizeCloudSpeech(service('aliyun'), { text: 'hi', language: 'en-US' }, 1, { signal: signal(), fetchImpl: async () => { count++; return json({ output: { audio: { url } } }); } }), /地址无效/);
    assert.equal(count, 1);
  }
  const bad = service('aliyun'); bad.profiles.aliyun.workspace = 'evil/path';
  await assert.rejects(synthesizeCloudSpeech(bad, { text: 'hi', language: 'en-US' }, 1, { signal: signal(), fetchImpl: () => assert.fail('must not send') }), /业务空间/);
});

test('request abort and timeout settle before any audio playback', async () => {
  const pendingFetch = (_url, options) => new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('abort', 'AbortError'))));
  const controller = new AbortController();
  const pending = synthesizeCloudSpeech(service('minimax'), { text: 'hi', language: 'en-US' }, 1, { signal: controller.signal, fetchImpl: pendingFetch });
  controller.abort(); await assert.rejects(pending, { name: 'AbortError' });
  await assert.rejects(synthesizeCloudSpeech(service('minimax'), { text: 'hi', language: 'en-US' }, 1, { signal: signal(), fetchImpl: pendingFetch, timeoutMs: 10 }), /超时/);
});

test('audio completion, playback rejection and stop release the player and object URL', async () => {
  const previous = globalThis.Audio; const players = [];
  globalThis.Audio = class { constructor() { players.push(this); } play() { return Promise.resolve(); } pause() { this.paused = true; } removeAttribute() { this.released = true; } };
  try {
    const controller = new AbortController(); const pending = playSpeechAudio(new Blob(['audio']), controller.signal);
    controller.abort(); await assert.rejects(pending, { name: 'AbortError' }); assert.equal(players[0].paused, true); assert.equal(players[0].released, true);
    const completed = playSpeechAudio(new Blob(['audio']), signal()); players[1].onended(); await completed;
    globalThis.Audio.prototype.play = () => Promise.reject(new Error('blocked'));
    await assert.rejects(playSpeechAudio(new Blob(['audio']), signal()), /播放未获允许/);
  } finally { globalThis.Audio = previous; }
});

test('strict offline mode never sends a cloud request; failure fallback is optional and English only', async () => {
  const spoken = [], notices = []; let calls = 0;
  globalThis.__dreamwhaleNative = { stopSpeech() {}, prepareSpeech: async () => ({ id: 'system', lang: 'en-US', local: true }), speak: async text => spoken.push(text), fetch: async () => { calls++; return new Response('', { status: 401 }); } };
  try {
    await speakText('Hello', { speechOffline: true }, { service: service('minimax') }); assert.equal(calls, 0); assert.deepEqual(spoken, ['Hello']);
    await assert.rejects(speakText('Hello', {}, { service: service('minimax') }), /鉴权/); assert.equal(calls, 1);
    await speakText('你好，Hello', {}, { service: { ...service('minimax'), fallback: true }, onNotice: text => notices.push(text) });
    assert.equal(calls, 2); assert.equal(spoken.at(-1), 'Hello'); assert.match(notices[0], /系统英文/);
  } finally { stopSpeech(); delete globalThis.__dreamwhaleNative; }
});

test('stopping a cloud request prevents late playback and native TTS is unnecessary for cloud playback', async () => {
  const previous = globalThis.Audio; let played = 0, release;
  globalThis.Audio = class { play() { played++; queueMicrotask(() => this.onended?.()); return Promise.resolve(); } pause() {} removeAttribute() {} };
  globalThis.__dreamwhaleNative = { fetch: () => new Promise(resolve => { release = resolve; }) };
  try {
    const pending = speakText('hello', {}, { service: service('minimax') }); await Promise.resolve();
    stopSpeech(); release(json({ data: { audio: '494433' } })); await pending; assert.equal(played, 0);
    globalThis.__dreamwhaleNative.fetch = async () => json({ data: { audio: '494433' } });
    await speakText('hello', {}, { service: service('minimax') }); assert.equal(played, 1);
  } finally { stopSpeech(); delete globalThis.__dreamwhaleNative; globalThis.Audio = previous; }
});
