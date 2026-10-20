import fs from 'node:fs';
import path from 'node:path';
import { CET4_WORDS, CET4_SOURCE } from '../src/content/cet4-syllabus.js';
import { CET6_WORDS, CET6_SOURCE, CET6_DICTIONARY_LICENSE } from '../src/content/cet6-words.js';
import { LEARNING_QUESTIONS, QUESTION_TYPES } from '../src/content/learning-bank.js';
import { FREQUENCY_RULE, FREQUENCY_SOURCES } from '../src/content/frequency.js';
import { BANKS, FREQUENCIES, matchesBank, questionBank, frequencySources } from '../src/engine/banks.js';
import { catalogOf } from '../src/engine/study.js';

if (!process.argv[2]) throw new Error('Usage: node tools/export-wordbanks.mjs <output-directory>');
const directory = path.resolve(process.argv[2]);
fs.mkdirSync(directory, { recursive: true });
const comparison = JSON.parse(fs.readFileSync(new URL('../content-sources/frequency-comparison.json', import.meta.url), 'utf8'));
const sourceNames = ids => ids.map(id => FREQUENCY_SOURCES.find(s => s.id === id).title).join(' / ');
const sourceUrls = ids => ids.map(id => FREQUENCY_SOURCES.find(s => s.id === id).url).join(' | ');
const csv = (name, rows) => fs.writeFileSync(path.join(directory, name), '\uFEFF' + rows.map(row => row.map(v => `"${String(v).replaceAll('"', '""')}"`).join(',')).join('\r\n') + '\r\n');
const json = (name, data) => fs.writeFileSync(path.join(directory, name), JSON.stringify(data, null, 2) + '\n');
for (const [bank, words, source] of [['cet4', CET4_WORDS, CET4_SOURCE], ['cet6', CET6_WORDS, CET6_SOURCE]]) {
  const evidence = new Map(comparison.comparison.filter(e => e.bank === bank).map(e => [e.word, e]));
  csv(`${bank}-vocabulary.csv`, [['单词', '词性', '释义', '接受拼法', '高频', '命中渠道数', '渠道', '渠道链接', '大纲PDF页码', '大纲链接'], ...words.map(w => {
    const e = evidence.get(w.word);
    return [w.word, w.pos, w.meaning, w.accepts.join(' / '), e.high ? '是' : '否', e.sources.length, sourceNames(e.sources), sourceUrls(e.sources), w.pdfPages.join(' / '), `${source.url}#page=${w.pdfPages[0]}`];
  })]);
}
const stats = [];
const rows = [['级别', '目标词或表达', '高频', '命中渠道数', '渠道', '渠道链接', '题目数']];
for (const [bank, label] of Object.entries(BANKS)) {
  for (const [frequency, range] of Object.entries(FREQUENCIES)) {
    const questions = LEARNING_QUESTIONS.filter(q => matchesBank(q, bank, frequency));
    stats.push({ bank, label, frequency, range, words: catalogOf(questions).length, questions: questions.length });
  }
  if (bank === 'mixed') continue;
  const questions = LEARNING_QUESTIONS.filter(q => matchesBank(q, bank));
  for (const entry of catalogOf(questions)) {
    const ids = frequencySources(entry.questions[0]);
    rows.push([label, entry.word, ids.length >= 2 ? '是' : '否', ids.length, sourceNames(ids), sourceUrls(ids), entry.questions.length]);
  }
}
csv('frequency-comparison.csv', rows);
json('frequency-evidence.json', comparison);
fs.copyFileSync(new URL('../content-sources/frequency-sources.json', import.meta.url), path.join(directory, 'frequency-sources.json'));
json('question-bank.json', {
  kind: 'dreamwhale-question-content', version: 1, appVersion: '0.6.0',
  sources: { cet4: CET4_SOURCE, cet6: CET6_SOURCE, frequency: FREQUENCY_SOURCES },
  frequencyRule: FREQUENCY_RULE, dictionaryLicense: CET6_DICTIONARY_LICENSE, stats,
  questions: LEARNING_QUESTIONS.map(q => ({ ...q, bank: questionBank(q), highFrequency: frequencySources(q).length >= 2, frequencySourceIds: frequencySources(q) })),
});
json('content-stats.json', { stats, types: Object.fromEntries(Object.entries(QUESTION_TYPES).map(([id, label]) => [id, { label, count: LEARNING_QUESTIONS.filter(q => q.type === id).length }])) });
fs.writeFileSync(path.join(directory, 'ECDICT-LICENSE.txt'), CET6_DICTIONARY_LICENSE);
console.log(JSON.stringify(stats, null, 2));
