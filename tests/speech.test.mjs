import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSpeechOptions, englishText, splitSpeechText, selectSpeechVoice, speechVoiceStatus } from '../src/engine/speech.js';
import { loadPreferences, savePreferences } from '../src/storage/client.js';
import { createBackup, parseBackup, restoreBackup } from '../src/storage/backup.js';
import { speakText, stopSpeech } from '../src/platform/runtime.js';
import { migrateAndroidSpeechPreferences } from '../src/platform/android-speech.js';

const voices = [
  { id:'us-online', lang:'en-US', local:false, default:true },
  { id:'us-local', lang:'en-US', local:true },
  { id:'uk-local', lang:'en-GB', local:true },
];
test('accent is exact, offline mode never selects network voices, invalid preferences recover defaults', () => {
  assert.equal(selectSpeechVoice(voices, {}).id, 'us-local');
  assert.equal(selectSpeechVoice(voices, {speechAccent:'en-GB'}).id, 'uk-local');
  assert.equal(selectSpeechVoice([voices[0]], {speechOffline:true}), null);
  assert.equal(selectSpeechVoice([voices[0]], {}).id, 'us-online');
  assert.equal(selectSpeechVoice([voices[0]], {speechOffline:false}).id, 'us-online');
  assert.equal(selectSpeechVoice([voices[1]], {speechAccent:'en-GB'}), null);
  assert.equal(normalizeSpeechOptions({speechRate:99}).speechRate, .85);
  assert.equal(normalizeSpeechOptions({speechRate:'0.5'}).speechRate, .5);
  assert.equal(selectSpeechVoice([{id:'variant',lang:'en-US-x-tpf',local:true}], {}).id, 'variant');
  assert.match(speechVoiceStatus({name:'System',lang:'en',local:null}, {}), /联网情况由系统决定.*未匹配美式/);
});
test('English extraction preserves pronunciation, keeps blanks and chunks long passages without loss', () => {
  assert.equal(englishText('简历：résumé'), 'résumé');
  assert.ok(englishText('填空：The ___ is ready.').includes('blank'));
  assert.equal(englishText('只有中文。'), '');
  const text = 'This is a longer sentence. '.repeat(100).trim();
  const chunks = splitSpeechText(text);
  assert.ok(chunks.length > 1); assert.ok(chunks.every(s => s.length <= 220));
  assert.equal(chunks.join(' '), text);
});
test('speech preferences persist, restore from backup and old backups receive safe defaults', () => {
  const values = new Map(); globalThis.localStorage = { getItem:k=>values.get(k)??null, setItem:(k,v)=>values.set(k,v), removeItem:k=>values.delete(k) };
  savePreferences({speechAccent:'en-GB',speechRate:1.25,speechOffline:false});
  assert.equal(loadPreferences().speechRate, 1.25);
  const backup = createBackup(); savePreferences({}); restoreBackup(backup,{includeSettings:true});
  assert.equal(loadPreferences().speechAccent,'en-GB'); assert.equal(loadPreferences().speechOffline,false);
  delete backup.preferences.speechAccent; delete backup.preferences.speechRate; delete backup.preferences.speechOffline;
  assert.equal(parseBackup(JSON.stringify(backup)).preferences.speechOffline,false);
  savePreferences({speechOffline:true});
  assert.equal(parseBackup(JSON.stringify(createBackup())).preferences.speechOffline,true);
});
test('stopping or superseding asynchronous voice discovery prevents stale playback', async () => {
  let release; const played = [];
  globalThis.__dreamwhaleNative = { stopSpeech:()=>{}, speechVoices:()=>new Promise(resolve=>{release=resolve;}), speak:async text=>played.push(text) };
  try {
    const pending = speakText('old'); await Promise.resolve(); stopSpeech(); release(voices); await pending; assert.deepEqual(played,[]);
    globalThis.__dreamwhaleNative.speechVoices = async()=>voices;
    await speakText('new',{speechAccent:'en-GB',speechRate:1.2}); assert.deepEqual(played,['new']);
    globalThis.__dreamwhaleNative.speechVoices = async()=>[voices[0]];
    await assert.rejects(speakText('offline',{speechOffline:true}), /离线/);
  } finally { delete globalThis.__dreamwhaleNative; }
});

test('Android upgrade restores automatic selection once and preserves later offline choices and other preferences', () => {
  const key = 'dreamwhale:client-preferences:v1';
  const values = new Map([[key, JSON.stringify({speechOffline:true,speechAccent:'en-GB',speechRate:1.15,theme:'dark'})], ['study','unchanged']]);
  const storage = { getItem:k=>values.get(k)??null, setItem:(k,v)=>values.set(k,v) };
  migrateAndroidSpeechPreferences(storage);
  assert.deepEqual(JSON.parse(values.get(key)), {speechOffline:false,speechAccent:'en-GB',speechRate:1.15,theme:'dark',speechPolicyVersion:1});
  savePreferences({...loadPreferences(storage),speechOffline:true},storage);
  const saved = values.get(key); migrateAndroidSpeechPreferences(storage); assert.equal(values.get(key), saved);
  assert.equal(values.get('study'),'unchanged');
  values.set(key,'broken'); migrateAndroidSpeechPreferences(storage); assert.equal(values.get(key),'broken');
});

test('Android uses native system selection without requiring a voice list and cancellation still prevents late speech', async () => {
  let release; const played = []; const optionsSeen = [];
  globalThis.__dreamwhaleNative = {
    stopSpeech:()=>{}, speechVoices:()=>{throw new Error('must not enumerate');},
    prepareSpeech:async options=>{ optionsSeen.push(options); return {id:'',name:'System English',lang:'en',local:null}; },
    speak:async (text,options)=>played.push({text,options}),
  };
  try {
    let actualVoice;
    await speakText('Hello',{speechAccent:'en-GB',speechRate:1.2},{onVoice:voice=>{actualVoice=voice;}});
    assert.equal(played.length,1); assert.equal(played[0].options.speechOffline,false); assert.equal(played[0].options.speechRate,1.2);
    assert.equal(actualVoice.lang,'en');
    globalThis.__dreamwhaleNative.prepareSpeech = options => { assert.equal(options.speechOffline,true); throw new Error('没有离线声音'); };
    await assert.rejects(speakText('strict',{speechOffline:true}),/离线/); assert.equal(played.length,1);
    globalThis.__dreamwhaleNative.prepareSpeech = ()=>new Promise(resolve=>{release=resolve;});
    const pending = speakText('late'); await Promise.resolve(); stopSpeech(); release({id:'',lang:'en'}); await pending;
    assert.equal(played.length,1);
  } finally { delete globalThis.__dreamwhaleNative; }
});
