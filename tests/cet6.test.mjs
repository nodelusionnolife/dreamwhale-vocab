import test from 'node:test';
import assert from 'node:assert/strict';
import { CET6_WORDS, CET6_SOURCE, CET6_DICTIONARY_LICENSE } from '../src/content/cet6-words.js';
import { CET6_QUESTIONS } from '../src/content/cet6-questions.js';
import { CET6_FOCUS_QUESTIONS } from '../src/content/cet6-focus.js';
import { CET4_SYLLABUS_QUESTIONS } from '../src/content/cet4-syllabus-questions.js';
import { LEARNING_QUESTIONS } from '../src/content/learning-bank.js';
import { BANKS, matchesBank, questionBank } from '../src/engine/banks.js';
import { emptyLearning, createQuestionInstance, gradeAnswer, recordOutcome, validateLearning, selectQuestion } from '../src/engine/learning.js';
import { startRound, advanceRound, studyOverview, catalogOf } from '../src/engine/study.js';
import { drawQuestion, renderQuestionBody } from '../src/engine/questions.js';
import { mistakeArchive } from '../src/engine/mistakes.js';
import { saveLearning, loadLearning, exportLearning, importLearning } from '../src/storage/learning.js';
import { createBackup, restoreBackup } from '../src/storage/backup.js';

function storage() {
  const data = new Map();
  const db = { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: k => data.delete(k), key: i => [...data.keys()][i], get length() { return data.size; } };
  globalThis.localStorage = db;
  return db;
}
const six = () => ({ ...emptyLearning(), plan: { ...emptyLearning().plan, bank: 'cet6' } });
const fixture = CET6_QUESTIONS.find(q => q.id === 'dw-c6-meaning-abbreviation');

