import { CET6_WORDS } from './cet6-words.js';
import { CET6_CONTEXTS, CET6_TASKS } from './cet6-contexts.js';

const contexts = new Map(CET6_CONTEXTS.map(w => [w.word, w]));
const byWord = new Map(CET6_WORDS.map(w => [w.word, w]));
const slug = word => word.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const sense = word => `${word}:cet6-syllabus`;
const gloss = w => `${w.pos} ${w.meaning}`;
const chinesePairs = text => new Set(text.match(/[\u4e00-\u9fff]{2,}/g)?.flatMap(part => [...part].slice(1).map((_, i) => part.slice(i, i + 2))) || []);
const signatures = new Map(CET6_WORDS.map(w => [w.word, chinesePairs(w.meaning)]));

function distractors(w, index) {
  if (w.word === 'trillion') return ['十亿', '一百万', '一千'];
  const samePart = CET6_WORDS.filter(other => other.pos === w.pos);
  const candidates = samePart.length >= 4 ? samePart : CET6_WORDS;
  const result = [];
  for (let i = 0; i < candidates.length && result.length < 3; i++) {
    const other = candidates[(index * 53 + i) % candidates.length];
    if (other.word === w.word || other.accepts.some(form => w.accepts.includes(form))
      || [...signatures.get(other.word)].some(pair => signatures.get(w.word).has(pair))
      || result.includes(other.meaning)) continue;
    result.push(other.meaning);
  }
  if (result.length !== 3) throw new Error(`Missing distractors: ${w.word}`);
  return result;
}

const base = w => ({
  version: 1, bank: 'cet6', topic: contexts.get(w.word)?.topic || 'general', difficulty: 'advanced',
  targetWords: [w.word], senseId: sense(w.word), source: 'cet-syllabus-2016-project-exercise',
  sourcePages: w.pdfPages, grading: 'exact', hint: gloss(w),
  explanation: `${w.word}：${gloss(w)}。`,
});

const vocabulary = CET6_WORDS.flatMap((w, i) => [
  {
    ...base(w), id: `dw-c6-meaning-${slug(w.word)}`, variantGroup: `dw-c6-meaning-${slug(w.word)}`,
    type: 'meaning', skill: 'recognition', stem: `请选择 ${w.word}（${w.pos}）的含义。`,
    audioText: w.word, answer: w.meaning, accepts: [w.meaning], options: [w.meaning, ...distractors(w, i)],
  },
  {
    ...base(w), id: `dw-c6-listen-${slug(w.word)}`, variantGroup: `dw-c6-listen-${slug(w.word)}`,
    type: 'listening', skill: 'listening', stem: '听读音，写出你听到的单词。',
    audioText: w.word, answer: w.word, accepts: w.accepts,
  },
]);

const contextual = CET6_CONTEXTS.flatMap((entry, i) => {
  const w = byWord.get(entry.word);
  if (!w) throw new Error(`Context word is not in CET6: ${entry.word}`);
  return [
    ...entry.examples.map((stem, j) => ({
      ...base(w), id: `dw-c6-context-${slug(w.word)}-${j + 1}`, variantGroup: `dw-c6-context-${slug(w.word)}-${j + 1}`,
      type: 'fill', skill: 'recall', stem, answer: w.word, accepts: w.accepts,
      promptHint: `${entry.contextMeaning}；首字母 ${w.word[0]}，${w.word.length} 个字母`,
      hint: entry.contextMeaning, explanation: `${stem.replace('___', w.word)}\n${w.word} 在这里表示“${entry.contextMeaning}”。`,
    })),
    {
      ...base(w), id: `dw-c6-choice-${slug(w.word)}`, variantGroup: `dw-c6-context-${slug(w.word)}-1`,
      type: 'choice', skill: 'recognition', stem: entry.examples[0], answer: w.word, accepts: w.accepts,
      options: [w.word, ...[5, 13, 23].map(n => CET6_CONTEXTS[(i + n) % CET6_CONTEXTS.length].word)],
      explanation: `${entry.examples[0].replace('___', w.word)}\n${w.word} 在这里表示“${entry.contextMeaning}”。`,
    },
  ];
});

const tasks = CET6_TASKS.map(([type, word, topic, stem, answer, wrong, explanation], i) => {
  const w = byWord.get(word);
  if (!w) throw new Error(`Task word is not in CET6: ${word}`);
  return {
    ...base(w), id: `dw-c6-task-${i + 1}`, variantGroup: `dw-c6-task-${i + 1}`, type, topic, stem, answer, accepts: [answer],
    skill: type === 'writing' ? 'production' : type === 'formation' ? 'formation' : type === 'reading' ? 'recognition' : 'usage',
    explanation, ...(wrong ? { options: [answer, ...wrong] } : {}),
    ...(type === 'writing' ? { grading: 'semantic', rubric: '目标词使用正确；满足题干表达要求；句意清楚。可接受不同于参考答案的合理句子。' } : {}),
  };
});

export const CET6_QUESTIONS = [...vocabulary, ...contextual, ...tasks];
