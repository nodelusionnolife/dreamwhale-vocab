import test from 'node:test';
import assert from 'node:assert/strict';
import { LEARNING_QUESTIONS } from '../src/content/learning-bank.js';
import { emptyLearning, validateLearning, recordOutcome, createQuestionInstance, DAY } from '../src/engine/learning.js';
import { catalogOf, startRound, advanceRound, roundPending, studyOverview, resumeLegacyPractice } from '../src/engine/study.js';
import { exportLearning, importLearning, saveLearning, loadLearning } from '../src/storage/learning.js';
import { resolveLayout, loadLayout, saveLayout } from '../src/ui/layout.js';

const now = new Date(2026, 9, 16, 12).getTime();
const storage = () => { const map = new Map(); return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v) }; };
function finishCurrent(state, { status = 'correct', hintLevel = 0, tries = 1 } = {}) {
  const current = state.active.practice;
  const result = { status, answer: current.question.answer, explanation: current.question.explanation };
  const next = recordOutcome(state, { ...current, hintLevel, tries: tries - 1 }, result, { now, source: `study:${state.round.kind}` });
  return { ...next, active: { ...next.active, practice: { ...current, status, hintLevel, tries, result: status === 'revealed' ? null : result } } };
}

test('old learning data receives a plan without losing events or current question', () => {
  const old = { version: 1, events: [], active: { practice: createQuestionInstance(LEARNING_QUESTIONS[0], { now }) }, favorites: [], preferences: {} };
  const valid = validateLearning(old);
  assert.equal(valid.plan.newGoal, 10);
  const resumed = resumeLegacyPractice(valid, now);
  assert.equal(resumed.round.items.length, 1);
  assert.equal(resumed.active.practice.id, old.active.practice.id);
  assert.equal(resumed.round.phase, 'answer');
  assert.doesNotThrow(() => validateLearning(resumed));
});

test('new learning is a bounded snapshot with unique, previously unseen words', () => {
  const first = LEARNING_QUESTIONS[0];
  const seen = recordOutcome(emptyLearning(), createQuestionInstance(first), { status: 'correct' }, { now: now - DAY });
  const state = startRound(LEARNING_QUESTIONS, seen, { count: 5, now });
  assert.equal(state.round.items.length, 5);
  assert.equal(new Set(state.round.items.map((x) => x.question.targetWords[0])).size, 5);
  assert.ok(state.round.items.every((x) => x.question.targetWords[0] !== first.targetWords[0]));
  assert.throws(() => startRound(LEARNING_QUESTIONS, state), /没有完成/);
  const db = storage(); saveLearning(state, null, db);
  assert.deepEqual(loadLearning(db).state.round, state.round);
  assert.deepEqual(loadLearning(db).state.active.practice.question.options, state.active.practice.question.options);
});

test('a round advances once per completed item and has a real ending', () => {
  let state = startRound(LEARNING_QUESTIONS, emptyLearning(), { count: 3, now });
  state = advanceRound(finishCurrent(state), { now });
  state = advanceRound(finishCurrent(state, { hintLevel: 1 }), { now });
  state = advanceRound(finishCurrent(state, { status: 'revealed' }), { now });
  assert.equal(roundPending(state), false);
  assert.equal(state.round.results.length, 3);
  assert.deepEqual(state.round.results.map((r) => r.independent), [true, false, false]);
  assert.equal(state.active.practice, undefined);
  assert.deepEqual(advanceRound(state, { now }), state);
  assert.doesNotThrow(() => validateLearning(state));
});

test('ending a group preserves prior outcomes and does not grade unvisited words', () => {
  let state = startRound(LEARNING_QUESTIONS, emptyLearning(), { count: 5, now });
  state = advanceRound(finishCurrent(state), { now });
  state = advanceRound(state, { now, end: true });
  assert.equal(state.round.endedEarly, true);
  assert.equal(state.events.length, 2);
  assert.equal(state.round.results[1].status, 'skipped');
  assert.equal(studyOverview(LEARNING_QUESTIONS, state, now).newDone, 1);
  assert.doesNotThrow(() => validateLearning(state));
});

test('due review selects only due skill keys while respecting the theme', () => {
  const q = LEARNING_QUESTIONS[0];
  let state = recordOutcome(emptyLearning(), createQuestionInstance(q), { status: 'correct' }, { now: now - 2 * DAY });
  state = startRound(LEARNING_QUESTIONS, state, { kind: 'review', topic: q.topic, count: 10, now });
  assert.equal(state.round.items.length, 1);
  assert.equal(state.active.practice.question.senseId, q.senseId);
  state = advanceRound(finishCurrent(state), { now });
  assert.equal(studyOverview(LEARNING_QUESTIONS, state, now).reviewDone, 1);
  assert.equal(studyOverview(LEARNING_QUESTIONS, state, now).newDone, 0);
});

