import test from 'node:test';
import assert from 'node:assert/strict';
import { sceneAt, forkConversation, filterSessions, normalizePreferences, modelEntry } from '../src/engine/client.js';
import { createSession, appendMessage } from '../src/engine/chat.js';
import { saveChatSession, loadChatSession, loadSessionList, importChatSessions } from '../src/storage/save.js';
import { createBackup, parseBackup, restoreBackup } from '../src/storage/backup.js';
import { saveModels, loadModels, saveDraft, loadDraft } from '../src/storage/client.js';
import { streamCompletion } from '../src/gateway/stream.js';

function storage(){const data=new Map();let fail=()=>false;const api={getItem:key=>data.get(key)??null,setItem(key,value){if(fail(key))throw new Error('quota');data.set(key,String(value));},removeItem:key=>data.delete(key),key:i=>[...data.keys()][i],get length(){return data.size;}};globalThis.localStorage=api;return {data,api,fail:fn=>{fail=fn;}};}
function conversation(){let s=createSession({profile:{name:'测试',gender:'女'}});s=appendMessage(s,{role:'user',text:'第一句'});s=appendMessage(s,{role:'assistant',text:'回复一'});s=appendMessage(s,{role:'user',text:'第二句'});return appendMessage(s,{role:'assistant',text:'回复二'});}
test('local time boundaries and manual scenes',()=>{
  for(const [hour,minute,expected] of [[4,59,'night'],[5,0,'dawn'],[8,59,'dawn'],[9,0,'day'],[16,59,'day'],[17,0,'dusk'],[19,59,'dusk'],[20,0,'night'],[0,0,'night']])assert.equal(sceneAt(new Date(2026,9,16,hour,minute)),expected);
  assert.equal(sceneAt(new Date(2026,9,16,10),'dusk'),'dusk');assert.equal(normalizePreferences(null).scene,'auto');
});
test('editing and regeneration preserve original branches and remap message parents',()=>{
  const original=conversation();const before=JSON.stringify(original);
  const edited=forkConversation(original,original.messages[0].id,{editText:'改后的问题'});
  assert.equal(edited.messages.length,1);assert.equal(edited.messages[0].text,'改后的问题');assert.equal(edited.branchOf,original.id);
  const regenerated=forkConversation(original,original.messages[3].id,{regenerate:true});assert.equal(regenerated.messages.length,3);assert.equal(regenerated.messages[1].parentId,regenerated.messages[0].id);
  assert.notEqual(regenerated.messages[0].id,original.messages[0].id);assert.equal(JSON.stringify(original),before);
  assert.throws(()=>forkConversation(original,'missing',{regenerate:true}));
});
test('session search respects archive and trash with pinned ordering',()=>{
  const rows=[{id:'a',title:'猫',updatedAt:5},{id:'b',title:'英语',searchText:'猫',pinned:true,updatedAt:1},{id:'c',title:'猫',archived:true,updatedAt:8},{id:'d',title:'猫',deletedAt:10}];
  assert.deepEqual(filterSessions(rows,{query:'猫'}).map(s=>s.id),['b','a']);assert.deepEqual(filterSessions(rows,{filter:'trash'}).map(s=>s.id),['d']);assert.deepEqual(filterSessions(rows,{filter:'archived'}).map(s=>s.id),['c']);
});
test('plain branches include the selected message, keep the original and survive saving',()=>{
  storage();const original=conversation();original.modelId='model-one';
  original.assistantConfig={mode:'speaking',instructions:'练习口语',memory:'学校'};
  original.messages[1].questionId='q-one';
  original.questionContext={sourceMessageId:original.messages[1].id,questionId:'q-one'};
  assert.equal(saveChatSession(original).ok,true);saveDraft(original.id,'原对话未发送草稿');
  const before=JSON.stringify(loadChatSession(original.id));
  for(const at of [0,1,3]) {
    const next=forkConversation(original,original.messages[at].id);
    assert.equal(next.messages.length,at+1);assert.equal(next.messages.at(-1).text,original.messages[at].text);
    assert.equal(next.modelId,'model-one');assert.equal(next.assistantConfig.mode,'speaking');
    assert.equal(next.branchOf,original.id);assert.notEqual(next.id,original.id);
    for(let i=0;i<next.messages.length;i++) {assert.notEqual(next.messages[i].id,original.messages[i].id);assert.equal(next.messages[i].parentId,i?next.messages[i-1].id:null);}
    if(at>0)assert.equal(next.questionContext.sourceMessageId,next.messages[1].id);else assert.equal(next.questionContext,null);
    assert.equal(saveChatSession(next).ok,true);
    const loaded=loadChatSession(next.id);assert.equal(loaded.branchOf,original.id);assert.equal(loaded.messages.length,at+1);
    assert.equal(loadDraft(next.id),'');
  }
  assert.equal(JSON.stringify(loadChatSession(original.id)),before);assert.equal(loadDraft(original.id),'原对话未发送草稿');
});
test('a branch storage failure does not publish a new conversation or change the original',()=>{
  const s=storage();const original=conversation();assert.equal(saveChatSession(original).ok,true);
  const next=forkConversation(original,original.messages[1].id);const before=JSON.stringify(loadSessionList());
  s.fail(key=>key==='word-blade:chat-index');assert.equal(saveChatSession(next).ok,false);
  assert.equal(JSON.stringify(loadSessionList()),before);assert.equal(loadChatSession(original.id).messages.length,4);
});
test('model profiles and drafts remain independent and survive reload',()=>{
  storage();const first=modelEntry({id:'a',name:'A',profile:{apiKey:'secret',model:'test'}});saveModels({entries:[first,modelEntry({id:'b'})],activeId:'a'});assert.equal(loadModels().entries[0].profile.apiKey,'secret');
  saveDraft('a','草稿');saveDraft('b','另一段');assert.equal(loadDraft('a'),'草稿');saveDraft('a','');assert.equal(loadDraft('a'),'');assert.equal(loadDraft('b'),'另一段');
});

