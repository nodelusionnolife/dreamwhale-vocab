import test from 'node:test';
import assert from 'node:assert/strict';
import { createReplyNarration } from '../src/engine/reply-narration.js';

const tick = () => new Promise(resolve => setImmediate(resolve));

test('在线朗读在回复结束前启动，按播放进度逐步显示并按顺序播放后续句子', async () => {
  const controller = new AbortController();
  const prepared = [], played = [], shown = [];
  let release, progress, finished = 0;
  const narration = createReplyNarration({
    signal: controller.signal,
    prepare: async text => { prepared.push(text); return text; },
    play: (text, update) => { played.push(text); progress = update; return new Promise(resolve => { release = resolve; }); },
    onText: text => shown.push(text), onDone: () => finished++,
  });
  narration.push('你好。');
  await tick();
  assert.deepEqual(played, ['你好。']);
  assert.equal(finished, 0);
  progress(.34);
  assert.equal(shown.at(-1), '你');
  narration.finish('你好。一起学习吧。<TurnSummary>本轮互相问好并准备学习英语。</TurnSummary>');
  await tick();
  assert.deepEqual(prepared, ['你好。', '一起学习吧。']);
  assert.equal(played.length, 1);
  release(); await tick();
  assert.equal(played.length, 2);
  progress(.5);
  assert.equal(shown.at(-1), '你好。一起学');
  release(); await tick();
  assert.equal(shown.at(-1), '你好。一起学习吧。');
  assert.equal(finished, 1);
});

test('题卡保留显示，表情、答案、教学参考及不完整的小总结均不发送到语音', async () => {
  const controller = new AbortController(), spoken = [], shown = [];
  const narration = createReplyNarration({
    signal: controller.signal,
    prepare: async text => { spoken.push(text); return text; },
    play: async (_, progress) => progress(1), onText: text => shown.push(text),
  });
  narration.push('Hello. <Question>Fill in');
  await tick();
  narration.finish('Hello. <Question>Fill in ___.</Question><Face>开心</Face><AnswerKey>secret</AnswerKey><TeachingReference>hidden</TeachingReference><TurnSummary>private');
  await tick();
  assert.equal(spoken.join(''), 'Hello.');
  assert.equal(shown.at(-1), 'Hello. <Question>Fill in ___.</Question>');
});

test('停止朗读后展示剩余文字，忽略旧播放进度，后续生成不再合成', async () => {
  const controller = new AbortController(), spoken = [], shown = [];
  let progress, release, finished = 0;
  const narration = createReplyNarration({
    signal: controller.signal,
    prepare: async text => { spoken.push(text); return text; },
    play: (_, update) => { progress = update; return new Promise(resolve => { release = resolve; }); },
    onText: text => shown.push(text), onDone: () => finished++,
  });
  narration.push('你好。'); await tick();
  progress(.34); controller.abort();
  assert.equal(shown.at(-1), '你好。');
  progress(.1);
  narration.finish('你好。后续内容。'); release(); await tick();
  assert.deepEqual(spoken, ['你好。']);
  assert.equal(shown.at(-1), '你好。后续内容。');
  assert.equal(finished, 1);
});

test('语音合成失败时报告错误并显示完整回复，后续文本仍可显示', async () => {
  const controller = new AbortController(), shown = [], errors = [];
  let finished = 0, cancelled = 0;
  const narration = createReplyNarration({
    signal: controller.signal,
    prepare: async () => { throw new Error('service unavailable'); },
    play: async () => assert.fail('failed synthesis must not play'),
    onText: text => shown.push(text), onError: error => errors.push(error.message),
    onDone: () => finished++, onCancel: () => cancelled++,
  });
  narration.push('你好。'); await tick();
  narration.finish('你好。还有后文。'); await tick();
  assert.deepEqual(errors, ['service unavailable']);
  assert.equal(shown.at(-1), '你好。还有后文。');
  assert.equal(finished, 1); assert.equal(cancelled, 1);
});
