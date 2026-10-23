import test from 'node:test';
import assert from 'node:assert/strict';
import { SPECIALTY_QUESTIONS } from '../src/content/high-frequency-specialties.js';
import { LEARNING_QUESTIONS, TOPICS } from '../src/content/learning-bank.js';
import { matchesBank, frequencySources } from '../src/engine/banks.js';
import { emptyLearning, gradeAnswer, normalizeAnswer, validateLearning, recordOutcome } from '../src/engine/learning.js';
import { startRound, resumeRound, pendingRounds } from '../src/engine/study.js';
import { questionMetadata } from '../src/content/question-metadata.js';

const types = ['collocation', 'formation', 'confusion', 'correction', 'phrase', 'reading', 'writing'];
const ids = new Set(SPECIALTY_QUESTIONS.map(q => q.id));

test('sparse high-frequency types gain twenty distinct targets in both banks, ten per difficulty', () => {
  assert.equal(SPECIALTY_QUESTIONS.length, 280);
  assert.equal(ids.size, 280);
  assert.equal(new Set(LEARNING_QUESTIONS.map(q => q.id)).size, LEARNING_QUESTIONS.length);
  const existing = LEARNING_QUESTIONS.filter(q => !ids.has(q.id));
  for (const bank of ['cet4', 'cet6']) for (const type of types) {
    const added = SPECIALTY_QUESTIONS.filter(q => q.bank === bank && q.type === type);
    assert.equal(added.length, 20, `${bank}/${type}`);
    assert.equal(new Set(added.map(q => q.targetWords[0])).size, 20, `${bank}/${type}`);
    assert.ok(LEARNING_QUESTIONS.filter(q => matchesBank(q, bank, 'high') && q.type === type).length >= 30);
    for (const difficulty of ['basic', 'advanced']) {
      const items = added.filter(q => q.difficulty === difficulty);
      assert.equal(items.length, 10);
      assert.equal(new Set(items.map(q => q.targetWords[0])).size, 10);
    }
    for (const q of added) {
      assert.ok(existing.some(old => matchesBank(old, bank, 'high') && old.targetWords.includes(q.targetWords[0])), q.id);
      assert.ok(frequencySources(q).length >= 2 && TOPICS[q.topic], q.id);
      assert.equal(questionMetadata(q).difficulty, q.difficulty);
      assert.equal(questionMetadata({ ...q, bank: bank === 'cet4' ? 'cet6' : 'cet4' }).difficulty, q.difficulty);
    }
  }
});

test('expanded questions have original prompts, valid answers, unambiguous options and complete task metadata', () => {
  const seen = new Set(LEARNING_QUESTIONS.filter(q => !ids.has(q.id)).map(q => normalizeAnswer(q.stem)));
  for (const q of SPECIALTY_QUESTIONS) {
    assert.ok(!seen.has(normalizeAnswer(q.stem)), q.id); seen.add(normalizeAnswer(q.stem));
    assert.ok(q.explanation && q.difficultyBasis && q.senseId && q.accepts.length, q.id);
    assert.ok(!/undefined|TODO|\ufffd|空格实际/.test(JSON.stringify(q)), q.id);
    for (const answer of q.accepts) assert.equal(gradeAnswer(q, answer).status, q.grading === 'semantic' ? 'needs-model' : 'correct', q.id);
    if (['collocation', 'confusion', 'reading'].includes(q.type)) {
      assert.equal(q.options.length, 4, q.id);
      assert.equal(new Set(q.options.map(normalizeAnswer)).size, 4, q.id);
      assert.equal(q.options.filter(option => gradeAnswer(q, option).status === 'correct').length, 1, q.id);
    }
    if (['collocation', 'confusion', 'formation', 'phrase'].includes(q.type)) assert.equal(q.stem.split('___').length, 2, q.id);
    if (q.type === 'correction') {
      const error = q.stem.match(/\[([^\]]+)\]/g);
      assert.equal(error?.length, 1, q.id);
      assert.ok(q.accepts.every(a => normalizeAnswer(a) !== normalizeAnswer(error[0].slice(1, -1))), q.id);
    }
    if (q.type === 'phrase') {
      const count = { 两: 2, 三: 3, 四: 4 }[q.stem.match(/补全([两三四])个词/)?.[1]];
      assert.ok(count, q.id);
      for (const answer of q.accepts) assert.equal(answer.split(/\s+/).length, count, q.id);
    }
    if (q.type === 'writing') {
      assert.ok(q.stem.startsWith(`用 ${q.targetWords[0]} `), q.id);
      assert.ok(q.answer.toLowerCase().includes(q.targetWords[0].replace(/e$/, '')), q.id);
      assert.ok(q.rubric.includes(q.explanation) && q.rubric.includes('不同表达'), q.id);
    }
  }
});

test('every specialty supports requested group sizes and both difficulties, with shortage bounded by distinct words', () => {
  for (const bank of ['cet4', 'cet6', 'mixed']) for (const type of types) for (const difficulty of ['all', 'basic', 'advanced']) {
    const state = emptyLearning(); state.plan = { ...state.plan, bank, frequency: 'high' };
    const candidates = LEARNING_QUESTIONS.filter(q => matchesBank(q, bank, 'high') && q.type === type && (difficulty === 'all' || q.difficulty === difficulty));
    const words = new Set(candidates.map(q => q.targetWords[0])).size;
    for (const count of [10, 20, 30]) {
      const result = startRound(LEARNING_QUESTIONS, state, { kind: 'drill', type, difficulty, count, semantic: true });
      assert.equal(result.round.items.length, Math.min(count, words), `${bank}/${type}/${difficulty}/${count}`);
      assert.equal(new Set(result.round.items.map(item => item.question.targetWords[0])).size, result.round.items.length);
      assert.ok(result.round.items.every(item => candidates.some(q => q.id === item.question.id)));
      assert.doesNotThrow(() => validateLearning(result));
    }
  }
});

test('switching to a longer specialty group preserves a previous question and recorded answer', () => {
  let state = emptyLearning(); state.plan = { ...state.plan, bank: 'cet4', frequency: 'high' };
  state = startRound(LEARNING_QUESTIONS, state, { kind: 'drill', type: 'collocation', count: 10, now: 1000 });
  const firstId = state.round.id;
  const firstQuestion = state.active.practice.question.id;
  state = recordOutcome(state, state.active.practice, { status: 'correct' }, { now: 1100 });
  const events = JSON.stringify(state.events);
  state = startRound(LEARNING_QUESTIONS, state, { kind: 'drill', type: 'reading', count: 20, now: 2000 });
  assert.equal(state.round.items.length, 20);
  assert.ok(pendingRounds(state).some(entry => entry.round.id === firstId));
  state = resumeRound(state, firstId);
  assert.equal(state.active.practice.question.id, firstQuestion);
  assert.equal(state.round.items.length, 10);
  assert.equal(JSON.stringify(state.events), events);
});
