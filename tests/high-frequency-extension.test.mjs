import test from 'node:test';
import assert from 'node:assert/strict';
import { EXTENSION_QUESTIONS } from '../src/content/high-frequency-extension.js';
import { USAGE_QUESTIONS } from '../src/content/high-frequency-usage.js';
import { LEARNING_QUESTIONS, TOPICS } from '../src/content/learning-bank.js';
import { frequencySources, matchesBank } from '../src/engine/banks.js';
import { catalogOf, startRound } from '../src/engine/study.js';
import { emptyLearning, gradeAnswer, normalizeAnswer, validateLearning, recordOutcome, createQuestionInstance } from '../src/engine/learning.js';
import { exportLearning, importLearning, saveLearning } from '../src/storage/learning.js';

const types = ['collocation', 'formation', 'confusion', 'correction', 'phrase', 'reading', 'writing'];
const ids = new Set(EXTENSION_QUESTIONS.map(q => q.id));
const laterIds = new Set(USAGE_QUESTIONS.map(q => q.id));
const before = LEARNING_QUESTIONS.filter(q => !ids.has(q.id) && !laterIds.has(q.id) && !['project-original-transfer-2026', 'project-original-pairs-2026'].includes(q.source));

test('extension closes every prior specialty gap and reading and writing cover a majority in each bank', () => {
  assert.equal(EXTENSION_QUESTIONS.length, 603);
  assert.equal(ids.size, 603);
  assert.equal(new Set(LEARNING_QUESTIONS.map(q => q.id)).size, LEARNING_QUESTIONS.length);
  for (const bank of ['cet4', 'cet6']) {
    const old = before.filter(q => matchesBank(q, bank, 'high'));
    const pool = LEARNING_QUESTIONS.filter(q => matchesBank(q, bank, 'high'));
    const words = catalogOf(pool).map(entry => entry.word);
    assert.deepEqual(words, catalogOf(old).map(entry => entry.word));
    const missing = new Set(catalogOf(old).filter(entry => !entry.questions.some(q => types.includes(q.type))).map(entry => entry.word));
    const writing = EXTENSION_QUESTIONS.filter(q => q.bank === bank && q.type === 'writing');
    assert.equal(writing.length, missing.size);
    assert.deepEqual(new Set(writing.map(q => q.targetWords[0])), missing);
    assert.ok(catalogOf(pool).every(entry => entry.questions.some(q => types.includes(q.type))));
    assert.ok(catalogOf(pool.filter(q => q.type === 'reading')).length / words.length > 0.5);
    assert.ok(catalogOf(pool.filter(q => q.type === 'writing')).length / words.length >= 0.75);
    for (const q of EXTENSION_QUESTIONS.filter(q => q.bank === bank)) {
      assert.ok(old.some(previous => previous.targetWords[0] === q.targetWords[0]), q.id);
      assert.ok(frequencySources(q).length >= 2, q.id);
      assert.ok(TOPICS[q.topic] && q.difficultyBasis && q.senseId, q.id);
      const runtime = pool.find(item => item.id === q.id);
      assert.equal(runtime.difficulty, q.difficulty);
      assert.equal(runtime.skill, q.skill);
    }
  }
});

test('new prompts are unique, all accepted answers grade, and open tasks carry explicit requirements', () => {
  const stems = new Set(before.map(q => normalizeAnswer(q.stem)));
  for (const q of EXTENSION_QUESTIONS) {
    assert.ok(!stems.has(normalizeAnswer(q.stem)), q.id); stems.add(normalizeAnswer(q.stem));
    assert.ok(!/undefined|TODO|\ufffd|空格实际/.test(JSON.stringify(q)), q.id);
    for (const answer of q.accepts) assert.equal(gradeAnswer(q, answer).status, q.grading === 'semantic' ? 'needs-model' : 'correct', q.id);
    if (q.options) {
      assert.equal(q.options.length, 4, q.id);
      assert.equal(new Set(q.options.map(normalizeAnswer)).size, 4, q.id);
      assert.equal(q.options.filter(answer => gradeAnswer(q, answer).status === 'correct').length, 1, q.id);
    }
    if (['collocation', 'formation', 'confusion', 'phrase'].includes(q.type)) assert.equal(q.stem.split('___').length, 2, q.id);
    if (q.type === 'phrase') {
      const count = { 两: 2, 三: 3, 四: 4, 五: 5 }[q.stem.match(/补全([两三四五])个词/)?.[1]];
      assert.ok(count, q.id);
      for (const answer of q.accepts) assert.equal(answer.split(/\s+/).length, count, q.id);
    }
    if (q.type === 'correction') {
      const error = q.stem.match(/\[([^\]]+)\]/g);
      assert.equal(error?.length, 1, q.id);
      assert.ok(q.accepts.every(answer => normalizeAnswer(answer) !== normalizeAnswer(error[0].slice(1, -1))), q.id);
    }
    if (q.type === 'reading') {
      assert.ok(q.stem.split(/\s+/).length >= 18 && q.stem.includes('?'), q.id);
      assert.ok(q.stem.split('. ').length >= 3, q.id);
      assert.equal(q.skill, 'reading');
      assert.ok(!q.stem.includes('___'), q.id);
    }
    if (q.type === 'writing') {
      assert.ok(q.stem.startsWith(`用 ${q.targetWords[0]} `), q.id);
      assert.ok(q.rubric.includes('不同表达') && q.rubric.includes(q.targetWords[0]), q.id);
      assert.ok(q.answer.split(/\s+/).length >= 3, q.id);
      assert.ok(!q.answer.includes('___'), q.id);
    }
  }
});

test('expanded high-frequency banks form full reading and writing groups at both difficulties', () => {
  for (const bank of ['cet4', 'cet6', 'mixed']) for (const type of ['reading', 'writing']) for (const difficulty of ['basic', 'advanced']) {
    const state = emptyLearning(); state.plan = { ...state.plan, bank, frequency: 'high' };
    const result = startRound(LEARNING_QUESTIONS, state, { kind: 'drill', type, difficulty, semantic: true, count: 30 });
    assert.equal(result.round.items.length, 30, `${bank}/${type}/${difficulty}`);
    assert.equal(new Set(result.round.items.map(item => item.question.targetWords[0])).size, 30);
    assert.ok(result.round.items.every(item => item.question.difficulty === difficulty && matchesBank(item.question, bank, 'high')));
    assert.doesNotThrow(() => validateLearning(result));
  }
});

test('old and new question histories survive export and merge without duplicate or lost outcomes', () => {
  const old = before.find(q => q.type === 'reading');
  const added = EXTENSION_QUESTIONS.find(q => q.type === 'reading');
  let state = recordOutcome(emptyLearning(), createQuestionInstance(old, { now: 1000 }), { status: 'correct' }, { now: 2000 });
  state = recordOutcome(state, createQuestionInstance(added, { now: 3000 }), { status: 'incorrect' }, { now: 4000 });
  const backup = exportLearning(state);
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  saveLearning(state, null, storage);
  importLearning(backup, storage);
  const merged = importLearning(backup, storage);
  assert.equal(merged.events.length, state.events.length);
  assert.deepEqual(merged.events, state.events);
});
