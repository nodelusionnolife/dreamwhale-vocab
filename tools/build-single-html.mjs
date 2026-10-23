// 把站点打包成一个 HTML 文件（零依赖，自己走一遍 ES module 图）。
//
// 为什么不用 bundler：本项目的红线是不装依赖。而且模块图是自成一体的
// （只有 ./ 和 ../ 相对导入，没有裸包名），手写一个够用的打包器比引一个
// 几 MB 的依赖更符合「最少依赖」那条工程原则。
//
// 做四件事：
//   1. 从 src/main.js 出发 DFS 收集模块（顺带检出循环依赖，有环就报错退出）
//   2. 每个模块包进 __def(id, factory)，静态 import 变成 __req(id) 解构
//   3. 动态 import('./module.js') 变成 Promise.resolve().then(() => __req(...))
//   4. 把结果内联进 index.html，替换掉 <script type="module" src> 那一行
//
// 只打包 main.js 能走到的模块，所以 tests/ 和 tools/ 天然进不来。
//
// 用法：node tools/build-single-html.mjs [输出路径]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Script } from 'node:vm';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ENTRY = 'src/main.js';
const OUT = process.argv[2] || path.join('dist', 'dreamwhale-vocab.html');

/** 统一成 posix 风格的相对路径，作为模块 id（稳定、可读、跨平台一致）。 */
const toId = (...p) => path.relative(ROOT, path.resolve(ROOT, ...p)).split(path.sep).join('/');

function readFile(id) {
  return fs.readFileSync(path.join(ROOT, id), 'utf8');
}

/**
 * 抽出模块顶部的 import 语句。
 * 本项目只有两种形态：具名导入（可跨行）和具名重命名；没有默认导入、
 * 没有 import * as、没有副作用导入——真出现了要显式报错，不能静默漏掉。
 */
function parseImports(code, id) {
  const imports = [];
  const re = /^[ \t]*import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]\s*;?[ \t]*$/gm;
  const stripped = code.replace(re, (full, clause, spec) => {
    const c = clause.trim();
    if (c.startsWith('*')) throw new Error(`${id}: 不支持 import * as（${spec}）`);
    if (!c.startsWith('{')) throw new Error(`${id}: 不支持默认导入（${spec}），请改成具名导入`);
    const inner = c.slice(c.indexOf('{') + 1, c.lastIndexOf('}'));
    const names = inner.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
      const m = /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(s);
      if (!m) throw new Error(`${id}: 认不出的导入项「${s}」`);
      return { imported: m[1], local: m[2] || m[1] };
    });
    imports.push({ spec, names });
    return `/* import ${spec} */`;
  });
  return { imports, code: stripped };
}

/**
 * 把 export 拆成「去掉关键字 + 模块末尾登记到 exports」。
 * 不保留实时绑定（用不到）：本项目的模块图无环，依赖总是先跑完再被读。
 */
function parseExports(code, id) {
  const exported = [];
  const add = (exportedName, localName) => exported.push({ exportedName, localName });

  let out = code;

  // export async function foo / export function foo
  out = out.replace(/^([ \t]*)export\s+(async\s+)?function\s+([A-Za-z_$][\w$]*)/gm,
    (full, ind, asyncKw, name) => { add(name, name); return `${ind}${asyncKw || ''}function ${name}`; });

  // export class Foo
  out = out.replace(/^([ \t]*)export\s+class\s+([A-Za-z_$][\w$]*)/gm,
    (full, ind, name) => { add(name, name); return `${ind}class ${name}`; });

  // export const / let / var（含 export const { a, b } = ... 这种解构写法）
  // 名字由 collectDeclaredExports 从原始代码里单独抓——这里只去掉关键字
  out = out.replace(/^([ \t]*)export\s+(const|let|var)\s+/gm, (full, ind, kind) => `${ind}${kind} `);

  // export { a, b as c };
  out = out.replace(/^([ \t]*)export\s*\{([^}]*)\}\s*;?[ \t]*$/gm, (full, ind, inner) => {
    for (const piece of inner.split(',')) {
      const s = piece.trim();
      if (!s) continue;
      const m = /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(s);
      if (!m) throw new Error(`${id}: 认不出的导出项「${s}」`);
      add(m[2] || m[1], m[1]);
    }
    return `${ind}/* export */`;
  });

  if (/^[ \t]*export\s/m.test(out)) {
    const bad = /^[ \t]*export\s.*$/m.exec(out)[0].trim();
    throw new Error(`${id}: 有没处理的导出写法 → ${bad}`);
  }

  return { exported, code: out };
}

