import { Capacitor, registerPlugin } from '@capacitor/core';
import { App } from '@capacitor/app';
import { createDurableStore } from './durable-store.js';
import { createAndroidFetch } from './native-fetch.js';
import { migrateAndroidSpeechPreferences } from './android-speech.js';

async function start() {
  let adapter;
  if (globalThis.__TAURI_INTERNALS__) {
    const [{ invoke }, dialog, fs, http, clipboard, { getCurrentWindow }] = await Promise.all([
      import('@tauri-apps/api/core'), import('@tauri-apps/plugin-dialog'), import('@tauri-apps/plugin-fs'),
      import('@tauri-apps/plugin-http'), import('@tauri-apps/plugin-clipboard-manager'), import('@tauri-apps/api/window'),
    ]);
    adapter = {
      load: () => invoke('load_store'),
      save: text => invoke('save_store', { text }),
      fetch: (url, options) => http.fetch(url, { ...options, maxRedirections: 0, connectTimeout: 30000 }),
      copyText: clipboard.writeText,
      speechVoices: () => invoke('speech_voices'),
      async saveFile(name, content) {
        const path = await dialog.save({ defaultPath: name });
        if (!path) return false;
        await fs.writeTextFile(path, content); return true;
      },
      async pickFile(maxBytes) {
        const path = await dialog.open({ multiple: false, directory: false, filters: [{ name: 'JSON', extensions: ['json'] }] });
        if (!path) return null;
        if ((await fs.stat(path)).size > maxBytes) throw new Error('文件超过允许大小。');
        const text = await fs.readTextFile(path);
        if (new TextEncoder().encode(text).length > maxBytes) throw new Error('文件超过允许大小。');
        return text;
      },
    };
    const { createWindowsSpeech } = await import('./windows-speech.js');
    Object.assign(adapter, createWindowsSpeech(invoke));
    let closing = false;
    await getCurrentWindow().onCloseRequested(async event => {
      if (closing) return;
      event.preventDefault();
      window.dispatchEvent(new Event('dreamwhale:pause'));
      try { await adapter.storage.flush(); closing = true; await getCurrentWindow().destroy(); }
      catch {}
    });
  } else if (Capacitor.isNativePlatform()) {
    const bridge = registerPlugin('Dreamwhale');
    adapter = {
      load: () => bridge.loadStore(),
      save: text => bridge.saveStore({ text }),
      fetch: await createAndroidFetch(bridge),
      speak: (text, options) => bridge.speak({ text, ...options }),
      prepareSpeech: options => bridge.prepareSpeech(options),
      speechVoices: async () => (await bridge.speechVoices()).voices,
      stopSpeech: () => bridge.stopSpeech(),
      copyText: text => bridge.copyText({ text }),
      saveFile: async (name, content, type) => (await bridge.saveFile({ name, content, type })).saved,
      pickFile: async maxBytes => (await bridge.pickFile({ maxBytes })).text ?? null,
    };
    await App.addListener('appStateChange', async ({ isActive }) => {
      if (!isActive) {
        window.dispatchEvent(new Event('dreamwhale:pause'));
        adapter.storage?.flush().catch(() => {});
      }
    });
    await App.addListener('backButton', async () => {
      const active = document.activeElement;
      if (active?.matches('input,textarea') && document.body.classList.contains('keyboard-open')) { active.blur(); return; }
      if (!window.dispatchEvent(new Event('dreamwhale:back', { cancelable: true }))) return;
      window.dispatchEvent(new Event('dreamwhale:pause'));
      try { await adapter.storage.flush(); await App.minimizeApp(); } catch {}
    });
  }
  if (adapter) {
    const status = document.createElement('button');
    status.type = 'button'; status.id = 'native-save-status'; status.setAttribute('aria-live', 'polite');
    status.style.cssText = 'position:fixed;right:12px;bottom:calc(78px + var(--safe-area-inset-bottom, env(safe-area-inset-bottom)));z-index:9999;max-width:calc(100vw - 24px);padding:8px 12px;font-size:12px;background:#fff7ed;color:#713f12;border:1px solid #d6bc8b;border-radius:10px;box-shadow:0 2px 12px #0002';
    status.hidden = true; document.body.append(status);
    const loaded = await adapter.load();
    adapter.storage = createDurableStore(loaded.text ?? null, adapter.save, ({ state, error }) => {
      status.hidden = state === 'saved';
      status.disabled = state === 'saving';
      status.textContent = state === 'saving' ? '正在保存，请稍候…' : `尚未保存：${error?.message || '写入失败'}。点此重试`;
    });
    status.addEventListener('click', () => adapter.storage.flush().catch(() => {}));
    if (loaded.recovered) {
      status.hidden = false; status.textContent = '已恢复上一份完整存档，请核对最近的学习记录。点击收起';
      status.addEventListener('click', () => { if (!adapter.storage.dirty) status.hidden = true; }, { once: true });
    }
    globalThis.__dreamwhaleNative = adapter;
    if (Capacitor.isNativePlatform()) migrateAndroidSpeechPreferences(adapter.storage);
    document.documentElement.dataset.native = Capacitor.isNativePlatform() ? 'android' : 'windows';
  }
  await import('../main.js');
}

start().catch(error => {
  const panel = document.createElement('div');
  panel.style.cssText = 'position:fixed;inset:0;z-index:10000;background:#fff7ed;color:#352820;padding:10vh 8vw;font:18px/1.7 sans-serif';
  const text = document.createElement('p'); text.textContent = `无法打开梦鲸：${error.message || error}。原有存档未清空，请保留应用数据后重试。`;
  const retry = document.createElement('button'); retry.textContent = '重试'; retry.onclick = () => location.reload();
  panel.append(text, retry); document.body.append(panel);
});
