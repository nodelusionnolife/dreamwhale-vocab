// AI 返回值的解析与校验。纯逻辑，不得 import 浏览器 API。
//
// 判定为纯 AI 判定，代码不做词表穷举；代码只负责：
//   1. 把返回文本解析成 JSON
//   2. 校验字段齐全、类型正确、字段间约束成立
//   3. 把不合格的返回归一化成「可重试错误」，不让它污染存档

export class RetryableError extends Error {
  constructor(message, { raw = '', kind = 'unknown' } = {}) {
    super(message);
    this.name = 'RetryableError';
    this.raw = raw;
    this.kind = kind;
  }
}

/** 容忍模型偶尔裹上 ```json 代码块或前后废话。 */
export function parseJsonLoose(text) {
  if (typeof text !== 'string') throw new RetryableError('模型返回为空', { kind: 'empty' });
  let s = text.trim();
  if (!s) throw new RetryableError('模型返回为空', { raw: text, kind: 'empty' });

  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();

  try {
    return JSON.parse(s);
  } catch {
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(s.slice(start, end + 1));
      } catch { /* fallthrough */ }
    }
    throw new RetryableError('模型返回不是合法 JSON', { raw: text, kind: 'not-json' });
  }
}

const isStr = (v) => typeof v === 'string';
const isBool = (v) => typeof v === 'boolean';
const nonEmpty = (v) => isStr(v) && v.trim().length > 0;

function need(cond, msg, raw) {
  if (!cond) throw new RetryableError(msg, { raw: JSON.stringify(raw), kind: 'schema' });
}

/** 中文字数：按字符计，不含空白。 */
export function charCount(text) {
  return String(text || '').replace(/\s+/g, '').length;
}

/** 出题返回校验。首版只接受「应对」模式。 */
export function normalizeScene(raw, { words, minChars = 0 }) {
  need(raw && typeof raw === 'object', '出题返回不是对象', raw);
  need(nonEmpty(raw.scene), '出题缺 scene', raw);
  need(nonEmpty(raw.objective), '出题缺 objective', raw);
  const mode = nonEmpty(raw.mode) ? String(raw.mode).trim() : '应对';
  need(mode === '应对', `首版只支持「应对」模式，收到「${mode}」`, raw);
  const shell = raw.shell === '战斗' || raw.shell === '日常' ? raw.shell : '日常';
  const scene = {
    mode,
    shell,
    meme: nonEmpty(raw.meme) ? String(raw.meme).trim() : '',
    scene: String(raw.scene).trim(),
    objective: String(raw.objective).trim(),
    whyFits: nonEmpty(raw.why_fits) ? String(raw.why_fits).trim() : '',
    words,
  };
  scene.chars = charCount(scene.scene);
  need(
    scene.chars >= minChars,
    `场景描述仅 ${scene.chars} 字，低于下限 ${minChars} 字`,
    raw,
  );
  // why_fits 是出题器的自检字段：必须分别提到两个目标词，否则视为这道题不合格
  if (scene.whyFits) {
    for (const w of words) {
      need(scene.whyFits.toLowerCase().includes(w.word), `出题自检未覆盖目标词「${w.word}」，此题不合格`, raw);
    }
  }
  return scene;
}

const toBool = (v) => {
  if (typeof v === 'boolean') return v;
  if (v === 'true' || v === 1 || v === '1') return true;
  if (v === 'false' || v === 0 || v === '0') return false;
  return null;
};

/**
 * 判定返回校验。字段缺失或字段间矛盾一律算可重试错误。
 * 真实模型经常漏字段，所以除 passed 与 narrative 外都尽量给出可推断的默认值，
 * 避免因为一个可有可无的字段把整轮回复废掉。
 *
 * @param {object} raw 模型返回
 * @param {{ word?: string, minNarrative?: number }} opts word 用于在模型漏报时回填玩家提交的词
 */
export function normalizeJudge(raw, { word: submitted = '', minNarrative = 40 } = {}) {
  need(raw && typeof raw === 'object', '判定返回不是对象', raw);

  const fitRaw = nonEmpty(raw.semantic_fit) ? String(raw.semantic_fit).trim().toLowerCase() : '';
  const passedRaw = toBool(raw.passed);
  need(passedRaw !== null || ['perfect', 'pass', 'fail'].includes(fitRaw), '判定既没有 passed 也没有可用的 semantic_fit', raw);

  const fit = ['perfect', 'pass', 'fail'].includes(fitRaw) ? fitRaw : (passedRaw ? 'pass' : 'fail');
  const passed = passedRaw === null ? fit !== 'fail' : passedRaw;

  // 这两个字段缺省时按语义推断：判过了必然是真词且在范围内
  const isReal = toBool(raw.is_real_word);
  const inScope = toBool(raw.in_scope);

  if (fit === 'fail' && passed) throw new RetryableError('semantic_fit 为 fail 却 passed=true', { raw: JSON.stringify(raw), kind: 'contradiction' });
  if (isReal === false && passed) throw new RetryableError('非真实词却 passed=true', { raw: JSON.stringify(raw), kind: 'contradiction' });
  if (inScope === false && passed) throw new RetryableError('超出词表范围却 passed=true', { raw: JSON.stringify(raw), kind: 'contradiction' });

  const word = nonEmpty(raw.word) ? String(raw.word).trim().toLowerCase() : String(submitted || '').trim().toLowerCase();
  need(nonEmpty(word), '判定没有可用的 word', raw);

  const narrative = nonEmpty(raw.narrative) ? String(raw.narrative).trim() : '';
  need(narrative.length >= minNarrative, `判定没有给出足够的续写（${narrative.length} 字）`, raw);

  return {
    passed,
    word,
    isRealWord: isReal === null ? passed : isReal,
    inScope: inScope === null ? passed : inScope,
    semanticFit: fit,
    narrative,
    narrativeChars: charCount(narrative),
    reason: nonEmpty(raw.reason) ? String(raw.reason).trim() : '',
    feedback: nonEmpty(raw.feedback) ? String(raw.feedback).trim() : '',
    wordMeaning: nonEmpty(raw.word_meaning) ? String(raw.word_meaning).trim() : '',
  };
}
