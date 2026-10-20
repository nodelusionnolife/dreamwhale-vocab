import fs from 'node:fs';
const raw = JSON.parse(fs.readFileSync('content-sources/cet4-syllabus-entries.json', 'utf8'));
const overrides = new Map(fs.readFileSync('content-sources/cet4-overrides.txt', 'utf8').trim().split(/\r?\n/).map(line => line.split('|')));
const words = raw.map(entry => {
  const word = ({ accordingto: 'according to', oughtto: 'ought to' })[entry.word] || entry.word;
  const line = overrides.get(word) || entry.dictionaryTranslation.split('\n')[0];
  const match = /^((?:[a-z]+\.)+)\s+(.+)$/i.exec(line);
  if (!match) throw new Error(`Missing meaning: ${word} ${line}`);
  const pos = match[1].replace(/^a\.$/, 'adj.').replace(/^vt\.vi\.$/, 'v.');
  const meaning = match[2].replace(/\r/g, '').split(/[,，;；]\s*/).slice(0, 3).join('；').trim();
  return { word, pos, meaning, accepts: word === 'résumé' ? ['résumé', 'resume'] : [word], pdfPages: entry.pdfPages, syllabusForms: entry.syllabusForms };
});
const source = {
  title: '全国大学英语四、六级考试大纲（2016年修订版）· 四级',
  url: 'https://cet.neea.edu.cn/res/Home/1704/55b02330ac17274664f06d9d3db8249d.pdf',
  primaryRows: 4114, uniqueSpellings: words.length, retrievedAt: '2026-10-20',
  coverage: '未标★的主词条；并列拼法与缩略语分列，同形词合并。派生词栏未另行展开。',
};
fs.writeFileSync('src/content/cet4-syllabus.js', `export const CET4_SOURCE = ${JSON.stringify(source, null, 2)};\nexport const CET4_WORDS = [\n${words.map(w => `  ${JSON.stringify(w)},`).join('\n')}\n];\n`);
console.log(`CET4: ${words.length} words`);
