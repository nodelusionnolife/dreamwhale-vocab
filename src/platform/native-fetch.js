export async function createAndroidFetch(bridge) {
  const requests = new Map();
  await bridge.addListener('httpEvent', event => requests.get(event.id)?.(event));
  return async function nativeFetch(url, options = {}) {
    const endpoint = new URL(url);
    if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) throw new TypeError('接口地址无效。');
    if (options.signal?.aborted) throw new DOMException('已取消', 'AbortError');
    const id = crypto.randomUUID();
    let controller, resolveHeaders, rejectHeaders, ended = false;
    const headers = new Promise((resolve, reject) => { resolveHeaders = resolve; rejectHeaders = reject; });
    const cleanup = () => { requests.delete(id); options.signal?.removeEventListener('abort', abort); };
    const fail = error => { if (ended) return; ended = true; rejectHeaders(error); controller.error(error); cleanup(); };
    const abort = () => { fail(new DOMException('已取消', 'AbortError')); bridge.cancelHttp({ id }).catch(() => {}); };
    const body = new ReadableStream({
      start(value) { controller = value; },
      cancel() { ended = true; cleanup(); return bridge.cancelHttp({ id }); },
    });
    requests.set(id, event => {
      if (ended) return;
      if (event.type === 'headers') resolveHeaders({ status: event.status, headers: event.headers });
      else if (event.type === 'data') {
        const binary = atob(event.data);
        controller.enqueue(Uint8Array.from(binary, c => c.charCodeAt(0)));
      } else if (event.type === 'end') { ended = true; controller.close(); cleanup(); }
      else if (event.type === 'error') fail(new Error(event.message || '连接失败。'));
    });
    options.signal?.addEventListener('abort', abort, { once: true });
    bridge.startHttp({ id, url: endpoint.href, method: options.method || 'GET', headers: Object.fromEntries(new Headers(options.headers)), body: options.body || '' }).catch(fail);
    try {
      const meta = await headers;
      return new Response([204, 205, 304].includes(meta.status) ? null : body, meta);
    } catch (error) { body.cancel().catch(() => {}); throw error; }
  };
}
