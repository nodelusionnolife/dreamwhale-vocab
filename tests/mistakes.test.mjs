import test from 'node:test';
import assert from 'node:assert/strict';
import { LEARNING_QUESTIONS } from '../src/content/learning-bank.js';
import { emptyLearning, createQuestionInstance, recordOutcome, validateLearning } from '../src/engine/learning.js';
import { mistakeArchive, MISTAKE_INTERVAL, mistakeKey } from '../src/engine/mistakes.js';
import { startRound } from '../src/engine/study.js';
import { exportLearning, importLearning, loadLearning } from '../src/storage/learning.js';
import { loadTutorial, saveTutorial } from '../src/storage/tutorial.js';

const q = LEARNING_QUESTIONS.find((q) => q.id === 'c4c-001');
const time = 100000;
function answer(state, status, at, { question = q, id = String(at), response = 'wrong answer' } = {}) {
  return recordOutcome(state, createQuestionInstance(question, { id, now: at }), { status, answer: response }, { now: at, source: 'test' });
}
function independent(state, at, options = {}) { return answer(state, 'correct', at, { ...options, response: q.answer }); }
function storage() { const data = new Map(); return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }; }

test('wrong answers are automatically collected by exact question version with a snapshot', () => {
  let state = answer(emptyLearning(), 'incorrect', time);
  state = answer(state, 'incorrect', time + 1, { response: 'second answer' });
  const entries = mistakeArchive(state, []);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].wrongCount, 2);
  assert.equal(entries[0].lastWrongAnswer, 'second answer');
  assert.equal(entries[0].question.stem, q.stem);
  assert.notEqual(state.events[0].question, q);
  assert.doesNotThrow(() => validateLearning(state));
});

test('skips, reveals, uncertain and assisted successes alone do not create wrong questions', () => {
  let state = emptyLearning();
  for (const [i, status] of ['skipped', 'revealed', 'uncertain', 'correct'].entries()) state = answer(state, status, time + i);
  assert.equal(mistakeArchive(state, LEARNING_QUESTIONS).length, 0);
});

test('archive requires two independent sessions at least one day apart and reopens on another failure', () => {
  let state = answer(emptyLearning(), 'incorrect', time);
  state = independent(state, time + 1);
  state = independent(state, time + 2);
  assert.equal(mistakeArchive(state)[0].successes, 1);
  state = independent(state, time + MISTAKE_INTERVAL + 1);
  assert.equal(mistakeArchive(state)[0].archivedAt, time + MISTAKE_INTERVAL + 1);
  state = answer(state, 'incorrect', time + MISTAKE_INTERVAL + 2);
  const entry = mistakeArchive(state)[0];
  assert.equal(entry.archivedAt, null);
  assert.equal(entry.successes, 0);
  assert.equal(entry.wrongCount, 2);
});

test('hints and retry successes reset consolidation; skips and uncertainty do not', () => {
  let state = independent(answer(emptyLearning(), 'incorrect', time), time + 1);
  state = answer(state, 'skipped', time + 2);
  state = answer(state, 'uncertain', time + 3);
  assert.equal(mistakeArchive(state)[0].successes, 1);
  const assisted = { ...createQuestionInstance(q, { id: 'hinted' }), hintLevel: 1 };
  state = recordOutcome(state, assisted, { status: 'correct' }, { now: time + MISTAKE_INTERVAL + 2 });
  assert.equal(mistakeArchive(state)[0].successes, 0);
});

test('legacy wrong records use the matching bank version and retain missing questions', () => {
  const state = answer(emptyLearning(), 'incorrect', time);
  delete state.events[0].question;
  assert.equal(mistakeArchive(state, LEARNING_QUESTIONS)[0].question.id, q.id);
  assert.equal(mistakeArchive(state, [{ ...q, version: q.version + 1 }])[0].question, null);
  assert.equal(mistakeArchive(state, [])[0].lastWrongAnswer, 'wrong answer');
});

test('wrong question replays use the captured question and exclude archived entries', () => {
  let state = answer(emptyLearning(), 'incorrect', time);
  const round = startRound([], state, { kind: 'errors', topic: 'all', questionKey: mistakeKey(q.id, q.version), now: time + 1 });
  assert.equal(round.active.practice.question.stem, q.stem);
  assert.equal(round.active.practice.question.id, q.id);
  state = independent(state, time + 1);
  state = independent(state, time + MISTAKE_INTERVAL + 1);
  assert.throws(() => startRound(LEARNING_QUESTIONS, state, { kind: 'errors', topic: 'all' }), /没有可练习/);
});

test('archived outcomes and wrong snapshots survive export and repeated imports without duplication', () => {
  let state = independent(answer(emptyLearning(), 'incorrect', time), time + 1);
  state = independent(state, time + MISTAKE_INTERVAL + 1);
  const db = storage(); const backup = exportLearning(state);
  importLearning(backup, db); importLearning(backup, db);
  assert.deepEqual(mistakeArchive(loadLearning(db).state), mistakeArchive(state));
  const broken = structuredClone(state); broken.events[0].question.options = [42];
  assert.throws(() => validateLearning(broken), /快照/);
});

test('tutorial can resume, finish, skip and replay without mixing learning storage', () => {
  const db = storage(); assert.equal(loadTutorial(db), null);
  saveTutorial('active', 'mistakes', db); assert.equal(loadTutorial(db).step, 'mistakes');
  saveTutorial('completed', 'finish', db); assert.equal(loadTutorial(db).status, 'completed');
  saveTutorial('skipped', 'today', db); assert.equal(loadTutorial(db).status, 'skipped');
  saveTutorial('active', 'welcome', db); assert.equal(loadTutorial(db).status, 'active');
  assert.deepEqual(loadLearning(db).state.events, []);
  assert.equal(loadTutorial({ getItem: () => '{bad' }), null);
  assert.equal(loadTutorial({ getItem: () => { throw Error('denied'); } }), null);
  assert.throws(() => saveTutorial('active', 'today', { setItem: () => { throw Error('full'); } }));
});
