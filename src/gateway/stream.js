import { RetryableError } from '../engine/judge.js';
import { requestHeaders, streamingBody, readPayload, streamState } from './protocols.js';

export async function streamCompletion({ endpoint, apiKey, body, signal, timeoutMs, fetchImpl, onDelta, options = {} }) {
  const format = options.apiFormat || 'chat';
  const state = streamState(format);
  const controller = new AbortController();
  let interrupted;
  const interruption = new Promise((_, reject) => { interrupted = reject; });
  const abort = (kind) => { if (!controller.signal.aborted) { controller.abort(); interrupted(new RetryableError(kind === 'timeout' ? '回复等待超时。' : '已停止生成。', {kind})); } };
  const onAbort = () => abort('cancelled');
  const timer = setTimeout(()=>abort('timeout'), timeoutMs);
  signal?.addEventListener('abort',onAbort,{once:true});
  let reader;
  const work = async () => {
    if (signal?.aborted) throw new RetryableError('已停止生成。',{kind:'cancelled'});
    const response = await fetchImpl(endpoint,{method:'POST',headers:requestHeaders(options,apiKey),redirect:'error',body:JSON.stringify(streamingBody(body,options)),signal:controller.signal});
    if (!response.ok) {
      const raw = await response.text(); let detail = raw.slice(0,300);
      try { detail = String(JSON.parse(raw).error?.message || detail).slice(0,300); } catch {}
      throw new RetryableError(`接口返回 ${response.status}：${detail}`,{kind:'http'});
    }
    if (!response.headers.get('content-type')?.includes('text/event-stream')) {
      const payload = await response.json();
      const {content,usage} = readPayload(payload,format);
      onDelta?.(content); return {text:content,usage};
    }
    if (!response.body) throw new RetryableError('接口没有返回数据流。',{kind:'empty'});
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const frame = (block) => {
      const data = block.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n').trim();
      if (!data) return;
      if (data === '[DONE]') { if(format==='chat') state.finished = true; return; }
      let payload;
      try { payload=JSON.parse(data); } catch { throw new RetryableError('收到无法解析的回复片段。',{kind:'not-json'}); }
      const event = block.split('\n').find(l=>l.startsWith('event:'))?.slice(6).trim();
      const before = state.text;
      state.accept(payload,event);
      if (state.text !== before) onDelta?.(state.text);
    };
    while (!state.finished) {
      const {value,done}=await reader.read();
      buffer += decoder.decode(value || new Uint8Array(),{stream:!done});
      buffer=buffer.replace(/\r\n/g,'\n');
      let split;
      while ((split=buffer.indexOf('\n\n'))>=0) { frame(buffer.slice(0,split)); buffer=buffer.slice(split+2); if(state.finished) break; }
      if (buffer.length>1000000) throw new RetryableError('回复片段过大。',{kind:'length'});
      if (done) { if(buffer.trim()) frame(buffer); break; }
    }
    return state.complete();
  };
  try { return await Promise.race([work(),interruption]); }
  catch(err) { const error = err instanceof RetryableError ? err : new RetryableError('连接中断，请检查网络后重试。',{kind:'network'}); error.usage=state.usage; throw error; }
  finally { clearTimeout(timer); signal?.removeEventListener('abort',onAbort); if(reader) { try { await reader.cancel(); } catch {} } }
}
