import { localMediaUrl } from '../platform/media.js';
import { faceUrlFor, EMOTIONS, DEFAULT_FACE_STYLE, CHARACTER_AVATAR_PATH } from '../content/emotions.js';
import { loadTutorial, saveTutorial } from '../storage/tutorial.js';

const STEPS = [
  { id: 'welcome', title: '嗨，我是梦鲸', face: '开心', text: '把单词交给我们一起记吧。我会亮起几个按钮，你跟着点，就能熟悉这里啦。', next: '好呀，带我逛逛', page: 'learn' },
  { id: 'today', title: '先看看今天的安排', face: '兴奋', text: '点一下亮起来的「今日」。新词和到期复习，我都放在这里等你。', target: '#nav-learn', click: true, page: 'learn' },
  { id: 'plan', title: '每天一点点就好', face: '温柔', text: '在「调整计划」里选词汇范围和每天的数量。每组最多十个词，先回忆，再验证；中途累了，也能暂存续练。', target: '.plan-card', next: '记住啦', page: 'learn' },
  { id: 'library', title: '你的词汇小书架', face: '思索', text: '点「词库」，可以查单词、看用法，也能把喜欢的词收藏起来。', target: '#nav-library', click: true, page: 'learn' },
  { id: 'mistakes', title: '错题我帮你收好', face: '认真', text: '点这里的「错题集」。做错的题会自动收进来，聊天里的小练习也一样。', target: '#library-mistakes', click: true, page: 'library' },
  { id: 'archive', title: '会了，就送进已巩固', face: '得意', text: '连续两次独立答对，两次至少隔一天，我就帮你归档。再次答错也没关系，它会回来陪你练。', target: '#mistake-rules', next: '继续逛逛', page: 'library', mistakes: true },
  { id: 'practice', title: '想练哪一项？', face: '兴奋', text: '点「专项」，拼写、搭配、听音、短文……挑你今天最想练的就好。', target: '#nav-practice', click: true, page: 'library' },
  { id: 'chat', title: '也可以来找我聊天', face: '害羞', text: '点「梦鲸」来找我。聊天和情境表达需要先在设置里配置模型；其他客观题直接就能练。', target: '#nav-chat', click: true, page: 'practice' },
  { id: 'finish', title: '好啦，轮到你啦', face: '温柔', text: '从今天的一小组开始吧。我就在这里陪你。以后想再逛一圈，到设置里找「梦鲸使用引导」就好。', next: '开始我的学习', page: 'learn' },
];

const node = (tag, className = '', text = '') => { const e = document.createElement(tag); e.className = className; e.textContent = text; return e; };