/** 声明式导出要单独抓名字：export const A = 1, B = 2; / export const { x } = y; */
function collectDeclaredExports(original) {
  const names = [];
  const re = /^[ \t]*export\s+(?:const|let|var)\s+/gm;
  let m;
  while ((m = re.exec(original)) !== null) {
    const rest = original.slice(m.index + m[0].length);
    // 取到第一个 = 或 ; 之前的部分就是声明头
    const head = rest.split(/[=;]/)[0];
    for (const part of head.split(',')) {
      const s = part.trim();
      if (!s) continue;
      const brace = /^\{([^}]*)\}/.exec(s);
      if (brace) {
        for (const one of brace[1].split(',')) {
          const t = one.trim();
          if (!t) continue;
          const mm = /^([A-Za-z_$][\w$]*)(?:\s*:\s*([A-Za-z_$][\w$]*))?$/.exec(t);
          if (mm) names.push({ exportedName: mm[2] || mm[1], localName: mm[1] });
        }
        continue;
      }
      const mm = /^([A-Za-z_$][\w$]*)/.exec(s);
      if (mm) names.push({ exportedName: mm[1], localName: mm[1] });
    }
  }
  return names;
}

function transformModule(id) {
  const original = readFile(id);
  const { imports, code: afterImports } = parseImports(original, id);
  const { exported, code: body } = parseExports(afterImports, id);

  const decls = collectDeclaredExports(original);
  const all = [...decls, ...exported.filter((e) => e.exportedName)];
  const seen = new Set();
  const uniq = all.filter((e) => (seen.has(e.exportedName) ? false : (seen.add(e.exportedName), true)));

  // 依赖 id：把相对说明符解析成模块 id
  const deps = imports.map((im) => ({
    id: toId(path.dirname(id), im.spec),
    names: im.names,
    spec: im.spec,
  }));

  return { id, original, body, deps, exports: uniq };
}

/** 动态 import 也走同一个注册表，不留下真 import()（单文件里它只会 404）。 */
function dynamicImportSpecs(code, id) {
  const specs = [];
  const re = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    if (!m[1].startsWith('.')) throw new Error(`${id}: 动态 import 只支持相对路径（${m[1]}）`);
    specs.push(m[1]);
  }
  return specs;
}

function rewriteDynamicImports(code, id) {
  return code.replace(/import\(\s*['"]([^'"]+)['"]\s*\)/g,
    (full, spec) => `Promise.resolve().then(() => __req(${JSON.stringify(toId(path.dirname(id), spec))}))`);
}

const MIME_BY_EXT = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
};

const { ASSET_MANIFEST } = await import(
  pathToFileURL(path.join(ROOT, 'src/content/assets.js')).href
);

const inlinedAssets = [];
const localAssetMap = Object.create(null);
const localBuffers = new Map();

for (const a of ASSET_MANIFEST?.assets || []) {
  for (const source of [a?.source, ...(a?.altSources || [])]) {
    if (source?.type !== 'local') continue;
    const rel = source.path;
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) throw new Error(`清单登记的本地媒体不存在：${rel}（资产 ${a.id}）`);
    const buf = localBuffers.get(rel) || fs.readFileSync(abs);
    localBuffers.set(rel, buf);
    const bytes = source.bytes ?? (source === a.source ? a.bytes : undefined);
    const sha256 = source.sha256 ?? (source === a.source ? a.sha256 : undefined);
    if (Number.isInteger(bytes) && bytes !== buf.length) {
      throw new Error(`资产 ${a.id}（${rel}）的 bytes 声明 ${bytes}，实际 ${buf.length}`);
    }
    if (sha256) {
      const { createHash } = await import('node:crypto');
      const real = createHash('sha256').update(buf).digest('hex');
      if (real !== String(sha256).toLowerCase()) {
        throw new Error(`资产 ${a.id}（${rel}）的 sha256 不匹配`);
      }
    }
    if (localAssetMap[rel]) continue;
    const mime = MIME_BY_EXT[path.extname(rel).toLowerCase()];
    if (!mime) throw new Error(`资产 ${a.id} 的扩展名认不出：${rel}`);
    localAssetMap[rel] = `data:${mime};base64,${buf.toString('base64')}`;
    inlinedAssets.push({ id: a.id, rel, bytes: buf.length });
  }
}

const modules = new Map();
const order = [];
const visiting = new Set();

function walk(id) {
  if (visiting.has(id)) throw new Error(`检出了循环依赖：${id}（打包器不支持有环的模块图）`);
  if (modules.has(id)) return;
  visiting.add(id);
  const mod = transformModule(id);
  modules.set(id, mod);
  // 动态导入进包但不算静态依赖：单文件里没有「按需再下一次请求」这回事，
  const allDeps = [...mod.deps.map((d) => d.spec), ...dynamicImportSpecs(mod.body, id)];
  for (const spec of allDeps) {
    const depId = toId(path.dirname(id), spec);
    if (!fs.existsSync(path.join(ROOT, depId))) throw new Error(`${id}: 找不到依赖 ${spec}`);
    walk(depId);
  }
  visiting.delete(id);
  order.push(id); // 后序：依赖先于依赖者，模块体求值顺序和 ESM 一致
}

walk(ENTRY);

const RUNTIME = `(function () {
  'use strict';
  var defs = {}, cache = {}, failures = {};
  function __def(id, fn) { defs[id] = fn; }
  function __req(id) {
    if (Object.prototype.hasOwnProperty.call(failures, id)) throw failures[id];
    if (Object.prototype.hasOwnProperty.call(cache, id)) return cache[id];
    if (!defs[id]) throw new Error('模块未打包：' + id);
    var module = { exports: {} };
    cache[id] = module.exports;
    try {
      defs[id](module, module.exports, __req);
    } catch (error) {
      delete cache[id];
      failures[id] = error;
      throw error;
    }
    return module.exports;
  }
  window.__wbModules = __req; // 排查用：控制台可 __wbModules('src/engine/limits.js')
`;

