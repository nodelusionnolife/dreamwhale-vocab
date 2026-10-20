// 为题库生成内联查表。运行：node tools/refresh-question-lookup.mjs
//
// 背景：src/content/cet4-questions.js 原本 import 全量词库（4048 词 / 258 KB）只为查
// 于是每次打开页面都要白拉 258 KB。本工具把那批词抽成内联表，切断这条依赖。
//
// 什么时候要重跑：往 EXTRA_SEEDS 里加了新 seed 之后。
// 本工具是幂等的，重复执行只会刷新查表内容，并会逐条比对确保题库数据没变。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FILE = path.join(root, 'src/content/cet4-questions.js');
const CET4_FILE = path.join(root, 'src/content/cet4.js');

const BEGIN = '// <<<SEED_LOOKUP_BEGIN>>>';
const END = '// <<<SEED_LOOKUP_END>>>';

const src = fs.readFileSync(FILE, 'utf8');

// 1) 记下改动前的题库，用于事后逐条比对
const bankUrl = pathToFileURL(FILE).href;
const beforeBank = (await import(bankUrl)).CET4_QUESTION_BANK.items;
const beforeJson = JSON.stringify(beforeBank);

// 2) 找出题库真正用到的词
const words = new Set();
for (const it of beforeBank) for (const w of (it.targetWords || [])) words.add(w);

// 3) 从全量词库取这些词的词性与释义
const { CET4 } = await import(pathToFileURL(CET4_FILE).href);
const lookup = {};
const missing = [];
for (const w of [...words].sort()) {
  const e = CET4.find((x) => x.w === w);
  if (!e) missing.push(w);
  else lookup[w] = { p: e.p, m: e.m };
}
if (missing.length) {
  console.log(`⚠ 词库里找不到这些词，内联表会缺它们（题库仍然可用，只是提示与解析会空）：${missing.join(', ')}`);
}

// 4) 生成带标记的查表块
const body = Object.entries(lookup)
  .map(([w, v]) => `  ${JSON.stringify(w)}: { p: ${JSON.stringify(v.p)}, m: ${JSON.stringify(v.m)} },`)
  .join('\n');
const block = `${BEGIN}
// 内联查表：只收题库真正用到的那批词，不含全量词库。
//
// 为什么不全量 import cet4.js：那是 4048 词 / 258 KB，而这里只需要其中 ${Object.keys(lookup).length} 个词的词性与释义。
//
// 新增 seed 之后跑 node tools/refresh-question-lookup.mjs 重新生成本表；
// 漏词会被 tests/run.mjs 的「题库查表覆盖」用例拦下。
const SEED_LOOKUP = {
${body}
};

const ENTRY_BY_WORD = new Map(Object.entries(SEED_LOOKUP));
${END}`;

// 5) 替换：首次运行换掉 import 与旧写法；之后只刷新标记之间的内容
const importLine = "import { CET4 } from './cet4.js';";
const oldEntry = 'const ENTRY_BY_WORD = new Map(CET4.map((entry) => [entry.w, entry]));';

let out;
if (src.includes(BEGIN) && src.includes(END)) {
  out = src.replace(new RegExp(`${BEGIN}[\\s\\S]*?${END}`), block);
} else if (src.includes(importLine) && src.includes(oldEntry)) {
  out = src
    .replace(importLine, '// 本文件不依赖全量词库 cet4.js —— 原因见下方 SEED_LOOKUP 的说明。')
    .replace(oldEntry, block);
} else {
  console.error('文件结构与预期不符，已放弃改动（请人工确认）。');
  console.error(`找得到 import 行：${src.includes(importLine)}　找得到旧 ENTRY 行：${src.includes(oldEntry)}`);
  process.exit(1);
}

if (out === src) {
  console.log('查表已是最新，无需改动。');
} else {
  fs.writeFileSync(FILE, out);
  console.log(`已写入：${(Buffer.byteLength(src) / 1024).toFixed(1)} KB → ${(Buffer.byteLength(out) / 1024).toFixed(1)} KB，内联词条 ${Object.keys(lookup).length} 个`);
}

// 6) 逐条比对：题库数据必须与改动前完全一致
const afterBank = (await import(`${bankUrl}?v=${Date.now()}`)).CET4_QUESTION_BANK.items;
const afterJson = JSON.stringify(afterBank);
if (beforeJson === afterJson) {
  console.log(`✓ 题库逐条比对通过：${afterBank.length} 条，内容与改动前完全一致`);
} else {
  console.error('✗ 题库数据发生了变化！请立刻用版本控制回退。');
  process.exit(1);
}
