// 对话模式渲染。所有模型输出都用 DOM 节点构建，绝不用 innerHTML 注入文本。
//
// 角色回复的呈现顺序会被保留：叙述片段按四类标记套样式，<Question> 块在原位渲染成题卡。

import { parseMarkers, extractQuestion } from '../engine/markers.js';
import { renderWindow } from '../engine/limits.js';
import { stripFaceTags } from '../engine/emotions.js';
import { stripStickerTags } from '../engine/assets.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** 把一段叙述按四类标记渲染成行内片段。 */
function renderSegments(text) {
  const frag = document.createDocumentFragment();
  for (const seg of parseMarkers(text)) {
    switch (seg.type) {
      case 'env':
        frag.appendChild(el('span', 'seg-env', `[${seg.text}]`));
        break;
      case 'action':
        frag.appendChild(el('span', 'seg-action', `(${seg.text})`));
        break;
      case 'thought':
        frag.appendChild(el('span', 'seg-thought', `【${seg.text}】`));
        break;
      case 'speech':
        frag.appendChild(el('span', 'seg-speech', `“${seg.text}”`));
        break;
      default:
        frag.appendChild(document.createTextNode(seg.text));
    }
  }
  return frag;
}

/** 把可能带换行的文本按段落渲染。 */
function renderParagraphs(host, text) {
  const parts = String(text).split(/\n{2,}/);
  for (const part of parts) {
    const p = el('p', 'para');
    p.appendChild(renderSegments(part));
    if (p.textContent.trim()) host.appendChild(p);
  }
}

/** 一道题渲染成卡片。 */
function renderQuestionCard(questionText) {
  const card = el('div', 'qcard');
  card.appendChild(el('div', 'qcard-label', '题目'));
  const body = el('div', 'qcard-body');
  for (const line of String(questionText).split('\n')) {
    if (line.trim()) body.appendChild(el('div', 'qcard-line', line));
  }
  card.appendChild(body);
  return card;
}

/**
 * 表情包：贴在角色消息里，随气泡宽度缩放，绝不撑破气泡。
 * 只由 main.js 传进来的解析结果决定地址，渲染层不认识图床——
 * 换图床要重渲染整条消息，本来也不该让渲染层知道该用哪个图床。
 */
function faceSticker(face) {
  const img = el('img', 'face-sticker');
  img.alt = face.emotion || '表情';
  img.decoding = 'async';
  img.loading = 'lazy';
  img.referrerPolicy = 'no-referrer'; // 图床多半按 referer 拦外链
  img.addEventListener('error', () => {
    // 图取不到时不留一块空白：把图换成一句人话，并提示可以去设置里换图床
    const note = el('p', 'face-sticker-note', '（这张表情没加载出来，可在设置里换另一个图床）');
    img.replaceWith(note);
  });
  img.src = face.src.path;
  return img;
}

/** 渲染一条角色回复：按顺序混排叙述与题卡，有表情就附在末尾。 */
function renderAssistant(host, rawText, face = null) {
  // 先摘掉「给系统看的」标签，它们不该出现在气泡文字里
  const text = stripFaceTags(stripStickerTags(String(rawText || '')))
    .replace(/<AnswerKey>[\s\S]*?<\/AnswerKey>/g, '');
  const re = /<Question>([\s\S]*?)<\/Question>/g;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) renderParagraphs(host, text.slice(last, m.index));
    host.appendChild(renderQuestionCard(m[1].trim()));
    last = m.index + m[0].length;
  }
  if (last < text.length) renderParagraphs(host, text.slice(last));
  if (!host.childNodes.length) renderParagraphs(host, text);
  // 表情贴在文字之后：像聊天里的贴图，而不是另开一块面板
  if (face?.src?.path) host.appendChild(faceSticker(face));
}

const fmt = (n) => (typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('en-US') : null);

/** 气泡下方的用量行。拿不到用量就不显示，不估算、不编造。 */
function renderUsage(host, { prompt, completion, cached }) {
  const bits = [];
  const p = fmt(prompt);
  const c = fmt(completion);
  const hit = fmt(cached);
  if (p !== null) {
    // 有缓存字段时把命中量一并报出来，让「有没有命中」变成看得见的事实
    if (hit !== null && cached > 0) {
      const pct = prompt ? Math.round((cached / prompt) * 100) : 0;
      bits.push(`本次输入 ${p} tok（缓存命中 ${hit}，${pct}%）`);
    } else if (hit !== null) {
      bits.push(`本次输入 ${p} tok（缓存未命中）`);
    } else {
      bits.push(`本次输入 ${p} tok`);
    }
  }
  if (c !== null) bits.push(`输出 ${c} tok`);
  if (!bits.length) return false;
  host.appendChild(el('div', 'msg-usage', bits.join(' · ')));
  return true;
}

