import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, appendMessage, deleteMessage } from '../src/engine/chat.js';
import {
  saveChatSession, loadChatSession, loadSessionList, setCurrentSession,
  deleteChatSession, clearChatSession, chatStorageSize, sweepOrphanMessages,
  CHAT_STORE_VERSION,
} from '../src/storage/save.js';

const INDEX = 'word-blade:chat-index';
const LEGACY = 'word-blade:chat-session';
const SESSION = 'word-blade:chat-sess:';
const MESSAGE = 'word-blade:chat-msg:';

function storage() {
  const data = new Map();
  let fail = null;
  let writes = 0;
  const api = {
    getItem: (key) => data.get(key) ?? null,
    setItem(key, value) {
      writes += 1;
      if (fail?.(key)) throw Object.assign(new Error('quota exceeded'), { name: 'QuotaExceededError' });
      data.set(key, String(value));
    },
    removeItem: (key) => data.delete(key),
    key: (index) => [...data.keys()][index] ?? null,
    get length() { return data.size; },
  };
  globalThis.localStorage = api;
  return { data, failOn: (predicate) => { fail = predicate; }, writes: () => writes, resetWrites: () => { writes = 0; } };
}

function conversation() {
  let session = createSession({ title: '已保存的对话' });
  session = appendMessage(session, { role: 'user', text: '问题一' });
  return appendMessage(session, { role: 'assistant', text: '答复一' });
}

function seedV2(store, session, extra = []) {
  const { messages, ...meta } = session;
  for (const message of messages) store.data.set(MESSAGE + message.id, JSON.stringify(message));
  store.data.set(SESSION + session.id, JSON.stringify({ ...meta, messageIds: messages.map((message) => message.id) }));
  store.data.set(INDEX, JSON.stringify({ version: 2, revision: 4, currentId: session.id, sessions: [{ id: session.id, title: session.title, messageCount: messages.length }, ...extra] }));
}

for (const stage of ['message', 'session', 'index']) {
  test(`failed ${stage} write preserves the committed session and cleans staged data`, () => {
    const store = storage();
    const original = conversation();
    assert.equal(saveChatSession(original).ok, true);
    const before = new Map(store.data);
    let edited = deleteMessage(original, original.messages[0].id);
    edited = appendMessage(edited, { role: 'user', text: '尚未保存的问题' });
    edited = { ...edited, title: '尚未保存的标题' };
    const prefix = stage === 'message' ? MESSAGE : stage === 'session' ? SESSION : INDEX;
    store.failOn((key) => key.startsWith(prefix));
    assert.deepEqual(saveChatSession(edited), { ok: false, full: true, error: 'quota' });
    assert.deepEqual(store.data, before);
    assert.equal(loadChatSession().title, original.title);
    assert.deepEqual(loadChatSession().messages.map((message) => message.text), ['问题一', '答复一']);
    store.failOn(null);
    assert.equal(saveChatSession(edited).ok, true);
    assert.equal(loadChatSession().title, edited.title);
  });
}

test('list refresh and another session load cannot authorize an obsolete snapshot', () => {
  storage();
  const original = conversation();
  saveChatSession(original);
  const stale = loadChatSession();
  const current = appendMessage(loadChatSession(), { role: 'user', text: '别的标签页提交' });
  saveChatSession(current);
  loadSessionList();
  loadChatSession();
  const rejected = saveChatSession(appendMessage(stale, { role: 'user', text: '陈旧内容' }));
  assert.equal(rejected.conflict, true);
  assert.equal(loadChatSession().messages.at(-1).text, '别的标签页提交');
});

test('selection and unrelated session writes do not invalidate a current snapshot', () => {
  storage();
  const first = conversation();
  saveChatSession(first);
  const snapshot = loadChatSession();
  const second = appendMessage(createSession(), { role: 'user', text: '另一段对话' });
  saveChatSession(second);
  assert.equal(setCurrentSession(first.id), true);
  assert.equal(saveChatSession(appendMessage(snapshot, { role: 'user', text: '继续第一段' })).ok, true);
  assert.equal(loadChatSession(second.id).messages[0].text, '另一段对话');
});

test('saving an immutable descendant does not refresh the ancestor snapshot', () => {
  storage();
  const original = conversation();
  saveChatSession(original);
  const child = appendMessage(original, { role: 'user', text: '新版本' });
  assert.equal(saveChatSession(child).ok, true);
  assert.equal(saveChatSession(original).conflict, true);
  assert.equal(saveChatSession(child).ok, true);
  assert.equal(saveChatSession(JSON.parse(JSON.stringify(child))).conflict, true);
});

test('a deleted snapshot cannot resurrect its old conversation', () => {
  storage();
  const original = conversation();
  saveChatSession(original);
  assert.equal(deleteChatSession(original.id), true);
  assert.equal(saveChatSession(original).conflict, true);
  assert.equal(loadSessionList().sessions.length, 0);
});

test('updating a message with the same id persists it without mutating another snapshot', () => {
  const store = storage();
  const original = conversation();
  saveChatSession(original);
  const stale = loadChatSession();
  const updated = { ...original, messages: original.messages.map((message, index) => index === 0 ? { ...message, text: '已修正的问题', promptInjection: '<Question>冻结题干</Question>' } : message) };
  store.failOn((key) => key === INDEX);
  assert.equal(saveChatSession(updated).ok, false);
  assert.equal(loadChatSession().messages[0].text, '问题一');
  store.failOn(null);
  assert.equal(saveChatSession(updated).ok, true);
  assert.equal(loadChatSession().messages[0].text, '已修正的问题');
  assert.equal(loadChatSession().messages[0].promptInjection, '<Question>冻结题干</Question>');
  assert.equal(saveChatSession(stale).conflict, true);
  assert.equal([...store.data.keys()].filter((key) => key.startsWith(MESSAGE)).length, 2);
});

