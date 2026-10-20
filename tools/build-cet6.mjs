import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const raw = JSON.parse(read('content-sources/cet6-entries.json'));
const overrides = new Map(read('content-sources/cet6-overrides.txt').trim().split(/\r?\n/).map(line => line.split('|')));
const source = {
  title: '全国大学英语四、六级考试大纲（2016年修订版）',
  publisher: '中国教育考试网',
  url: 'https://cet.neea.edu.cn/res/Home/1704/55b02330ac17274664f06d9d3db8249d.pdf',
  indexUrl: 'https://cet.neea.edu.cn/xhtml1/folder/16113/1588-1.htm',
  retrievedAt: '2026-10-20',
  pdfSha256: '9166d3c03b7bc43abd9d9df91bd2ef8085b4419286f1e5ca100dea68f3cfd1f1',
  starredRows: 1263,
  uniqueHeadwords: 1262,
  dictionary: 'https://github.com/skywind3000/ECDICT',
  dictionarySha256: '1a6947e04785db63613a92e14903cdae7954f7e84860b10e68e5c7cbb3f9c3cf',
};
const words = raw.map(entry => {
  const line = overrides.get(entry.word) || entry.dictionaryTranslation?.split('\n')[0];
  if (!line) throw new Error(`Missing meaning: ${entry.word}`);
  const match = /^((?:[a-z]+\.)+)\s+(.+)$/i.exec(line);
  if (!match) throw new Error(`Invalid meaning: ${entry.word} ${line}`);
  const pos = match[1].replace(/^a\.$/, 'adj.').replace(/^vt\.vi\.$/, 'v.');
  const meaning = match[2].split(/[,，;；]\s*/).slice(0, 3).join('；');
  return { word: entry.word, pos, meaning, accepts: entry.word === 'steward' ? ['steward'] : entry.word === 'cliché' ? ['cliché', 'cliche'] : entry.accepts,
    pdfPages: entry.pdfPages, syllabusForms: entry.syllabusForms };
});
if (words.length !== source.uniqueHeadwords || new Set(words.map(w => w.word)).size !== words.length) throw new Error('CET6 coverage changed');
for (const key of overrides.keys()) if (!words.some(w => w.word === key)) throw new Error(`Unused correction: ${key}`);
const license = read('content-sources/ECDICT-LICENSE.txt');
const output = `export const CET6_SOURCE = ${JSON.stringify(source, null, 2)};\nexport const CET6_DICTIONARY_LICENSE = ${JSON.stringify(license)};\nexport const CET6_WORDS = [\n${words.map(w => `  ${JSON.stringify(w)},`).join('\n')}\n];\n`;
fs.writeFileSync(path.join(root, 'src/content/cet6-words.js'), output);
console.log(`CET6: ${words.length} headwords, ${overrides.size} meaning corrections`);