/** 单条消息的删除控件：就地二次确认，避免手滑删掉一段对话。 */
function messageDeleteControl(id, onDelete) {
  const box = el('div', 'msg-del');
  const btn = el('button', 'msg-del-btn', '×');
  btn.title = '删除这条消息';
  btn.addEventListener('click', () => {
    const confirm = el('div', 'msg-del-confirm');
    confirm.appendChild(el('span', null, '删除这条？'));
    const yes = el('button', 'msg-del-yes', '删除');
    yes.addEventListener('click', () => onDelete(id));
    const no = el('button', 'msg-del-no', '取消');
    no.addEventListener('click', () => confirm.replaceWith(btn));
    confirm.appendChild(yes);
    confirm.appendChild(no);
    btn.replaceWith(confirm);
  });
  box.appendChild(btn);
  return box;
}

/**
 * 渲染整个消息流。
 * @param {object} opts
 * @param {HTMLElement} opts.hostEl
 * @param {object} opts.session
 * @param {boolean} opts.busy
 * @param {boolean} opts.showThinking  是否在末尾显示「对方正在输入」
 * @param {function|null} opts.onRegenerate 末尾有未回应的用户消息时，点「重新生成」的回调
 * @param {function|null} opts.onDeleteMessage 删除单条消息的回调
 * @param {function|null} opts.faceFor 把角色回复文本解析成表情 {emotion, src}；返回 null 表示这条没有表情
 */
export function renderThread({
  hostEl, session, busy, showThinking = true, onRegenerate = null, onDeleteMessage = null,
  faceFor = null,
}) {
  const atBottom = hostEl.scrollHeight - hostEl.scrollTop - hostEl.clientHeight < 80;
  hostEl.replaceChildren();

  const all = session?.messages || [];
  // 只渲染最近 renderLimit 条；更早的在界面上折叠，不影响存档与发送
  const win = renderWindow(all, session?.limits);
  const list = win.items;
  let sawUsage = false;

  if (win.hiddenCount > 0) {
    hostEl.appendChild(el('div', 'usage-absent', `更早的 ${win.hiddenCount} 条消息已折叠（仍保存在本地）`));
  }

  list.forEach((msg, idx) => {
    const wrap = el('div', `msg ${msg.role === 'user' ? 'user' : 'assistant'}`);
    const who = el('div', 'msg-who', msg.role === 'user' ? (session?.profile?.name || '你') : '鲸鱼娘');
    wrap.appendChild(who);
    const body = el('div', 'msg-body');
    if (msg.role === 'user') {
      renderParagraphs(body, msg.text || '');
    } else {
      // 表情由外部解析后传进来：渲染层不认识清单与图床，只负责画
      const face = faceFor ? faceFor(msg.text) : null;
      renderAssistant(body, msg.text, face);
      // 立绘钩子：把这条回复里的表情落到 DOM 上，供外部查询
      if (face?.emotion) wrap.dataset.face = face.emotion;
    }
    wrap.appendChild(body);

    // 用量：角色回复自带全量；用户消息取「本轮」的输入侧——也就是紧随其后那条回复的 prompt
    let usage = msg.usage;
    if (msg.role === 'user') {
      const next = list[idx + 1];
      usage = next && next.role === 'assistant' && next.usage
        ? { prompt: next.usage.prompt, completion: null, cached: next.usage.cached }
        : null;
    }
    if (usage && renderUsage(wrap, usage)) sawUsage = true;
    if (onDeleteMessage) wrap.appendChild(messageDeleteControl(msg.id, onDeleteMessage));

    hostEl.appendChild(wrap);
  });

  if (!all.length) {
    const empty = el('div', 'chat-empty');
    empty.appendChild(el('p', null, '这里是你们时隔多年的第一句话。'));
    empty.appendChild(el('p', 'muted', '随便说点什么——称呼、近况、天气，都行。'));
    hostEl.appendChild(empty);
  }

  if (busy && showThinking) {
    const thinking = el('div', 'msg assistant thinking');
    thinking.appendChild(el('div', 'msg-who', '鲸鱼娘'));
    thinking.appendChild(el('div', 'msg-body thinking-dot', '正在输入…'));
    hostEl.appendChild(thinking);
  }

  // 末尾挂着一条没人回的用户消息 → 说明上一次请求没成功（超时、断网、关页面）
  const last = all[all.length - 1];
  if (!busy && onRegenerate && last && last.role === 'user') {
    const bar = el('div', 'regen-bar');
    bar.appendChild(el('span', 'regen-text', '这一条还没有回应（可能是超时、断网，或页面被关掉了）。'));
    const btn = el('button', 'regen-btn', '重新生成');
    btn.addEventListener('click', () => onRegenerate());
    bar.appendChild(btn);
    hostEl.appendChild(bar);
  }

  // 有对话但一条用量都没有，说明端点没返回用量——明说，别让人以为是坏了
  if (all.length >= 2 && !sawUsage) {
    hostEl.appendChild(el('div', 'usage-absent', '当前端点未返回 token 用量，因此无法显示消耗。'));
  }

  if (atBottom) hostEl.scrollTop = hostEl.scrollHeight;
  return { sawUsage, hiddenCount: win.hiddenCount };
}