test('protocol and authentication options survive save and backup without exporting credentials',()=>{
  storage();const profile={endpoint:'https://example.com/v1',model:'same-model',apiKey:'private-token',apiFormat:'responses',authMode:'api-key',sendTemperature:false,streamUsage:false,jsonMode:'off',tokenField:'max_completion_tokens'};
  saveModels({entries:[modelEntry({id:'a',profile})],activeId:'a'});
  const loaded=loadModels().entries[0].profile;for(const [key,value] of Object.entries(profile))assert.equal(loaded[key],value);
  const s=conversation();s.modelId='a';saveChatSession(s);const backup=createBackup();assert.ok(!JSON.stringify(backup).includes('private-token'));
  storage();saveModels({entries:[modelEntry({id:'a',profile:{...profile,apiFormat:'chat',apiKey:'keep-key'}})],activeId:'a'});
  restoreBackup(backup,{includeSettings:true});const restored=loadChatSession(s.id);assert.notEqual(restored.modelId,'a');
  const imported=loadModels().entries.find(e=>e.id===restored.modelId).profile;assert.equal(imported.apiFormat,'responses');assert.equal(imported.authMode,'api-key');assert.equal(imported.sendTemperature,false);assert.equal(imported.apiKey,'');assert.equal(loadModels().entries.find(e=>e.id==='a').profile.apiKey,'keep-key');
});
test('backup excludes keys, rejects malformed files and merges idempotently',()=>{
  storage();const original=conversation();assert.equal(saveChatSession(original).ok,true);saveModels({entries:[modelEntry({id:'a',profile:{apiKey:'secret-123'}})],activeId:'a'});
  const backup=createBackup();assert.ok(!JSON.stringify(backup).includes('secret-123'));assert.equal(parseBackup(JSON.stringify(backup)).chats.length,1);
  const bad=structuredClone(backup);bad.chats[0].messages[1].id=bad.chats[0].messages[0].id;assert.throws(()=>parseBackup(JSON.stringify(bad)));
  const changed=loadChatSession(original.id);changed.title='本地修改';saveChatSession(changed);
  assert.equal(restoreBackup(backup).chats,1);assert.equal(loadSessionList().sessions.length,2);assert.equal(restoreBackup(backup).chats,0);assert.equal(loadChatSession(original.id).title,'本地修改');
});
test('failed import index commit rolls back learning and staged chats',()=>{
  const s=storage();saveChatSession(conversation());s.api.setItem('dreamwhale:learning:v1','old');const index=s.api.getItem('word-blade:chat-index');
  s.fail(key=>key==='word-blade:chat-index');
  assert.throws(()=>importChatSessions([conversation()],[{key:'dreamwhale:learning:v1',expected:'old',value:'new'}]));
  assert.equal(s.api.getItem('dreamwhale:learning:v1'),'old');assert.equal(s.api.getItem('word-blade:chat-index'),index);assert.equal(loadSessionList().sessions.length,1);
});
test('imported conversations resolve models by endpoint and model instead of colliding IDs',()=>{
  storage();const s=conversation();s.modelId='legacy-model';saveChatSession(s);
  saveModels({activeId:'legacy-model',entries:[modelEntry({id:'legacy-model',profile:{endpoint:'http://localhost:8001/v1',model:'old',apiKey:'source-key'}})]});
  const backup=createBackup();storage();saveModels({activeId:'legacy-model',entries:[modelEntry({id:'legacy-model',profile:{endpoint:'http://localhost:8002/v1',model:'local',apiKey:'keep-key'}})]});
  restoreBackup(backup,{includeSettings:true});const restored=loadChatSession(s.id);assert.notEqual(restored.modelId,'legacy-model');const entries=loadModels().entries;assert.equal(entries.find(e=>e.id===restored.modelId).profile.apiKey,'');assert.equal(entries.find(e=>e.id==='legacy-model').profile.apiKey,'keep-key');
});
test('staging quota and stale learning snapshot never publish imported chats',()=>{
  const s=storage();saveChatSession(conversation());const index=s.api.getItem('word-blade:chat-index');s.fail(key=>key.startsWith('word-blade:chat-msg:'));
  assert.throws(()=>importChatSessions([conversation()]));assert.equal(s.api.getItem('word-blade:chat-index'),index);
  s.fail(()=>false);s.api.setItem('dreamwhale:learning:v1','newer');assert.throws(()=>importChatSessions([conversation()],[{key:'dreamwhale:learning:v1',expected:'old',value:'new'}]));assert.equal(s.api.getItem('dreamwhale:learning:v1'),'newer');assert.equal(s.api.getItem('word-blade:chat-index'),index);
});
const options={endpoint:'http://localhost/v1/chat/completions',apiKey:'',body:{model:'test'},timeoutMs:1000};
function streamed(text){const bytes=new TextEncoder().encode(text);return async()=>new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=7)c.enqueue(bytes.slice(i,i+7));c.close();}}),{headers:{'content-type':'text/event-stream'}});}
test('SSE handles split UTF-8, CRLF, usage and final marker',async()=>{
  const deltas=[];const result=await streamCompletion({...options,onDelta:t=>deltas.push(t),fetchImpl:streamed('data: {"choices":[{"delta":{"content":"清晨"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":"你好"},"finish_reason":"stop"}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":4,"total_tokens":14}}\n\ndata: [DONE]\n\n')});
  assert.equal(result.text,'清晨你好');assert.equal(result.usage.total,14);assert.deepEqual(deltas,['清晨','清晨你好']);
});
test('truncated SSE and output length are recoverable failures',async()=>{
  await assert.rejects(()=>streamCompletion({...options,fetchImpl:streamed('data: {"choices":[{"delta":{"content":"半句"}}]}\n\n')}),e=>e.kind==='network');
  await assert.rejects(()=>streamCompletion({...options,fetchImpl:streamed('data: {"choices":[{"delta":{"content":"半句"},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n')}),e=>e.kind==='length');
});
test('stop and timeout settle even when endpoint ignores abort',async()=>{
  const controller=new AbortController();const pending=streamCompletion({...options,signal:controller.signal,fetchImpl:()=>new Promise(()=>{})});controller.abort();await assert.rejects(pending,e=>e.kind==='cancelled');
  await assert.rejects(()=>streamCompletion({...options,timeoutMs:10,fetchImpl:()=>new Promise(()=>{})}),e=>e.kind==='timeout');
});
