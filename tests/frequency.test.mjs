import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CET4_WORDS } from '../src/content/cet4-syllabus.js';
import { CET4_SYLLABUS_QUESTIONS } from '../src/content/cet4-syllabus-questions.js';
import { CET6_FOCUS_QUESTIONS, CET6_FOCUS_WORDS } from '../src/content/cet6-focus.js';
import { LEARNING_QUESTIONS } from '../src/content/learning-bank.js';
import { FREQUENCY_EVIDENCE, FREQUENCY_SOURCES } from '../src/content/frequency.js';
import { matchesBank, frequencySources } from '../src/engine/banks.js';
import { emptyLearning, validateLearning, gradeAnswer, selectQuestion, createQuestionInstance, recordOutcome } from '../src/engine/learning.js';
import { catalogOf, startRound, advanceRound, studyOverview } from '../src/engine/study.js';
import { drawQuestion } from '../src/engine/questions.js';
import { saveLearning, loadLearning, exportLearning, importLearning } from '../src/storage/learning.js';
import { createBackup, restoreBackup } from '../src/storage/backup.js';

const stateFor = (bank, frequency = 'all') => ({ ...emptyLearning(), plan: { ...emptyLearning().plan, bank, frequency } });
const high = LEARNING_QUESTIONS.find(q => q.id === 'dw-c6-focus-choice-allocate');
const low = LEARNING_QUESTIONS.find(q => q.id === 'dw-c6-meaning-abbreviation');
const read = name => JSON.parse(fs.readFileSync(new URL(`../content-sources/${name}`, import.meta.url), 'utf8'));
function storage() {
  const data = new Map();
  const db = { getItem: k => data.get(k) ?? null, setItem: (k,v) => data.set(k,String(v)), removeItem: k => data.delete(k), key: i => [...data.keys()][i], get length() { return data.size; } };
  globalThis.localStorage = db;
  return db;
}

test('CET4 covers every extracted unstarred primary row, with usable variants and unique question IDs', () => {
  assert.equal(CET4_WORDS.length, 4126);
  assert.equal(CET4_SYLLABUS_QUESTIONS.length, 8252);
  const rows = read('syllabus-primary-rows.json').filter(r => r.bank === 'cet4');
  assert.equal(rows.length, 4114);
  const references = new Set(CET4_WORDS.flatMap(w => w.syllabusForms.flatMap(form => w.pdfPages.map(page => `${form}|${page}`))));
  for (const row of rows) assert.ok(references.has(`${row.raw}|${row.pdfPage}`), row.raw);
  const words = new Map(CET4_WORDS.map(w => [w.word,w]));
  for (const word of ['according to','ought to','résumé','resume','center','centre','a','an','I','TV','zero']) assert.ok(words.has(word), word);
  assert.equal(words.get('stale').pos, 'adj.');
  assert.equal(words.get('weekday').meaning, '工作日；周一至周五的一天');
  assert.equal(words.get('china').meaning, '瓷器');
  assert.equal(new Set(LEARNING_QUESTIONS.map(q => q.id)).size, LEARNING_QUESTIONS.length);
  for (const q of CET4_SYLLABUS_QUESTIONS) {
    assert.ok(q.sourcePages.length);
    assert.match(q.hint, /[\u4e00-\u9fff]/);
    assert.ok(!/[\uE000-\uF8FF]|\[计\]|undefined|\r/.test(q.hint));
    for (const answer of q.accepts) assert.equal(gradeAnswer(q, answer).status, 'correct', q.id);
    if (q.options) {
      assert.equal(new Set(q.options).size, 4, q.id);
      for (const option of q.options.slice(1)) assert.equal(gradeAnswer(q, option).status, 'incorrect', q.id);
    }
  }
});

test('high frequency requires two traceable same-level channels; repeated pages do not increase votes', () => {
  const raw = read('frequency-sources.json');
  assert.equal(FREQUENCY_SOURCES.length, 4);
  for (const bank of ['cet4','cet6']) {
    const channels = raw.sources.filter(s => s.bank === bank);
    assert.equal(channels.length, 2);
    for (const [word, ids] of Object.entries(FREQUENCY_EVIDENCE[bank])) {
      assert.equal(new Set(ids).size, ids.length, word);
      for (const id of ids) assert.ok(channels.some(s => s.id === id), word);
    }
  }
  assert.equal(matchesBank(high, 'cet6', 'high'), true);
  assert.equal(matchesBank(low, 'cet6', 'high'), false);
  assert.equal(matchesBank(high, 'cet4', 'high'), false);
  assert.equal(matchesBank(high, 'mixed', 'high'), true);
  const report = read('frequency-comparison.json');
  for (const row of report.comparison.filter(r => r.high)) {
    assert.equal(row.sources.length, 2);
    for (const id of row.sources) assert.ok(row.references.some(ref => ref.source === id), row.word);
  }
});