// 本地媒体映射：src/platform/media.js 在运行时查它，查到就把相对路径换成 data URL。
// 放在所有模块之前，因为模块体一执行（比如清单派生）就可能要用。
const assetRuntime = inlinedAssets.length
  ? `  window.__wbAssets = ${JSON.stringify(localAssetMap)};\n`
  : '';

let bundle = RUNTIME + assetRuntime;
for (const id of order) {
  const mod = modules.get(id);
  const body = rewriteDynamicImports(mod.body, id);
  const importLines = mod.deps.map((d) => {
    const list = d.names.map((n) => (n.imported === n.local ? n.imported : `${n.imported}: ${n.local}`)).join(', ');
    return `    const { ${list} } = __req(${JSON.stringify(d.id)});`;
  }).join('\n');
  const exportLines = mod.exports.map((e) => `    exports.${e.exportedName} = ${e.localName};`).join('\n');

  bundle += `\n  __def(${JSON.stringify(id)}, function (module, exports, __req) {\n`;
  if (importLines) bundle += `${importLines}\n`;
  bundle += `${body.trimEnd()}\n`;
  if (exportLines) bundle += `${exportLines}\n`;
  bundle += '  });\n';
}
bundle += `\n  __req(${JSON.stringify(ENTRY)});\n})();\n`;

// 内联脚本里出现 </script 会把 HTML 解析器提前收尾；转义后在任何 JS 上下文里都等价
const safeBundle = bundle.replace(/<\/script/gi, '<\\/script');

const html = readFile('index.html').replace('./assets/branding/app-icon.png', () =>
  `data:image/png;base64,${fs.readFileSync(path.join(ROOT, 'assets/branding/app-icon.png')).toString('base64')}`);
const TAG = /^[ \t]*<script\b[^>]*\bsrc=[^>]*><\/script>[ \t]*$/m;
const matched = TAG.exec(html);
if (!matched) throw new Error('index.html 里没找到 <script src> 那一行，打包器不知道怎么接进去');

// 用下标拼接而不是 String.replace(pattern, 字符串)：replace 会把替换文本里的
// $&、$1、$' 当成替换模式展开，而替换文本是整份源码——踩过一次，源码里的
// `$&` 把原来的 <script src> 标签注进了函数体。
const insertAt = matched.index;
const outHtml = html.slice(0, insertAt)
  + `  <script>\n${safeBundle}  </script>`
  + html.slice(insertAt + matched[0].length);

// 产物里只该有我们注入的那一个 <script>。多一个就说明上面那类展开事故又发生了。
const scriptCount = (outHtml.match(/<script/gi) || []).length;
if (scriptCount !== 1) {
  throw new Error(`产物里有 ${scriptCount} 个 <script>，应该只有 1 个——检查替换是否被 $ 模式展开污染`);
}

// 自检：每个登记要内联的资产，其 data URL 必须真的出现在产物里。
// 这条是补票——上一版统计的是「清单里有几条」，而不是「实际内联了几条」，
// 结果表情一张都没进包、统计却报「已内联 12 个」。数字必须从产物里数。
const dataUrlCount = (outHtml.match(/data:image\//g) || []).length;
if (dataUrlCount < inlinedAssets.length) {
  throw new Error(
    `产物里只有 ${dataUrlCount} 个 data URL，但有 ${inlinedAssets.length} 个本地资产要内联`
    + '——检查 src/platform/media.js 的取值路径是否被绕过',
  );
}
for (const a of inlinedAssets) {
  if (!localAssetMap[a.rel]) throw new Error(`资产 ${a.rel} 没有进映射表`);
}

const outPath = path.isAbsolute(OUT) ? OUT : path.join(ROOT, OUT);
new Script(safeBundle, { filename: outPath });
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, outHtml, 'utf8');

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
console.log(`已打包 ${order.length} 个模块 → ${path.relative(ROOT, outPath)}`);
console.log(`  脚本 ${kb(Buffer.byteLength(safeBundle))}，HTML 总计 ${kb(Buffer.byteLength(outHtml))}`);
if (inlinedAssets.length) {
  console.log(`  内联本地媒体 ${inlinedAssets.length} 个（产物内核对到 ${dataUrlCount} 个 data URL）：`);
  console.log(`    ${inlinedAssets.map((a) => `${a.rel}（${kb(a.bytes)}）`).join('、')}`);
} else {
  console.log('  没有本地媒体需要内联（清单里没有 local 资产）');
}
console.log(`  体积最大的三个模块：`);
for (const id of [...order].sort((a, b) => modules.get(b).original.length - modules.get(a).original.length).slice(0, 3)) {
  console.log(`    ${id}  ${kb(Buffer.byteLength(modules.get(id).original))}`);
}
