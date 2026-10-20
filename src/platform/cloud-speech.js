import { voiceRequest } from '../engine/voice-service.js';

const MAX_AUDIO = 12 * 1024 * 1024;
async function readBytes(response, max, signal) {
  if (Number(response.headers.get('content-length')) > max) { await response.body?.cancel(); throw new Error('语音响应过大，请缩短朗读内容。'); }
  if (!response.body) throw new Error('语音服务未返回内容。');
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) throw new Error('语音响应过大，请缩短朗读内容。');
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

function serviceError(status, code) {
  if (status === 401 || status === 403 || ['1004', 'InvalidApiKey', 'AccessDenied'].includes(String(code))) return '语音服务鉴权失败，请检查 Key、地域和模型权限。';
  if (status === 429 || ['1002', '1008', 'Throttling'].includes(String(code))) return '语音服务额度不足或请求过于频繁，请检查账户额度后重试。';
  return `语音合成失败（HTTP ${status}），请检查模型和音色配置。`;
}

export async function synthesizeCloudSpeech(service, segment, rate, { fetchImpl, signal, timeoutMs = 60000 }) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.throwIfAborted(); signal.addEventListener('abort', abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    const request = voiceRequest(service, segment, rate);
    const response = await fetchImpl(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify(request.body), signal: controller.signal, redirect: 'error', credentials: 'omit' });
    if (!response.ok) { await response.body?.cancel(); throw new Error(serviceError(response.status)); }
    const bytes = await readBytes(response, MAX_AUDIO * 2 + 65536, controller.signal);
    let data;
    try { data = JSON.parse(new TextDecoder().decode(bytes)); }
    catch { throw new Error('语音服务返回了无法识别的内容。'); }
    if (data.code || (data.base_resp && data.base_resp.status_code !== 0)) throw new Error(serviceError(response.status, data.code || data.base_resp.status_code));
    if (service.provider === 'minimax') {
      const hex = data.data?.audio;
      if (typeof hex !== 'string' || !hex.length || hex.length % 2 || hex.length > MAX_AUDIO * 2 || /[^a-f\d]/i.test(hex)) throw new Error('语音服务未返回有效音频。');
      const audio = new Uint8Array(hex.length / 2);
      for (let i = 0; i < audio.length; i++) audio[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
      return new Blob([audio], { type: 'audio/mpeg' });
    }
    let url;
    try { url = new URL(data.output?.audio?.url); } catch { throw new Error('语音服务未返回音频地址。'); }
    if (!/(^|\.)aliyuncs\.com$/i.test(url.hostname) || !['https:', 'http:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port))) throw new Error('语音服务返回的音频地址无效。');
    url.protocol = 'https:'; url.port = '';
    controller.signal.throwIfAborted();
    const audio = await fetchImpl(url.href, { signal: controller.signal, redirect: 'error', credentials: 'omit' });
    if (!audio.ok) { await audio.body?.cancel(); throw new Error('语音音频下载失败，请重试。'); }
    const content = await readBytes(audio, MAX_AUDIO, controller.signal);
    if (!content.length) throw new Error('语音服务返回了空音频。');
    return new Blob([content], { type: 'audio/mpeg' });
  } catch (error) {
    if (signal.aborted) throw new DOMException('已停止朗读', 'AbortError');
    if (timedOut) throw new Error('语音服务响应超时，请重试。');
    if (error instanceof TypeError) throw new Error('无法连接语音服务，请检查网络；网页版可能受跨域限制，可使用安装版。');
    throw error;
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
}

export function playSpeechAudio(blob, signal) {
  signal.throwIfAborted();
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = error => {
      if (finished) return; finished = true;
      clearTimeout(timer); signal.removeEventListener('abort', stop);
      audio.onended = audio.onerror = null; audio.pause(); audio.removeAttribute('src'); URL.revokeObjectURL(url);
      error ? reject(error) : resolve();
    };
    const stop = () => finish(new DOMException('已停止朗读', 'AbortError'));
    const timer = setTimeout(() => finish(new Error('音频播放超时，请重试。')), 180000);
    signal.addEventListener('abort', stop, { once: true });
    audio.onended = () => finish(); audio.onerror = () => finish(new Error('无法播放语音音频，请重试。'));
    audio.play().catch(() => finish(new Error('播放未获允许，请点击朗读按钮再试。')));
  });
}
