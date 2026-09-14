// 资产解析与校验。纯逻辑，不得 import 浏览器 API、不得发网络请求。
//
// 职责边界：
//   这里只回答「该显示哪张图」和「清单写对没有」。
//   真正去取图（本地 <img> / iNeed.getAsset）留给平台层，UI 层只负责画。
//
// 为什么解析要单独成层：模型会给「键」，而键可能是它编的。
// 所以解析必须带白名单校验与回退链——一张图取不到不能让整条回复崩掉。

import {
  ASSET_KINDS, PRELOAD_POLICIES, LIFETIMES, ASSET_SCHEMA_VERSION, STICKER_TAG,
} from '../content/assets.js';

const HEX64 = /^[0-9a-f]{64}$/i;

/** 本地路径必须相对、且在媒体根下：不许 ..、不许以 / 开头、不许带协议。 */
function checkLocalPath(path) {
  const p = String(path || '');
  if (!p) return '路径为空';
  if (p.startsWith('/') || p.startsWith('\\')) return '必须用相对路径，不能以 / 开头';
  if (p.includes('..')) return '不得包含 ..';
  if (/^[a-z][a-z0-9+.-]*:/i.test(p)) return '不得带协议头';
  return null;
}

/** 校验单个来源。返回错误列表。 */
function checkSource(src, at, id) {
  const out = [];
  if (!src || typeof src !== 'object') {
    out.push(`${at}（${id}）缺 source`);
    return out;
  }
  if (src.type === 'local') {
    const bad = checkLocalPath(src.path);
    if (bad) out.push(`${at}（${id}）本地路径不合规：${bad}`);
  } else if (src.type === 'remote') {
    if (!/^https:\/\//i.test(String(src.path || ''))) {
      out.push(`${at}（${id}）远端地址必须是 https`);
    }
  } else {
    out.push(`${at}（${id}）source.type 非法：${src.type}，只能是 local / remote`);
  }
  if (src.host !== undefined && (typeof src.host !== 'string' || !src.host.trim())) {
    out.push(`${at}（${id}）source.host 必须是非空字符串`);
  }
  return out;
}

/**
 * 校验清单。错误会让清单不可用；警告只提示风险，不阻断。
 * @returns {{ok:boolean, errors:string[], warnings:string[]}}
 */