test('CET6 coverage retains official page attribution, alternate spellings, and dictionary license', () => {
  assert.equal(CET6_WORDS.length, 1262);
  assert.equal(CET6_SOURCE.starredRows, 1263);
  assert.match(CET6_SOURCE.url, /^https:\/\/cet\.neea\.edu\.cn\//);
  assert.match(CET6_DICTIONARY_LICENSE, /MIT License/);
  for (const w of CET6_WORDS) {
    assert.ok(w.pos && /[\u4e00-\u9fff]/.test(w.meaning), w.word);
    assert.ok(w.accepts.includes(w.word), w.word);
    assert.ok(w.pdfPages.every(p => p >= 21 && p <= 149), w.word);
    const questions = CET6_QUESTIONS.filter(q => q.targetWords[0] === w.word);
    assert.ok(questions.some(q => q.type === 'meaning'), w.word);
    assert.ok(questions.some(q => q.type === 'listening'), w.word);
  }
  assert.deepEqual(CET6_WORDS.find(w => w.word === 'aesthetic').pdfPages, [23, 63]);
  assert.equal(CET6_WORDS.find(w => w.word === 'random').pos, 'adj.');
  assert.equal(CET6_WORDS.find(w => w.word === 'tan').meaning, '晒黑的肤色；黄褐色');
  assert.ok(!CET6_WORDS.find(w => w.word === 'afloat').meaning.includes('浸满水'));
  for (const [word, variant] of [['armor', 'armour'], ['jeopardize', 'jeopardise'], ['cliché', 'cliche']]) {
    const question = CET6_QUESTIONS.find(q => q.type === 'listening' && q.targetWords[0] === word);
    assert.equal(gradeAnswer(question, variant).status, 'correct');
  }
});

test('CET6 questions grade their options and accept spellings with no broken references', () => {
  assert.equal(CET6_QUESTIONS.length, 2646);
  assert.equal(new Set(CET6_QUESTIONS.map(q => q.type)).size, 11);
  for (const q of CET6_QUESTIONS) {
    assert.equal(q.bank, 'cet6');
    assert.ok(q.sourcePages.length);
    for (const answer of q.accepts) assert.equal(gradeAnswer(q, answer).status, q.grading === 'semantic' ? 'needs-model' : 'correct', q.id);
    for (const option of q.options || []) if (!q.accepts.includes(option)) assert.equal(gradeAnswer(q, option).status, 'incorrect', q.id);
    if (q.type === 'fill' || q.type === 'choice') assert.equal((q.stem.match(/___/g) || []).length, 1, q.id);
    if (q.type === 'meaning') {
      assert.equal(q.audioText, q.targetWords[0]);
      assert.ok(q.options.every(option => !/^[a-z]+\./i.test(option)));
    }
  }
});

test('banks partition questions while keeping shared spellings and legacy IDs intact', () => {
  const groups = Object.fromEntries(Object.keys(BANKS).map(b => [b, LEARNING_QUESTIONS.filter(q => matchesBank(q, b))]));
  assert.equal(groups.cet4.length + groups.cet6.length, groups.mixed.length);
  assert.equal(groups.cet4.length, 1220 + CET4_SYLLABUS_QUESTIONS.length);
  assert.equal(groups.cet6.length, 2702 + CET6_FOCUS_QUESTIONS.length);
  assert.equal(catalogOf(groups.mixed).length, 5636);
  assert.equal(questionBank({ targetWords: ['appropriate'] }), 'cet4');
  assert.equal(questionBank(CET6_QUESTIONS.find(q => q.targetWords[0] === 'appropriate')), 'cet6');
  assert.match(CET6_WORDS.find(w => w.word === 'appropriate').meaning, /挪用/);
  assert.equal(questionBank({ targetWords: ['hypothesis'] }), 'cet6');
});

test('new, drill and chat draws respect the saved bank even after exhausting that bank', () => {
  for (const bank of Object.keys(BANKS)) {
    const state = { ...emptyLearning(), plan: { ...emptyLearning().plan, bank } };
    for (const kind of ['new', 'drill']) {
      const round = startRound(LEARNING_QUESTIONS, state, { kind, count: 30 });
      assert.equal(round.round.bank, bank);
      assert.ok(round.round.items.every(item => matchesBank(item.question, bank)));
    }
    const usedQuestionIds = LEARNING_QUESTIONS.filter(q => matchesBank(q, bank)).map(q => q.id);
    for (const rng of [() => 0, () => 0.5, () => 0.999]) {
      assert.ok(matchesBank(drawQuestion({ learning: state, session: { usedQuestionIds }, rng }), bank));
      assert.ok(matchesBank(selectQuestion(LEARNING_QUESTIONS, state, { rng }), bank));
    }
  }
  assert.ok(renderQuestionBody(fixture).includes(fixture.options[0]));
});

test('bank switching preserves a paused group, mistakes, favorites and old snapshots', () => {
  let state = startRound(LEARNING_QUESTIONS, emptyLearning(), { count: 2, now: 1000 });
  const original = JSON.stringify(state.round);
  state = { ...state, plan: { ...state.plan, bank: 'cet6' } };
  assert.equal(JSON.stringify(validateLearning(state).round), original);
  state = advanceRound(state, { end: true, now: 2000 });
  const old = structuredClone(state); delete old.plan.bank; delete old.round.bank;
  assert.equal(validateLearning(old).plan.bank, 'cet4');
  const attempt = createQuestionInstance(fixture, { id: 'c6-mistake', now: 3000 });
  state = recordOutcome(state, attempt, { status: 'incorrect', answer: 'wrong' }, { now: 3000 });
  state.favorites = ['abbreviation'];
  const retried = startRound(LEARNING_QUESTIONS, state, { kind: 'errors', now: 4000 });
  assert.equal(retried.round.items[0].question.id, fixture.id);
  assert.equal(mistakeArchive(retried, LEARNING_QUESTIONS).length, 1);
  assert.deepEqual(retried.favorites, ['abbreviation']);
});

test('progress totals and due reviews stay in their bank, including homographs', () => {
  let state = recordOutcome(six(), createQuestionInstance(fixture, { id: 'c6-success' }), { status: 'correct' }, { now: 1000 });
  assert.equal(studyOverview(LEARNING_QUESTIONS, state, 2000).seen, 1);
  const basic = { ...state, plan: { ...state.plan, bank: 'cet4' } };
  assert.equal(studyOverview(LEARNING_QUESTIONS, basic, 2000).seen, 0);
  assert.throws(() => startRound(LEARNING_QUESTIONS, basic, { kind: 'review', now: 100000000 }), /没有到期/);
  assert.equal(startRound(LEARNING_QUESTIONS, state, { kind: 'review', now: 100000000 }).round.items[0].question.targetWords[0], 'abbreviation');
  const original = LEARNING_QUESTIONS.find(q => matchesBank(q, 'cet4') && q.targetWords[0] === 'appropriate');
  if (original) {
    state = recordOutcome(six(), createQuestionInstance(original, { id: 'c4-shared' }), { status: 'correct' }, { now: 1000 });
    assert.equal(studyOverview(LEARNING_QUESTIONS, state, 2000).seen, 0);
  }
});

test('bank choice persists, imports merge records, and full restore applies settings only when selected', () => {
  const db = storage();
  const state = recordOutcome(six(), createQuestionInstance(fixture, { id: 'export-c6' }), { status: 'incorrect' }, { now: 1000 });
  saveLearning(state, null, db);
  assert.equal(loadLearning(db).state.plan.bank, 'cet6');
  const exported = exportLearning(state);
  const backup = createBackup(db);
  const dest = storage();
  importLearning(exported, dest); importLearning(exported, dest);
  assert.equal(loadLearning(dest).state.events.length, 1);
  assert.equal(loadLearning(dest).state.plan.bank, 'cet4');
  restoreBackup(backup, { storage: dest });
  assert.equal(loadLearning(dest).state.plan.bank, 'cet4');
  restoreBackup(backup, { storage: dest, includeSettings: true });
  assert.equal(loadLearning(dest).state.plan.bank, 'cet6');
  assert.equal(loadLearning(dest).state.events.length, 1);
  const before = loadLearning(dest).raw;
  assert.throws(() => saveLearning({ ...state, plan: { ...state.plan, bank: 'invalid' } }, before, dest));
  assert.equal(loadLearning(dest).raw, before);
});
