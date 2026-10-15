import test from 'node:test';
import assert from 'node:assert/strict';
import { renderThread, renderAppearancePreview } from '../src/ui/chat.js';
import { resolveFace, lastFace } from '../src/engine/emotions.js';
import { ASSET_MANIFEST } from '../src/content/assets.js';
import { CHARACTER_AVATAR_PATH } from '../src/content/emotions.js';

class Node {
  constructor(tag) {
    this.tagName = tag;
    this.className = '';
    this.childNodes = [];
    this.dataset = {};
    this.events = {};
    this.parentNode = null;
    this._text = '';
    this.scrollHeight = 1000;
    this.scrollTop = 950;
    this.clientHeight = 100;
  }
  set textContent(value) {
    this.replaceChildren();
    this._text = String(value);
  }
  get textContent() { return this._text + this.childNodes.map((node) => node.textContent).join(''); }
  appendChild(node) {
    if (node.tagName === '#fragment') {
      for (const child of [...node.childNodes]) this.appendChild(child);
      return node;
    }
    node.remove();
    this.childNodes.push(node);
    node.parentNode = this;
    return node;
  }
  replaceChildren(...nodes) {
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes = [];
    this._text = '';
    for (const node of nodes) this.appendChild(node);
  }
  remove() {
    if (!this.parentNode) return;
    const siblings = this.parentNode.childNodes;
    siblings.splice(siblings.indexOf(this), 1);
    this.parentNode = null;
  }
  replaceWith(node) {
    const parent = this.parentNode;
    const idx = parent.childNodes.indexOf(this);
    this.remove();
    node.remove();
    parent.childNodes.splice(idx, 0, node);
    node.parentNode = parent;
  }
  addEventListener(type, handler) { (this.events[type] ||= []).push(handler); }
  dispatch(type) { for (const handler of this.events[type] || []) handler({ stopPropagation() {} }); }
}

const previousDocument = globalThis.document;
globalThis.document = {
  createElement: (tag) => new Node(tag),
  createDocumentFragment: () => new Node('#fragment'),
  createTextNode: (text) => {
    const node = new Node('#text');
    node.textContent = text;
    return node;
  },
};
test.after(() => { globalThis.document = previousDocument; });

function findAll(node, predicate) {
  return [node, ...node.childNodes.flatMap((child) => findAll(child, predicate))].filter(predicate);
}
const byClass = (node, cls) => findAll(node, (item) => item.className.split(' ').includes(cls));
const session = (messages, options = {}) => ({ id: 'session-one', messages, ...options });

test('摘要内容在正文、题卡、旁白及表情解析前移除', () => {
  const hostEl = new Node('div');
  const texts = [];
  renderThread({
    hostEl, session: session([{
      id: 'a', role: 'assistant',
      text: '“你好。”<TurnSummary>[隐秘旁白]<Question>秘密题干</Question><Face>惊讶</Face></TurnSummary>',
      summary: '这段摘要只允许在调试模式下显示，不应进入普通气泡。',
    }]),
    faceFor: (text) => { texts.push(text); return null; },
  });
  assert.deepEqual(texts, ['“你好。”']);
  assert.equal(hostEl.textContent, '梦鲸“你好。”');
  assert.equal(byClass(hostEl, 'qcard').length, 0);
  assert.equal(byClass(hostEl, 'seg-env').length, 0);
  assert.equal(byClass(hostEl, 'msg-summary').length, 0);
});

test('未闭合的摘要尾部不进入气泡或表情解析', () => {
  const hostEl = new Node('div');
  const texts = [];
  renderThread({
    hostEl, session: session([{ role: 'assistant', text: '你好<TurnSummary>隐藏尾部<Face>悲伤</Face>' }]),
    faceFor: (text) => { texts.push(text); return null; },
  });
  assert.deepEqual(texts, ['你好']);
  assert.equal(hostEl.textContent, '梦鲸你好');
});

test('调试小总结作为纯文本显示，不解析标记或HTML', () => {
  const hostEl = new Node('div');
  const summary = '【心理标记】<img src=x onerror=alert(1)>“摘要原文”';
  renderThread({
    hostEl, session: session([{ role: 'assistant', text: '正文', summary }]), debugSummaries: true,
  });
  const debug = byClass(hostEl, 'msg-summary-debug')[0];
  assert.equal(byClass(debug, 'msg-summary-text')[0].textContent, summary);
  assert.equal(byClass(debug, 'seg-thought').length, 0);
  assert.equal(findAll(debug, (node) => node.tagName === 'img').length, 0);
});

test('缺少有效摘要只在调试模式给提示，不编造摘要', () => {
  const hostEl = new Node('div');
  const current = session([{ role: 'assistant', text: '正文', summary: null, summaryStatus: 'invalid' }]);
  renderThread({ hostEl, session: current });
  assert.equal(hostEl.textContent, '梦鲸正文');
  renderThread({ hostEl, session: current, debugSummaries: true });
  assert.match(hostEl.textContent, /本轮未生成有效小总结，正文暂不能裁剪/);
});

