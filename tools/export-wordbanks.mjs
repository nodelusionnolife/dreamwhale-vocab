import fs from 'node:fs';
import path from 'node:path';
import { CET4_WORDS, CET4_SOURCE } from '../src/content/cet4-syllabus.js';
import { CET6_WORDS, CET6_SOURCE, CET6_DICTIONARY_LICENSE } from '../src/content/cet6-words.js';
import { LEARNING_QUESTIONS, PAIRED_QUESTIONS, QUESTION_TYPES, TOPICS } from '../src/content/learning-bank.js';
import { FREQUENCY_RULE, FREQUENCY_SOURCES } from '../src/content/frequency.js';
import { BANKS, FREQUENCIES, matchesBank, questionBank, frequencySources } from '../src/engine/banks.js';
import { catalogOf } from '../src/engine/study.js';
import { HIGH_FREQUENCY_QUESTIONS } from '../src/content/high-frequency-questions.js';
import { COVERAGE_QUESTIONS } from '../src/content/high-frequency-coverage.js';
import { SPECIALTY_QUESTIONS } from '../src/content/high-frequency-specialties.js';
import { EXTENSION_QUESTIONS } from '../src/content/high-frequency-extension.js';
import { USAGE_QUESTIONS } from '../src/content/high-frequency-usage.js';
import { TRANSFER_QUESTIONS } from '../src/content/high-frequency-transfer.js';