export function validateManifest(manifest) {
  const errors = [];
  const warnings = [];

  if (!manifest || typeof manifest !== 'object') {
    return { ok: false, errors: ['清单不是对象'], warnings };
  }
  if (manifest.schemaVersion !== ASSET_SCHEMA_VERSION) {
    errors.push(`schemaVersion 应为 ${ASSET_SCHEMA_VERSION}，实际 ${manifest.schemaVersion}`);
  }
  if (!Array.isArray(manifest.assets)) {
    return { ok: false, errors: [...errors, 'assets 不是数组'], warnings };
  }

  const ids = new Set();
  const defaultsByKind = new Map();

  manifest.assets.forEach((a, i) => {
    const at = `assets[${i}]`;
    if (!a || typeof a !== 'object') {
      errors.push(`${at} 不是对象`);
      return;
    }
    const id = String(a.id || '').trim();
    if (!id) errors.push(`${at} 缺 id`);
    else if (ids.has(id)) errors.push(`${at} id 重复：${id}`);
    else ids.add(id);

    if (!ASSET_KINDS.includes(a.kind)) {
      errors.push(`${at}（${id}）kind 非法：${a.kind}，只能是 ${ASSET_KINDS.join(' / ')}`);
    } else if (a.isDefault === true) {
      if (defaultsByKind.has(a.kind)) {
        errors.push(`${at}（${id}）kind=${a.kind} 已有默认项 ${defaultsByKind.get(a.kind)}，不能有两个`);
      } else {
        defaultsByKind.set(a.kind, id);
      }
    }

    errors.push(...checkSource(a.source, at, id));

    // 备用图床：同一张图的其他地址，逐个按同样规则校验
    if (a.altSources !== undefined) {
      if (!Array.isArray(a.altSources)) {
        errors.push(`${at}（${id}）altSources 必须是数组`);
      } else {
        const hosts = [];
        if (a.source?.host) hosts.push(a.source.host);
        a.altSources.forEach((s, j) => {
          errors.push(...checkSource(s, `${at}.altSources[${j}]`, id));
          if (s?.host) hosts.push(s.host);
        });
        const dup = hosts.filter((h, i) => hosts.indexOf(h) !== i);
        if (dup.length) errors.push(`${at}（${id}）图床重复登记：${[...new Set(dup)].join(', ')}`);
      }
    }

    if (a.preload !== undefined && !PRELOAD_POLICIES.includes(a.preload)) {
      errors.push(`${at}（${id}）preload 非法：${a.preload}`);
    } else if (a.preload === undefined) {
      warnings.push(`${at}（${id}）未声明 preload，按 lazy 处理`);
    }
    if (a.lifetime !== undefined && !LIFETIMES.includes(a.lifetime)) {
      errors.push(`${at}（${id}）lifetime 非法：${a.lifetime}`);
    } else if (a.lifetime === undefined) {
      warnings.push(`${at}（${id}）未声明 lifetime，按 chat 处理`);
    }

    if (a.bytes !== null && a.bytes !== undefined) {
      if (!Number.isInteger(a.bytes) || a.bytes <= 0) errors.push(`${at}（${id}）bytes 必须是正整数或 null`);
    }
    if (a.sha256 !== null && a.sha256 !== undefined) {
      if (!HEX64.test(String(a.sha256))) errors.push(`${at}（${id}）sha256 必须是 64 位十六进制`);
    }
    if (a.tags !== undefined && !Array.isArray(a.tags)) {
      errors.push(`${at}（${id}）tags 必须是数组`);
    }

    const prov = a.provenance;
    if (!prov || typeof prov !== 'object') {
      warnings.push(`${at}（${id}）缺 provenance——立绘与表情包多为第三方作品，来源与授权是事后唯一可追溯依据`);
    } else {
      if (!String(prov.origin || '').trim()) warnings.push(`${at}（${id}）provenance.origin 为空`);
      const lic = String(prov.license || '').trim().toLowerCase();
      if (!lic || lic === 'unknown' || lic === '未确认') {
        warnings.push(`${at}（${id}）授权状态未确认，公开发布前必须核实`);
      }
    }
  });

  // 回退目标必须存在，且不能指向自己
  manifest.assets.forEach((a, i) => {
    if (!a || a.fallbackAssetId === null || a.fallbackAssetId === undefined) return;
    const fid = String(a.fallbackAssetId);
    if (fid === String(a.id)) errors.push(`assets[${i}]（${a.id}）fallbackAssetId 指向自己`);
    else if (!ids.has(fid)) errors.push(`assets[${i}]（${a.id}）fallbackAssetId 指向不存在的资产：${fid}`);
  });

  return { ok: errors.length === 0, errors, warnings };
}

/* ---------------- 查询 ---------------- */

export function assetsOfKind(manifest, kind) {
  return (manifest?.assets || []).filter((a) => a?.kind === kind);
}

export function findAsset(manifest, id) {
  if (!id) return null;
  return (manifest?.assets || []).find((a) => String(a.id) === String(id)) || null;
}

/**
 * 按图床挑出实际要用的地址。
 * 同一条资产可能登记了多个图床（同一张图的多份直链），这里只负责选哪一份。
 * 指定的图床没有这条资产时，退回默认来源，而不是返回 null——没图可显示比取次选地址更糟。
 * @returns {{type:string, path:string, host?:string}|null}
 */
export function sourceFor(asset, host) {
  if (!asset) return null;
  if (!host) return asset.source || null;
  if (asset.source?.host === host) return asset.source;
  const alt = (asset.altSources || []).find((s) => s?.host === host);
  return alt || asset.source || null;
}

/** 某类的默认资产：显式标记优先，否则该类只有一条时就是它。 */
export function kindDefault(manifest, kind) {
  const list = assetsOfKind(manifest, kind);
  const flagged = list.filter((a) => a.isDefault === true);
  if (flagged.length === 1) return flagged[0];
  return list.length === 1 ? list[0] : null;
}

/**
 * 把模型给的键解析成一条资产。回退链：
 *   1. id 精确命中（且 kind 相符）
 *   2. 该类下 tags 命中
 *   3. 该类的默认资产
 *   4. null —— 什么都不显示，而不是给个坏图
 * @returns {{asset:object|null, via:'id'|'tag'|'default'|null}}
 */