/* ---------------- 会话侧栏 ---------------- */

function timeAgo(ts) {
  const d = Date.now() - Number(ts || 0);
  if (!Number.isFinite(d) || d < 0) return '';
  const m = Math.floor(d / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}

/**
 * 渲染左侧会话列表。
 * 删除采用就地二次确认：点 × 变成「确认删除 / 取消」，避免误删整段对话。
 */
export function renderSessionList({ hostEl, sessions = [], currentId = null, onSelect, onNew, onDelete }) {
  hostEl.replaceChildren();

  const head = el('div', 'side-head');
  head.appendChild(el('span', 'side-title', '对话'));
  const add = el('button', 'side-new', '＋ 新建');
  add.addEventListener('click', () => onNew && onNew());
  head.appendChild(add);
  hostEl.appendChild(head);

  if (!sessions.length) {
    hostEl.appendChild(el('div', 'side-empty', '还没有对话'));
    return;
  }

  for (const s of sessions) {
    const item = el('div', `side-item${s.id === currentId ? ' active' : ''}`);

    const main = el('button', 'side-main');
    main.appendChild(el('div', 'side-item-title', s.title || '未命名'));
    main.appendChild(el('div', 'side-item-meta', `${s.messageCount || 0} 条 · ${timeAgo(s.updatedAt)}`));
    main.addEventListener('click', () => onSelect && onSelect(s.id));
    item.appendChild(main);

    const del = el('button', 'side-del', '×');
    del.title = '删除这个对话';
    del.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const confirm = el('div', 'side-confirm');
      confirm.appendChild(el('span', null, '删除？'));
      const yes = el('button', 'side-confirm-yes', '删除');
      yes.addEventListener('click', (e2) => {
        e2.stopPropagation();
        onDelete && onDelete(s.id);
      });
      const no = el('button', 'side-confirm-no', '取消');
      no.addEventListener('click', (e2) => {
        e2.stopPropagation();
        confirm.replaceWith(del);
      });
      confirm.appendChild(yes);
      confirm.appendChild(no);
      del.replaceWith(confirm);
    });
    item.appendChild(del);

    hostEl.appendChild(item);
  }
}

export function fillProfileForm({ nameEl, genderEl, customEl, customWrap, profile }) {
  nameEl.value = profile?.name || '';
  genderEl.value = GENDER_VALUES.includes(profile?.gender) ? profile.gender : '女';
  customEl.value = profile?.customGender || '';
  syncCustomVisibility({ genderEl, customWrap });
}

export const GENDER_VALUES = ['男', '女', '自定义'];

export function syncCustomVisibility({ genderEl, customWrap }) {
  customWrap.classList.toggle('hidden', genderEl.value !== '自定义');
}

export function readProfileForm({ nameEl, genderEl, customEl }) {
  return {
    name: nameEl.value.trim(),
    gender: genderEl.value,
    customGender: genderEl.value === '自定义' ? customEl.value.trim() : '',
  };
}

export function profileFormError({ nameEl, genderEl, customEl }) {
  if (!nameEl.value.trim()) return '先填一个称呼吧——鲸鱼娘总得知道该叫你什么。';
  if (genderEl.value === '自定义' && !customEl.value.trim()) return '选了「自定义」就把性别写一下。';
  return '';
}

/* ---------------- 轻提示 ---------------- */

let toastTimer = null;
export function chatToast(message, { error = false, ms = 4200 } = {}) {
  const node = document.getElementById('chat-toast');
  if (!node) return;
  node.textContent = message;
  node.classList.remove('hidden');
  node.classList.toggle('err', error);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.add('hidden'), ms);
}
