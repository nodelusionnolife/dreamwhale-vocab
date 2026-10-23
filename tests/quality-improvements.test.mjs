import test from 'node:test';
import assert from 'node:assert/strict';
import { LEARNING_QUESTIONS } from '../src/content/learning-bank.js';
import { COVERAGE_QUESTIONS } from '../src/content/high-frequency-coverage.js';
import { questionMetadata } from '../src/content/question-metadata.js';
import { matchesBank, frequencySources } from '../src/engine/banks.js';
import { catalogOf, startRound } from '../src/engine/study.js';
import { emptyLearning, progressKey, learningProgress, recordOutcome, createQuestionInstance, gradeAnswer } from '../src/engine/learning.js';
import { loadLearning, saveLearning, exportLearning, importLearning } from '../src/storage/learning.js';

test('all high-frequency words have contextual practice and new contexts retain source and spelling support', () => {
  assert.equal(COVERAGE_QUESTIONS.length, 668);
  const stems = new Set();
  for (const bank of ['cet4', 'cet6']) {
    const pool = LEARNING_QUESTIONS.filter(q => matchesBank(q, bank, 'high'));
    assert.ok(catalogOf(pool).every(e => e.questions.some(q => !['meaning', 'listening'].includes(q.type))));
    const added = COVERAGE_QUESTIONS.filter(q => q.bank === bank);
    for (const entry of catalogOf(added)) assert.equal(entry.questions.length, 2);
    for (const q of added) {
      assert.equal(q.stem.split('___').length, 2, q.id);
      assert.ok(!stems.has(q.stem), q.id); stems.add(q.stem);
      assert.ok(frequencySources(q).length >= 2 && q.sourcePages.length, q.id);
      assert.ok(q.promptHint.includes(q.targetWords[0][0]));
      for (const answer of q.accepts) assert.equal(gradeAnswer(q, answer).status, 'correct', q.id);
    }
  }
});

test('both levels contain both difficulties and the same task never changes difficulty with its bank label', () => {
  for (const bank of ['cet4', 'cet6']) for (const difficulty of ['basic', 'advanced']) {
    assert.ok(LEARNING_QUESTIONS.filter(q => matchesBank(q, bank, 'high') && q.difficulty === difficulty).length >= 10);
  }
  for (const q of LEARNING_QUESTIONS.filter(q => q.id.includes('-high-'))) {
    assert.equal(questionMetadata({ ...q, bank: q.bank === 'cet4' ? 'cet6' : 'cet4' }).difficulty, q.difficulty);
    assert.ok(q.difficultyBasis);
  }
  assert.equal(LEARNING_QUESTIONS.find(q => q.id === 'dw-c6-high-confusion-expire').difficulty, 'basic');
  assert.equal(LEARNING_QUESTIONS.find(q => q.id === 'dw-c4-high-correction-substitute').difficulty, 'advanced');
});

test('legacy events separate decline senses and reading without rewriting stored history or losing backups', () => {
  const decline = LEARNING_QUESTIONS.find(q => q.id === 'dw-c4-high-choice-decline');
  const refusal = LEARNING_QUESTIONS.find(q => q.id === 'dw-c4-high-meaning-decline');
  const reading = LEARNING_QUESTIONS.find(q => q.id === 'dw-c4-high-reading-decline');
  let state = recordOutcome(emptyLearning(), createQuestionInstance(decline), { status: 'correct' }, { now: 1000 });
  state.events[0].key = 'decline:cet4-syllabus|recognition';
  const original = JSON.stringify(state.events);
  const values = new Map(); const db = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  saveLearning(state, null, db);
  const loaded = loadLearning(db);
  const progress = learningProgress(loaded.state);
  assert.equal(progress[progressKey(decline)].independent, 1);
  assert.equal(progress[progressKey(refusal)], undefined);
  assert.equal(progress[progressKey(reading)], undefined);
  importLearning(exportLearning(loaded.state), db);
  importLearning(exportLearning(loaded.state), db);
  assert.equal(JSON.stringify(loadLearning(db).state.events), original);
  assert.equal(loadLearning(db).state.events.length, 1);
});

test('drills prefer unseen contexts and avoid questions reserved in another pending group', () => {
  const pool = LEARNING_QUESTIONS.filter(q => q.id.startsWith('dw-c4-coverage-')).slice(0, 20);
  let state = emptyLearning();
  for (const q of pool.filter((_, i) => i % 2 === 0)) state = recordOutcome(state, createQuestionInstance(q), { status: 'correct' }, { now: 1000 });
  const next = startRound(pool, state, { kind: 'drill', type: 'fill', count: 10, rng: () => .5 });
  assert.ok(next.round.items.every(item => !state.events.some(e => e.questionId === item.question.id)));
  const second = startRound(pool, next, { kind: 'drill', type: 'fill', count: 10, rng: () => .5 });
  assert.ok(second.round.items.every(item => !next.round.items.some(old => old.question.id === item.question.id)));
  const single = startRound(pool.slice(0, 1), next, { kind: 'drill', type: 'fill', count: 10 });
  assert.equal(single.round.items.length, 1);
});

test('self-reviewing expression is assisted and retains the response in the learning record', () => {
  const q = LEARNING_QUESTIONS.find(q => q.type === 'writing');
  const instance = createQuestionInstance(q);
  const state = recordOutcome(emptyLearning(), instance, { status: 'revealed', answer: 'My own sentence.' });
  assert.equal(state.events[0].answer, 'My own sentence.');
  assert.equal(state.events[0].assisted, true);
  assert.equal(learningProgress(state)[progressKey(q)].independent, 0);
});
