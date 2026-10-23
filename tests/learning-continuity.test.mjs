import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyLearning, validateLearning, createQuestionInstance, recordOutcome, learningProgress, gradeAnswer, DAY } from '../src/engine/learning.js';
import { startRound, studyOverview, advanceRound, pendingRounds } from '../src/engine/study.js';
import { learningStatistics } from '../src/engine/learning-statistics.js';
import { loadLearning, saveLearning, exportLearning, importLearning } from '../src/storage/learning.js';
import { createBackup, restoreBackup } from '../src/storage/backup.js';
import { LEARNING_QUESTIONS, TOPICS } from '../src/content/learning-bank.js';
import { USAGE_QUESTIONS } from '../src/content/high-frequency-usage.js';
import { TRANSFER_QUESTIONS } from '../src/content/high-frequency-transfer.js';

const KEY = 'dreamwhale:learning:v1';
function storage() {
  const data = new Map(); let fail = () => false;
  const api = { getItem: k => data.get(k) ?? null, setItem(k, v) { if (fail(k)) throw new Error('quota'); data.set(k, v); },
    removeItem: k => data.delete(k), key: i => [...data.keys()][i], get length() { return data.size; } };
  globalThis.localStorage = api;
  return { api, data, fail: f => { fail = f; } };
}
const question = (id, type, skill, word = 'globe') => ({ id, version: 1, type, skill, bank: 'cet4', topic: 'research', difficulty: 'basic',
  targetWords: [word], senseId: `${word}:core`, stem: `${id}: ___`, answer: word, accepts: [word], explanation: 'explanation', grading: 'exact' });
const qs = [question('recognize', 'meaning', 'recognition'), question('recall', 'fill', 'recall'), question('usage', 'phrase', 'usage'), question('formation', 'formation', 'formation')];
const at = new Date(2026, 9, 16, 12).getTime();
const outcome = (state, q, now, id = `${q.id}-${now}`, status = 'correct') => recordOutcome(state, createQuestionInstance(q, { id, now }), { status }, { now });
const longHistory = count => ({ ...emptyLearning(), events: Array.from({ length: count }, (_, i) => ({ id: `attempt-${i}`, instanceId: `instance-${i}`, key: 'globe:core|recall', word: 'globe', skill: 'recall', questionId: 'recall', status: i % 8 ? 'correct' : 'incorrect', assisted: false, at: at + i * DAY })) });

test('legacy history passes 30,000 entries, archives without loss, and reuses unchanged chunks', () => {
  const db = storage(), original = longHistory(30000);
  db.api.setItem(KEY, JSON.stringify(original));
  const old = loadLearning(db.api);
  const next = longHistory(30001);
  const saved = saveLearning(next, old.raw, db.api);
  const manifest = JSON.parse(saved.raw);
  assert.equal(manifest.version, 2); assert.ok(manifest.current.events.length <= 2000);
  const chunks = manifest.history.map(p => [p.key, db.api.getItem(p.key)]);
  assert.deepEqual(loadLearning(db.api).state.events, next.events);
  assert.deepEqual(learningProgress(loadLearning(db.api).state), learningProgress(next));
  saveLearning(longHistory(30002), saved.raw, db.api);
  for (const [key, value] of chunks) assert.equal(db.api.getItem(key), value);
  const exported = exportLearning(loadLearning(db.api).state);
  const fresh = storage(); importLearning(exported, fresh.api); importLearning(exported, fresh.api);
  assert.deepEqual(loadLearning(fresh.api).state.events, longHistory(30002).events);
});

test('archive quota, main-index quota and concurrent update keep the old history intact', () => {
  for (const failing of ['history', 'index']) {
    const db = storage(); const saved = saveLearning(longHistory(2000), null, db.api);
    const before = [...db.data]; db.fail(k => failing === 'index' ? k === KEY : k.includes(':history:'));
    assert.throws(() => saveLearning(longHistory(3001), saved.raw, db.api), /quota/);
    assert.deepEqual([...db.data], before);
    assert.equal(loadLearning(db.api).state.events.length, 2000);
    db.fail(() => false);
    const newer = saveLearning(longHistory(2001), saved.raw, db.api);
    assert.throws(() => saveLearning(longHistory(4000), saved.raw, db.api), /另一页面/);
    assert.equal(db.api.getItem(KEY), newer.raw);
  }
});

