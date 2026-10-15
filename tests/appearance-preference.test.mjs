import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFaceStyle, saveFaceStyle } from '../src/storage/save.js';
import { DEFAULT_FACE_STYLE } from '../src/content/emotions.js';

const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
let data;
let unavailable;
test.beforeEach(() => {
  data = new Map();
  unavailable = false;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key) => {
        if (unavailable) throw new Error('storage unavailable');
        return data.get(key) ?? null;
      },
      setItem: (key, value) => {
        if (unavailable) throw new Error('storage unavailable');
        data.set(key, value);
      },
    },
  });
});
test.after(() => {
  if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
  else delete globalThis.localStorage;
});

test('风格单独保存，重新读取生效且不修改档案或聊天', () => {
  const profile = '{"name":"用户"}';
  const chat = '{"messages":[{"text":"<Face>平静</Face>","summary":"原总结"}]}';
  data.set('word-blade:user-profile', profile);
  data.set('word-blade:chat-session', chat);
  assert.equal(saveFaceStyle('portrait'), true);
  assert.equal(data.get('word-blade:face-style'), 'portrait');
  assert.equal(loadFaceStyle(), 'portrait');
  assert.equal(data.get('word-blade:user-profile'), profile);
  assert.equal(data.get('word-blade:chat-session'), chat);
  assert.equal(saveFaceStyle('chibi'), true);
  assert.equal(loadFaceStyle(), 'chibi');
});

test('旧图床与无效值安全回到默认风格，不迁入用户档案', () => {
  for (const legacy of ['remit', 'picui']) {
    data.set('word-blade:face-host', legacy);
    data.delete('word-blade:face-style');
    assert.equal(loadFaceStyle(), DEFAULT_FACE_STYLE);
    data.set('word-blade:face-style', legacy);
    assert.equal(loadFaceStyle(), DEFAULT_FACE_STYLE);
  }
  assert.equal(saveFaceStyle('不存在'), true);
  assert.equal(loadFaceStyle(), DEFAULT_FACE_STYLE);
  assert.equal(data.has('word-blade:user-profile'), false);
});

test('保存失败返回false且保留先前偏好，读取异常使用默认风格', () => {
  assert.equal(saveFaceStyle('portrait'), true);
  unavailable = true;
  assert.equal(saveFaceStyle('chibi'), false);
  assert.equal(data.get('word-blade:face-style'), 'portrait');
  assert.equal(loadFaceStyle(), DEFAULT_FACE_STYLE);
  unavailable = false;
  assert.equal(loadFaceStyle(), 'portrait');
});

test('浏览器完全禁止访问localStorage时可继续使用默认风格', () => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true, get() { throw new Error('denied'); },
  });
  assert.equal(loadFaceStyle(), DEFAULT_FACE_STYLE);
  assert.equal(saveFaceStyle('portrait'), false);
});
