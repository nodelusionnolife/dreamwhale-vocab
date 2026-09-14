// 字母发放。纯逻辑，不得 import 浏览器 API。
//
// 规则（见 总设计案.md「已确认」）：
//   手牌 = 两个目标词字母的多重集并集 + 干扰字母，打乱后发牌。
//   该构造在数学上保证两个目标词都拼得出来。

export const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');

// 英语字母频率，用于抽取干扰字母（让干扰项看起来像真的手牌）
const FREQ = {
  a: 82, b: 15, c: 28, d: 43, e: 127, f: 22, g: 20, h: 61, i: 70, j: 2,
  k: 8, l: 40, m: 24, n: 67, o: 75, p: 19, q: 1, r: 60, s: 63, t: 91,
  u: 28, v: 10, w: 24, x: 2, y: 20, z: 1,
};

export function lettersOf(word) {
  return String(word)
    .toLowerCase()
    .split('')
    .filter((c) => c >= 'a' && c <= 'z');
}

export function multiset(chars) {
  const m = new Map();
  for (const c of chars) m.set(c, (m.get(c) || 0) + 1);
  return m;
}

export function unionMultiset(a, b) {
  const m = new Map(a);
  for (const [c, n] of b) m.set(c, (m.get(c) || 0) + n);
  return m;
}

export function multisetChars(m) {
  const out = [];
  for (const [c, n] of m) for (let i = 0; i < n; i += 1) out.push(c);
  return out;
}

/** 手牌是否够拼出 word（只看字母与数量，不看语义）。 */
export function canSpell(poolChars, word) {
  const have = multiset(poolChars);
  for (const [c, n] of multiset(lettersOf(word))) {
    if ((have.get(c) || 0) < n) return false;
  }
  return true;
}

function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function weightedLetter(rng) {
  const total = LETTERS.reduce((s, c) => s + FREQ[c], 0);
  let r = rng() * total;
  for (const c of LETTERS) {
    r -= FREQ[c];
    if (r <= 0) return c;
  }
  return 'e';
}

/**
 * 发一手牌。
 * @param {string[]} targetWords 本轮两个目标词
 * @returns {{tiles: {id:string, ch:string}[], targetWords: string[], distractorCount: number}}
 */
export function buildLetterPool(targetWords, { distractorCount = 4, rng = Math.random } = {}) {
  const base = multiset(targetWords.flatMap(lettersOf));
  for (let i = 0; i < distractorCount; i += 1) {
    const c = weightedLetter(rng);
    base.set(c, (base.get(c) || 0) + 1);
  }
  const chars = shuffle(multisetChars(base), rng);
  const tiles = chars.map((ch, i) => ({ id: `t${i}_${ch}`, ch }));
  const pool = { tiles, targetWords: [...targetWords], distractorCount };
  assertSolvable(pool);
  return pool;
}

/** 两个目标词字母并集去重后的字母数，用于校验抽词规则第 5 条。 */
export function unionSize(words) {
  return multiset(words.flatMap(lettersOf)).size;
}

export const MAX_UNION = 12;

/** 目标词必须都能被手牌拼出，否则抛错——这是可解性的硬保证。 */
export function assertSolvable(pool) {
  const chars = pool.tiles.map((t) => t.ch);
  for (const w of pool.targetWords) {
    if (!canSpell(chars, w)) {
      throw new Error(`手牌无法拼出目标词「${w}」，可解性被破坏`);
    }
  }
  return true;
}

/** 从手牌中扣除已选中的牌，返回剩余字母的多重集。 */
export function remainingAfter(pool, selectedTileIds) {
  const used = new Set(selectedTileIds);
  return multiset(pool.tiles.filter((t) => !used.has(t.id)).map((t) => t.ch));
}
