const MAX_BYTES = 64 * 1024 * 1024;
const owned = key => /^(dreamwhale:|word-blade:)/.test(key);

export function parseSnapshot(text) {
  if (text === null || text === '') return { version: 1, revision: 0, data: {} };
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_BYTES) throw new Error('存档大小无效，原文件未改动。');
  const value = JSON.parse(text);
  if (value?.version !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0 || !value.data || Array.isArray(value.data) || typeof value.data !== 'object') throw new Error('存档格式无法读取，原文件未改动。');
  if (Object.entries(value.data).some(([k, v]) => !owned(k) || typeof v !== 'string')) throw new Error('存档记录无效，原文件未改动。');
  return value;
}

export function createDurableStore(initialText, write, status = () => {}) {
  const initial = parseSnapshot(initialText);
  const values = new Map(Object.entries(initial.data));
  let revision = initial.revision;
  let committed = revision;
  let pending = null;
  let scheduled = false;

  async function flush() {
    if (pending) { await pending; if (committed < revision) return flush(); return; }
    if (committed === revision) return;
    pending = (async () => {
      try {
        while (committed < revision) {
          const next = revision;
          const text = JSON.stringify({ version: 1, revision: next, data: Object.fromEntries(values) });
          if (new TextEncoder().encode(text).length > MAX_BYTES) throw new Error('存档超过 64 MB，请先导出备份并整理对话。');
          await write(text);
          committed = next;
        }
        status({ state: 'saved' });
      } catch (error) { status({ state: 'error', error }); throw error; }
    })();
    try { await pending; } finally { pending = null; }
  }
  function changed() {
    revision += 1;
    status({ state: 'saving' });
    if (!scheduled) {
      scheduled = true;
      queueMicrotask(() => { scheduled = false; flush().catch(() => {}); });
    }
  }
  return {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.get(String(key)) ?? null; },
    setItem(key, value) {
      key = String(key); value = String(value);
      if (!owned(key)) throw new Error('不支持的存储键。');
      if (values.get(key) === value) return;
      values.set(key, value); changed();
    },
    removeItem(key) { if (values.delete(String(key))) changed(); },
    clear() { if (values.size) { values.clear(); changed(); } },
    flush,
    get dirty() { return committed !== revision; },
  };
}
