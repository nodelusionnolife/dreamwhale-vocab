const registry = new Map();
const meaningSenses = { decline: 'refuse', issue: 'provide', render: 'cause', yield: 'produce', appropriate: 'allocate', sanction: 'approve', default: 'fail-to-repay', confer: 'discuss', premium: 'extra-charge', staple: 'food', closet: 'cupboard', aggregate: 'combined', obscure: 'conceal', integral: 'essential' };
const advancedWords = new Set(['reconcile', 'inherent', 'tentative', 'infer', 'substitute', 'appropriate', 'sanction', 'confer']);
const revisedReading = new Set(['tentative', 'credible', 'redundant', 'concede', 'reconcile']);
const advancedByType = {
  choice: ['decline', 'evaluate', 'concede', 'inherent', 'reconcile', 'tentative'],
  fill: ['decline', 'evaluate', 'concede', 'inherent', 'reconcile', 'tentative'],
  collocation: ['substitute', 'confer', 'reconcile'],
  formation: ['maintain', 'consume', 'expand', 'concede'],
  confusion: ['infer', 'relevant', 'credible', 'compliment', 'adverse', 'simulate', 'consecutive'],
  correction: ['adapt', 'appreciate', 'substitute', 'dedicate', 'reconcile'],
  phrase: ['substitute', 'retrospect', 'reconcile'],
  reading: ['tentative', 'credible', 'redundant', 'concede', 'reconcile', 'inherent', 'evaluate', 'vary'],
  meaning: ['decline', 'issue', 'render', 'yield', 'appropriate', 'sanction', 'default', 'confer', 'obscure'],
  writing: ['adapt', 'available', 'evaluate', 'restrict', 'retain', 'alleviate', 'conserve', 'credible', 'inherent', 'reconcile', 'tentative', 'versatile'],
  listening: [],
};
const taskReasons = { choice: '比较语境线索与选项含义', fill: '依据情境主动回忆拼写', collocation: '辨别搭配和动作方向', formation: '转换词性并处理拼写变化', confusion: '区分近形词及语义用法', correction: '定位并修正搭配或句法错误', phrase: '组织完整固定表达', reading: '区分原文依据、条件与推断', meaning: '选择当前语境义项', writing: '组织符合对象、目的和语气要求的表达', listening: '听句并补全目标词' };

export function questionMetadata(q) {
  const word = q.targetWords?.[0];
  let result = { ...q };
  if (!q.difficultyBasis) result.difficulty = ['writing', 'correction'].includes(q.type) || advancedWords.has(word) || (q.type === 'reading' && /inference|infer|imply|推断|隐含|best reflects/.test(q.stem)) ? 'advanced' : 'basic';
  if (/-syllabus$/.test(q.senseId) && !['meaning', 'listening'].includes(q.type)) result.senseId = `${word}:exercise:${q.variantGroup || q.id}`;
  if (q.id.startsWith('dw-c4-high-') || q.id.startsWith('dw-c6-high-')) {
    let sense = 'context';
    if (q.type === 'meaning') sense = meaningSenses[word] || 'meaning-context';
    if (word === 'available') sense = ['confusion', 'writing'].includes(q.type) ? 'free' : 'obtainable';
    result.senseId = `${word}:${sense}`;
    result.difficulty = advancedByType[q.type]?.includes(word) ? 'advanced' : 'basic';
    result.difficultyBasis = `${taskReasons[q.type]}；${result.difficulty === 'advanced' ? '需要处理易混关系、抽象线索或多项表达要求' : '主要依靠直接线索或单步作答'}`;
    if (q.type === 'reading' && revisedReading.has(word)) { result.difficulty = 'advanced'; result.version = 2; }
  }
  if (q.type === 'reading') result.skill = 'reading';
  result.difficultyBasis ||= result.difficulty === 'advanced' ? '需要辨别用法、推断关系或独立组织表达' : '直接线索、单步识别或有提示回忆';
  const previous = registry.get(q.id);
  registry.set(q.id, { version: result.version || 1, senseId: result.senseId, skill: result.skill, oldSkill: previous?.oldSkill || q.skill,
    stem: result.stem, answer: result.answer, accepts: result.accepts });
  return result;
}

export function resolvedAcceptedAnswers(question) {
  const accepted = question.accepts || [question.answer];
  const meta = registry.get(question.id);
  return meta && (question.version || 1) < meta.version && question.stem === meta.stem && question.answer === meta.answer
    ? [...new Set([...accepted, ...(meta.accepts || [])])] : accepted;
}

export function resolvedProgressKey(question, fallback) {
  const meta = registry.get(question.questionId || question.id);
  if (meta && (!question.skill || [meta.oldSkill, meta.skill].includes(question.skill)) && (question.questionVersion || question.version || 1) <= meta.version) return `${meta.senseId}|${meta.skill}`;
  return fallback;
}
