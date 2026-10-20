import { CET4_WORDS } from './cet4-syllabus.js';

const slug = word => word === 'résumé' ? 'resume-cv' : word.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '');
const groups = new Map();
const signatures = new Map(CET4_WORDS.map(w => [w.word, new Set(w.meaning.match(/[\u4e00-\u9fff]/g) || [])]));
for (const w of CET4_WORDS) {
  if (!groups.has(w.pos)) groups.set(w.pos, []);
  groups.get(w.pos).push(w);
}
function distractors(w, index) {
  const pool = groups.get(w.pos).length >= 12 ? groups.get(w.pos) : CET4_WORDS;
  const result = [];
  for (let i = 0; i < pool.length && result.length < 3; i++) {
    const other = pool[(index * 37 + i) % pool.length];
    if (other.word === w.word || result.includes(other.meaning)
      || other.meaning.includes(w.meaning) || w.meaning.includes(other.meaning)
      || [...signatures.get(other.word)].filter(c => signatures.get(w.word).has(c)).length >= 2) continue;
    result.push(other.meaning);
  }
  if (result.length !== 3) throw new Error(`Missing CET4 distractors: ${w.word}`);
  return result;
}
export const CET4_SYLLABUS_QUESTIONS = CET4_WORDS.flatMap((w, i) => {
  const base = {
    version: 1, bank: 'cet4', topic: 'general', difficulty: 'basic', targetWords: [w.word],
    senseId: `${w.word}:cet4-syllabus`, source: 'cet-syllabus-2016-project-exercise', sourcePages: w.pdfPages,
    grading: 'exact', hint: `${w.pos} ${w.meaning}`, explanation: `${w.word}：${w.pos} ${w.meaning}。`,
  };
  return [
    { ...base, id: `dw-c4-meaning-${slug(w.word)}`, variantGroup: `dw-c4-meaning-${slug(w.word)}`,
      type: 'meaning', skill: 'recognition', stem: `请选择 ${w.word}（${w.pos}）的含义。`,
      audioText: w.word, answer: w.meaning, accepts: [w.meaning], options: [w.meaning, ...distractors(w, i)] },
    { ...base, id: `dw-c4-listen-${slug(w.word)}`, variantGroup: `dw-c4-listen-${slug(w.word)}`,
      type: 'listening', skill: 'listening', stem: '听读音，写出你听到的单词或表达。',
      audioText: w.word, answer: w.word, accepts: w.accepts },
  ];
});
