// 对话文本的四类标记解析。纯逻辑，不得 import 浏览器 API。
//
// 角色输出的文本约定：
//   []   环境变化、描写    [突然下雨了]
//   ()   人物动作          (鲸鱼娘摸了摸你的额头)
//   【】 心理描写          【他是不是喜欢我哇】
//   “”   说话              “你有什么想去的地方嘛？”
//
// 解析成有序片段，供渲染层按类型套样式。容错优先：
// 标记未闭合就把剩余文本当作普通文本，不吞内容、不抛错。

export const MARKERS = {
  env: { open: '[', close: ']' },
  action: { open: '(', close: ')' },
  thought: { open: '【', close: '】' },
  speech: { open: '“', close: '”', altOpen: '"', altClose: '"' },
};

const OPENERS = [
  { type: 'env', ch: '[' },
  { type: 'action', ch: '(' },
  { type: 'thought', ch: '【' },
  { type: 'speech', ch: '“' },
  { type: 'speech', ch: '"' },
];

function closerFor(type, openCh) {
  if (type === 'speech') return openCh === '“' ? '”' : '"';
  return MARKERS[type].close;
}

/**
 * 把一段角色输出切成片段。
 * @returns {{type:'plain'|'env'|'action'|'thought'|'speech', text:string}[]}
 */
export function parseMarkers(input) {
  const src = String(input ?? '');
  const out = [];
  let buf = '';
  let i = 0;

  const flush = () => {
    if (buf) {
      out.push({ type: 'plain', text: buf });
      buf = '';
    }
  };

  while (i < src.length) {
    const hit = OPENERS.find((o) => src.startsWith(o.ch, i));
    if (!hit) {
      buf += src[i];
      i += 1;
      continue;
    }
    const close = closerFor(hit.type, hit.ch);
    const end = src.indexOf(close, i + hit.ch.length);
    if (end === -1) {
      // 未闭合：整段当普通文本，避免吞掉内容
      buf += src.slice(i);
      break;
    }
    flush();
    out.push({
      type: hit.type,
      text: src.slice(i + hit.ch.length, end),
    });
    i = end + close.length;
  }
  flush();

  // 合并相邻普通文本，去掉纯空白的普通片段
  return out.filter((seg) => seg.type !== 'plain' || seg.text.trim() !== '');
}

/** 四类片段计数，便于测试与调试。 */
export function markerStats(segments) {
  const s = { plain: 0, env: 0, action: 0, thought: 0, speech: 0 };
  for (const seg of segments) s[seg.type] = (s[seg.type] || 0) + 1;
  return s;
}

/** 取出标签内的题目文本；无标签返回 null。 */
export function extractQuestion(text) {
  const m = String(text ?? '').match(/<Question>([\s\S]*?)<\/Question>/);
  return m ? m[1].trim() : null;
}

/** 从展示文本里去掉题目标签（标签内容已由界面单独呈现时可选用）。 */
export function stripQuestionTag(text) {
  return String(text ?? '').replace(/<Question>[\s\S]*?<\/Question>/g, '').trim();
}
