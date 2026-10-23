import { CET4_WORDS } from './cet4-syllabus.js';
import { CET6_WORDS } from './cet6-words.js';
import { frequencySources } from '../engine/banks.js';
import { HIGH_FREQUENCY_CONTEXTS } from './high-frequency-contexts.js';
import { CET4_HIGH_TASKS } from './high-frequency-cet4.js';
import { CET6_HIGH_TASKS } from './high-frequency-cet6.js';
import { questionMetadata } from './question-metadata.js';

const dictionaries = { cet4: new Map(CET4_WORDS.map(w => [w.word, w])), cet6: new Map(CET6_WORDS.map(w => [w.word, w])) };
const skills = { choice: 'recognition', fill: 'recall', collocation: 'usage', formation: 'formation', confusion: 'recognition',
  meaning: 'recognition', correction: 'usage', phrase: 'usage', reading: 'recognition', writing: 'production', listening: 'listening' };
const hints = { collocation: '把空格与相邻词组成搭配，再检查介词或动词。', formation: '根据题目要求改变词形，留意名词、副词和单复数。',
  confusion: '先判断词性，再比较相近拼写和不同用法。', correction: '只改标出的部分，注意介词和动词形式。', phrase: '按指定词和词数填写完整短语。',
  reading: '答案要有文中依据，不把局部信息扩大成绝对结论。', meaning: '结合当前句子确定这个词在此处的含义。', listening: '再听一次，留意音节和词尾。',
  writing: '使用目标词，检查搭配，并表达题目要求的情境。' };

function base(bank, type, word, topic) {
  const entry = dictionaries[bank].get(word);
  if (frequencySources({ bank, targetWords: [word] }).length < 2) throw new Error(`Missing high-frequency evidence: ${bank}/${word}`);
  return { version: 1, bank, type, topic, skill: skills[type], difficulty: 'basic',
    targetWords: [word], senseId: entry ? `${word}:${bank}-syllabus` : `${word}:core`, source: 'project-original-high-frequency-2026', sourcePages: entry?.pdfPages || [],
    grading: type === 'writing' ? 'semantic' : 'exact' };
}

const contextual = Object.entries(HIGH_FREQUENCY_CONTEXTS).flatMap(([bank, text]) => text.split('\n').flatMap(line => {
  const [word, topic, meaning, first, second, wrong, explanation] = line.split('|');
  const prefix = `dw-c${bank.slice(-1)}-high`;
  const accepts = dictionaries[bank].get(word)?.accepts || [word];
  return [
    { ...base(bank, 'choice', word, topic), id: `${prefix}-choice-${word}`, variantGroup: `${prefix}-choice-${word}`, stem: first,
      answer: word, accepts, options: [word, ...wrong.split(',')], hint: meaning, explanation: `${first.replace('___', word)}\n${explanation}` },
    { ...base(bank, 'fill', word, topic), id: `${prefix}-fill-${word}`, variantGroup: `${prefix}-fill-${word}`, stem: second,
      answer: word, accepts, promptHint: `${meaning}；首字母 ${word[0]}，${word.length} 个字母`, hint: meaning,
      explanation: `${second.replace('___', word)}\n${explanation}` },
  ];
}));

const tasks = Object.entries({ cet4: CET4_HIGH_TASKS, cet6: CET6_HIGH_TASKS }).flatMap(([bank, text]) => text.split('\n').map(line => {
  const [type, word, topic, stem, answers, wrong, explanation] = line.split('|');
  const accepts = answers.split('~');
  const answer = accepts[0];
  const id = `dw-c${bank.slice(-1)}-high-${type}-${word}`;
  return { ...base(bank, type, word, topic), id, variantGroup: id, stem, answer, accepts, explanation, hint: hints[type],
    ...(wrong ? { options: [answer, ...wrong.split(';')] } : {}),
    ...(type === 'writing' ? { rubric: `正确使用目标词 ${word}（允许符合语境的屈折变化）；完成题干要求的时间、对象、原因或具体例子；语句通顺。参考答案只是示例，接受语法正确且符合情境的不同表达。` } : {}),
    ...(type === 'listening' ? { audioText: stem.split('：').at(-1).replace('___', answer) } : {}),
  };
}));

export const HIGH_FREQUENCY_QUESTIONS = [...contextual, ...tasks].map(questionMetadata);