test('append uses three writes regardless of history length', () => {
  const store = storage();
  let session = conversation();
  for (let i = 0; i < 60; i += 1) session = appendMessage(session, { role: 'user', text: `消息 ${i}` });
  saveChatSession(session);
  store.resetWrites();
  const next = appendMessage(session, { role: 'assistant', text: '新增回复' });
  assert.equal(saveChatSession(next).ok, true);
  assert.equal(store.writes(), 3);
  assert.equal([...store.data.keys()].filter((key) => key.startsWith(SESSION)).length, 1);
});

test('failed session deletion leaves all messages and the current id readable', () => {
  const store = storage();
  const session = conversation();
  saveChatSession(session);
  const before = new Map(store.data);
  store.failOn((key) => key === INDEX);
  assert.equal(deleteChatSession(session.id), false);
  assert.deepEqual(store.data, before);
  assert.equal(loadChatSession().id, session.id);
  assert.equal(setCurrentSession('missing'), false);
});

for (const version of [0, 1]) {
  for (const fail of [false, true]) {
    test(`legacy v${version} ${fail ? 'remains readable when migration runs out of quota' : 'migrates without losing messages'}`, () => {
      const store = storage();
      const original = conversation();
      if (version === 0) store.data.set(LEGACY, JSON.stringify(original));
      else {
        const { messages, ...meta } = original;
        for (const message of messages) store.data.set(MESSAGE + message.id, JSON.stringify(message));
        store.data.set(INDEX, JSON.stringify({ version: 1, revision: 2, meta, messageIds: messages.map((message) => message.id) }));
      }
      const before = new Map(store.data);
      if (fail) store.failOn((key) => key === INDEX);
      const loaded = loadChatSession();
      assert.equal(loaded.id, original.id);
      assert.deepEqual(loaded.messages.map((message) => message.text), ['问题一', '答复一']);
      assert.equal(loadSessionList().sessions[0].id, original.id);
      if (fail) {
        assert.deepEqual(store.data, before);
        store.failOn(null);
        assert.equal(saveChatSession(appendMessage(loaded, { role: 'user', text: '迁移后继续' })).ok, true);
      }
      assert.equal(JSON.parse(store.data.get(INDEX)).version, CHAT_STORE_VERSION);
      assert.equal(store.data.has(LEGACY), false);
      assert.equal([...store.data.keys()].filter((key) => key.startsWith(SESSION)).length, 1);
    });
  }
}

test('v2 upgrades only after a successful save', () => {
  const store = storage();
  const original = conversation();
  seedV2(store, original);
  const before = new Map(store.data);
  const loaded = loadChatSession();
  assert.deepEqual(store.data, before);
  const next = appendMessage(loaded, { role: 'user', text: '新格式消息' });
  store.failOn((key) => key === INDEX);
  assert.equal(saveChatSession(next).ok, false);
  assert.deepEqual(store.data, before);
  store.failOn(null);
  assert.equal(saveChatSession(next).ok, true);
  assert.equal(JSON.parse(store.data.get(INDEX)).version, CHAT_STORE_VERSION);
  assert.equal(loadChatSession().messages.length, 3);
  assert.equal(store.data.has(SESSION + original.id), false);
});

test('legacy shared message references survive deletion of one session', () => {
  const store = storage();
  const first = conversation();
  const second = { ...conversation(), messages: first.messages };
  seedV2(store, first, [{ id: second.id, title: second.title, messageCount: 2 }]);
  const { messages, ...meta } = second;
  store.data.set(SESSION + second.id, JSON.stringify({ ...meta, messageIds: messages.map((message) => message.id) }));
  assert.equal(deleteChatSession(first.id), true);
  assert.equal(loadChatSession(second.id).messages.length, 2);
  assert.equal([...store.data.keys()].filter((key) => key.startsWith(MESSAGE)).length, 2);
});

test('a missing message fails closed instead of returning a truncated writable history', () => {
  const store = storage();
  const original = conversation();
  seedV2(store, original);
  store.data.delete(MESSAGE + original.messages[0].id);
  assert.equal(loadChatSession(), null);
  const unrelated = conversation();
  assert.equal(saveChatSession(unrelated).ok, true);
  assert.equal(store.data.has(MESSAGE + original.messages[1].id), true);
});

test('unsupported index data cannot be silently overwritten', () => {
  const store = storage();
  store.data.set(INDEX, JSON.stringify({ version: 99, sessions: [] }));
  const before = new Map(store.data);
  assert.equal(saveChatSession(conversation()).ok, false);
  assert.deepEqual(store.data, before);
});

test('storage size includes message bodies and sweeping preserves recent staging keys', () => {
  const store = storage();
  const session = conversation();
  saveChatSession(session);
  assert.equal(chatStorageSize(), [...store.data.values()].reduce((sum, value) => sum + value.length, 0));
  store.data.set(MESSAGE + 'old-orphan', '{}');
  const recent = MESSAGE + `pending:t_${Date.now().toString(36)}_test`;
  store.data.set(recent, '{}');
  assert.equal(sweepOrphanMessages(), 1);
  assert.equal(store.data.has(recent), true);
  assert.equal(loadChatSession().messages.length, 2);
  assert.equal(clearChatSession(), true);
  assert.equal(store.data.size, 0);
});
