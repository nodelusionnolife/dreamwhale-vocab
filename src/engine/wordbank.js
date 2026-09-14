// 词库抽词。纯逻辑，不得 import 浏览器 API。
//
// 这是词源的唯一入口：主题词与标准答案全部由此抽取，不再交给模型凭空想。
// 词表来路见 src/content/cet4.js 顶部（四级大纲词表 + COCA 词频）。

import { CET4, HOT_RANK_MAX, isHot } from '../content/cet4.js';
import { MAX_UNION, multiset } from './letters.js';

/** 把手牌字母并集去重后的数量，用于约束一次抽几个词。 */
function unionOf(words) {
  return multiset(words.flatMap((w) => String(w).toLowerCase().split(''))).size;
}

function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const lettersKey = (w) => [...w].sort().join('');

/**
 * 在给定候选里尝试抽 count 个词，满足：首字母互不相同、字母并集不超限、
 * 互不为异位词（避免出现两个字母完全相同的手牌）。
 */
function tryPick(candidates, { count, maxUnion, rng }) {
  const pool = shuffle(candidates, rng);
  const picked = [];
  const firsts = new Set();
  const anagrams = new Set();
  for (const e of pool) {
    if (picked.length >= count) break;
    const first = e.w[0];
    if (firsts.has(first)) continue;
    const key = lettersKey(e.w);
    if (anagrams.has(key)) continue;
    if (maxUnion && unionOf([...picked.map((x) => x.w), e.w]) > maxUnion) continue;
    picked.push(e);
    firsts.add(first);
    anagrams.add(key);
  }
  return picked.length === count ? picked : null;
}

/**
 * 抽词。
 * @param {object} opts
 * @param {Array}  opts.bank       词库，默认四级核心库
 * @param {number} opts.count      抽几个词（默认 2，即两个主题词/标准答案）
 * @param {Array}  opts.usedWords  已用过的词，避免重复
 * @param {boolean} opts.hotOnly   是否只抽高频（热点）词；默认 true
 * @param {number} opts.maxUnion   手牌字母并集上限
 * @param {function} opts.rng      随机源，便于测试注入
 * @returns {{word:string,pos:string,meaning:string,rank:number|null}[]}
 */
export function drawWords({
  bank = CET4,
  count = 2,
  usedWords = [],
  hotOnly = true,
  maxUnion = MAX_UNION,
  minRank = null,
  rng = Math.random,
} = {}) {
  if (!Array.isArray(bank) || bank.length < count) {
    throw new Error(`词库不足以抽出 ${count} 个词`);
  }
  const used = new Set(usedWords.map((w) => String(w).toLowerCase()));
  const base = bank.filter((e) => e && /^[a-z]+$/.test(e.w));

  // 逐级放宽：先按要求，抽不出来再去掉高频限制、再放宽并集、最后才允许重复用词
  const attempts = [
    { list: base.filter((e) => (!hotOnly || isHot(e)) && !used.has(e.w)), maxUnion, label: '严格' },
    { list: base.filter((e) => !used.has(e.w)), maxUnion, label: '放宽高频限制' },
    { list: base.filter((e) => !used.has(e.w)), maxUnion: maxUnion + 4, label: '放宽并集上限' },
    { list: base, maxUnion: maxUnion + 4, label: '允许重复用词' },
  ];

  for (const a of attempts) {
    if (a.list.length < count) continue;
    const picked = tryPick(a.list, { count, maxUnion: a.maxUnion, rng });
    if (picked) {
      return picked.map((e) => ({ word: e.w, pos: e.p, meaning: e.m, rank: e.r ?? null }));
    }
  }
  throw new Error('词库抽词失败：放宽全部限制后仍无法凑齐');
}

/** 词库概览，供设置页与自检展示。 */
export function describeBank(bank = CET4) {
  const hot = bank.filter(isHot).length;
  const lens = bank.map((e) => e.w.length);
  return {
    total: bank.length,
    hot,
    hotRankMax: HOT_RANK_MAX,
    minLen: Math.min(...lens),
    maxLen: Math.max(...lens),
  };
}

/** 按单词查词库条目，用于判定后回填权威释义。 */
export function lookup(bank, word) {
  const w = String(word || '').trim().toLowerCase();
  return bank.find((e) => e.w === w) || null;
}
