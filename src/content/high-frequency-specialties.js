import { CET4_SPECIALTIES } from './high-frequency-specialties-cet4.js';
import { CET6_SPECIALTIES } from './high-frequency-specialties-cet6.js';
import { CET4_WORDS } from './cet4-syllabus.js';
import { CET6_WORDS } from './cet6-words.js';
import { frequencySources } from '../engine/banks.js';

const dictionaries = { cet4: new Map(CET4_WORDS.map(w => [w.word, w])), cet6: new Map(CET6_WORDS.map(w => [w.word, w])) };
const skills = { collocation: 'usage', formation: 'formation', confusion: 'recognition', correction: 'usage', phrase: 'usage', reading: 'reading', writing: 'production' };
const hints = { collocation: '检查空格前后的搭配关系。', formation: '注意题目指定的词性、数量和肯定或否定含义。', confusion: '结合语境比较词义和用法。', correction: '只替换方括号中的部分。', phrase: '按指定词和词数补全短语。', reading: '根据短文判断，不扩大证据支持的范围。', writing: '保留情境中的对象、条件和限制，检查目标词的用法。' };

export const SPECIALTY_QUESTIONS = Object.entries({ cet4: CET4_SPECIALTIES, cet6: CET6_SPECIALTIES }).flatMap(([bank, text]) => text.split('\n').map(line => {
  const fields = line.split('|');
  if (fields.length !== 9) throw new Error(`Invalid specialty row: ${line}`);
  const [type, difficulty, word, sense, topic, stem, answers, wrong, explanation] = fields;
  const entry = dictionaries[bank].get(word);
  if (frequencySources({ bank, targetWords: [word] }).length < 2) throw new Error(`Missing specialty source: ${bank}/${word}`);
  if (!skills[type] || !['basic', 'advanced'].includes(difficulty)) throw new Error(`Invalid specialty category: ${line}`);
  const id = `dw-c${bank.slice(-1)}-specialty-${type}-${word}`;
  const accepts = answers.split('~');
  return { id, version: 1, bank, type, difficulty, difficultyBasis: explanation, topic, skill: skills[type],
    targetWords: [word], senseId: `${word}:specialty:${sense}`, variantGroup: id,
    stem, answer: accepts[0], accepts, hint: hints[type], explanation, grading: type === 'writing' ? 'semantic' : 'exact',
    source: 'project-original-specialties-2026', sourcePages: entry?.pdfPages || [],
    ...(wrong ? { options: [accepts[0], ...wrong.split(';')] } : {}),
    ...(type === 'writing' ? { rubric: `正确使用 ${word}（允许符合语境的屈折变化）。${explanation}语句通顺，接受符合要求的不同表达，参考句不是唯一答案。` } : {}),
  };
}));