test('focused CET6 exercises cover 64 shared words and all eleven question types', () => {
  assert.equal(CET6_FOCUS_WORDS.length, 64);
  assert.equal(CET6_FOCUS_QUESTIONS.length, 213);
  for (const word of CET6_FOCUS_WORDS) {
    const items = CET6_FOCUS_QUESTIONS.filter(q => q.targetWords[0] === word);
    assert.equal(items.filter(q => q.type === 'fill').length, 2, word);
    assert.ok(items.some(q => q.type === 'choice'));
  }
  for (const q of CET6_FOCUS_QUESTIONS) {
    assert.equal(frequencySources(q).length, 2, q.id);
    for (const answer of q.accepts) assert.equal(gradeAnswer(q, answer).status, q.grading === 'semantic' ? 'needs-model' : 'correct', q.id);
    if (q.options) {
      assert.equal(new Set(q.options).size, 4, q.id);
      for (const option of q.options.slice(1)) assert.equal(gradeAnswer(q, option).status, 'incorrect', q.id);
    }
  }
  assert.equal(new Set(LEARNING_QUESTIONS.filter(q => matchesBank(q,'cet6','high')).map(q => q.type)).size, 11);
});

test('all six bank/frequency combinations scope new rounds, drills, totals and exhausted chat draws', () => {
  for (const bank of ['cet4','cet6','mixed']) for (const frequency of ['all','high']) {
    const state = stateFor(bank,frequency);
    const pool = LEARNING_QUESTIONS.filter(q => matchesBank(q,bank,frequency));
    assert.equal(studyOverview(LEARNING_QUESTIONS,state).total, catalogOf(pool).length);
    for (const kind of ['new','drill']) {
      const round = startRound(LEARNING_QUESTIONS,state,{kind,count:30,rng:()=>0.3});
      assert.equal(round.round.frequency,frequency);
      assert.ok(round.round.items.every(item => matchesBank(item.question,bank,frequency)));
    }
    const session = { usedQuestionIds: pool.map(q => q.id) };
    for (const rng of [()=>0,()=>0.7,()=>0.999]) {
      assert.ok(matchesBank(drawQuestion({learning:state,session,rng}),bank,frequency));
      assert.ok(matchesBank(selectQuestion(LEARNING_QUESTIONS,state,{rng}),bank,frequency));
    }
  }
});

test('frequency switching preserves active snapshots and scopes mistakes, favorites and due reviews', () => {
  let state = stateFor('cet6');
  for (const [q,id] of [[high,'high'],[low,'low']]) {
    state = recordOutcome(state,createQuestionInstance(q,{id}),{status:'incorrect',answer:'wrong'},{now:1000});
  }
  state.favorites = [high.targetWords[0],low.targetWords[0]];
  state.plan.frequency = 'high';
  assert.equal(studyOverview(LEARNING_QUESTIONS,state,2000).seen,1);
  for (const kind of ['errors','favorites','mistakes','review']) {
    const next = startRound(LEARNING_QUESTIONS,state,{kind,now:100000000});
    assert.ok(next.round.items.every(item => matchesBank(item.question,'cet6','high')),kind);
  }
  state = startRound(LEARNING_QUESTIONS,state,{kind:'drill'});
  const snapshot = JSON.stringify(state.round);
  state.plan = {...state.plan,bank:'cet4',frequency:'all'};
  assert.equal(JSON.stringify(validateLearning(state).round),snapshot);
  state = advanceRound(state,{end:true});
  assert.equal(state.favorites.length,2);
  assert.equal(state.events.filter(e=>e.status==='incorrect').length,2);
});

test('old records default to all; frequency persists and backup settings remain opt-in', () => {
  const old = emptyLearning(); delete old.plan.frequency;
  assert.equal(validateLearning(old).plan.frequency,'all');
  assert.throws(()=>validateLearning({...old,plan:{...old.plan,frequency:'invalid'}}),/词频/);
  const source = storage(), dest = storage();
  let state = recordOutcome(stateFor('cet6','high'),createQuestionInstance(high,{id:'frequency-export'}),{status:'correct'},{now:1000});
  saveLearning(state,null,source);
  assert.equal(loadLearning(source).state.plan.frequency,'high');
  const backup = createBackup(source);
  const exported = exportLearning(state);
  importLearning(exported,dest); importLearning(exported,dest);
  assert.equal(loadLearning(dest).state.events.length,1);
  assert.equal(loadLearning(dest).state.plan.frequency,'all');
  restoreBackup(backup,{storage:dest});
  assert.equal(loadLearning(dest).state.plan.frequency,'all');
  restoreBackup(backup,{storage:dest,includeSettings:true});
  assert.equal(loadLearning(dest).state.plan.frequency,'high');
  assert.equal(loadLearning(dest).state.plan.bank,'cet6');
});