export function resolveAsset(manifest, { kind, key } = {}) {
  const k = String(key ?? '').trim();
  if (k) {
    const byId = findAsset(manifest, k);
    if (byId && (!kind || byId.kind === kind)) return { asset: byId, via: 'id' };
    const byTag = assetsOfKind(manifest, kind).find((a) => Array.isArray(a.tags) && a.tags.includes(k));
    if (byTag) return { asset: byTag, via: 'tag' };
  }
  const def = kindDefault(manifest, kind);
  return def ? { asset: def, via: 'default' } : { asset: null, via: null };
}

/**
 * 加载失败时的兜底：取该资产声明的 fallbackAssetId。
 * 只走一步——更深的链由调用方对着返回的资产再调一次，
 * 这样环与深度上限由调用方自己控制，这里不藏隐含行为。
 * （自指与悬空引用已在 validateManifest 里拦掉。）
 */
export function fallbackFor(manifest, asset) {
  const id = asset?.fallbackAssetId;
  if (!id) return null;
  const next = findAsset(manifest, id);
  if (!next || String(next.id) === String(asset.id)) return null;
  return next;
}

/**
 * 按标签挑一张。用于表情包这类「同一情绪有多张、随手挑一张」的场景。
 * 命中标签数多的优先；同分用 rng 打散。
 */
export function pickByTags(manifest, { kind, tags = [], rng = Math.random } = {}) {
  const want = new Set((tags || []).map((t) => String(t).trim()).filter(Boolean));
  const list = assetsOfKind(manifest, kind);
  if (!list.length) return null;
  if (!want.size) return list[Math.floor(rng() * list.length)];

  const scored = list
    .map((a) => ({
      a,
      score: (a.tags || []).filter((t) => want.has(String(t))).length,
    }))
    .filter((x) => x.score > 0);
  if (!scored.length) return kindDefault(manifest, kind);

  const top = Math.max(...scored.map((x) => x.score));
  const best = scored.filter((x) => x.score === top).map((x) => x.a);
  return best[Math.floor(rng() * best.length)];
}

/**
 * 从场景对象解析背景与立绘。
 * 场景走的是结构化通道——字段由出题返回，代码只把键翻成资产，
 * 不经过正文解析，所以这里没有「模型在散文里编键」的问题。
 * 两者都是确定性解析（同一个场景永远得到同一张图），不引入随机。
 */
export function resolveSceneArt(manifest, scene) {
  const bg = resolveAsset(manifest, { kind: 'bg', key: scene?.bg }).asset;
  const sprite = resolveAsset(manifest, { kind: 'sprite', key: scene?.spriteEmotion }).asset;
  return { bg, sprite };
}

/* ---------------- 正文内联表情包 ---------------- */

/**
 * 从正文里取出内联表情包标签：<Sticker>键</Sticker>。
 * 与 <Question> 平行，同一个渲染器可以一起切分。
 * 只做解析，不做校验——校验交给 resolveAsset 的白名单。
 * @returns {{key:string, start:number, end:number}[]}
 */
export function parseStickerTags(text) {
  const s = String(text ?? '');
  const re = new RegExp(`<${STICKER_TAG}>([\\s\\S]*?)</${STICKER_TAG}>`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(s)) !== null) {
    out.push({ key: m[1].trim(), start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/** 把正文里的表情包标签替换成占位文本，用于「不渲染图也要能读」的降级。 */
export function stripStickerTags(text) {
  const s = String(text ?? '');
  return s.replace(new RegExp(`<${STICKER_TAG}>([\\s\\S]*?)</${STICKER_TAG}>`, 'g'), '').trim();
}

/**
 * 统计清单概况，供设置页或自检展示。
 */
export function describeManifest(manifest) {
  const list = manifest?.assets || [];
  const byKind = {};
  for (const k of ASSET_KINDS) byKind[k] = list.filter((a) => a.kind === k).length;
  const v = validateManifest(manifest);
  return {
    total: list.length,
    byKind,
    ready: v.ok,
    errors: v.errors.length,
    warnings: v.warnings.length,
  };
}