test('missing and duplicated archive data is rejected without resetting the record', () => {
  const db = storage(); const saved = saveLearning(longHistory(4000), null, db.api);
  const history = JSON.parse(saved.raw).history;
  const chunk = db.api.getItem(history[0].key);
  db.api.removeItem(history[0].key);
  assert.throws(() => loadLearning(db.api), /历史缺失/);
  assert.equal(db.api.getItem(KEY), saved.raw);
  db.api.setItem(history[0].key, chunk); db.api.setItem(history[1].key, chunk);
  assert.throws(() => loadLearning(db.api), /损坏的作答/);
});

test('review moves from recognition to recall on a later day and gives due words priority', () => {
  let state = outcome(emptyLearning(), qs[0], at);
  assert.equal(studyOverview(qs, state, at).advance, 0);
  let round = startRound(qs, state, { kind: 'review', now: at + DAY, count: 1 });
  assert.equal(round.active.practice.question.type, 'meaning');
  state = outcome(state, qs[0], at + DAY);
  assert.equal(studyOverview(qs, state, at + DAY).reviewAvailable, 0);
  assert.equal(studyOverview(qs, state, at + 2 * DAY).advance, 1);
  round = startRound(qs, state, { kind: 'review', now: at + 2 * DAY, count: 1 });
  assert.equal(round.active.practice.question.type, 'fill');
  const other = question('other', 'meaning', 'recognition', 'campus');
  state = outcome(state, other, at);
  round = startRound([...qs, other], state, { kind: 'review', now: at + 2 * DAY, count: 2 });
  assert.deepEqual(round.round.items.map(i => i.question.id), ['other', 'recall']);
  assert.equal(studyOverview(qs, state, at + 2 * DAY).newDone, 0);
});

test('progression skips unavailable stages, respects capabilities and does not advance weak words', () => {
  let state = outcome(outcome(emptyLearning(), qs[0], at), qs[0], at + DAY);
  assert.equal(startRound([qs[0], qs[3]], state, { kind: 'review', now: at + 2 * DAY }).active.practice.question.type, 'formation');
  const model = { ...question('write', 'writing', 'production'), grading: 'semantic' };
  const audio = question('listen', 'listening', 'listening');
  assert.throws(() => startRound([qs[0], model, audio], state, { kind: 'review', now: at + 2 * DAY, semantic: false, audio: false }));
  assert.equal(studyOverview([qs[0], model, audio], state, at + 2 * DAY, { semantic: false, audio: false }).reviewAvailable, 0);
  state = outcome(state, qs[0], at + DAY + 1, 'wrong', 'incorrect');
  assert.equal(studyOverview(qs, state, at + 2 * DAY).advance, 0);
  const otherContext = { ...qs[0], id: 'recognize-context-2', stem: 'Different context ___' };
  assert.equal(startRound([qs[0], otherContext], state, { kind: 'review', now: at + 2 * DAY }).active.practice.question.id, otherContext.id);
});

test('full backups preserve drafts and paused groups, merge idempotently and do not resurrect ended groups', () => {
  const source = storage();
  let state = startRound(qs, emptyLearning(), { kind: 'drill', now: at });
  state.active.practice.response = 'draft answer'; state.round.phase = 'answer';
  state = startRound(qs, state, { kind: 'drill', now: at + 1 });
  saveLearning(state, null, source.api);
  const backup = createBackup(source.api);
  assert.equal(backup.learning.pausedRounds[0].practice.response, 'draft answer');
  const target = storage();
  let local = startRound(qs, emptyLearning(), { kind: 'drill', now: at + 2 });
  local.active.practice.response = 'local draft'; saveLearning(local, null, target.api);
  assert.equal(restoreBackup(backup, { storage: target.api }).rounds, 2);
  assert.equal(restoreBackup(backup, { storage: target.api }).rounds, 0);
  const restored = loadLearning(target.api);
  assert.deepEqual(restored.state.active.practice, local.active.practice);
  assert.equal(pendingRounds(restored.state).length, 3);
  assert.doesNotThrow(() => validateLearning(restored.state));
  const fresh = storage(); restoreBackup(backup, { storage: fresh.api });
  const loaded = loadLearning(fresh.api);
  const ended = advanceRound(loaded.state, { end: true, now: at + 3 });
  saveLearning(startRound(qs, ended, { kind: 'drill', now: at + 4 }), loaded.raw, fresh.api);
  assert.equal(restoreBackup(backup, { storage: fresh.api }).rounds, 0);
  assert.ok(!pendingRounds(loadLearning(fresh.api).state).some(e => e.round.id === loaded.state.round.id));
});

