// 对话模式渲染。所有模型输出都用 DOM 节点构建，绝不用 innerHTML 注入文本。
//
// 角色回复的呈现顺序会被保留：叙述片段按四类标记套样式，<Question> 块在原位渲染成题卡。

import { parseMarkers } from '../engine/markers.js';
import { renderWindow } from '../engine/limits.js';
import { stripFaceTags } from '../engine/emotions.js';
import { stripStickerTags } from '../engine/assets.js';
import { stripTurnSummary } from '../engine/summary.js';
import { filterSessions } from '../engine/client.js';
import { appendSpeech, speechButton } from './speech.js';

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
    appendSpeech(p, p.textContent, '朗读段落', { full: true, scope: 'chat' });
    if (p.textContent.trim()) host.appendChild(p);
  }
}

/** 一道题渲染成卡片。 */
function renderQuestionCard(questionText) {
  const card = el('div', 'qcard');
  card.appendChild(el('div', 'qcard-label', '题目'));
  const body = el('div', 'qcard-body');
  for (const line of String(questionText).split('\n')) {
    if (line.trim()) { const row = el('div', 'qcard-line', line); appendSpeech(row, line, '朗读英文'); body.appendChild(row); }
  }
  card.appendChild(body);
  return card;
}

function faceSticker(face) {
  const img = el('img', 'face-sticker');
  img.alt = `梦鲸 · ${face.emotion || '表情'}`;
  img.decoding = 'async';
  img.loading = 'lazy';
  img.referrerPolicy = 'no-referrer';
  img.addEventListener('error', () => {
    const note = el('p', 'face-sticker-note', '表情图片未能加载，请刷新后重试。');
    img.replaceWith(note);
  });
  img.src = face.src.path;
  return img;
}

function assistantName(avatarSrc) {
  const who = el('div', 'msg-who assistant-name');
  if (avatarSrc) {
    const avatar = el('img', 'character-avatar');
    avatar.alt = '';
    avatar.width = 40;
    avatar.height = 40;
    avatar.decoding = 'async';
    avatar.addEventListener('error', () => {
      const fallback = el('span', 'character-avatar avatar-fallback', '梦');
      fallback.title = '头像未能加载';
      avatar.replaceWith(fallback);
    });
    avatar.src = avatarSrc;
    who.appendChild(avatar);
  }
  who.appendChild(el('span', 'msg-name', '梦鲸'));
  return who;
}

function renderExpression(host, face) {
  if (!face?.src?.path) return;
  const expression = el('div', 'msg-expression');
  expression.appendChild(faceSticker(face));
  host.appendChild(expression);
}

export function renderAppearancePreview({ hostEl, face, avatarSrc }) {
  hostEl.replaceChildren();
  hostEl.appendChild(assistantName(avatarSrc));
  renderExpression(hostEl, face);
}

function renderAssistant(host, rawText) {
  // 先摘掉「给系统看的」标签，它们不该出现在气泡文字里
  const text = stripFaceTags(stripStickerTags(stripTurnSummary(rawText)))
    .replace(/<(AnswerKey|TeachingReference)>[\s\S]*?<\/\1>/gi, '');
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
}

function renderSummary(host, msg, debug = false) {
  const box = el('div', debug ? 'msg-summary-debug' : 'msg-summary');
  box.appendChild(el('div', 'msg-summary-label', '回合小总结'));
  box.appendChild(el('div', 'msg-summary-text', msg.summary || '本轮未生成有效小总结，正文暂不能裁剪。'));
  host.appendChild(box);
}

