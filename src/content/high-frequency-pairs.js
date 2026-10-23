import { matchesBank, questionBank } from '../engine/banks.js';
import { PAIR_FORMATION } from './high-frequency-pairs-formation.js';
import { PAIR_COLLOCATION } from './high-frequency-pairs-collocation.js';
import { PAIR_CORRECTION } from './high-frequency-pairs-correction.js';
import { PAIR_PHRASE } from './high-frequency-pairs-phrase.js';
import { PAIR_SCENARIOS_CORE } from './high-frequency-pairs-scenarios-core.js';
import { PAIR_SCENARIOS_CET4A } from './high-frequency-pairs-scenarios-cet4a.js';
import { PAIR_SCENARIOS_CET4B } from './high-frequency-pairs-scenarios-cet4b.js';
import { PAIR_SCENARIOS_CET6A } from './high-frequency-pairs-scenarios-cet6a.js';
import { PAIR_SCENARIOS_CET6B } from './high-frequency-pairs-scenarios-cet6b.js';
import { PAIR_EXTRA_CONTEXTS, PAIR_CHOICE_OVERRIDES } from './high-frequency-pairs-contexts.js';
import { PAIR_CONTEXT_LINKS } from './high-frequency-pairs-links.js';

const rows = (text, width) => text.split('\n').map(line => {
  const fields = line.split('|');
  if (fields.length !== width) throw new Error(`Invalid paired exercise row: ${line}`);
  return fields;
});
const usage = new Map(Object.entries({ formation: PAIR_FORMATION, collocation: PAIR_COLLOCATION, correction: PAIR_CORRECTION, phrase: PAIR_PHRASE })
  .flatMap(([type, text]) => rows(text, 4).map(([level, word, topic, stem]) => [`cet${level}|${word}|${type}`, { topic, stem }])));
const scenarios = new Map([PAIR_SCENARIOS_CORE, PAIR_SCENARIOS_CET4A, PAIR_SCENARIOS_CET4B, PAIR_SCENARIOS_CET6A, PAIR_SCENARIOS_CET6B]
  .flatMap(text => rows(text, 6).map(([level, word, topic, summary, passage, wrong]) => [`cet${level}|${word}`, { topic, summary, passage, wrong }])));
const extra = new Map(rows(PAIR_EXTRA_CONTEXTS, 5).map(([level, word, topic, stem, gloss]) => [`cet${level}|${word}`, { topic, stem, gloss }]));
const overrides = new Map(rows(PAIR_CHOICE_OVERRIDES, 2));
const links = new Map(rows(PAIR_CONTEXT_LINKS, 2));
const reasons = { choice: '结合具体语境选择合适词汇', fill: '根据词义提示回忆句中所需单词', confusion: '结合限定线索区分近形词和相近含义', meaning: '结合完整句子辨认目标词的含义', listening: '听完整句子并拼出空缺单词', reading: '比较短文事实与选项中的范围、时间和条件', writing: '用目标词表达具体情境，保留条件、否定和逻辑关系' };
const blank = /_{3,}/;
const slug = word => word.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase();

