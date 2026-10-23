import { EXTENSION_WRITING } from './high-frequency-extension-writing.js';
import { EXTENSION_READING } from './high-frequency-extension-reading.js';
import { EXTENSION_USAGE } from './high-frequency-extension-usage.js';
import { CET4_WORDS } from './cet4-syllabus.js';
import { CET6_WORDS } from './cet6-words.js';
import { frequencySources } from '../engine/banks.js';

const dictionaries = { cet4: new Map(CET4_WORDS.map(w => [w.word, w])), cet6: new Map(CET6_WORDS.map(w => [w.word, w])) };
const skills = { writing: 'production', reading: 'reading', collocation: 'usage', formation: 'formation', confusion: 'recognition', correction: 'usage', phrase: 'usage' };
function base(bank, type, word, difficulty, basis, topic = 'general') {
  if (!skills[type] || !['basic', 'advanced'].includes(difficulty) || frequencySources({ bank, targetWords: [word] }).length < 2) throw new Error(`Invalid extension: ${bank}/${type}/${word}`);
  const id = `dw-c${bank.slice(-1)}-extension-${type}-${word}`;
  return { id, version: 1, bank, type, targetWords: [word], topic, skill: skills[type],
    senseId: `${word}:extension:${type}`, difficulty, difficultyBasis: basis, variantGroup: id,
    grading: type === 'writing' ? 'semantic' : 'exact', source: 'project-original-extension-2026', sourcePages: dictionaries[bank].get(word)?.pdfPages || [] };
}
function rows(data, width, build) {
  return Object.entries(data).flatMap(([bank, text]) => text.split('\n').map(line => {
    const fields = line.split('|');
    if (fields.length !== width || fields.some((field, i) => !field && !(width === 9 && i === 7))) throw new Error(`Invalid extension row: ${bank}/${line}`);
    return build(bank, fields);
  }));
}
const writing = rows(EXTENSION_WRITING, 4, (bank, [word, difficulty, task, answer]) => {
  const requirement = `正确使用 ${word}（允许符合语境的屈折变化和英美拼法）；${task}保留要求中的对象、条件、否定、比较和可能性，不添加相反结论；接受语句通顺且满足要求的不同表达。`;
  return { ...base(bank, 'writing', word, difficulty, difficulty === 'advanced' ? `结合限定关系完成表达：${task}` : `根据明确情境完成表达：${task}`),
    stem: `用 ${word} 写一到两句英文，${task}`, answer, accepts: [answer], rubric: requirement,
    explanation: `表达要点：${task}\n参考句：${answer}\n参考句不是唯一答案，可以使用符合情境的其他表达。`, hint: '先列出情境要求，再检查目标词及句子之间的关系。' };
});
const reading = rows(EXTENSION_READING, 5, (bank, [word, difficulty, stem, choices, explanation]) => {
  const options = choices.split('~');
  if (options.length !== 4) throw new Error(`Invalid reading choices: ${bank}/${word}`);
  return { ...base(bank, 'reading', word, difficulty, explanation), stem, answer: options[0], accepts: [options[0]], options, explanation,
    hint: '先找短文中的依据，注意范围、时间、否定与不确定性。' };
});
const usage = rows(EXTENSION_USAGE, 9, (bank, [type, difficulty, word, sense, topic, stem, answers, wrong, explanation]) => {
  const accepts = answers.split('~');
  return { ...base(bank, type, word, difficulty, explanation, topic), senseId: `${word}:extension:${sense}`, stem, answer: accepts[0], accepts, explanation,
    hint: '按题目指定的词、词形或修改范围作答，留意相邻词的搭配。', ...(wrong ? { options: [accepts[0], ...wrong.split(';')] } : {}) };
});
export const EXTENSION_QUESTIONS = [...writing, ...reading, ...usage];
