import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, appendMessage } from '../src/engine/chat.js';
import { generateChatTurn, retainBodiesAfterSaveFailure } from '../src/app/chat-turn.js';
import { recordRequest } from '../src/app/request-record.js';
import { saveChatSession, loadChatSession } from '../src/storage/save.js';

const SUMMARY = '用户询问词汇的意思，我解释常见用法并请用户继续练习。';
const REPLY = `“我们继续练习。”\n<TurnSummary>${SUMMARY}</TurnSummary>`;

function memoryStorage() {
  const data = new Map();
  let rejectIndex = false;
  globalThis.localStorage = {
    getItem: key => data.get(key) ?? null,
    setItem(key, value) {
      if (rejectIndex && key === 'word-blade:chat-index') throw Object.assign(new Error('full'), { name: 'QuotaExceededError' });
      data.set(key, String(value));
    },
    removeItem: key => data.delete(key),
    key: index => [...data.keys()][index] ?? null,
    get length() { return data.size; },
  };
  return { data, reject: value => { rejectIndex = value; } };
}

function pendingSession() {
  let session = createSession({ debugSummaries: true, limits: { historyLimit: 2 } });
  session = appendMessage(session, { role: 'user', text: '原始用户正文不能提前删除' });
  session = appendMessage(session, { role: 'assistant', text: REPLY });
  return appendMessage(session, { role: 'user', text: '继续练习' });
}

test('总结与裁剪正文原子保存，刷新后只剩总结且保留调试选项', async () => {
  const store = memoryStorage();
  const session = pendingSession();
  assert.equal(saveChatSession(session).ok, true);
  const next = await generateChatTurn(session, 'system', { model: 'mock' }, { request: async () => ({ text: REPLY, usage: null }) });
  assert.equal(session.messages[0].text, '原始用户正文不能提前删除');
  assert.equal(next.messages[0].text, '');
  assert.equal(saveChatSession(next).ok, true);
  const restored = loadChatSession();
  assert.equal(restored.debugSummaries, true);
  assert.equal(restored.messages[0].compacted, true);
  assert.equal(restored.messages[1].summary, SUMMARY);
  assert.equal(restored.messages[1].text, '');
  assert.ok(![...store.data.values()].some(value => value.includes('原始用户正文不能提前删除')));
});

test('保存裁剪失败时存档不变，内存恢复旧正文并保留新回复', async () => {
  const store = memoryStorage();
  const session = pendingSession();
  assert.equal(saveChatSession(session).ok, true);
  const before = new Map(store.data);
  const next = await generateChatTurn(session, 'system', { model: 'mock' }, { request: async () => ({ text: REPLY, usage: null }) });
  store.reject(true);
  assert.equal(saveChatSession(next).ok, false);
  assert.deepEqual(store.data, before);
  const recovered = retainBodiesAfterSaveFailure(session, next);
  assert.equal(recovered.messages[0].text, '原始用户正文不能提前删除');
  assert.equal(recovered.messages.at(-1).summary, SUMMARY);
  assert.equal(recovered.messages.at(-1).text, '“我们继续练习。”');
  store.reject(false);
  assert.equal(saveChatSession(recovered).ok, true);
  assert.equal(loadChatSession().messages.length, 4);
});

test('模型失败不提交正文裁剪，已返回的用量仍可独立记录', async () => {
  memoryStorage();
  const session = pendingSession();
  saveChatSession(session);
  const failure = Object.assign(new Error('模型截断'), { kind: 'length', usage: { prompt: 100, completion: 20, cached: 50 } });
  let caught;
  try {
    await generateChatTurn(session, 'system', { model: 'mock', apiKey: 'never-record-this' }, { request: async () => { throw failure; } });
  } catch (error) { caught = error; }
  assert.equal(caught, failure);
  const next = recordRequest(session, caught.requestRecord);
  assert.equal(next.messages[0].text, '原始用户正文不能提前删除');
  assert.equal(next.requestLog.at(-1).usage.total, 120);
  assert.ok(!JSON.stringify(next.requestLog).includes('never-record-this'));
  assert.equal(saveChatSession(next).ok, true);
  assert.equal(loadChatSession().requestLog.at(-1).status, 'failed');
});

test('请求编译使用提示词分段版本并传递稳定会话上下文', async () => {
  const session = pendingSession();
  const prompt = { version: 'summary-v2', segments: [{ id: 'rules', content: '固定规则', stability: 'static' }] };
  const next = await generateChatTurn(session, prompt, { model: 'mock' }, { request: async (_, request) => {
    assert.deepEqual(request.requestContext, { sessionId: session.id, promptVersion: 'summary-v2' });
    assert.equal(request.messages[0].content, '固定规则');
    assert.ok(request.messages.some(message => message.content.includes('<TurnSummary>')));
    assert.ok(!request.messages.some(message => message.content.includes('原始用户正文不能提前删除')));
    return { text: REPLY, usage: { prompt: 100, completion: 20, cached: 50 } };
  } });
  assert.equal(next.lastRequest.promptVersion, 'summary-v2');
  assert.equal(next.requestLog.at(-1).compactedTurns, 1);
});
