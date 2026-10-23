import { chatSpeechText } from './voice-service.js';

export function visibleReply(raw) {
  return String(raw || '')
    .replace(/<(TurnSummary|AnswerKey|TeachingReference|Face|Sticker)>[\s\S]*?(?:<\/\1>|$)/gi, '')
    .replace(/<Question>[\s\S]*?(?:<\/Question>|$)/gi, part => /<\/Question>$/i.test(part) ? part : '')
    .replace(/<[^>]*$/, '');
}

function nextChunk(text, final) {
  if (!text) return '';
  const question = text.search(/<Question>/i);
  if (question === 0) return text.slice(0, text.search(/<\/Question>/i) + 11);
  const plain = question > 0 ? text.slice(0, question) : text;
  const boundary = /[。！？；\n]|[.!?;](?=\s|$)/u.exec(plain);
  if (boundary) return plain.slice(0, boundary.index + boundary[0].length);
  if (plain.length >= 160) {
    const prefix = [...plain].slice(0, 120).join('');
    const space = prefix.lastIndexOf(' ');
    return prefix.slice(0, space > 60 ? space + 1 : prefix.length);
  }
  return final || question > 0 ? plain : '';
}

export function createReplyNarration({ prepare, play, signal, onText, onDone, onError, onCancel }) {
  let visible = '', consumed = 0, completed = '', displayed = '';
  let running = false, ended = false, stopped = false, notified = false;
  const queue = [];
  const emit = text => { if (displayed !== text) { displayed = text; onText?.(text); } };
  const done = () => {
    if (notified) return;
    notified = true; signal.removeEventListener('abort', stop); onDone?.();
  };
  function stop() {
    if (stopped) return;
    stopped = true; queue.length = 0; emit(visible); done(); onCancel?.();
  }
  function warm() {
    for (const item of queue.slice(0, 2)) {
      if (!item.ready) item.ready = item.speech
        ? Promise.resolve().then(() => { signal.throwIfAborted(); return prepare(item.speech); }).then(value => ({ value }), error => ({ error }))
        : Promise.resolve({ value: null });
    }
  }
  async function drain() {
    if (running || stopped) return;
    running = true;
    try {
      while (queue.length && !stopped) {
        warm();
        const item = queue[0], result = await item.ready;
        if (stopped || signal.aborted) return;
        if (result.error) throw result.error;
        const chars = [...item.display];
        if (result.value !== null) await play(result.value, fraction => {
          if (stopped || signal.aborted) return;
          const count = Math.max(item.revealed || 0, Math.min(chars.length, Math.floor(fraction * chars.length)));
          item.revealed = count;
          emit(completed + chars.slice(0, count).join(''));
        });
        if (stopped || signal.aborted) return;
        completed += item.display; emit(completed); queue.shift();
      }
      if (ended && !stopped) { emit(visible); done(); }
    } catch (error) {
      if (!stopped && !signal.aborted) { stop(); onError?.(error); }
    } finally { running = false; }
  }
  function push(raw, final = false) {
    const next = visibleReply(raw);
    if (!next.startsWith(visible) && !stopped) stop();
    visible = next;
    if (final) ended = true;
    if (stopped) { emit(visible); return; }
    let chunk;
    while ((chunk = nextChunk(visible.slice(consumed), final))) {
      consumed += chunk.length;
      queue.push({ display: chunk, speech: chatSpeechText(chunk) });
    }
    warm(); void drain();
  }
  signal.addEventListener('abort', stop, { once: true });
  if (signal.aborted) stop();
  return { push, finish: raw => push(raw, true) };
}