export function buildHighFrequencyPairs(questions) {
  const byId = new Map(questions.map(q => [q.id, q]));
  const groups = new Map();
  for (const q of questions.filter(q => matchesBank(q, 'mixed', 'high'))) {
    const key = `${questionBank(q)}|${q.targetWords[0]}|${q.type}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(q);
  }
  return [...groups].filter(([, items]) => items.length === 1 || items[0].type === 'listening'
    && new Set(items.map(q => q.audioText.toLowerCase().trim())).size === 1).map(([key, [base]]) => {
    const bank = questionBank(base);
    const word = base.targetWords[0];
    const wordKey = `${bank}|${word}`;
    const q = { ...base, id: `dw-pair-${bank}-${base.type}-${slug(word)}`, version: 1, bank,
      source: 'project-original-pairs-2026', pairedWith: base.id, contextSourceId: undefined,
      difficultyBasis: reasons[base.type] || base.difficultyBasis };
    delete q.audioText;
    delete q.promptHint;
    const task = usage.get(key);
    if (task) {
      q.topic = task.topic;
      q.stem = base.type === 'collocation' ? task.stem : `${base.stem.split('：')[0]}：${task.stem}`;
      if (base.type === 'phrase') q.stem += base.stem.match(/（[^（）]+）$/)?.[0] || '';
      const completed = base.type === 'correction' ? task.stem.replace(/\[[^\]]+\]/, base.answer) : task.stem.replace(blank, base.answer);
      q.explanation = `${completed}\n用法提示：${base.explanation}`;
      if (word === 'obstacle' && base.type === 'collocation') q.options = base.options.map(option => option === 'for' ? 'onto' : option);
      return q;
    }
    if (['reading', 'writing'].includes(base.type)) {
      const scene = scenarios.get(wordKey);
      if (!scene) throw new Error(`Missing paired scenario: ${key}`);
      q.topic = scene.topic;
      if (base.type === 'reading') {
        const wrong = scene.wrong.split('~');
        if (wrong.length !== 3) throw new Error(`Missing reading distractors: ${key}`);
        q.stem = `${scene.passage}\n哪项准确表达了短文的信息？`;
        q.answer = scene.summary;
        q.accepts = [q.answer];
        q.options = [q.answer, ...wrong];
        q.explanation = `${scene.summary}\n原文依据：${scene.passage}`;
        q.hint = '对照原文中的范围、条件、时间与否定，排除扩大或颠倒意思的选项。';
      } else {
        q.stem = `用 ${word} 写一到两句英文，表达以下情境：${scene.summary}`;
        q.answer = scene.passage;
        q.accepts = [q.answer];
        q.rubric = `正确使用 ${word}，允许符合语境的屈折变化和英美拼法；表达以下信息：${scene.summary} 保留否定、条件、范围和逻辑关系；接受语法通顺且满足要求的不同表达，不要求与参考句逐字一致。`;
        q.explanation = `表达要点：${scene.summary}\n参考句：${scene.passage}\n也接受满足情境要求的其他通顺表达。`;
        q.hint = '先确认要求表达的各项事实，再检查它们之间的关系。';
      }
      return q;
    }
    const original = byId.get(links.get(base.id));
    const fallback = extra.get(wordKey);
    if (!original && !fallback) throw new Error(`Missing paired context: ${key}`);
    const stem = overrides.get(base.id) || original?.stem || fallback.stem;
    const answer = original?.answer || word;
    const completed = stem.replace(blank, answer);
    if (!blank.test(stem)) throw new Error(`Missing paired blank: ${key}`);
    q.contextSourceId = overrides.has(base.id) ? undefined : original?.id;
    q.topic = original?.topic || fallback.topic;
    if (base.type === 'meaning') {
      const gloss = original?.id.includes('-coverage-') ? original.promptHint.split('；')[0] : fallback?.gloss;
      if (gloss) {
        q.answer = gloss;
        q.accepts = [gloss];
        q.options = base.options.map(option => option === base.answer ? gloss : option);
      }
      q.stem = `${completed}\n句中的 ${word} 最接近哪项含义？`;
      q.explanation = `${completed}\n${word} 在这里对应的含义：${q.answer}。`;
      q.hint = '根据目标词前后的动作、对象和关系判断含义。';
    } else {
      q.stem = base.type === 'listening' ? `听完整句子，补全空缺单词：${stem}` : stem;
      q.answer = answer;
      q.accepts = original?.accepts || base.accepts;
      const note = overrides.has(base.id) ? base.explanation : original?.explanation;
      const explanation = note?.split('\n').filter(line => /[\u4e00-\u9fff]/.test(line)).join('\n');
      q.explanation = `${completed}\n${explanation || `${word} 在这里表示“${fallback.gloss}”。`}`;
      if (base.type === 'listening') {
        q.audioText = completed;
        q.hint = '留意句中的空缺位置，重听并检查目标词的拼写。';
      }
      if (base.type === 'fill') {
        q.promptHint = original?.promptHint || `${original?.hint || fallback?.gloss || base.hint}；首字母 ${word[0]}，${word.length} 个字符`;
      }
    }
    return q;
  });
}
