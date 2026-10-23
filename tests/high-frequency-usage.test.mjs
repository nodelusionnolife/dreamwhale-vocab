import test from 'node:test';
import assert from 'node:assert/strict';
import { USAGE_QUESTIONS } from '../src/content/high-frequency-usage.js';
import { LEARNING_QUESTIONS } from '../src/content/learning-bank.js';
import { matchesBank, frequencySources } from '../src/engine/banks.js';
import { catalogOf, startRound } from '../src/engine/study.js';
import { emptyLearning, gradeAnswer, normalizeAnswer, validateLearning } from '../src/engine/learning.js';

const types = ['collocation', 'formation', 'confusion', 'correction', 'phrase'];
const ids = new Set(USAGE_QUESTIONS.map(q => q.id));
const previous = LEARNING_QUESTIONS.filter(q => !ids.has(q.id) && !['project-original-transfer-2026', 'project-original-pairs-2026'].includes(q.source));

test('usage expansion adds 400 questions, each closing an actual word/type gap without extending the word list', () => {
  assert.equal(USAGE_QUESTIONS.length, 400);
  assert.equal(ids.size, 400);
  assert.equal(new Set(LEARNING_QUESTIONS.map(q => q.id)).size, LEARNING_QUESTIONS.length);
  for (const bank of ['cet4', 'cet6']) {
    const old = previous.filter(q => matchesBank(q, bank, 'high'));
    const now = LEARNING_QUESTIONS.filter(q => matchesBank(q, bank, 'high'));
    assert.deepEqual(catalogOf(now).map(w => w.word), catalogOf(old).map(w => w.word));
    for (const type of types) {
      const added = USAGE_QUESTIONS.filter(q => q.bank === bank && q.type === type);
      assert.equal(added.length, 40, `${bank}/${type}`);
      assert.equal(new Set(added.map(q => q.targetWords[0])).size, 40);
      for (const difficulty of ['basic', 'advanced']) assert.equal(added.filter(q => q.difficulty === difficulty).length, 20);
      const covered = new Set(old.filter(q => q.type === type).flatMap(q => q.targetWords));
      for (const q of added) {
        assert.ok(!covered.has(q.targetWords[0]), q.id);
        assert.ok(frequencySources(q).length >= 2, q.id);
        assert.equal(now.find(item => item.id === q.id).difficulty, q.difficulty);
      }
      assert.equal(catalogOf(now.filter(q => q.type === type)).length, covered.size + 40);
    }
  }
});

test('usage questions have unique prompts, valid answer variants, bounded corrections and exact phrase lengths', () => {
  const stems = new Set(previous.map(q => normalizeAnswer(q.stem)));
  for (const q of USAGE_QUESTIONS) {
    assert.ok(!stems.has(normalizeAnswer(q.stem)), q.id); stems.add(normalizeAnswer(q.stem));
    assert.ok(!/undefined|TODO|placeholder|\ufffd/.test(JSON.stringify(q)), q.id);
    assert.ok(q.difficultyBasis && q.explanation && q.senseId, q.id);
    for (const answer of q.accepts) assert.equal(gradeAnswer(q, answer).status, 'correct', `${q.id}/${answer}`);
    assert.equal(gradeAnswer(q, 'incorrect sample').status, 'incorrect', q.id);
    if (['collocation', 'confusion'].includes(q.type)) {
      assert.equal(q.options.length, 4, q.id);
      assert.equal(new Set(q.options.map(normalizeAnswer)).size, 4, q.id);
      assert.equal(q.options.filter(a => gradeAnswer(q, a).status === 'correct').length, 1, q.id);
    }
    if (q.type === 'correction') {
      const marked = q.stem.match(/\[([^\]]+)\]/g);
      assert.equal(marked?.length, 1, q.id);
      assert.equal(gradeAnswer(q, marked[0].slice(1, -1)).status, 'incorrect', q.id);
    } else assert.equal(q.stem.split('___').length, 2, q.id);
    if (q.type === 'phrase') {
      const length = { 两: 2, 三: 3, 四: 4 }[q.stem.match(/补全([两三四])个词/)?.[1]];
      assert.ok(length, q.id);
      for (const answer of q.accepts) assert.equal(answer.split(/\s+/).length, length, `${q.id}/${answer}`);
    }
  }
});

test('all five expanded types provide 30 distinct words at each difficulty and preserve a paused group', () => {
  for (const bank of ['cet4', 'cet6', 'mixed']) for (const type of types) for (const difficulty of ['basic', 'advanced']) {
    const initial = emptyLearning(); initial.plan = { ...initial.plan, bank, frequency: 'high' };
    const old = startRound(previous, initial, { kind: 'drill', type, count: 10 });
    const round = startRound(LEARNING_QUESTIONS, old, { kind: 'drill', type, difficulty, count: 30 });
    assert.equal(round.round.items.length, 30, `${bank}/${type}/${difficulty}`);
    assert.equal(new Set(round.round.items.map(item => item.question.targetWords[0])).size, 30);
    assert.ok(round.round.items.every(item => matchesBank(item.question, bank, 'high') && item.question.difficulty === difficulty));
    assert.ok(round.pausedRounds.some(group => group.round.id === old.round.id));
    assert.doesNotThrow(() => validateLearning(round));
  }
});
