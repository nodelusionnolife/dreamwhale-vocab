import { appStorage } from '../platform/runtime.js';
const LAYOUT_KEY = 'dreamwhale:layout:v1';
export const LAYOUT_CHOICES = { auto: '自动', mobile: '手机', desktop: '桌面' };

export function resolveLayout(preference, { width, height, touch = false }) {
  if (preference === 'mobile' || preference === 'desktop') return preference;
  return width <= 860 || (touch && width <= 1100 && Math.min(width, height) <= 900) ? 'mobile' : 'desktop';
}

export function loadLayout(storage) {
  try { const value = storage.getItem(LAYOUT_KEY); return Object.hasOwn(LAYOUT_CHOICES, value) ? value : 'auto'; }
  catch { return 'auto'; }
}

export function saveLayout(value, storage) {
  if (!Object.hasOwn(LAYOUT_CHOICES, value)) throw new Error('布局选项无效。');
  storage.setItem(LAYOUT_KEY, value);
}

export function initLayout({ select, status, notify }) {
  let preference = 'auto';
  try { preference = loadLayout(appStorage()); } catch {}
  const pointer = window.matchMedia('(pointer: coarse)');
  const root = document.documentElement;
  function sync() {
    const layout = resolveLayout(preference, { width: window.innerWidth, height: window.innerHeight, touch: pointer.matches });
    const signature = `${layout}:${window.innerWidth <= 860}:${window.innerWidth <= 1100}`;
    const changed = signature !== root.dataset.layoutSignature;
    root.dataset.layout = layout;
    root.dataset.layoutPreference = preference;
    root.dataset.sidePanel = layout === 'mobile' || window.innerWidth <= 860 ? 'drawer' : 'docked';
    root.dataset.practicePanel = layout === 'mobile' || window.innerWidth <= 1100 ? 'drawer' : 'docked';
    root.dataset.layoutSignature = signature;
    select.value = preference;
    status.textContent = `${preference === 'auto' ? '自动适配' : '手动选择'} · 当前${LAYOUT_CHOICES[layout]}排版 · ${window.innerWidth} × ${window.innerHeight}`;
    if (changed) window.dispatchEvent(new Event('layoutchange'));
  }
  function choose(value) {
    try { saveLayout(value, appStorage()); }
    catch { notify('布局已切换，但浏览器未能保存偏好。'); }
    preference = value;
    sync();
  }
  select.addEventListener('change', () => choose(select.value));
  pointer.addEventListener('change', sync);
  window.addEventListener('resize', sync);
  window.addEventListener('storage', (event) => {
    if (event.key === LAYOUT_KEY) { try { preference = loadLayout(appStorage()); } catch { preference = 'auto'; } sync(); }
  });
  sync();
  return { sync };
}
