import test from 'node:test';
import assert from 'node:assert/strict';
import { HIGH_FREQUENCY_QUESTIONS } from '../src/content/high-frequency-questions.js';
import { LEARNING_QUESTIONS, QUESTION_TYPES, TOPICS } from '../src/content/learning-bank.js';
import { frequencySources, matchesBank } from '../src/engine/banks.js';
import { emptyLearning, gradeAnswer, normalizeAnswer, createQuestionInstance, validateLearning } from '../src/engine/learning.js';
import { startRound } from '../src/engine/study.js';
import { drawQuestion } from '../src/engine/questions.js';

test('both high-frequency banks add 130 original questions, with ten distinct words in every type', () => {
  assert.equal(HIGH_FREQUENCY_QUESTIONS.length, 260);
  for (const bank of ['cet4', 'cet6']) {
    const pool = HIGH_FREQUENCY_QUESTIONS.filter(q => q.bank === bank);
    assert.equal(pool.length, 130);
    for (const type of Object.keys(QUESTION_TYPES)) {
      const items = pool.filter(q => q.type === type);
      assert.equal(items.length, ['choice', 'fill'].includes(type) ? 20 : 10, `${bank}/${type}`);
      assert.ok(new Set(items.map(q => q.targetWords[0])).size >= 10, `${bank}/${type}`);
    }
    for (const q of pool) {
      assert.ok(TOPICS[q.topic], q.id);
      assert.ok(frequencySources(q).length >= 2, q.id);
      assert.ok(matchesBank(q, bank, 'high'));
      assert.ok(matchesBank(q, 'mixed', 'high'));
      assert.equal(matchesBank(q, bank === 'cet4' ? 'cet6' : 'cet4', 'high'), false);
    }
  }
});

test('new content has unique prompts and every selectable question has one accepted option', () => {
  const ids = new Set(HIGH_FREQUENCY_QUESTIONS.map(q => q.id));
  const existingStems = new Set(LEARNING_QUESTIONS.filter(q => !ids.has(q.id) && q.source !== 'project-original-pairs-2026').map(q => q.stem.trim().toLowerCase()));
  const seen = new Set();
  for (const q of HIGH_FREQUENCY_QUESTIONS) {
    const signature = `${q.bank}/${q.stem.trim().toLowerCase()}`;
    assert.ok(!seen.has(signature), q.id); seen.add(signature);
    assert.ok(!existingStems.has(q.stem.trim().toLowerCase()), q.id);
    assert.equal(q.source, 'project-original-high-frequency-2026');
    assert.ok(!/[\u200b-\u200f\ufffd]|undefined|TODO/.test(JSON.stringify(q)), q.id);
    for (const answer of q.accepts) {
      assert.equal(gradeAnswer(q, answer).status, q.grading === 'semantic' ? 'needs-model' : 'correct', q.id);
    }
    if (q.options) {
      assert.equal(q.options.length, 4, q.id);
      assert.equal(new Set(q.options.map(normalizeAnswer)).size, 4, q.id);
      assert.equal(q.options.filter(option => gradeAnswer(q, option).status === 'correct').length, 1, q.id);
      const snapshot = createQuestionInstance(q, { rng: () => 0.4 });
      assert.deepEqual([...snapshot.question.options].sort(), [...q.options].sort());
    }
    if (q.type === 'writing') assert.match(q.rubric, /不同表达/);
    if (q.type === 'phrase') {
      const number = q.stem.match(/补全([二两三四五六])个词/)?.[1];
      const count = { 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6 }[number];
      assert.ok(count, q.id);
      for (const answer of q.accepts) assert.equal(answer.split(/\s+/).length, count, q.id);
    }
  }
});

test('sentence listening has an unambiguous gap and a complete spoken sentence without a printed answer', () => {
  for (const q of HIGH_FREQUENCY_QUESTIONS.filter(q => q.type === 'listening')) {
    assert.equal(q.stem.match(/___/g)?.length, 1, q.id);
    assert.equal(q.audioText, q.stem.split('：').at(-1).replace('___', q.answer), q.id);
    assert.ok(q.audioText.split(/\s+/).length >= 5, q.id);
    assert.ok(!q.stem.toLowerCase().includes(q.answer.toLowerCase()), q.id);
    assert.ok(!q.audioText.includes('___'), q.id);
    assert.equal(q.grading, 'exact');
  }
});

test('every new type can form a full group in CET4, CET6 and mixed high-frequency mode', () => {
  for (const bank of ['cet4', 'cet6', 'mixed']) for (const type of Object.keys(QUESTION_TYPES)) {
    const state = emptyLearning(); state.plan = { ...state.plan, bank, frequency: 'high' };
    const group = startRound(HIGH_FREQUENCY_QUESTIONS, state, { kind: 'drill', type, count: 10, audio: true, semantic: true });
    assert.equal(group.round.items.length, 10, `${bank}/${type}`);
    assert.ok(group.round.items.every(item => item.question.type === type && matchesBank(item.question, bank, 'high')));
    assert.doesNotThrow(() => validateLearning(group));
    if (type !== 'listening') assert.ok(matchesBank(drawQuestion({ learning: state, type }), bank, 'high'));
  }
});

test('open response variants and new-only listening availability are respected', () => {
  for (const [id, variants] of [
    ['dw-c4-high-phrase-rely', ['rely on', 'rely upon']],
    ['dw-c6-high-correction-confer', ['on', 'upon']],
    ['dw-c6-high-correction-incorporate', ['into', 'in']],
  ]) {
    const q = HIGH_FREQUENCY_QUESTIONS.find(q => q.id === id);
    for (const value of variants) assert.equal(gradeAnswer(q, value).status, 'correct');
  }
  assert.throws(() => startRound(HIGH_FREQUENCY_QUESTIONS, emptyLearning(), { kind: 'drill', type: 'listening', audio: false }), /没有可练习/);
  assert.throws(() => startRound(HIGH_FREQUENCY_QUESTIONS, emptyLearning(), { kind: 'drill', type: 'writing', semantic: false }), /没有可练习/);
});
