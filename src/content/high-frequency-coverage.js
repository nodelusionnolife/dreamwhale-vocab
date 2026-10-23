import { COVERAGE_CONTEXTS } from './high-frequency-coverage-data.js';
import { CET4_WORDS } from './cet4-syllabus.js';
import { CET6_WORDS } from './cet6-words.js';
import { frequencySources } from '../engine/banks.js';

const dictionaries = { cet4: new Map(CET4_WORDS.map(w => [w.word, w])), cet6: new Map(CET6_WORDS.map(w => [w.word, w])) };
const inferenceWords = new Set(['apparent', 'arbitrary', 'equivalent', 'exploit', 'notion', 'nevertheless', 'radical', 'render', 'ultimate', 'homogeneous', 'impetus', 'intuition', 'transcend', 'vicious', 'withhold']);
export const COVERAGE_QUESTIONS = Object.entries(COVERAGE_CONTEXTS).flatMap(([bank, text]) => text.split('\n').flatMap(line => {
  const [word, gloss, first, second] = line.split('|');
  const entry = dictionaries[bank].get(word);
  if (!entry || frequencySources({ bank, targetWords: [word] }).length < 2) throw new Error(`Missing source for ${bank}/${word}`);
  return [first, second].map((stem, index) => {
    if (stem.split('___').length !== 2) throw new Error(`Invalid context for ${word}`);
    const id = `dw-c${bank.slice(-1)}-coverage-${word.normalize('NFD').replace(/[\u0300-\u036f]/g, '')}-${index + 1}`;
    return { id, version: 1, bank, type: 'fill', skill: 'recall', topic: 'general',
      difficulty: inferenceWords.has(word) ? 'advanced' : 'basic', difficultyBasis: inferenceWords.has(word) ? '结合转折、抽象含义或搭配关系回忆目标词' : '利用明确情境和词形提示回忆目标词',
      stem, answer: word, accepts: entry.accepts, targetWords: [word], senseId: `${word}:context:${gloss}`,
      variantGroup: id, grading: 'exact', promptHint: `${gloss}；首字母 ${word[0]}，${word.length} 个字符`, hint: `结合句中的对象与动作，填写表示“${gloss}”的词。`,
      explanation: `${stem.replace('___', word)}\n${word} 在这里表示“${gloss}”。`,
      source: 'project-original-coverage-2026', sourcePages: entry.pdfPages };
  });
}));
