import test from 'node:test';
import assert from 'node:assert/strict';
import { LEARNING_QUESTIONS, PAIRED_QUESTIONS, QUESTION_TYPES, TOPICS } from '../src/content/learning-bank.js';
import { questionBank, matchesBank } from '../src/engine/banks.js';
import { gradeAnswer, normalizeAnswer, emptyLearning, validateLearning, recordOutcome, createQuestionInstance } from '../src/engine/learning.js';
import { startRound } from '../src/engine/study.js';

const previous = LEARNING_QUESTIONS.filter(q => q.source !== 'project-original-pairs-2026');
const oldById = new Map(previous.map(q => [q.id, q]));
const key = q => `${questionBank(q)}|${q.targetWords[0]}|${q.type}`;
const prompt = q => normalizeAnswer(q.type === 'listening' ? q.audioText : q.stem.replace(/_{3,}/g, '___'));

test('every existing high-frequency bank/word/type combination has at least two distinct exercises', () => {
  const groups = new Map();
  for (const q of LEARNING_QUESTIONS.filter(q => matchesBank(q, 'mixed', 'high'))) {
    if (!groups.has(key(q))) groups.set(key(q), []);
    groups.get(key(q)).push(q);
  }
  assert.equal(groups.size, 2855);
  for (const [label, items] of groups) {
    assert.ok(items.length >= 2, label);
    assert.ok(new Set(items.map(prompt)).size >= 2, label);
  }
  assert.equal(PAIRED_QUESTIONS.length, 2244);
  assert.equal(new Set(LEARNING_QUESTIONS.map(q => q.id)).size, LEARNING_QUESTIONS.length);
  assert.deepEqual(new Set(PAIRED_QUESTIONS.map(q => q.type)), new Set(Object.keys(QUESTION_TYPES)));
  for (const q of PAIRED_QUESTIONS) {
    const base = oldById.get(q.pairedWith);
    assert.ok(base, q.id);
    const siblings = previous.filter(old => key(old) === key(q));
    assert.ok(siblings.length === 1 || siblings[0].type === 'listening' && new Set(siblings.map(prompt)).size === 1, q.id);
    assert.notEqual(prompt(q), prompt(base), q.id);
    assert.equal(q.senseId, base.senseId, q.id);
    assert.equal(q.skill, base.skill, q.id);
    assert.equal(q.variantGroup, base.variantGroup, q.id);
  }
});

test('paired exercises retain valid grading, options, audio and bounded editing instructions', () => {
  for (const q of PAIRED_QUESTIONS) {
    assert.ok(TOPICS[q.topic] && q.difficultyBasis && q.explanation, q.id);
    assert.ok(!/undefined|TODO|placeholder|\ufffd/.test(JSON.stringify(q)), q.id);
    for (const answer of q.accepts) assert.equal(gradeAnswer(q, answer).status, q.grading === 'semantic' ? 'needs-model' : 'correct', `${q.id}/${answer}`);
    if (q.options) {
      assert.equal(q.options.length, 4, q.id);
      assert.equal(new Set(q.options.map(normalizeAnswer)).size, 4, q.id);
      assert.equal(q.options.filter(answer => gradeAnswer(q, answer).status === 'correct').length, 1, q.id);
    }
    if (q.type === 'correction') {
      const marked = q.stem.match(/\[([^\]]+)\]/g);
      assert.equal(marked?.length, 1, q.id);
      assert.equal(gradeAnswer(q, marked[0].slice(1, -1)).status, 'incorrect', q.id);
    }
    if (q.type === 'phrase') {
      const length = { 两: 2, 三: 3, 四: 4, 五: 5 }[q.stem.match(/补全([两三四五])个词/)?.[1]];
      assert.ok(length, q.id);
      for (const answer of q.accepts) assert.equal(answer.split(/\s+/).length, length, `${q.id}/${answer}`);
    }
    if (q.type === 'listening') {
      const cloze = q.stem.split('：').slice(1).join('：');
      assert.equal(cloze.replace(/_{3,}/, q.answer), q.audioText, q.id);
      assert.ok(q.audioText.split(/\s+/).length >= 5, q.id);
    }
    if (q.type === 'reading') assert.ok(q.stem.split(/[.!]/).length >= 3, q.id);
    if (q.type === 'writing') {
      assert.match(q.rubric, /不同表达/, q.id);
      assert.ok(q.answer.split(/\s+/).length >= 10, q.id);
    }
  }
});

test('paired variants preserve progress keys and can be selected for practice with a pending group', () => {
  for (const bank of ['cet4', 'cet6']) {
    const initial = emptyLearning();
    initial.plan = { ...initial.plan, bank, frequency: 'high' };
    const prior = startRound(previous, initial, { kind: 'drill', type: 'formation', count: 10 });
    const current = startRound(PAIRED_QUESTIONS, prior, { kind: 'drill', type: 'formation', count: 10 });
    assert.equal(current.round.items.length, 10);
    assert.ok(current.round.items.every(item => item.question.source === 'project-original-pairs-2026'));
    assert.ok(current.pausedRounds.some(group => group.round.id === prior.round.id));
    assert.doesNotThrow(() => validateLearning(current));
  }
});

test('practising a previously answered word chooses its unseen question in the full bank', () => {
  const base = oldById.get('dw-c4-high-formation-adapt');
  const state = emptyLearning();
  state.plan = { ...state.plan, bank: 'cet4', frequency: 'high' };
  const answered = recordOutcome(state, createQuestionInstance(base), { status: 'correct' });
  const round = startRound(LEARNING_QUESTIONS, answered, { kind: 'drill', word: 'adapt', type: 'formation', count: 1, rng: () => 0 });
  assert.equal(round.round.items[0].question.id, 'dw-pair-cet4-formation-adapt');
});
