import fs from 'node:fs';
import path from 'node:path';
import { CET6_WORDS, CET6_SOURCE, CET6_DICTIONARY_LICENSE } from '../src/content/cet6-words.js';
import { CET6_QUESTIONS } from '../src/content/cet6-questions.js';

if (!process.argv[2]) throw new Error('Usage: node tools/export-cet6.mjs <output-directory>');
const directory = path.resolve(process.argv[2]);
fs.mkdirSync(directory, { recursive: true });
const quote = value => `"${String(value).replaceAll('"', '""')}"`;
const rows = [['单词', '词性', '释义', '可接受拼法', '大纲书内页码', '来源'], ...CET6_WORDS.map(word => [
  word.word, word.pos, word.meaning, word.accepts.join(' / '), word.pdfPages.map(page => page - 5).join(' / '),
  `${CET6_SOURCE.url}#page=${word.pdfPages[0]}`,
])];
fs.writeFileSync(path.join(directory, 'cet6-vocabulary.csv'), '\uFEFF' + rows.map(row => row.map(quote).join(',')).join('\r\n') + '\r\n');
fs.writeFileSync(path.join(directory, 'cet6-question-bank.json'), JSON.stringify({
  kind: 'dreamwhale-cet6-content', version: 1, source: CET6_SOURCE,
  dictionaryLicense: CET6_DICTIONARY_LICENSE, questions: CET6_QUESTIONS,
}, null, 2) + '\n');
fs.writeFileSync(path.join(directory, 'ECDICT-LICENSE.txt'), CET6_DICTIONARY_LICENSE);
console.log(`Exported ${CET6_WORDS.length} words and ${CET6_QUESTIONS.length} new questions`);
