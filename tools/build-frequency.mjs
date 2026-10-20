import fs from 'node:fs';
import { CET4_WORDS } from '../src/content/cet4-syllabus.js';
import { CET6_WORDS } from '../src/content/cet6-words.js';

const data = JSON.parse(fs.readFileSync('content-sources/frequency-sources.json', 'utf8'));
const sources = data.sources.map(({ entries, documents, ...source }) => ({ ...source, entries: new Set(entries.map(e => e.word)).size, documents: documents.length }));
const evidence = { cet4: {}, cet6: {} };
const comparison = [];
for (const bank of ['cet4', 'cet6']) {
  const channels = data.sources.filter(s => s.bank === bank);
  for (const channel of channels) for (const entry of channel.entries) {
    const ids = evidence[bank][entry.word] ||= [];
    if (!ids.includes(channel.id)) ids.push(channel.id);
  }
  for (const entry of bank === 'cet4' ? CET4_WORDS : CET6_WORDS) {
    const ids = [...new Set(entry.accepts.flatMap(form => evidence[bank][form.toLowerCase()] || []))];
    for (const form of entry.accepts) if (ids.length) evidence[bank][form.toLowerCase()] = ids;
    comparison.push({ bank, word: entry.word, high: ids.length >= 2, sources: ids, references: channels.flatMap(c => c.entries.filter(e => entry.accepts.map(f => f.toLowerCase()).includes(e.word)).map(e => ({ source: c.id, ...e }))) });
  }
}
const report = { retrievedAt: '2026-10-20', rule: data.rule, sources, comparison };
fs.writeFileSync('content-sources/frequency-comparison.json', JSON.stringify(report, null, 2) + '\n');
fs.writeFileSync('src/content/frequency.js', `export const FREQUENCY_RULE = ${JSON.stringify(data.rule)};\nexport const FREQUENCY_SOURCES = ${JSON.stringify(sources, null, 2)};\nexport const FREQUENCY_EVIDENCE = ${JSON.stringify(evidence)};\n`);
console.log(JSON.stringify(Object.fromEntries(['cet4','cet6'].map(bank => [bank, comparison.filter(e => e.bank === bank && e.high).length]))));
