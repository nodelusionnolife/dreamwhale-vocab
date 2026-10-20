import test from 'node:test';
import assert from 'node:assert/strict';
import { createDurableStore, parseSnapshot } from '../src/platform/durable-store.js';
import { createAndroidFetch } from '../src/platform/native-fetch.js';

test('原生存档在持久写入完成前保持待保存，合并同一操作的多键写入', async () => {
  let finish; const writes = []; const states = [];
  const store = createDurableStore(null, text => { writes.push(JSON.parse(text)); return new Promise(resolve => { finish = resolve; }); }, s => states.push(s.state));
  store.setItem('dreamwhale:a', '1'); store.setItem('word-blade:b', '2');
  const saving = store.flush();
  assert.equal(store.dirty, true); assert.equal(states.at(-1), 'saving'); assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].data, { 'dreamwhale:a': '1', 'word-blade:b': '2' });
  finish(); await saving;
  assert.equal(store.dirty, false); assert.equal(states.at(-1), 'saved');
  const restored = createDurableStore(JSON.stringify(writes[0]), async () => {});
  assert.equal(restored.getItem('word-blade:b'), '2');
});

test('写入中出现的新状态顺序落盘，失败保留内存且可以重试', async () => {
  let release; let failed = true; const saved = [];
  const store = createDurableStore(null, async text => {
    if (failed) throw new Error('disk-full');
    saved.push(text); if (saved.length === 1) await new Promise(resolve => { release = resolve; });
  });
  store.setItem('dreamwhale:a', 'first');
  await assert.rejects(store.flush(), /disk-full/);
  assert.equal(store.dirty, true); assert.equal(store.getItem('dreamwhale:a'), 'first');
  failed = false;
  const saving = store.flush();
  store.setItem('dreamwhale:a', 'second'); release(); await saving;
  assert.equal(saved.length, 2); assert.equal(JSON.parse(saved[1]).data['dreamwhale:a'], 'second');
  assert.equal(store.dirty, false);
});

test('坏存档或其他应用记录拒绝加载，不以空记录覆盖', () => {
  for (const text of ['broken', '{"version":99,"revision":1,"data":{}}', '{"version":1,"revision":1,"data":{"other":"secret"}}']) {
    assert.throws(() => parseSnapshot(text));
  }
  assert.deepEqual(parseSnapshot(null).data, {});
});

function bridgeFixture() {
  let listener; const cancelled = []; const started = [];
  return {
    bridge: { async addListener(_, callback) { listener = callback; }, async startHttp(request) { started.push(request); }, async cancelHttp({ id }) { cancelled.push(id); } },
    event(type, data = {}) { listener({ id: started.at(-1).id, type, ...data }); }, started, cancelled,
  };
}

test('安卓原生请求在完成前逐片提供 UTF-8 数据，HTTP 错误保留状态码', async () => {
  const fixture = bridgeFixture(); const fetch = await createAndroidFetch(fixture.bridge);
  const pending = fetch('https://example.com/v1', { method: 'POST', headers: { Authorization: 'Bearer test' }, body: '{}' });
  fixture.event('headers', { status: 200, headers: { 'content-type': 'text/event-stream' } });
  const response = await pending; const reader = response.body.getReader();
  const bytes = Buffer.from('梦鲸');
  fixture.event('data', { data: bytes.subarray(0, 2).toString('base64') });
  assert.deepEqual(Buffer.from((await reader.read()).value), bytes.subarray(0, 2));
  fixture.event('data', { data: bytes.subarray(2).toString('base64') });
  assert.deepEqual(Buffer.from((await reader.read()).value), bytes.subarray(2));
  fixture.event('end'); assert.equal((await reader.read()).done, true);
  const bad = fetch('https://example.com');
  fixture.event('headers', { status: 401, headers: {} }); fixture.event('end');
  assert.equal((await bad).status, 401);
});

test('请求取消覆盖首包前和流式读到一半，释放原生连接', async () => {
  const fixture = bridgeFixture(); const fetch = await createAndroidFetch(fixture.bridge);
  const early = new AbortController(); const pending = fetch('https://example.com', { signal: early.signal });
  early.abort(); await assert.rejects(pending, { name: 'AbortError' });
  assert.ok(fixture.cancelled.includes(fixture.started[0].id));
  const late = new AbortController(); const second = fetch('https://example.com', { signal: late.signal });
  fixture.event('headers', { status: 200, headers: {} });
  const reader = (await second).body.getReader(); const reading = reader.read(); late.abort();
  await assert.rejects(reading, { name: 'AbortError' });
  assert.ok(fixture.cancelled.includes(fixture.started[1].id));
});