export function initTutorial({ navigate, getFaceStyle, notify, canStart, onClose }) {
  let running = false;
  let index = 0;
  let root, card, ring, target, observer;
  let frame = 0;
  let transition = 0;
  let warned = false;
  let priorFocus;
  const shields = [];
  const saved = loadTutorial();

  function remember(status) {
    try { saveTutorial(status, STEPS[index].id); }
    catch { if (!warned) { notify('引导进度未能保存，重新打开页面后可能再次出现。'); warned = true; } }
  }

  function place() {
    frame = 0;
    if (!running) return;
    const width = document.documentElement.clientWidth;
    const height = window.visualViewport?.height || window.innerHeight;
    const offsetY = window.visualViewport?.offsetTop || 0;
    if (STEPS[index].target && !target?.isConnected) target = document.querySelector(STEPS[index].target);
    const r = target?.isConnected ? target.getBoundingClientRect() : null;
    const left = r ? Math.max(0, r.left - 5) : 0;
    const right = r ? Math.min(width, r.right + 5) : 0;
    const top = r ? Math.max(offsetY, r.top - 5) : offsetY;
    const bottom = r ? Math.min(offsetY + height, r.bottom + 5) : offsetY;
    ring.hidden = !r;
    Object.assign(ring.style, { left: `${left}px`, top: `${top}px`, width: `${Math.max(0, right - left)}px`, height: `${Math.max(0, bottom - top)}px` });
    const boxes = r ? [[0, offsetY, width, top - offsetY], [0, bottom, width, offsetY + height - bottom], [0, top, left, bottom - top], [right, top, width - right, bottom - top]] : [[0, offsetY, width, height], [0,0,0,0], [0,0,0,0], [0,0,0,0]];
    boxes.forEach(([x,y,w,h], i) => Object.assign(shields[i].style, { left: `${x}px`, top: `${y}px`, width: `${Math.max(0,w)}px`, height: `${Math.max(0,h)}px` }));
    root.classList.toggle('tour-centered', !r);
    card.style.maxHeight = `${height - 24}px`;
    const cardWidth = Math.min(416, width - 24);
    card.style.width = `${cardWidth}px`;
    const h = card.getBoundingClientRect().height;
    const gap = 16;
    const above = top - offsetY - gap;
    const below = offsetY + height - bottom - gap;
    let y = offsetY + (height - h) / 2;
    if (r) {
      if (below >= h) y = bottom + gap;
      else if (above >= h) y = top - h - gap;
      else if (STEPS[index].click) {
        const available = Math.max(above, below) - 12;
        card.style.maxHeight = `${Math.max(100, available)}px`;
        y = below >= above ? bottom + gap : offsetY + 12;
      } else y = offsetY + height - h - 12;
    }
    Object.assign(card.style, { left: `${Math.max(12, Math.min(width - cardWidth - 12, r ? (left + right - cardWidth) / 2 : (width - cardWidth) / 2))}px`, top: `${Math.max(offsetY + 12, y)}px` });
  }

  function schedulePlace() { if (!frame) frame = requestAnimationFrame(place); }

  function close(status) {
    if (!running) return;
    remember(status);
    running = false;
    observer?.disconnect();
    cancelAnimationFrame(frame); frame = 0;
    clearTimeout(transition); transition = 0;
    window.removeEventListener('resize', schedulePlace);
    window.removeEventListener('scroll', schedulePlace, true);
    window.visualViewport?.removeEventListener('resize', schedulePlace);
    document.removeEventListener('click', guardClick, true);
    document.removeEventListener('keydown', guardKey, true);
    document.removeEventListener('focusin', guardFocus, true);
    root.remove();
    onClose?.();
    if (priorFocus?.isConnected && priorFocus.getClientRects().length) priorFocus.focus({ preventScroll: true });
    else document.getElementById('nav-learn')?.focus({ preventScroll: true });
  }

  function advance() { if (index === STEPS.length - 1) close('completed'); else { index++; show(); } }

  function guardClick(event) {
    if (card.contains(event.target)) return;
    if (STEPS[index].click && target?.contains(event.target)) {
      if (!transition) transition = setTimeout(() => { transition = 0; if (running) advance(); }, 0);
      return;
    }
    event.preventDefault(); event.stopImmediatePropagation();
  }

  function focusables() { return [...(STEPS[index].click && target ? [target] : []), ...card.querySelectorAll('button')].filter((e) => !e.disabled); }
  function guardFocus(event) { if (!card.contains(event.target) && !(STEPS[index].click && target?.contains(event.target))) card.focus({ preventScroll: true }); }
  function guardKey(event) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close('skipped'); }
    if (event.key === 'Tab') {
      event.preventDefault();
      const items = focusables(); const position = items.indexOf(document.activeElement);
      items[(position + (event.shiftKey ? -1 : 1) + items.length) % items.length]?.focus({ preventScroll: true });
    }
  }

  function show() {
    observer?.disconnect();
    const step = STEPS[index];
    navigate(step.page, step.mistakes);
    target = step.target ? document.querySelector(step.target) : null;
    if (target) target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    card.replaceChildren();
    const top = node('div', 'tour-top');
    top.append(node('span', '', `梦鲸带你逛 · ${index + 1} / ${STEPS.length}`));
    const skip = node('button', 'text-button', '跳过引导'); skip.type = 'button'; skip.addEventListener('click', () => close('skipped')); top.append(skip);
    const body = node('div', 'tour-body');
    const picture = node('img', 'tour-face'); picture.alt = `梦鲸 · ${step.face}`;
    picture.src = localMediaUrl(faceUrlFor(EMOTIONS.find((emotion) => emotion.id === step.face), getFaceStyle?.() || DEFAULT_FACE_STYLE));
    picture.addEventListener('error', () => { picture.src = localMediaUrl(CHARACTER_AVATAR_PATH); }, { once: true });
    const speech = node('div', 'tour-speech'); const title = node('h2', '', step.title); title.id = 'tour-title'; speech.append(title, node('p', '', step.text)); body.append(picture, speech);
    const actions = node('div', 'tour-actions');
    if (index) { const back = node('button', 'ghost', '上一步'); back.type = 'button'; back.addEventListener('click', () => { index--; show(); }); actions.append(back); }
    if (step.click && target) actions.append(node('span', 'tour-instruction', '请点击亮起的按钮'));
    else { const next = node('button', 'primary', step.next || '继续'); next.type = 'button'; next.addEventListener('click', advance); actions.append(next); }
    card.append(top, body, actions);
    remember('active');
    place();
    card.focus({ preventScroll: true });
    observer = new ResizeObserver(schedulePlace); observer.observe(card); if (target) observer.observe(target);
  }

  function start({ restart = false } = {}) {
    if (running || !canStart()) return false;
    priorFocus = document.activeElement;
    const latest = restart ? null : loadTutorial();
    index = latest?.status === 'active' ? Math.max(0, STEPS.findIndex((step) => step.id === (latest.step === 'layout' ? 'finish' : latest.step))) : 0;
    running = true;
    root = node('div', 'tour-overlay');
    ring = node('div', 'tour-spotlight'); ring.setAttribute('aria-hidden', 'true'); root.append(ring);
    shields.length = 0;
    for (let i = 0; i < 4; i++) { const shield = node('div', 'tour-shield'); shield.setAttribute('aria-hidden', 'true'); shields.push(shield); root.append(shield); }
    card = node('section', 'tour-card'); card.setAttribute('role', 'dialog'); card.setAttribute('aria-labelledby', 'tour-title'); card.tabIndex = -1; root.append(card); document.body.append(root);
    window.addEventListener('resize', schedulePlace);
    window.addEventListener('scroll', schedulePlace, true);
    window.visualViewport?.addEventListener('resize', schedulePlace);
    document.addEventListener('click', guardClick, true);
    document.addEventListener('keydown', guardKey, true);
    document.addEventListener('focusin', guardFocus, true);
    show();
    return true;
  }

  return { start, shouldStart: () => !saved || saved.status === 'active', get active() { return running; } };
}
