import { SCENE_PATHS } from '../content/scenes.js';
import { localMediaUrl } from '../platform/media.js';
import { sceneAt, SCENE_LABELS } from '../engine/client.js';

export function initAppearance({ getPreferences, status, clock = () => new Date() }) {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  function sync() {
    const prefs = getPreferences();
    const scene = sceneAt(clock(), prefs.scene);
    const root = document.documentElement;
    root.dataset.scene = scene;
    root.dataset.theme = prefs.theme === 'auto' ? (media.matches ? 'dark' : 'light') : prefs.theme;
    root.dataset.font = prefs.font;
    root.dataset.motion = prefs.motion;
    root.style.setProperty('--scene-current', `url("${localMediaUrl(SCENE_PATHS[scene])}")`);
    if (status) status.textContent = `${prefs.scene === 'auto' ? '自动 · ' : ''}${SCENE_LABELS[scene]}`;
  }
  const timer = setInterval(sync, 30000);
  const resume = () => { if (!document.hidden) sync(); };
  document.addEventListener('visibilitychange', resume);
  window.addEventListener('focus', sync);
  media.addEventListener('change', sync);
  sync();
  return { sync, destroy() { clearInterval(timer); document.removeEventListener('visibilitychange',resume); window.removeEventListener('focus',sync); media.removeEventListener('change',sync); } };
}
