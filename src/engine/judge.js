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