const threadViews = new WeakMap();

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
  faceFor = null, avatarSrc = '', debugSummaries = false,
  onMessageAction = null,
}) {
  const atBottom = hostEl.scrollHeight - hostEl.scrollTop - hostEl.clientHeight < 80;
  let view = threadViews.get(hostEl);
  if (!view || view.sessionId !== session?.id) {
    view = { sessionId: session?.id, expanded: false };
    threadViews.set(hostEl, view);
  }
  hostEl.replaceChildren();

  const all = session?.messages || [];
  const win = renderWindow(all, session?.limits);
  let sawUsage = false;
  let usageNotice = null;

  const renderMessage = (msg, idx, target) => {
    const wrap = el('div', `msg ${msg.role === 'user' ? 'user' : 'assistant'}`);
    const who = msg.role === 'user'
      ? el('div', 'msg-who', session?.profile?.name || '你')
      : assistantName(avatarSrc);
    wrap.appendChild(who);
    const body = el('div', 'msg-body');
    let face = null;
    if (msg.compacted) {
      if (msg.role === 'user') {
        body.appendChild(el('div', 'msg-compacted-note', '正文已裁剪，见本轮小总结。'));
      } else {
        renderSummary(body, msg);
      }
    } else if (msg.role === 'user') {
      renderParagraphs(body, msg.text || '');
    } else {
      const text = stripTurnSummary(msg.text);
      face = faceFor ? faceFor(text) : null;
      renderAssistant(body, text);
      // 立绘钩子：把这条回复里的表情落到 DOM 上，供外部查询
      if (face?.emotion) wrap.dataset.face = face.emotion;
    }
    wrap.appendChild(body);
    renderExpression(wrap, face);
    if (debugSummaries && msg.role === 'assistant' && !msg.compacted) renderSummary(wrap, msg, true);

    // 用量：角色回复自带全量；用户消息取「本轮」的输入侧——也就是紧随其后那条回复的 prompt
    let usage = msg.usage;
    if (msg.role === 'user') {
      const next = all[idx + 1];
      usage = next && next.role === 'assistant' && next.usage
        ? { prompt: next.usage.prompt, completion: null, cached: next.usage.cached }
        : null;
    }
    if (usage && renderUsage(wrap, usage)) sawUsage = true;
    if (onDeleteMessage) wrap.appendChild(messageDeleteControl(msg.id, onDeleteMessage));
    if (onMessageAction) {
      const actions = el('div','message-actions');
      for (const [action,label] of [['copy','复制'], ...(msg.compacted ? [] : msg.role === 'user' ? [['edit','编辑并分支']] : [['regenerate','重新生成分支']])]) {
        const button=el('button','ghost',label);button.disabled=busy;button.addEventListener('click',()=>onMessageAction(action,msg.id));actions.append(button);
      }
      if (!msg.compacted) actions.append(speechButton(msg.text, '朗读整条', '朗读整条消息', { full: true, scope: 'chat' }));
      const branch = el('button', 'ghost', '创建分支');
      branch.type = 'button'; branch.disabled = busy; branch.title = '从这条消息创建独立对话';
      branch.addEventListener('click', () => onMessageAction('branch', msg.id));
      actions.append(branch);
      wrap.append(actions);
    }

    target.appendChild(wrap);
  };

  if (win.hiddenCount > 0) {
    const earlier = el('details', 'thread-history');
    earlier.appendChild(el('summary', null, `更早的 ${win.hiddenCount} 条消息`));
    const history = el('div', 'thread-history-content');
    earlier.appendChild(history);
    let loaded = false;
    const loadHistory = () => {
      if (loaded) return;
      for (let i = 0; i < win.startIndex; i += 1) renderMessage(all[i], i, history);
      loaded = true;
      if (sawUsage && usageNotice) usageNotice.remove();
    };
    earlier.addEventListener('toggle', () => {
      view.expanded = earlier.open;
      if (earlier.open) loadHistory();
    });
    if (view.expanded) loadHistory();
    earlier.open = view.expanded;
    hostEl.appendChild(earlier);
  }

  for (let i = win.startIndex; i < all.length; i += 1) renderMessage(all[i], i, hostEl);

  if (!all.length) {
    const empty = el('div', 'chat-empty');
    empty.appendChild(el('p', null, '这里是你们时隔多年的第一句话。'));
    empty.appendChild(el('p', 'muted', '随便说点什么——称呼、近况、天气，都行。'));
    hostEl.appendChild(empty);
  }

  if (busy && showThinking) {
    const thinking = el('div', 'msg assistant thinking');
    thinking.appendChild(assistantName(avatarSrc));
    thinking.appendChild(el('div', 'msg-body thinking-dot', '正在输入…'));
    hostEl.appendChild(thinking);
  }

  const last = all[all.length - 1];
  if (!busy && onRegenerate && last && last.role === 'user') {
    const branch = Boolean(session?.branchOf);
    const bar = el('div', branch ? 'regen-bar branch-ready' : 'regen-bar');
    bar.appendChild(el('span', 'regen-text', branch ? '这条消息尚未收到回复，可以从这里继续。' : '这一条还没有回应（可能是超时、断网，或页面被关掉了）。'));
    const btn = el('button', 'regen-btn', branch ? '生成回复' : '重新生成');
    btn.addEventListener('click', () => onRegenerate());
    bar.appendChild(btn);
    hostEl.appendChild(bar);
  }

  // 有对话但一条用量都没有，说明端点没返回用量——明说，别让人以为是坏了
  if (all.length >= 2 && !sawUsage) {
    usageNotice = el('div', 'usage-absent', '当前端点未返回 token 用量，因此无法显示消耗。');
    hostEl.appendChild(usageNotice);
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
const listViews = new WeakMap();
export function renderSessionList({ hostEl, sessions = [], currentId = null, onSelect, onNew, onDelete, onAction, searchText, busy = false }) {
  hostEl.replaceChildren();
  const state=listViews.get(hostEl)||{query:'',filter:'active'};listViews.set(hostEl,state);
  const head = el('div', 'side-head');
  head.appendChild(el('span', 'side-title', '对话'));
  const add = el('button', 'side-new', '＋ 新建');
  add.addEventListener('click', () => onNew && onNew());
  add.disabled=busy;
  head.appendChild(add);
  hostEl.appendChild(head);

  const search=el('input','session-search');search.type='search';search.placeholder='搜索标题与消息';search.setAttribute('aria-label','搜索对话');search.value=state.query;
  const filters=el('select','session-filter');filters.setAttribute('aria-label','对话分类');
  for(const [value,label] of [['active','最近对话'],['archived','已归档'],['all','全部对话'],['trash','回收站']]){const o=el('option',null,label);o.value=value;filters.append(o);}filters.value=state.filter;
  const results=el('div','session-results');hostEl.append(search,filters,results);
  let searchTimer;
  search.addEventListener('input',()=>{state.query=search.value;clearTimeout(searchTimer);searchTimer=setTimeout(draw,160);});
  filters.addEventListener('change',()=>{state.filter=filters.value;draw();});
  function draw(){
  results.replaceChildren();
  const enriched=state.query.trim()&&searchText?sessions.map(s=>({...s,searchText:searchText(s.id)})):sessions;
  const visible=filterSessions(enriched,state);
  if(!visible.length){results.append(el('div','side-empty',state.query?'没有找到相符的对话':'这里还没有对话'));return;}
  for (const s of visible) {
    const item = el('div', `side-item${s.id === currentId ? ' active' : ''}`);

    const main = el('button', 'side-main');
    main.appendChild(el('div', 'side-item-title', `${s.pinned?'置顶 · ':''}${s.title || '未命名'}`));
    main.appendChild(el('div', 'side-item-meta', `${s.messageCount || 0} 条 · ${timeAgo(s.updatedAt)}`));
    main.addEventListener('click', () => onSelect && onSelect(s.id));
    main.disabled=busy||Boolean(s.deletedAt);
    item.appendChild(main);
    if(onAction){
      const menu=el('details','session-menu');menu.append(el('summary',null,'更多'));
      const choices=s.deletedAt?[['restore','恢复'],['purge','永久删除']]:[['rename','重命名'],['pin',s.pinned?'取消置顶':'置顶'],['archive',s.archived?'移回最近':'归档'],['trash','移入回收站']];
      for(const [action,label] of choices){const b=el('button','ghost',label);b.disabled=busy;b.addEventListener('click',()=>onAction(action,s.id));menu.append(b);}item.append(menu);
    } else {
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
    }
    results.appendChild(item);
  }
  }
  draw();
}

export function updateStreaming(host, text) {
  const body=host.querySelector('.thinking .msg-body');
  if(!body)return;
  const atBottom=host.scrollHeight-host.scrollTop-host.clientHeight<100;
  body.classList.remove('thinking-dot');body.replaceChildren();
  const safe=text.replace(/<(TurnSummary|AnswerKey|TeachingReference|Face|Sticker)>[\s\S]*?(?:<\/\1>|$)/gi,'').replace(/<[^>]*$/,'');
  renderAssistant(body,safe);
  if(atBottom)host.scrollTop=host.scrollHeight;
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
  if (!nameEl.value.trim()) return '先填一个称呼吧——梦鲸总得知道该叫你什么。';
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