test('old backups remain readable; archived backup import rolls back chunks if chat commit fails', () => {
  const source = storage(); saveLearning(longHistory(3001), null, source.api);
  const backup = createBackup(source.api); delete backup.learning.closedRounds; delete backup.learning.pausedRounds;
  const target = storage(); const old = saveLearning(emptyLearning(), null, target.api);
  createBackup(target.api); const before = [...target.data];
  target.fail(k => k === 'word-blade:chat-index');
  assert.throws(() => restoreBackup(backup, { storage: target.api }), /quota/);
  assert.deepEqual([...target.data], before);
  assert.equal(loadLearning(target.api).raw, old.raw);
  target.fail(() => false); restoreBackup(backup, { storage: target.api });
  assert.equal(loadLearning(target.api).state.events.length, 3001);
});

test('authored usage themes and reasonable phrase alternatives are available to grading and filters', () => {
  assert.ok(USAGE_QUESTIONS.filter(q => q.topic !== 'general').length > 350);
  for (const q of USAGE_QUESTIONS) assert.ok(TOPICS[q.topic]);
  for (const [word, answer] of [['code', 'code of behavior'], ['code', 'code of behaviour'], ['arouse', 'arouse suspicions'], ['decade', 'once every decade']]) {
    const q = USAGE_QUESTIONS.find(q => q.type === 'phrase' && q.targetWords[0] === word);
    assert.equal(gradeAnswer(q, answer).status, 'correct'); assert.equal(gradeAnswer(q, 'wrong answer').status, 'incorrect');
    const old = { ...q, version: 1, accepts: [q.answer] };
    assert.equal(gradeAnswer(old, answer).status, 'correct');
    assert.equal(old.accepts.length, 1);
    assert.equal(gradeAnswer({ ...old, stem: 'Different task' }, answer).status, 'incorrect');
  }
  const campus = startRound(USAGE_QUESTIONS, emptyLearning(), { kind: 'drill', topic: 'education', type: 'phrase', now: at });
  assert.ok(campus.round.items.some(i => i.question.targetWords[0] === 'campus'));
});

test('statistics count first encounters, hints and separate repeated errors from immediate retries', () => {
  let state = outcome(emptyLearning(), qs[1], at, 'first', 'incorrect');
  state = recordOutcome(state, { ...createQuestionInstance(qs[1], { id: 'first' }), tries: 1, hintLevel: 2 }, { status: 'correct' }, { now: at + 1 });
  state = outcome(state, qs[1], at + DAY, 'second', 'incorrect');
  state = recordOutcome(state, { ...createQuestionInstance(qs[1], { id: 'third' }), hintLevel: 1 }, { status: 'correct' }, { now: at + 2 * DAY });
  state = outcome(state, qs[1], at + 3 * DAY, 'fourth', 'revealed');
  state = recordOutcome(state, { ...createQuestionInstance(qs[1], { id: 'second' }), tries: 1 }, { status: 'revealed' }, { now: at + DAY + 1 });
  assert.deepEqual(learningStatistics(state, qs).types[0], { type: 'fill', attempts: 4, correct: 0, hinted: 2, revealed: 2, repeatedErrors: 1 });
});

test('transfer questions add a new context for each selected use without inventing additional word coverage', () => {
  assert.equal(TRANSFER_QUESTIONS.length, 40);
  for (const type of ['collocation', 'formation', 'confusion', 'correction', 'phrase']) {
    for (const bank of ['cet4', 'cet6']) assert.equal(TRANSFER_QUESTIONS.filter(q => q.type === type && q.bank === bank).length, 4);
  }
  for (const q of TRANSFER_QUESTIONS) {
    const base = USAGE_QUESTIONS.find(original => original.id === q.variantGroup);
    assert.ok(base); assert.notEqual(q.stem, base.stem); assert.equal(q.senseId, base.senseId);
    for (const answer of q.accepts) assert.equal(gradeAnswer(q, answer).status, 'correct');
    if (q.options) assert.equal(q.options.filter(answer => gradeAnswer(q, answer).status === 'correct').length, 1);
    if (q.type === 'correction') { const bracket = q.stem.match(/\[([^\]]+)\]/g); assert.equal(bracket.length, 1); assert.equal(gradeAnswer(q, bracket[0].slice(1, -1)).status, 'incorrect'); }
    else assert.equal(q.stem.split('___').length, 2);
  }
});
