import { USAGE_COLLOCATION } from './high-frequency-usage-collocation.js';
import { USAGE_FORMATION } from './high-frequency-usage-formation.js';
import { USAGE_CONFUSION } from './high-frequency-usage-confusion.js';
import { USAGE_CORRECTION } from './high-frequency-usage-correction.js';
import { USAGE_PHRASE } from './high-frequency-usage-phrase.js';
import { CET4_WORDS } from './cet4-syllabus.js';
import { CET6_WORDS } from './cet6-words.js';
import { frequencySources } from '../engine/banks.js';

const dictionaries = { cet4: new Map(CET4_WORDS.map(w => [w.word, w])), cet6: new Map(CET6_WORDS.map(w => [w.word, w])) };
const skills = { collocation: 'usage', formation: 'formation', confusion: 'recognition', correction: 'usage', phrase: 'usage' };
const topics = new Set(['general', 'education', 'career', 'technology', 'environment', 'health', 'travel', 'community', 'consumer', 'research']);
const hints = { collocation: '比较相邻词的搭配及动作方向。', formation: '按指定词形作答，检查词尾、双写和否定前缀。', confusion: '比较近形词的词义、词性和搭配，并核对语境线索。', correction: '只替换方括号中的部分，保持句子其他部分不变。', phrase: '按指定含义、目标词和词数补全短语。' };

export const USAGE_QUESTIONS = Object.entries({ collocation: USAGE_COLLOCATION, formation: USAGE_FORMATION, confusion: USAGE_CONFUSION, correction: USAGE_CORRECTION, phrase: USAGE_PHRASE }).flatMap(([type, text]) => text.split('\n').map(line => {
  const fields = line.split('|');
  if (fields.length !== 9 || fields.some((value, i) => !value && i !== 6)) throw new Error(`Invalid usage row: ${line}`);
  const [bank, difficulty, word, sense, stem, answers, wrong, explanation, topic] = fields;
  if (!topics.has(topic)) throw new Error(`Invalid usage topic: ${line}`);
  const entry = dictionaries[bank]?.get(word);
  if (!dictionaries[bank] || !['basic', 'advanced'].includes(difficulty) || frequencySources({ bank, targetWords: [word] }).length < 2) throw new Error(`Invalid usage target: ${bank}/${word}`);
  const accepts = answers.split('~');
  const options = wrong ? [accepts[0], ...wrong.split(';')] : undefined;
  if (options && (options.length !== 4 || new Set(options).size !== 4)) throw new Error(`Invalid usage options: ${bank}/${type}/${word}`);
  const id = `dw-c${bank.slice(-1)}-usage-${type}-${word}`;
  return { id, version: 2, bank, type, difficulty, difficultyBasis: explanation, topic, skill: skills[type],
    targetWords: [word], senseId: `${word}:usage:${sense}`, variantGroup: id, stem, answer: accepts[0], accepts,
    ...(options ? { options } : {}), explanation, hint: hints[type], grading: 'exact',
    source: 'project-original-usage-2026', sourcePages: entry?.pdfPages || [] };
}));
