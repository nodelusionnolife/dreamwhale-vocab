// 重新生成 src/content/cet4.js。运行：node tools/build-cet4.mjs
//
// 数据来源（均为公开数据，脚本会把原始文件缓存到 tools/raw/）：
//   1. CET4 大纲词表
//      https://raw.githubusercontent.com/mahavivo/english-wordlists/master/CET4_edited.txt
//      该仓库 README 声明：内容提取自《大学英语四级考试大纲》词表 PDF，共 4615 词，音标部分经人工校正。
//   2. COCA 词频表（20000 词，行号即词频名次，越小越常用）
//      https://raw.githubusercontent.com/mahavivo/english-wordlists/master/COCA_20000.txt
//
// 注意：该仓库未附 LICENSE 文件。词表本体源自公开考试大纲与公开语料库，
// 但再分发与商业使用前建议自行确认权利状态。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const rawDir = path.join(root, 'tools', 'raw');
const outFile = path.join(root, 'src', 'content', 'cet4.js');

const SOURCES = {
  'CET4_edited.txt': 'https://raw.githubusercontent.com/mahavivo/english-wordlists/master/CET4_edited.txt',
  'COCA_20000.txt': 'https://raw.githubusercontent.com/mahavivo/english-wordlists/master/COCA_20000.txt',
};

/* ---------- 过滤参数（改这里就能调整词库口径） ---------- */

/** 只保留内容词性：名词/动词/形容词/副词。虚词无法成为有意义的答案。 */
const CONTENT_POS = new Set(['n.', 'v.', 'vt.', 'vi.', 'adj.', 'a.', 'ad.', 'adv.']);

/** 单个词的字母数区间。太短没有练习价值，太长会让手牌失控。 */
const MIN_LEN = 3;
const MAX_LEN = 10;

/** COCA 词频前多少名的词算「高频/热点」。 */
const HOT_RANK_MAX = 3000;

/** 兜底虚词表（词性标注可能缺失，这里再拦一道）。 */
const STOPWORDS = new Set(
  ('a an the be is are was were do does did of to in on at by for and or but if so as '
    + 'it its he she we you they this that these those not no').split(' '),
);

/**
 * 排除专有名词。原始词表用首字母大写标注专有名词、国名国籍、月份、星期，
 * 共 59 条（France / British / Monday / December …）。转小写前先按大写判定。
 */
const EXCLUDE_CAPITALIZED = true;

const POS_RE = /^(n|v|vt|vi|adj|adv|prep|conj|pron|art|num|int|interj|aux|abbr|a|ad|pl)\./i;

/* ---------- 取源文件 ---------- */

fs.mkdirSync(rawDir, { recursive: true });
for (const [name, url] of Object.entries(SOURCES)) {
  const dest = path.join(rawDir, name);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) {
    console.log(`已缓存 ${name}`);
    continue;
  }
  console.log(`下载 ${name} …`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载失败 ${url} → ${res.status}`);
  fs.writeFileSync(dest, await res.text());
}

/* ---------- 解析 ---------- */

const cet4Raw = fs.readFileSync(path.join(rawDir, 'CET4_edited.txt'), 'utf8').replace(/^\uFEFF/, '');
const seen = new Set();
const all = [];

for (const line of cet4Raw.split(/\r?\n/)) {
  const s = line.trim();
  if (!s) continue;
  if (/^大学英语四级/.test(s) || /^\(共/.test(s)) continue;
  if (/^[A-Z]$/.test(s)) continue; // 字母分节标题
  const m = s.match(/^([a-zA-Z][a-zA-Z'’-]*)(?:\s*\[[^\]]*\])?\s+(.*)$/);
  if (!m) continue;
  const rawWord = m[1];
  if (EXCLUDE_CAPITALIZED && /^[A-Z]/.test(rawWord)) continue; // 专有名词/国名/月份/星期
  const word = rawWord.toLowerCase();
  if (!/^[a-z]+$/.test(word)) continue;
  if (seen.has(word)) continue;

  let rest = m[2].trim();
  let pos = '';
  const p = rest.match(POS_RE);
  if (p) { pos = p[0]; rest = rest.slice(pos.length).trim(); }
  const meaning = rest.replace(/\s+/g, ' ').slice(0, 40);
  if (!meaning) continue;

  seen.add(word);
  all.push({ w: word, p: pos, m: meaning });
}

// COCA 名次
const coca = fs.readFileSync(path.join(rawDir, 'COCA_20000.txt'), 'utf8').replace(/^\uFEFF/, '');
const rank = new Map();
coca.split(/\r?\n/).forEach((w, i) => {
  const t = w.trim().toLowerCase();
  if (t && /^[a-z]+$/.test(t) && !rank.has(t)) rank.set(t, i + 1);
});
for (const e of all) {
  const r = rank.get(e.w);
  if (r) e.r = r;
}

/* ---------- 过滤 ---------- */

const kept = all.filter((e) => CONTENT_POS.has(e.p)
  && e.w.length >= MIN_LEN && e.w.length <= MAX_LEN
  && !STOPWORDS.has(e.w));

kept.sort((a, b) => a.w.localeCompare(b.w));
const hot = kept.filter((e) => typeof e.r === 'number' && e.r <= HOT_RANK_MAX).length;

/* ---------- 输出 ---------- */

const body = kept.map((e) => `  { w: ${JSON.stringify(e.w)}, p: ${JSON.stringify(e.p)}, m: ${JSON.stringify(e.m)}, r: ${e.r ?? 'null'} },`).join('\n');

const out = `// 本文件由 tools/build-cet4.mjs 生成，请勿手工编辑。
// 重新生成：node tools/build-cet4.mjs
//
// 数据来源：
//   CET4 大纲词表  https://github.com/mahavivo/english-wordlists （CET4_edited.txt，4615 词）
//   COCA 词频表    https://github.com/mahavivo/english-wordlists （COCA_20000.txt）
//
// 口径：
//   原始大纲词 ${all.length} 条 → 仅内容词性（n./v./vt./vi./adj./a./ad./adv.）
//   + 长度 ${MIN_LEN}–${MAX_LEN} 字母 + 纯字母 + 非虚词，得到 ${kept.length} 条核心词库。
//   r 为 COCA 词频名次（越小越常用），null 表示该词未进 COCA 前两万名。
//   其中 r ≤ ${HOT_RANK_MAX} 的高频词 ${hot} 条，即「热点」子集。
//
// 权利状态：上游仓库未附 LICENSE。词表源自公开考试大纲与公开语料库，
// 再分发或商业使用前请自行确认权利状态。

/** COCA 词频名次阈值：r ≤ 该值视为高频（热点）词。 */
export const HOT_RANK_MAX = ${HOT_RANK_MAX};

/** 四级核心词库：{ w 单词, p 词性, m 释义, r COCA 名次 } */
export const CET4 = [
${body}
];

/** 是否为高频（热点）词。 */
export function isHot(entry) {
  return typeof entry?.r === 'number' && entry.r <= HOT_RANK_MAX;
}

/** 核心词库规模。 */
export const CET4_SIZE = CET4.length;
`;

fs.writeFileSync(outFile, out);
console.log(`原始大纲词条 ${all.length} → 核心词库 ${kept.length}（高频 ${hot}）`);
console.log(`已写出 ${path.relative(root, outFile)}，${(Buffer.byteLength(out) / 1024).toFixed(0)} KB`);
