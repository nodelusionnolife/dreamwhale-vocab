// 表情标签的归一化、解析与立绘解析。纯逻辑，不得 import 浏览器 API。
//
// 三层职责：
//   1. normalizeEmotion —— 把模型写的各种近义词收敛到标准标签
//   2. parseFaceTags    —— 从正文里取出 <Face>标准标签</Face>
//   3. resolveFace      —— 标签 → 立绘资产（走 assets 层的白名单与回退链）
//
// 为什么归一化必须存在：模型不会只写「开心」，它会写高兴／愉快／喜悦。
// 只认一种写法就会出现「图有、标签也对、却解析不到」的假故障。

import {
  EMOTIONS, EMOTION_IDS, FACE_TAG, faceUrlFor, DEFAULT_FACE_HOST,
} from '../content/emotions.js';
import { resolveAsset, sourceFor } from './assets.js';

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, '');

// 标准标签与别名 → 标准标签。启动时建一次，查询 O(1)。
const LOOKUP = (() => {
  const m = new Map();
  for (const e of EMOTIONS) {
    m.set(norm(e.id), e.id);
    for (const a of e.aliases || []) m.set(norm(a), e.id);
  }
  return m;
})();

/**
 * 把任意写法收敛到标准标签。
 * @returns {string|null} 标准标签；认不出来返回 null
 */
export function normalizeEmotion(raw) {
  const k = norm(raw);
  if (!k) return null;
  return LOOKUP.get(k) || null;
}

/** 该标准标签有没有立绘。 */
export function hasArt(emotionId) {
  return Boolean(faceUrlFor(EMOTIONS.find((x) => x.id === emotionId)));
}

/**
 * 从正文里取出立绘标签：<Face>开心</Face>。
 * 认不出的写法也会被取出（canonical 为 null），交给上层决定怎么处理——
 * 解析层不静默丢弃，否则排查时看不到「模型写了什么」。
 */
export function parseFaceTags(text) {
  const s = String(text ?? '');
  const re = new RegExp(`<${FACE_TAG}>([\\s\\S]*?)</${FACE_TAG}>`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(s)) !== null) {
    const raw = m[1].trim();
    out.push({
      raw,
      canonical: normalizeEmotion(raw),
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return out;
}

/** 去掉正文里的立绘标签（标签文字不该漏进气泡）。 */
export function stripFaceTags(text) {
  return String(text ?? '').replace(new RegExp(`<${FACE_TAG}>[\\s\\S]*?</${FACE_TAG}>`, 'g'), '');
}

/** 取正文里最后一个可识别的表情——立绘是持续状态，最后写的那个生效。 */
export function lastFace(text) {
  const tags = parseFaceTags(text).filter((t) => t.canonical);
  return tags.length ? tags[tags.length - 1].canonical : null;
}

/**
 * 标签 → 立绘资产 + 实际要用的图床地址。
 * 认不出的标签不会硬给一张图，而是落回 sprite 类的默认项；
 * 没有默认项就返回 null（立绘区留空），绝不给坏图。
 *
 * @param {object} manifest
 * @param {string} raw 模型写的标签（标准或别名都行）
 * @param {{host?:string}} opts host 指定图床；缺省用默认图床
 * @returns {{asset:object|null, src:object|null, emotion:string|null, via:string|null, reason:string}}
 */
export function resolveFace(manifest, raw, { host = DEFAULT_FACE_HOST } = {}) {
  const pick = (asset) => (asset ? { asset, src: sourceFor(asset, host) } : { asset: null, src: null });

  const canonical = normalizeEmotion(raw);
  if (!canonical) {
    const fb = resolveAsset(manifest, { kind: 'sprite' });
    return {
      ...pick(fb.asset),
      emotion: null,
      via: fb.via,
      reason: raw ? `认不出的表情标签：${raw}` : '没有表情标签',
    };
  }
  const r = resolveAsset(manifest, { kind: 'sprite', key: canonical });
  if (!r.asset) {
    return {
      asset: null,
      src: null,
      emotion: canonical,
      via: null,
      reason: `「${canonical}」还没有立绘，且 sprite 类没有默认项，立绘区留空`,
    };
  }
  return { ...pick(r.asset), emotion: canonical, via: r.via, reason: '' };
}

/**
 * 生成提示词里的可用表情列表。
 * 只列**有立绘**的标签，并把别名一起标出来——这样模型既知道有哪些标准写法，
 * 也知道自己习惯写的近义词会归到哪一个，减少选错。
 */
export function emotionPromptList() {
  return EMOTIONS
    .filter((e) => faceUrlFor(e))
    .map((e) => (e.aliases?.length ? `${e.id}（${e.aliases.join('、')}）` : e.id))
    .join('；');
}

/** 自检用：标准标签总数、有图数、缺图数。 */
export function emotionStats() {
  const withArt = EMOTIONS.filter((e) => faceUrlFor(e)).length;
  return {
    total: EMOTION_IDS.length,
    withArt,
    withoutArt: EMOTION_IDS.length - withArt,
  };
}