test('裁剪楼层默认展示摘要，仍能删除消息且不解析旧正文', () => {
  const hostEl = new Node('div');
  const deleted = [];
  let faces = 0;
  renderThread({
    hostEl, session: session([
      { id: 'u', role: 'user', text: '不能恢复的用户正文', compacted: true },
      { id: 'a', role: 'assistant', text: '不能恢复的回复', summary: '本轮学习了表示时间的介词用法，并约定下一轮练习相近词义。', compacted: true },
    ]),
    faceFor: () => { faces += 1; return null; }, onDeleteMessage: (id) => deleted.push(id),
  });
  assert.match(hostEl.textContent, /正文已裁剪，见本轮小总结/);
  assert.match(hostEl.textContent, /本轮学习了表示时间的介词/);
  assert.doesNotMatch(hostEl.textContent, /不能恢复/);
  assert.equal(faces, 0);
  byClass(hostEl, 'msg-del-btn')[1].dispatch('click');
  byClass(hostEl, 'msg-del-yes')[0].dispatch('click');
  assert.deepEqual(deleted, ['a']);
});

test('折叠历史按需展开，并保留同会话展开状态', () => {
  const hostEl = new Node('div');
  const messages = [
    { role: 'user', compacted: true },
    { role: 'assistant', compacted: true, summary: '较早回合的专属总结。' },
    ...Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: `正文${i}` })),
  ];
  const current = session(messages, { limits: { renderLimit: 10 } });
  renderThread({ hostEl, session: current });
  assert.doesNotMatch(hostEl.textContent, /较早回合的专属总结/);
  const details = byClass(hostEl, 'thread-history')[0];
  details.open = true;
  details.dispatch('toggle');
  assert.match(hostEl.textContent, /较早回合的专属总结/);
  renderThread({ hostEl, session: current, debugSummaries: true });
  assert.equal(byClass(hostEl, 'thread-history')[0].open, true);
  assert.match(hostEl.textContent, /较早回合的专属总结/);
  renderThread({ hostEl, session: { ...current, id: 'another-session' } });
  assert.equal(byClass(hostEl, 'thread-history')[0].open, false);
});

test('所有梦鲸楼层固定显示同一头像，包括无表情、已裁剪和正在输入', () => {
  const hostEl = new Node('div');
  renderThread({
    hostEl, busy: true, avatarSrc: CHARACTER_AVATAR_PATH,
    session: session([
      { role: 'user', text: '你好' },
      { role: 'assistant', text: '没有表情标签的回复' },
      { role: 'user', compacted: true },
      { role: 'assistant', compacted: true, summary: '过去一轮的小总结。' },
    ]),
  });
  const avatars = byClass(hostEl, 'character-avatar');
  assert.equal(avatars.length, 3);
  assert.ok(avatars.every((avatar) => avatar.src === CHARACTER_AVATAR_PATH));
  assert.ok(avatars.every((avatar) => avatar.parentNode.textContent === '梦鲸'));
  assert.equal(byClass(hostEl, 'face-sticker').length, 0);
});

test('切换风格只重绘气泡外的表情，消息与总结保持不变', () => {
  const hostEl = new Node('div');
  const current = session([{
    role: 'assistant', text: '“继续聊吧。”<Face>平静</Face>',
    summary: '用户与梦鲸继续日常交流，约定下一轮练习更多新词。',
  }]);
  const saved = JSON.stringify(current);
  const render = (style) => renderThread({
    hostEl, session: current, avatarSrc: CHARACTER_AVATAR_PATH,
    faceFor: (text) => resolveFace(ASSET_MANIFEST, lastFace(text), { style }),
  });
  render('chibi');
  const first = byClass(hostEl, 'face-sticker')[0];
  assert.match(first.src, /\/chibi\//);
  assert.equal(first.parentNode.className, 'msg-expression');
  assert.equal(first.parentNode.parentNode.className, 'msg assistant');
  assert.equal(byClass(byClass(hostEl, 'msg-body')[0], 'face-sticker').length, 0);
  render('portrait');
  assert.match(byClass(hostEl, 'face-sticker')[0].src, /\/portrait\//);
  assert.equal(byClass(hostEl, 'character-avatar')[0].src, CHARACTER_AVATAR_PATH);
  assert.equal(JSON.stringify(current), saved);
});

test('风格预览使用同一头像，图片失败提示不再指向旧图床', () => {
  const hostEl = new Node('div');
  renderAppearancePreview({
    hostEl, avatarSrc: CHARACTER_AVATAR_PATH,
    face: resolveFace(ASSET_MANIFEST, '平静', { style: 'portrait' }),
  });
  assert.equal(byClass(hostEl, 'character-avatar')[0].src, CHARACTER_AVATAR_PATH);
  assert.match(byClass(hostEl, 'face-sticker')[0].src, /\/portrait\//);
  byClass(hostEl, 'face-sticker')[0].dispatch('error');
  assert.match(hostEl.textContent, /表情图片未能加载/);
  assert.doesNotMatch(hostEl.textContent, /图床/);
});