if (!process.argv[2]) throw new Error('Usage: node tools/export-wordbanks.mjs <output-directory>');
const directory = path.resolve(process.argv[2]);
fs.mkdirSync(directory, { recursive: true });
const comparison = JSON.parse(fs.readFileSync(new URL('../content-sources/frequency-comparison.json', import.meta.url), 'utf8'));
const sourceNames = ids => ids.map(id => FREQUENCY_SOURCES.find(s => s.id === id).title).join(' / ');
const sourceUrls = ids => ids.map(id => FREQUENCY_SOURCES.find(s => s.id === id).url).join(' | ');
const csv = (name, rows) => fs.writeFileSync(path.join(directory, name), '\uFEFF' + rows.map(row => row.map(v => `"${String(v).replaceAll('"', '""')}"`).join(',')).join('\r\n') + '\r\n');
const json = (name, data) => fs.writeFileSync(path.join(directory, name), JSON.stringify(data, null, 2) + '\n');
const appVersion = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
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
  kind: 'dreamwhale-question-content', version: 1, appVersion,
  sources: { cet4: CET4_SOURCE, cet6: CET6_SOURCE, frequency: FREQUENCY_SOURCES },
  frequencyRule: FREQUENCY_RULE, dictionaryLicense: CET6_DICTIONARY_LICENSE, stats,
  questions: LEARNING_QUESTIONS.map(q => ({ ...q, bank: questionBank(q), highFrequency: frequencySources(q).length >= 2, frequencySourceIds: frequencySources(q) })),
});
json('content-stats.json', { stats, types: Object.fromEntries(Object.entries(QUESTION_TYPES).map(([id, label]) => [id, { label, count: LEARNING_QUESTIONS.filter(q => q.type === id).length }])) });
const authoredIds = new Set([...HIGH_FREQUENCY_QUESTIONS, ...COVERAGE_QUESTIONS, ...SPECIALTY_QUESTIONS, ...EXTENSION_QUESTIONS, ...USAGE_QUESTIONS, ...TRANSFER_QUESTIONS, ...PAIRED_QUESTIONS].map(q => q.id));
const authored = LEARNING_QUESTIONS.filter(q => authoredIds.has(q.id));
json('high-frequency-exercises.json', { kind: 'dreamwhale-question-content', version: 1, appVersion, questions: authored });
const exerciseHeader = ['题号', '级别', '题型', '目标词', '难度', '难度依据', '义项', '题干', '参考答案', '接受答案', '选项', '讲解', '朗读文本', '评分要求', '主题'];
const exerciseRow = q => [q.id, BANKS[q.bank], QUESTION_TYPES[q.type], q.targetWords.join(' / '), q.difficulty, q.difficultyBasis, q.senseId, q.stem, q.answer, q.accepts.join(' / '), (q.options || []).join(' / '), q.explanation, q.audioText || '', q.rubric || '', TOPICS[q.topic]];
csv('high-frequency-exercises.csv', [exerciseHeader, ...authored.map(exerciseRow)]);
for (const [name, source] of [['added-high-frequency-exercises', 'project-original-pairs-2026']]) {
  const questions = authored.filter(q => q.source === source);
  json(`${name}.json`, { kind: 'dreamwhale-question-content', version: 1, appVersion, questions });
  csv(`${name}.csv`, [exerciseHeader, ...questions.map(exerciseRow)]);
}
json('high-frequency-coverage.json', Object.fromEntries(['cet4', 'cet6', 'mixed'].map(bank => {
  const pool = LEARNING_QUESTIONS.filter(q => matchesBank(q, bank, 'high'));
  const totalWords = catalogOf(pool).length;
  return [bank, Object.fromEntries(Object.keys(QUESTION_TYPES).map(type => {
    const items = pool.filter(q => q.type === type);
    const words = catalogOf(items).length;
    return [type, { label: QUESTION_TYPES[type], questions: items.length, words, totalWords, coveragePercent: Number((100 * words / totalWords).toFixed(1)), authored: authored.filter(q => matchesBank(q, bank, 'high') && q.type === type).length, basic: items.filter(q => q.difficulty === 'basic').length, advanced: items.filter(q => q.difficulty === 'advanced').length }];
  }))];
})));
const specialtyTypes = ['collocation', 'formation', 'confusion', 'correction', 'phrase', 'reading', 'writing'];
const wordCoverage = ['cet4', 'cet6'].flatMap(bank => catalogOf(LEARNING_QUESTIONS.filter(q => matchesBank(q, bank, 'high'))).map(entry => {
  const counts = Object.fromEntries(Object.keys(QUESTION_TYPES).map(type => [type, entry.questions.filter(q => q.type === type).length]));
  const distinct = Object.fromEntries(Object.keys(QUESTION_TYPES).map(type => [type, new Set(entry.questions.filter(q => q.type === type)
    .map(q => (q.type === 'listening' ? q.audioText : q.stem.replace(/_{3,}/g, '___')).toLowerCase().replace(/\s+/g, ' ').trim())).size]));
  return { bank, word: entry.word, questionsByType: counts, distinctQuestionsByType: distinct,
    belowMinimumTypes: Object.keys(QUESTION_TYPES).filter(type => counts[type] && distinct[type] < 2),
    coveredSpecialties: specialtyTypes.filter(type => counts[type]), missingSpecialties: specialtyTypes.filter(type => !counts[type]) };
}));
json('high-frequency-word-coverage.json', { appVersion, words: wordCoverage });
csv('high-frequency-word-coverage.csv', [['级别', '目标词', ...Object.values(QUESTION_TYPES), '已有专项', '尚缺专项', '已有题型不足两道不同题目'], ...wordCoverage.map(entry =>
  [BANKS[entry.bank], entry.word, ...Object.keys(QUESTION_TYPES).map(type => entry.questionsByType[type]), entry.coveredSpecialties.map(type => QUESTION_TYPES[type]).join(' / '), entry.missingSpecialties.map(type => QUESTION_TYPES[type]).join(' / '), entry.belowMinimumTypes.map(type => QUESTION_TYPES[type]).join(' / ')])]);
const pairedCoverage = wordCoverage.flatMap(entry => Object.keys(QUESTION_TYPES).filter(type => entry.questionsByType[type]).map(type => ({ bank: entry.bank, word: entry.word, type, questions: entry.questionsByType[type], distinctQuestions: entry.distinctQuestionsByType[type] })));
json('high-frequency-minimum-audit.json', { appVersion, minimum: 2, scope: 'existing bank/word/type combinations', wordEntries: wordCoverage.length,
  coveredCombinations: pairedCoverage.length, missingTypeCombinations: wordCoverage.length * Object.keys(QUESTION_TYPES).length - pairedCoverage.length,
  belowMinimum: pairedCoverage.filter(entry => entry.distinctQuestions < 2), addedQuestions: PAIRED_QUESTIONS.length,
  additionsByType: Object.fromEntries(Object.keys(QUESTION_TYPES).map(type => [type, PAIRED_QUESTIONS.filter(q => q.type === type).length])) });
fs.copyFileSync(new URL('../content-sources/high-frequency-exercises.md', import.meta.url), path.join(directory, 'high-frequency-exercises.md'));
fs.writeFileSync(path.join(directory, 'ECDICT-LICENSE.txt'), CET6_DICTIONARY_LICENSE);
console.log(JSON.stringify(stats, null, 2));