test('daily counts do not count repeated attempts, reveals twice, or skipped words', () => {
  const q = LEARNING_QUESTIONS[0];
  let state = emptyLearning();
  for (let i = 0; i < 4; i++) state = recordOutcome(state, createQuestionInstance(q, { id: `retry-${i}` }), { status: i ? 'correct' : 'incorrect' }, { now: now - 100 + i });
  assert.equal(studyOverview(LEARNING_QUESTIONS, state, now).newDone, 1);
  assert.equal(studyOverview(LEARNING_QUESTIONS, state, now).reviewDone, 0);
  state.plan.topic = 'unavailable-topic';
  assert.equal(studyOverview(LEARNING_QUESTIONS, state, now).newDone, 0);
});

test('record export excludes an unfinished round and import preserves local progress', () => {
  const pending = startRound(LEARNING_QUESTIONS, emptyLearning(), { count: 5, now });
  const exported = exportLearning(pending);
  assert.equal(JSON.parse(exported).round, null);
  assert.deepEqual(JSON.parse(exported).active, {});
  const db = storage(); saveLearning(pending, null, db);
  importLearning(exported, db);
  assert.deepEqual(loadLearning(db).state.round, pending.round);
  assert.equal(loadLearning(db).state.active.practice.id, pending.active.practice.id);
});

test('same-day due review counts as review without counting the new word twice', () => {
  const q = LEARNING_QUESTIONS[0];
  let state = recordOutcome(emptyLearning(), createQuestionInstance(q), { status: 'revealed' }, { now: now - 700000, source: 'study:new' });
  state = recordOutcome(state, createQuestionInstance(q), { status: 'correct' }, { now, source: 'study:review' });
  const summary = studyOverview(LEARNING_QUESTIONS, state, now);
  assert.equal(summary.newDone, 1);
  assert.equal(summary.reviewDone, 1);
  assert.equal(summary.reviewTarget, 1);
  assert.equal(studyOverview(LEARNING_QUESTIONS, emptyLearning(), now).reviewTarget, 0);
});

test('a stale next button cannot skip another tab’s current item', () => {
  const state = startRound(LEARNING_QUESTIONS, emptyLearning(), { count: 2, now });
  const oldId = state.active.practice.id;
  const next = advanceRound(finishCurrent(state), { expectedId: oldId, now });
  assert.throws(() => advanceRound(next, { expectedId: oldId, now }), /另一页面/);
  const finished = advanceRound(finishCurrent(next), { now });
  assert.throws(() => advanceRound(finished, { expectedId: next.active.practice.id, now }), /另一页面/);
});

test('broken groups are rejected before they can overwrite a good record', () => {
  const state = startRound(LEARNING_QUESTIONS, emptyLearning(), { count: 2, now });
  const db = storage(); const saved = saveLearning(state, null, db);
  for (const breakIt of [
    (s) => { s.round.index = 2; },
    (s) => { s.active.practice.id = 'other'; },
    (s) => { s.round.items[1].question.options = [42]; },
    (s) => { s.plan.newGoal = -5; },
  ]) {
    const broken = structuredClone(state); breakIt(broken);
    assert.throws(() => saveLearning(broken, saved.raw, db));
    assert.equal(loadLearning(db).raw, saved.raw);
  }
});

test('catalog and grouped drills include phrases without duplicating variants', () => {
  assert.equal(catalogOf(LEARNING_QUESTIONS.filter(q => !/^dw-c[46]-/.test(q.id))).length, 503);
  const state = startRound(LEARNING_QUESTIONS, emptyLearning(), { kind: 'drill', type: 'collocation', now });
  assert.equal(state.round.items.length, 10);
  assert.ok(state.round.items.every((item) => item.question.type === 'collocation'));
  assert.throws(() => startRound(LEARNING_QUESTIONS, emptyLearning(), { kind: 'drill', type: 'writing', semantic: false }), /没有可练习/);
});

test('automatic layout considers window and touch; explicit choices always win', () => {
  for (const [width, height, touch, expected] of [[390,844,false,'mobile'],[844,390,true,'mobile'],[1024,768,true,'mobile'],[1024,768,false,'desktop'],[1440,900,true,'desktop']]) {
    assert.equal(resolveLayout('auto', { width, height, touch }), expected);
    assert.equal(resolveLayout('mobile', { width, height, touch }), 'mobile');
    assert.equal(resolveLayout('desktop', { width, height, touch }), 'desktop');
  }
});

test('layout preference survives reload and fails safely when storage is unavailable', () => {
  const db = storage(); saveLayout('mobile', db); assert.equal(loadLayout(db), 'mobile');
  saveLayout('auto', db); assert.equal(loadLayout(db), 'auto');
  const broken = { getItem: () => { throw Error('denied'); }, setItem: () => { throw Error('full'); } };
  assert.equal(loadLayout(broken), 'auto');
  assert.throws(() => saveLayout('desktop', broken));
});
