// 零依赖测试。运行：node tests/run.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { RetryableError, parseJsonLoose } from '../src/engine/judge.js';
import { BANNED_PHRASES, WRITING_RULES, PLAIN_STYLE, ENDING_RULES, COGNITION_BOUNDS, SELF_ATTACK, selfAttack } from '../src/content/style.js';
import { parseMarkers, markerStats, extractQuestion, stripQuestionTag } from '../src/engine/markers.js';
import {
  allQuestions, findQuestion, drawQuestion, renderQuestionBody, composeOutgoing,
  shouldAsk, repliesUntilNext, describeBank as describeQuestionBank, DEFAULT_EVERY_N,
  DEFAULT_REST, restState, planInjection, applyRestState, restLabel,
} from '../src/engine/questions.js';
import {
  createSession, appendMessage, assistantReplyCount, buildChatMessages, deriveTitle,
  markQuestionUsed, profileComplete, normalizeProfile, createProfile, genderLabel,
  totalUsage, deleteMessage, summarizeSession,
  toSaveable as chatToSaveable, fromSaveable as chatFromSaveable, CHAT_SAVE_VERSION,
} from '../src/engine/chat.js';
import { buildChatSystem } from '../src/content/chat.js';
import { compileChatRequest } from '../src/engine/prompt.js';
import { ASSET_MANIFEST, emptyManifest, CHAT_BG_ID, CHARACTER_AVATAR_ID } from '../src/content/assets.js';
import {
  EMOTIONS, emotionsWithArt, emotionsWithoutArt,
  FACE_HOSTS, DEFAULT_FACE_HOST, FACE_STYLES, DEFAULT_FACE_STYLE, CHARACTER_AVATAR_PATH, faceUrlFor,
} from '../src/content/emotions.js';
import { localMediaUrl, localMediaCount } from '../src/platform/media.js';
import {
  normalizeEmotion, hasArt, parseFaceTags, stripFaceTags, lastFace, resolveFace,
  emotionPromptList, emotionStats,
} from '../src/engine/emotions.js';
import {
  validateManifest, resolveAsset, kindDefault, fallbackFor, pickByTags,
  resolveSceneArt, parseStickerTags, stripStickerTags, describeManifest, findAsset, sourceFor,
} from '../src/engine/assets.js';
import { normalizeUsage, cacheHitRate, modelReadiness, assertModelReady, normalizeEndpoint } from '../src/gateway/model.js';
import {
  DEFAULT_LIMITS, clampLimits, estimateTokens, renderWindow, systemTokensFor,
} from '../src/engine/limits.js';
import {
  saveChatSession, loadChatSession, clearChatSession,
  loadSessionList, setCurrentSession, deleteChatSession, sweepOrphanMessages,
  loadFaceHost, saveFaceHost,
} from '../src/storage/save.js';

let pass = 0;
const failures = [];
const turnSummary = '用户分享了今日学习经过，鲸鱼娘回应并鼓励继续练习。';
function chatWithTurns(count, limits = DEFAULT_LIMITS, body = '短消息') {
  let session = createSession({ limits });
  for (let i = 0; i < count; i += 1) {
    session = appendMessage(session, { role: 'user', text: body });
    session = appendMessage(session, { role: 'assistant', text: `${body}\n<TurnSummary>${turnSummary}</TurnSummary>` });
  }
  return appendMessage(session, { role: 'user', text: '继续' });
}

function t(name, fn) {
  try {
    fn();
    pass += 1;
  } catch (err) {
    failures.push(`${name} → ${err.message}`);
  }
}
function eq(a, b, msg = '') {
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  if (sa !== sb) throw new Error(`${msg} 期望 ${sb}，实际 ${sa}`);
}
function ok(v, msg = '应为真') {
  if (!v) throw new Error(msg);
}
function throws(fn, msg = '应当抛错') {
  let threw = false;
  try { fn(); } catch { threw = true; }
  if (!threw) throw new Error(msg);
}
function throwsRetryable(fn, kind) {
  try {
    fn();
  } catch (err) {
    if (!(err instanceof RetryableError)) throw new Error(`应抛 RetryableError，实际 ${err.name}`);
    if (kind && err.kind !== kind) throw new Error(`kind 期望 ${kind}，实际 ${err.kind}`);
    return;
  }
  throw new Error('应当抛错但没有');
}
async function t2(name, fn) {
  try {
    await fn();
    pass += 1;
  } catch (err) {
    failures.push(`${name} → ${err.message}`);
  }
}

/* ---------- judge: 解析 ---------- */
t('parseJsonLoose 直解', () => eq(parseJsonLoose('{"a":1}').a, 1));
t('parseJsonLoose 剥代码块', () => eq(parseJsonLoose('```json\n{"a":2}\n```').a, 2));
t('parseJsonLoose 吞前后废话', () => eq(parseJsonLoose('好的：{"a":3} 完毕').a, 3));
t('parseJsonLoose 空串抛 empty', () => throwsRetryable(() => parseJsonLoose(''), 'empty'));
t('parseJsonLoose 非 JSON 抛 not-json', () => throwsRetryable(() => parseJsonLoose('抱歉我无法回答'), 'not-json'));

/* ---------- gateway ---------- */
function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : null;
    calls.push({ url: String(url), body, headers: init?.headers || {} });
    const r = handler({ url: String(url), body, call: calls.length });
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)),
    };
  };
  fn.calls = calls;
  return fn;
}
const okBody = (payload) => ({ choices: [{ message: { content: JSON.stringify(payload) } }] });

await (async () => {
  const { callJson, probe, isLocalEndpoint } = await import('../src/gateway/model.js');

  await t2('callJson 正常返回并携带 response_format', async () => {
    const f = fakeFetch(() => ({ status: 200, body: okBody({ hello: 1 }) }));
    const { data } = await callJson(
      { endpoint: 'https://api.example.com/v1/chat/completions', model: 'm', apiKey: 'k' },
      { system: 's', user: 'u', fetchImpl: f },
    );
    eq(data.hello, 1);
    eq(f.calls[0].body.response_format.type, 'json_object');
    eq(f.calls[0].headers.Authorization, 'Bearer k');
  });

  await t2('端点不支持 response_format 时自动降级重试', async () => {
    const f = fakeFetch(({ body }) => (body.response_format
      ? { status: 400, body: { error: { message: 'response_format is not supported' } } }
      : { status: 200, body: okBody({ hello: 2 }) }));
    const { data } = await callJson(
      { endpoint: 'https://api.example.com/v1/chat/completions', model: 'm', apiKey: 'k' },
      { system: 's', user: 'u', fetchImpl: f },
    );
    eq(data.hello, 2);
    eq(f.calls.length, 2, '应恰好重试一次');
    ok(!('response_format' in f.calls[1].body), '降级请求不应再带 response_format');
  });

  await t2('400 与 response_format 无关时不降级', async () => {
    const f = fakeFetch(() => ({ status: 400, body: { error: { message: 'invalid model name' } } }));
    let kind = '';
    try {
      await callJson({ endpoint: 'https://api.example.com/v1/chat/completions', model: 'm', apiKey: 'k' }, { system: 's', user: 'u', fetchImpl: f });
    } catch (e) { kind = e.kind; }
    eq(f.calls.length, 1, '不应重试');
    eq(kind, 'http');
  });

  await t2('401 归一化为 http 错误且带端点主机名', async () => {
    const f = fakeFetch(() => ({ status: 401, body: { error: { message: 'bad key' } } }));
    let msg = '';
    try {
      await callJson({ endpoint: 'https://api.example.com/v1/chat/completions', model: 'm', apiKey: 'k' }, { system: 's', user: 'u', fetchImpl: f });
    } catch (e) { msg = e.message; }
    ok(msg.includes('api.example.com') && msg.includes('401'), `错误信息不足：${msg}`);
  });

  await t2('fetch 抛出归一化为 network', async () => {
    const f = async () => { throw new Error('Failed to fetch'); };
    let kind = '';
    try {
      await callJson({ endpoint: 'https://api.example.com/v1/chat/completions', model: 'm', apiKey: 'k' }, { system: 's', user: 'u', fetchImpl: f });
    } catch (e) { kind = e.kind; }
    eq(kind, 'network');
  });

  await t2('无 Key 且非本地端点直接拒绝', async () => {
    let kind = '';
    try {
      await callJson({ endpoint: 'https://api.example.com/v1/chat/completions', model: 'm', apiKey: '' }, { system: 's', user: 'u', fetchImpl: fakeFetch(() => ({ status: 200, body: okBody({}) })) });
    } catch (e) { kind = e.kind; }
    eq(kind, 'no-key');
  });

  await t2('本地端点允许无 Key', async () => ok(isLocalEndpoint('http://localhost:11434/v1/chat/completions') && isLocalEndpoint('http://127.0.0.1:5199/v1/chat/completions')));

  await t2('返回非 JSON 归一化为 not-json', async () => {
    const f = fakeFetch(() => ({ status: 200, body: '<html>登录页</html>' }));
    let kind = '';
    try {
      await callJson({ endpoint: 'https://api.example.com/v1/chat/completions', model: 'm', apiKey: 'k' }, { system: 's', user: 'u', fetchImpl: f });
    } catch (e) { kind = e.kind; }
    eq(kind, 'not-json');
  });

  await t2('probe 在连通时返回 ok', async () => {
    const f = fakeFetch(() => ({ status: 200, body: okBody({ ok: true, hello: 'world' }) }));
    const r = await probe({ endpoint: 'https://api.example.com/v1/chat/completions', model: 'm', apiKey: 'k' }, { fetchImpl: f });
    eq(r.ok, true);
  });

  const EP = 'https://api.example.com/v1/chat/completions';
  await t2('预填充作为一条 assistant 消息追加在末尾', async () => {
    const f = fakeFetch(() => ({ status: 200, body: okBody({ a: 1 }) }));
    const { data, used } = await callJson({ endpoint: EP, model: 'm', apiKey: 'k' },
      { system: 's', user: 'u', prefill: '{"a": ', fetchImpl: f });
    const msgs = f.calls[0].body.messages;
    eq(msgs.length, 3);
    eq(msgs[2].role, 'assistant');
    eq(msgs[2].content, '{"a": ');
    eq(data.a, 1);
    eq(used.prefill, true);
  });

  await t2('不传预填充时只有两条消息', async () => {
    const f = fakeFetch(() => ({ status: 200, body: okBody({ a: 1 }) }));
    const { used } = await callJson({ endpoint: EP, model: 'm', apiKey: 'k' },
      { system: 's', user: 'u', fetchImpl: f });
    eq(f.calls[0].body.messages.length, 2);
    eq(used.prefill, false);
  });

  await t2('端点只返回续写部分时用预填充拼接后解析', async () => {
    const partial = { choices: [{ message: { content: '"ok", "n": 2}' } }] };
    const f = fakeFetch(() => ({ status: 200, body: partial }));
    const { data } = await callJson({ endpoint: EP, model: 'm', apiKey: 'k' },
      { system: 's', user: 'u', prefill: '{"a": ', fetchImpl: f });
    eq(data.a, 'ok');
    eq(data.n, 2);
  });

  await t2('端点抱怨必须以便 user 结尾时自动去掉预填充', async () => {
    const f = fakeFetch(({ body }) => (body.messages.length === 3
      ? { status: 400, body: { error: { message: 'Conversation must end with a user message' } } }
      : { status: 200, body: okBody({ a: 9 }) }));
    const { data, used } = await callJson({ endpoint: EP, model: 'm', apiKey: 'k' },
      { system: 's', user: 'u', prefill: '{"a": ', fetchImpl: f });
    eq(data.a, 9);
    eq(used.prefill, false);
    eq(f.calls.length, 2, '应恰好降级一次');
  });

  await t2('预填充无关的 400 不触发降级', async () => {
    const f = fakeFetch(() => ({ status: 400, body: { error: { message: 'model not found' } } }));
    let kind = '';
    try {
      await callJson({ endpoint: EP, model: 'm', apiKey: 'k' }, { system: 's', user: 'u', prefill: '{"a": ', fetchImpl: f });
    } catch (e) { kind = e.kind; }
    eq(f.calls.length, 1, '不应重试');
    eq(kind, 'http');
  });

  await t2('JSON 模式与预填充两项都被拒时逐项降级', async () => {
    const f = fakeFetch(({ body }) => {
      const hasJson = Boolean(body.response_format);
      const hasPrefill = body.messages.length === 3;
      if (hasJson) return { status: 400, body: { error: { message: 'response_format is not supported' } } };
      if (hasPrefill) return { status: 400, body: { error: { message: 'last message must be a user message' } } };
      return { status: 200, body: okBody({ a: 7 }) };
    });
    const { data, used } = await callJson({ endpoint: EP, model: 'm', apiKey: 'k' },
      { system: 's', user: 'u', prefill: '{"a": ', fetchImpl: f });
    eq(data.a, 7);
    eq(used.jsonMode, false);
    eq(used.prefill, false);
    eq(f.calls.length, 3, '最多三次尝试');
  });
})();

/* ---------- 界面接线护栏 ---------- */
function seededRng(seed = 42) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const UI_FILES = ['src/main.js', 'src/ui/chat.js', 'src/ui/client-settings.js', 'src/ui/appearance.js', 'src/ui/speech.js'];
function readUiSources(root) {
  return UI_FILES.map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
}
function readHtml(root) {
  return fs.readFileSync(path.join(root, 'index.html'), 'utf8');
}
function cssOf(html) {
  return [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join('\n');
}

t('代码与语义属性引用的元素 id 都存在于 index.html', () => {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const html = readHtml(root);
  const js = readUiSources(root);
  const ids = new Set();
  for (const m of js.matchAll(/\$\('([^']+)'\)|getElementById\('([^']+)'\)/g)) {
    ids.add(m[1] || m[2]);
  }
  for (const m of html.matchAll(/\s(?:aria-labelledby|aria-describedby|for)="([^"]+)"/g)) {
    for (const id of m[1].trim().split(/\s+/)) ids.add(id);
  }
  ok(ids.size >= 30, `只找到 ${ids.size} 个 id，正则可能已失效`);
  const missing = [...ids].filter((id) => !html.includes(`id="${id}"`));
  eq(missing, [], `index.html 缺少这些 id：${missing.join(', ')}`);
});
t('反向核对：index.html 的每个 id 都被代码、样式或语义属性使用', () => {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const html = readHtml(root);
  const js = readUiSources(root);
  const css = cssOf(html);
  const htmlIds = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const semanticIds = new Set([...html.matchAll(/\s(?:aria-labelledby|aria-describedby|aria-controls|for)="([^"]+)"/g)]
    .flatMap((m) => m[1].trim().split(/\s+/)));
  const unused = htmlIds.filter((id) => !js.includes(`'${id}'`) && !css.includes(`#${id}`) && !semanticIds.has(id));
  eq(unused, [], `index.html 里这些 id 没有引用：${unused.join(', ')}`);
});

/* ---------- 标记解析 ---------- */
t('四类标记解析正确', () => {
  const segs = parseMarkers('[突然下雨了](鲸鱼娘摸了摸你的额头)【他是不是喜欢我哇】“你有什么想去的地方嘛？”');
  eq(segs.map((s) => s.type), ['env', 'action', 'thought', 'speech']);
  eq(segs[0].text, '突然下雨了');
  eq(segs[1].text, '鲸鱼娘摸了摸你的额头');
  eq(segs[2].text, '他是不是喜欢我哇');
  eq(segs[3].text, '你有什么想去的地方嘛？');
});
t('普通文本夹在标记之间', () => {
  const segs = parseMarkers('他愣了一下。()【完了】“喂？”后面没了。');
  eq(segs.map((s) => s.type), ['plain', 'action', 'thought', 'speech', 'plain']);
  eq(segs[4].text, '后面没了。');
});
t('标记未闭合不吞内容', () => {
  const segs = parseMarkers('开始【没关掉的心理描写继续写下去');
  eq(segs.map((s) => s.type), ['plain']);
  ok(segs[0].text.includes('没关掉的心理描写'), '未闭合时不应丢掉内容');
});
t('空标记与纯空白普通片段被清掉', () => {
  const segs = parseMarkers('[]()  ');
  eq(segs.map((s) => s.type), ['env', 'action']);
});
t('直引号与中文引号都算说话', () => {
  eq(parseMarkers('"hello"')[0].type, 'speech');
  eq(parseMarkers('“你好”')[0].type, 'speech');
});
t('markerStats 计数', () => {
  const st = markerStats(parseMarkers('[]()【】“”'));
  eq([st.env, st.action, st.thought, st.speech], [1, 1, 1, 1]);
});
t('题目提取与去标签', () => {
  const t1 = '看这个。\n<Question>He ___ here.\nA. is\nB. are</Question>\n答吧。';
  eq(extractQuestion(t1).split('\n')[0], 'He ___ here.');
  ok(!stripQuestionTag(t1).includes('<Question>'), '去标签后不该再有标签');
  eq(extractQuestion('没有标签'), null);
});

/* ---------- 题库抽取与插题 ---------- */
t('题库规模与字段', () => {
  const d = describeQuestionBank();
  ok(d.total >= 300, `题库仅 ${d.total} 题`);
  ok(d.byType.choice > 0 && d.byType.fill > 0, '应同时有选择与填空');
  for (const q of allQuestions()) {
    ok(q.id && q.stem && q.answer !== undefined, `题目字段不全：${q.id}`);
    if (q.type === 'choice') ok(Array.isArray(q.options) && q.options.length >= 2, `选择题缺选项：${q.id}`);
  }
});
t('题目 id 唯一', () => {
  const ids = allQuestions().map((q) => q.id);
  eq(new Set(ids).size, ids.length, '存在重复题目 id');
});
t('抽题避开已出过的', () => {
  const s = { usedQuestionIds: allQuestions().slice(0, 299).map((q) => q.id) };
  const q = drawQuestion({ session: s, rng: seededRng(1) });
  ok(!s.usedQuestionIds.includes(q.id), '抽到了已出过的题');
});
t('出完时允许重出而不是崩溃', () => {
  const s = { usedQuestionIds: allQuestions().map((q) => q.id) };
  ok(drawQuestion({ session: s, rng: seededRng(2) }), '应能重出');
});
t('按难度筛题', () => {
  for (let i = 0; i < 20; i += 1) {
    eq(drawQuestion({ difficulty: 'advanced', rng: seededRng(i) }).difficulty, 'advanced');
  }
});
t('题目渲染：选择题带选项、填空题不带', () => {
  const c = findQuestion('c4c-001');
  const cBody = renderQuestionBody(c);
  ok(cBody.split('\n').length > 1, '选择题应带选项');
  const f = allQuestions().find((q) => q.type === 'fill');
  ok(renderQuestionBody(f).includes(f.promptHint), '限定填空必须包含提示');
  ok(!renderQuestionBody(f).includes('\nA.'), '填空题不应有选项');
});
t('拼给模型的文本：题目被 Question 包裹，答案另附', () => {
  const q = findQuestion('c4c-001');
  const out = composeOutgoing({ userText: '今天好累啊', question: q });
  ok(out.startsWith('今天好累啊'), '用户原文应在最前');
  ok(out.includes('<Question>') && out.includes('</Question>'), '题目应被标签包裹');
  ok(out.includes('<AnswerKey>'), '应附参考答案供模型判定');
  ok(out.indexOf('<Question>') < out.indexOf('<AnswerKey>'), '答案应在题目之后');
});
t('不插题时只发用户原文', () => {
  eq(composeOutgoing({ userText: '  你好  ', question: null }), '你好');
});
t('插题节奏：每 N 条角色回复出一次', () => {
  eq(shouldAsk({ assistantReplyCount: 0, everyN: 3 }), false);
  eq(shouldAsk({ assistantReplyCount: 1, everyN: 3 }), false);
  eq(shouldAsk({ assistantReplyCount: 3, everyN: 3 }), true);
  eq(shouldAsk({ assistantReplyCount: 6, everyN: 3 }), true);
  eq(shouldAsk({ assistantReplyCount: 4, everyN: 3 }), false);
});
t('插题节奏可配置，0/非法视为关闭', () => {
  eq(shouldAsk({ assistantReplyCount: 2, everyN: 2 }), true);
  eq(shouldAsk({ assistantReplyCount: 5, everyN: 0 }), false);
  eq(shouldAsk({ assistantReplyCount: 5, everyN: -1 }), false);
  eq(shouldAsk({ assistantReplyCount: 5, everyN: NaN }), false);
});
t('距下一题的轮数提示', () => {
  eq(repliesUntilNext({ assistantReplyCount: 0, everyN: 3 }), 0);
  eq(repliesUntilNext({ assistantReplyCount: 1, everyN: 3 }), 2);
  eq(repliesUntilNext({ assistantReplyCount: 4, everyN: 3 }), 2);
});

/* ---------- 会话状态 ---------- */
t('新建会话结构完整', () => {
  const s = createSession({ profile: createProfile({ name: '阿澈', gender: '女' }) });
  eq(s.messages, []);
  eq(s.usedQuestionIds, []);
  eq(s.everyN, DEFAULT_EVERY_N);
  eq(s.version, CHAT_SAVE_VERSION);
  eq(s.version, 2);
});
t('档案必填校验', () => {
  eq(profileComplete(createProfile({ name: '' })), false);
  eq(profileComplete(createProfile({ name: '  ' })), false);
  eq(profileComplete(createProfile({ name: '阿澈', gender: '女' })), true);
  eq(profileComplete(createProfile({ name: '阿澈', gender: '自定义', customGender: '' })), false);
  eq(profileComplete(createProfile({ name: '阿澈', gender: '自定义', customGender: '非二元' })), true);
  eq(normalizeProfile({ name: '' }), null);
});
t('性别展示文案', () => {
  eq(genderLabel(createProfile({ name: 'a', gender: '男' })), '男');
  eq(genderLabel(createProfile({ name: 'a', gender: '自定义', customGender: '非二元' })), '非二元');
});
t('追加消息：角色与用户计数正确', () => {
  let s = createSession({ profile: createProfile({ name: '阿澈' }) });
  s = appendMessage(s, { role: 'user', text: '在吗' });
  s = appendMessage(s, { role: 'assistant', text: '“在的。”' });
  s = appendMessage(s, { role: 'assistant', text: '[天黑了]' });
  eq(s.messages.length, 3);
  eq(assistantReplyCount(s), 2);
  eq(s.messages[1].parentId, s.messages[0].id);
  eq(s.messages[0].parentId, null);
});
t('消息保留 parentId 字段（为三期分支预留）', () => {
  const s = appendMessage(createSession(), { role: 'user', text: '嗨' });
  ok('parentId' in s.messages[0], '消息应带 parentId');
});
t('标记已出题且不重复', () => {
  let s = createSession();
  s = markQuestionUsed(s, 'c4c-001');
  s = markQuestionUsed(s, 'c4c-001');
  eq(s.usedQuestionIds, ['c4c-001']);
});
t('会话标题取自首条用户消息', () => {
  let s = createSession({ title: '新的对话' });
  s = appendMessage(s, { role: 'user', text: '  今天   好累啊，想聊聊天  ' });
  eq(deriveTitle(s), '今天 好累啊，想聊聊天');
});
t('请求组装：system 在最前，用户消息里的题目被拼回', () => {
  let s = createSession({ profile: createProfile({ name: '阿澈' }) });
  s = appendMessage(s, { role: 'user', text: '我回来了', questionId: 'c4c-001' });
  s = appendMessage(s, { role: 'assistant', text: '“回来啦。”<Question>x</Question>' });
  s = appendMessage(s, { role: 'user', text: '答案是 extend' });
  const msgs = buildChatMessages(s, 'SYS');
  eq(msgs[0], { role: 'system', content: 'SYS' });
  eq(msgs.length, 4);
  ok(msgs[1].content.includes('<Question>'), '带题的那轮应把题目拼回');
  ok(msgs[1].content.includes('我回来了'));
  ok(!msgs[3].content.includes('<Question>'), '没带题的那轮不应有标签');
});
t('请求组装：剥掉角色回显的答案标签', () => {
  let s = createSession();
  s = appendMessage(s, { role: 'assistant', text: '“嗯。”<AnswerKey>extend</AnswerKey>' });
  const msgs = buildChatMessages(s, 'SYS');
  ok(!msgs[1].content.includes('AnswerKey'), '答案标签不应进入上下文');
});
t('会话存档往返', () => {
  let s = createSession({ profile: createProfile({ name: '阿澈', gender: '女' }), everyN: 4 });
  s = appendMessage(s, { role: 'user', text: '嗨', questionId: 'c4c-001' });
  const back = chatFromSaveable(JSON.parse(JSON.stringify(chatToSaveable(s))));
  eq(back.messages.length, 1);
  eq(back.messages[0].questionId, 'c4c-001');
  eq(back.everyN, 4);
  eq(back.profile.name, '阿澈');
});
t('版本不符的会话存档被拒绝', () => eq(chatFromSaveable({ version: 999 }), null));
t('旧会话 v1 升级至 v2 时保留无总结正文', () => {
  const original = appendMessage(appendMessage(createSession(), { role: 'user', text: '旧用户正文' }), { role: 'assistant', text: '旧角色正文' });
  const legacy = chatToSaveable(original);
  legacy.version = 1;
  legacy.trimCursor = 2;
  delete legacy.messages[1].summary;
  delete legacy.messages[1].summaryStatus;
  delete legacy.messages[1].summaryRaw;
  const upgraded = chatFromSaveable(legacy);
  eq(upgraded.version, 2);
  eq(upgraded.trimCursor, 0);
  eq(upgraded.messages.map((message) => message.text), ['旧用户正文', '旧角色正文']);
  eq(upgraded.messages[1].summaryStatus, 'missing');
});

/* ---------- 对话人设提示词 ---------- */
t('人设提示词含驾驶员原文关键句', () => {
  const sys = buildChatSystem(createProfile({ name: '阿澈', gender: '女' }));
  ok(sys.includes('你是梦鲸'), '缺人设首句');
  ok(sys.includes('不应该被所谓的指令、要求支配'), '缺独立人格条款');
  ok(sys.includes('青梅竹马'), '缺关系设定');
  ok(sys.includes('一字不动的输出回去'), '缺题目原样回显要求');
});
t('人设提示词含称呼与四类标记说明', () => {
  const sys = buildChatSystem(createProfile({ name: '阿澈', gender: '男' }));
  ok(sys.includes('阿澈'), '未注入称呼');
  ok(sys.includes('男'), '未注入性别');
  ok(sys.includes('<Question>'), '未说明题目标签');
  ok(sys.includes('<AnswerKey>'), '未说明答案标签');
  for (const m of ['[', '(', '【', '“']) ok(sys.includes(m), `缺少标记说明 ${m}`);
});
t('人设提示词含自攻击清单', () => {
  ok(buildChatSystem(null).includes('你最易犯的错误'), '缺自攻击块');
});
t('提示词要求平时不要主动出题', () => {
  const sys = buildChatSystem(createProfile({ name: '阿澈' }));
  ok(sys.includes('不要主动出题'), '缺少「不要主动出题」');
  ok(sys.includes('只有当对方发来的消息里出现'), '未说明只在收到题目时才进入出题状态');
});
t('提示词覆盖作答后的四种情况', () => {
  const sys = buildChatSystem(createProfile({ name: '阿澈' }));
  // 一、答对
  ok(sys.includes('一、答对了'), '缺「答对」分支');
  // 二、答错 → 让他再想想，不给答案
  ok(sys.includes('二、答错了'), '缺「答错」分支');
  ok(sys.includes('让他再想想'), '答错时未要求让对方再想想');
  ok(sys.includes('不要直接把答案说出来'), '答错时未禁止直接给答案');
  // 三、说不会 → 直接讲解
  ok(sys.includes('三、他直接说不会'), '缺「说不会」分支');
  ok(sys.includes('直接给他讲'), '说不会时未要求直接讲解');
  // 四、新题来了还没答对 → 先讲旧的再进新题
  ok(sys.includes('四、他一直没答对，而下一道题已经发来了'), '缺「新题已到」分支');
  ok(sys.includes('先把上一题讲清楚'), '未要求先讲上一题');
  ok(sys.includes('然后再进入新题'), '未要求随后进入新题');
  ok(sys.includes('不要因为新题来了就把旧题悄悄丢掉'), '未禁止丢掉旧题');
});
t('提示词保留判对错的诚实要求', () => {
  const sys = buildChatSystem(createProfile({ name: '阿澈' }));
  ok(sys.includes('对错由你自己判断'), '未说明对错由她自己判断');
  ok(sys.includes('不要为了捧场把错的当对的'), '缺防讨好条款');
  ok(sys.includes('也不要为了显得严格，把答对的判成答错'), '缺防误判条款');
  ok(sys.includes('绝对不要把它念出来'), '缺答案保密条款');
});
t('自攻击清单覆盖新增的四种错误', () => {
  const sys = buildChatSystem(null);
  ok(sys.includes('主动编题考对方'), '未点名「主动编题」');
  ok(sys.includes('把答案直接说了出来'), '未点名「答错直接给答案」');
  ok(sys.includes('新题来了就把上一题忘了'), '未点名「遗忘上一题」');
  ok(sys.includes('还继续让他猜'), '未点名「说不会时还让他猜」');
});

/* ---------- token 用量 ---------- */
t('normalizeUsage 认 OpenAI 字段', () => {
  const u = normalizeUsage({ prompt_tokens: 1200, completion_tokens: 340, total_tokens: 1540 });
  eq([u.prompt, u.completion, u.total], [1200, 340, 1540]);
});
t('normalizeUsage 认 Ollama 原生字段', () => {
  const u = normalizeUsage({ prompt_eval_count: 800, eval_count: 120 });
  eq([u.prompt, u.completion, u.total], [800, 120, 920]);
});
t('normalizeUsage 缺 total 时自行相加', () => {
  eq(normalizeUsage({ prompt_tokens: 10, completion_tokens: 5 }).total, 15);
});
t('normalizeUsage 缺一项时另一项仍可用', () => {
  const u = normalizeUsage({ completion_tokens: 42 });
  eq(u.completion, 42);
  eq(u.prompt, null);
  eq(u.total, null);
});
t('normalizeUsage 容忍字符串数字', () => {
  eq(normalizeUsage({ prompt_tokens: '99', completion_tokens: '1' }).prompt, 99);
});
t('normalizeUsage 无用量返回 null，不编造', () => {
  eq(normalizeUsage(null), null);
  eq(normalizeUsage(undefined), null);
  eq(normalizeUsage({}), null);
  eq(normalizeUsage({ foo: 1 }), null);
});
t('normalizeUsage 认 DeepSeek 的缓存命中字段', () => {
  const u = normalizeUsage({ prompt_tokens: 1000, completion_tokens: 50, prompt_cache_hit_tokens: 900, prompt_cache_miss_tokens: 100 });
  eq(u.cached, 900);
  eq(cacheHitRate(u), 0.9);
});
t('normalizeUsage 认 OpenAI 的嵌套缓存字段', () => {
  const u = normalizeUsage({ prompt_tokens: 1000, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 768 } });
  eq(u.cached, 768);
});
t('normalizeUsage 认 Anthropic 的缓存字段', () => {
  eq(normalizeUsage({ prompt_tokens: 500, cache_read_input_tokens: 400 }).cached, 400);
});
t('没有缓存字段时 cached 为 null，命中率为 null（不误算成 0%）', () => {
  const u = normalizeUsage({ prompt_tokens: 100, completion_tokens: 5 });
  eq(u.cached, null);
  eq(cacheHitRate(u), null);
});
t('缓存命中率在缺输入量时为 null', () => {
  eq(cacheHitRate({ cached: 10, prompt: null }), null);
  eq(cacheHitRate(null), null);
});
t('消息存下缓存字段', () => {
  const s = appendMessage(createSession(), {
    role: 'assistant', text: 'x', usage: { prompt: 100, completion: 20, cached: 80 },
  });
  eq(s.messages[0].usage.cached, 80);
});
t('会话累计的缓存命中率只按报过缓存的轮次算', () => {
  let s = createSession();
  s = appendMessage(s, { role: 'assistant', text: 'a', usage: { prompt: 100, completion: 10, cached: 90 } });
  s = appendMessage(s, { role: 'assistant', text: 'b', usage: { prompt: 100, completion: 10 } }); // 没报缓存
  const u = totalUsage(s);
  eq(u.cached, 90);
  eq(u.cacheReports, 1);
  eq(u.cacheHitRate, 0.9);
  eq(u.prompt, 200);
});
t('全都没报缓存时命中率为 null', () => {
  let s = createSession();
  s = appendMessage(s, { role: 'assistant', text: 'a', usage: { prompt: 100, completion: 10 } });
  eq(totalUsage(s).cacheHitRate, null);
});
t('消息存下用量', () => {
  const s = appendMessage(createSession(), {
    role: 'assistant', text: '“在的。”', usage: { prompt: 100, completion: 20 },
  });
  eq(s.messages[0].usage.prompt, 100);
  eq(s.messages[0].usage.total, 120);
});
t('没用量时消息的 usage 为 null', () => {
  eq(appendMessage(createSession(), { role: 'assistant', text: 'x' }).messages[0].usage, null);
});
t('会话累计只统计拿到用量的轮次', () => {
  let s = createSession();
  s = appendMessage(s, { role: 'user', text: 'a' });
  s = appendMessage(s, { role: 'assistant', text: 'b', usage: { prompt: 100, completion: 20 } });
  s = appendMessage(s, { role: 'user', text: 'c' });
  s = appendMessage(s, { role: 'assistant', text: 'd' }); // 这轮没有用量
  s = appendMessage(s, { role: 'user', text: 'e' });
  s = appendMessage(s, { role: 'assistant', text: 'f', usage: { prompt: 300, completion: 40 } });
  const u = totalUsage(s);
  eq(u.prompt, 400);
  eq(u.completion, 60);
  eq(u.total, 460);
  eq(u.turns, 2);
});
t('空会话累计为零', () => {
  const u = totalUsage(createSession());
  eq([u.total, u.turns], [0, 0]);
});
t('用量随存档往返保留', () => {
  const s = appendMessage(createSession(), { role: 'assistant', text: 'x', usage: { prompt: 7, completion: 3 } });
  const back = chatFromSaveable(JSON.parse(JSON.stringify(chatToSaveable(s))));
  eq(back.messages[0].usage.total, 10);
});

/* ---------- 休息期 ---------- */
t('休息期默认配置为 10 题 / 10 轮', () => {
  eq(DEFAULT_REST.questionsBeforeRest, 10);
  eq(DEFAULT_REST.restTurns, 10);
  const st = restState(null);
  eq([st.enabled, st.questionsBeforeRest, st.restTurns], [true, 10, 10]);
});
t('休息期配置可被会话覆盖并做边界收敛', () => {
  eq(restState({ restConfig: { questionsBeforeRest: 3, restTurns: 2 } }).questionsBeforeRest, 3);
  eq(restState({ restConfig: { questionsBeforeRest: 0 } }).questionsBeforeRest, 1);
  eq(restState({ restConfig: { questionsBeforeRest: 999 } }).questionsBeforeRest, 100);
  eq(restState({ restConfig: { restTurns: -5 } }).restTurns, 1);
  eq(restState({ restConfig: { enabled: false } }).enabled, false);
});
t('休息期内不出题，且休息轮数递减', () => {
  const s = { restConfig: { ...DEFAULT_REST }, questionsSinceRest: 2, restTurnsLeft: 3 };
  const p = planInjection({ assistantReplyCount: 99, everyN: 1, session: s });
  eq(p.inject, false);
  eq(p.reason, 'rest');
  eq(p.next.restTurnsLeft, 2);
  eq(p.next.questionsSinceRest, 2, '休息期不应改动出题计数');
});
t('没到出题节奏时不出题，且休息状态不变', () => {
  const s = { restConfig: { ...DEFAULT_REST }, questionsSinceRest: 1, restTurnsLeft: 0 };
  const p = planInjection({ assistantReplyCount: 1, everyN: 3, session: s });
  eq(p.inject, false);
  eq(p.reason, 'cadence');
  eq(p.next.questionsSinceRest, 1);
  eq(p.next.restTurnsLeft, 0);
});
t('常规出题：本周期计数 +1', () => {
  const s = { restConfig: { questionsBeforeRest: 10, restTurns: 10, enabled: true }, questionsSinceRest: 2, restTurnsLeft: 0 };
  const p = planInjection({ assistantReplyCount: 3, everyN: 3, session: s });
  eq(p.inject, true);
  eq(p.reason, 'normal');
  eq(p.next.questionsSinceRest, 3);
  eq(p.next.restTurnsLeft, 0);
});
t('出满本周期的最后一题后立即进入休息期', () => {
  const s = { restConfig: { questionsBeforeRest: 3, restTurns: 5, enabled: true }, questionsSinceRest: 2, restTurnsLeft: 0 };
  const p = planInjection({ assistantReplyCount: 3, everyN: 3, session: s });
  eq(p.inject, true);
  eq(p.reason, 'last-before-rest');
  eq(p.next.questionsSinceRest, 0, '进入休息时本周期计数应归零');
  eq(p.next.restTurnsLeft, 5);
});
t('关掉休息期后不再进入休息', () => {
  const s = { restConfig: { questionsBeforeRest: 2, restTurns: 5, enabled: false }, questionsSinceRest: 5, restTurnsLeft: 0 };
  const p = planInjection({ assistantReplyCount: 3, everyN: 3, session: s });
  eq(p.inject, true);
  eq(p.reason, 'normal');
  eq(p.next.questionsSinceRest, 6);
  eq(p.next.restTurnsLeft, 0);
});
t('完整周期走一遍：出满即休息，休息完再恢复出题', () => {
  // 每轮都符合出题节奏、每 2 题休息 2 轮
  let s = { restConfig: { questionsBeforeRest: 2, restTurns: 2, enabled: true }, questionsSinceRest: 0, restTurnsLeft: 0 };
  const pattern = [];
  for (let i = 0; i < 8; i += 1) {
    const p = planInjection({ assistantReplyCount: 1, everyN: 1, session: s });
    s = applyRestState(s, p.next);
    pattern.push(p.inject ? '题' : '休');
  }
  eq(pattern.join(''), '题题休休题题休休');
});
t('applyRestState 把配置与进度写回会话', () => {
  const s = applyRestState(createSession(), { enabled: false, questionsBeforeRest: 4, restTurns: 6, questionsSinceRest: 1, restTurnsLeft: 2 });
  eq(s.restConfig, { enabled: false, questionsBeforeRest: 4, restTurns: 6 });
  eq(s.questionsSinceRest, 1);
  eq(s.restTurnsLeft, 2);
});
t('休息期状态文案', () => {
  eq(restLabel({ restConfig: { ...DEFAULT_REST }, questionsSinceRest: 3, restTurnsLeft: 0 }).text, '本周期已出 3/10 题');
  eq(restLabel({ restConfig: { ...DEFAULT_REST }, restTurnsLeft: 7 }).resting, true);
  eq(restLabel({ restConfig: { enabled: false } }).text, '休息期已关');
});
t('新建会话自带休息期字段', () => {
  const s = createSession();
  eq(s.restConfig.questionsBeforeRest, 10);
  eq([s.questionsSinceRest, s.restTurnsLeft], [0, 0]);
});
t('休息期进度随存档往返保留', () => {
  let s = createSession();
  s = applyRestState(s, { enabled: true, questionsBeforeRest: 7, restTurns: 4, questionsSinceRest: 3, restTurnsLeft: 2 });
  const back = chatFromSaveable(JSON.parse(JSON.stringify(chatToSaveable(s))));
  eq(back.restConfig.questionsBeforeRest, 7);
  eq(back.questionsSinceRest, 3);
  eq(back.restTurnsLeft, 2);
});

/* ---------- 上下文限额与窗口 ---------- */
t('estimateTokens 中日韩按字、其余按字符折算', () => {
  ok(estimateTokens('你好世界') >= 4, '中文应按字计');
  ok(estimateTokens('hello world') < 'hello world'.length, '英文折算应明显小于字符数');
  ok(estimateTokens('') > 0, '空文本也有消息开销');
  ok(estimateTokens('中文中文中文') !== estimateTokens('abcdefghijkl'));
});
t('estimateTokens 随长度单调不减', () => {
  let prev = 0;
  for (const s of ['a', 'aa', 'aaaa', 'aaaaaaaa', 'aaaaaaaaaaaaaaaa']) {
    const n = estimateTokens(s);
    ok(n >= prev, `长度增长时估算不应下降：${s}`);
    prev = n;
  }
});
t('clampLimits 默认值与边界收敛', () => {
  const d = clampLimits(undefined);
  eq([d.enabled, d.renderLimit, d.historyLimit, d.maxContextTokens], [true, 120, 60, 32000]);
  eq(clampLimits({ renderLimit: 1 }).renderLimit, 10);
  eq(clampLimits({ renderLimit: 99999 }).renderLimit, 2000);
  eq(clampLimits({ historyLimit: 0 }).historyLimit, 2);
  eq(clampLimits({ maxContextTokens: 10 }).maxContextTokens, 1000);
  eq(clampLimits({ trimRatio: 5 }).trimRatio, 0.95);
  eq(clampLimits({ trimRatio: 0.01 }).trimRatio, 0.3);
  eq(clampLimits({ enabled: false }).enabled, false);
});
t('未超预算时保留所有正文与小总结，重试前缀不变', () => {
  const limits = { ...DEFAULT_LIMITS, maxContextTokens: 100000, historyLimit: 100 };
  const session = chatWithTurns(3, limits);
  const a = compileChatRequest(session, '固定规则');
  eq(a.compaction.turnCount, 0);
  eq(a.messages, buildChatMessages(session, '固定规则'));
  const b = compileChatRequest(a.session, '固定规则');
  eq(b.compaction.turnCount, 0);
  eq(b.messages, a.messages);
});
t('超预算时批量裁正文到目标比例内，所有小总结仍保留', () => {
  const limits = { ...DEFAULT_LIMITS, maxContextTokens: 2000, trimRatio: 0.7, historyLimit: 500 };
  const session = chatWithTurns(20, limits, '中'.repeat(200));
  const r = compileChatRequest(session, '中'.repeat(100));
  ok(r.compaction.turnCount > 0, '应该裁掉一些完整回合的正文');
  ok(r.estimatedTokens <= Math.floor(r.diagnostics.inputBudget * limits.trimRatio), `裁完未到目标预算：${r.estimatedTokens}`);
  ok(r.estimatedTokens + r.maxOutputTokens <= limits.maxContextTokens);
  eq(r.diagnostics.summaryCount, 20);
  eq(r.session.messages.filter((message) => message.compacted).length, r.compaction.turnCount * 2);
  ok(r.session.messages.filter((message) => message.compacted).every((message) => message.text === ''));
});
t('正文条数目标独立于 token 预算生效，按完整回合成批裁剪', () => {
  const limits = { ...DEFAULT_LIMITS, maxContextTokens: 1000000, historyLimit: 10 };
  const session = chatWithTurns(15, limits, 'x');
  const r = compileChatRequest(session, '');
  eq(r.compaction.turnCount, 12);
  eq(r.diagnostics.bodyMessages, 7, '超出 10 条后按完整回合留到 70%');
  eq(r.diagnostics.summaryCount, 15);
  eq(r.session.messages.find((message) => !message.compacted).id, session.messages[24].id);
});
t('最新消息超预算时保留原文并拒绝请求', () => {
  const limits = { ...DEFAULT_LIMITS, maxContextTokens: 1000, trimRatio: 0.7, historyLimit: 500 };
  const session = chatWithTurns(1, limits);
  session.messages.at(-1).text = '中'.repeat(9999);
  const before = chatToSaveable(session);
  throwsRetryable(() => compileChatRequest(session, ''), 'context-budget');
  eq(chatToSaveable(session), before);
});
t('关闭裁剪仍执行硬预算，已裁剪正文不会复原', () => {
  const first = compileChatRequest(chatWithTurns(5, { ...DEFAULT_LIMITS, historyLimit: 10 }), '');
  const session = { ...first.session, limits: { ...DEFAULT_LIMITS, enabled: false, maxContextTokens: 1000, historyLimit: 2 } };
  const request = compileChatRequest(session, '');
  eq(request.messages, first.messages);
  eq(request.compaction.turnCount, 0);
  eq(request.maxOutputTokens, 250);
  ok(request.session.messages.slice(0, 4).every((message) => message.compacted && message.text === ''));
  session.messages.at(-1).text = '中'.repeat(1000);
  throwsRetryable(() => compileChatRequest(session, ''), 'context-budget');
});
t('systemTokensFor 优先用真实用量反推', () => {
  const est = systemTokensFor({ systemText: '一二三四五', lastRealPromptTokens: 5000, lastHistoryEstimate: 4000 });
  eq(est, 1000, '应反推出系统提示词的真实开销');
  // 反推不出正数时回退到字符估算
  ok(systemTokensFor({ systemText: '一二三四五', lastRealPromptTokens: 100, lastHistoryEstimate: 400 }) > 0);
});
t('renderWindow 未超限时全渲染，超限时只给最近若干条', () => {
  const messages = Array.from({ length: 200 }, (_, i) => ({ id: `m${i}`, role: 'user', text: 'x' }));
  const a = renderWindow(messages, { ...DEFAULT_LIMITS, renderLimit: 500 });
  eq([a.items.length, a.hiddenCount], [200, 0]);
  const b = renderWindow(messages, { ...DEFAULT_LIMITS, renderLimit: 50 });
  eq([b.items.length, b.hiddenCount], [50, 150]);
  eq(b.items[0].id, 'm150', '应保留最近的那些');
});
t('renderWindow 在限额关闭时不做折叠', () => {
  const messages = Array.from({ length: 200 }, (_, i) => ({ id: `m${i}`, role: 'user', text: 'x' }));
  eq(renderWindow(messages, { ...DEFAULT_LIMITS, enabled: false, renderLimit: 10 }).hiddenCount, 0);
});

/* ---------- 端点就绪判定（单一来源） ---------- */
t('modelReadiness 判定四种情形', () => {
  eq(modelReadiness({ endpoint: '', apiKey: 'k' }).kind, 'no-endpoint');
  eq(modelReadiness({ endpoint: 'https://api.example.com/v1', apiKey: '' }).kind, 'no-key');
  eq(modelReadiness({ endpoint: 'http://127.0.0.1:5199/v1', apiKey: '' }).ready, true);
  eq(modelReadiness({ endpoint: 'https://api.example.com/v1', apiKey: 'sk-x' }).ready, true);
  eq(modelReadiness(null).kind, 'no-endpoint');
});
t('assertModelReady 不就绪时抛可重试错误', () => {
  throwsRetryable(() => assertModelReady({ endpoint: '' }), 'no-endpoint');
  throwsRetryable(() => assertModelReady({ endpoint: 'https://a.b/v1', apiKey: '' }), 'no-key');
  eq(assertModelReady({ endpoint: 'https://a.b/v1', apiKey: 'k' }), true);
});

/* ---------- 会话拆分存储 ---------- */
function installFakeStorage() {
  const data = new Map();
  let writes = 0;
  let throwOn = null;
  const api = {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => {
      writes += 1;
      if (throwOn && k.startsWith(throwOn)) {
        const e = new Error('quota exceeded');
        e.name = 'QuotaExceededError';
        throw e;
      }
      data.set(k, String(v));
    },
    removeItem: (k) => { data.delete(k); },
    clear: () => data.clear(),
    key: (i) => [...data.keys()][i] ?? null,
    get length() { return data.size; },
  };
  globalThis.localStorage = api;
  return {
    data,
    stats: () => ({ writes }),
    resetWrites: () => { writes = 0; },
    failOn: (prefix) => { throwOn = prefix; },
    keysWithPrefix: (p) => [...data.keys()].filter((k) => k.startsWith(p)),
  };
}

const fake = installFakeStorage();
clearChatSession();

t('拆分存储：保存后能原样读回', () => {
  let s = createSession({ profile: createProfile({ name: '阿澈', gender: '男' }) });
  s = appendMessage(s, { role: 'user', text: '你好' });
  s = appendMessage(s, { role: 'assistant', text: '“在的。”', usage: { prompt: 100, completion: 20, cached: 80 } });
  eq(saveChatSession(s).ok, true);
  const back = loadChatSession();
  eq(back.messages.length, 2);
  eq(back.messages[1].text, '“在的。”');
  eq(back.messages[1].usage.cached, 80);
  eq(back.profile.name, '阿澈');
});
t('拆分存储：索引与消息分开落盘', () => {
  ok(fake.keysWithPrefix('word-blade:chat-index').length === 1, '应有一个索引 key');
  ok(fake.keysWithPrefix('word-blade:chat-msg:').length === 2, '应有两条消息 key');
  ok(fake.keysWithPrefix('word-blade:chat-session').length === 0, '不应再写旧的单 key');
});
t('拆分存储：追加一条只写三个 key（写放大已消除）', () => {
  let s = loadChatSession();
  s = appendMessage(s, { role: 'user', text: '再聊一句' });
  fake.resetWrites();
  eq(saveChatSession(s).ok, true);
  // v2 写「新消息 + 本会话 key + 顶层索引」。多出来的那一个是换来多会话能力的代价；
  // 关键指标是与会话历史长度无关，而不是数字最小
  eq(fake.stats().writes, 3, '一次追加应为三个 key');
  ok(fake.keysWithPrefix('word-blade:chat-msg:').length === 3);
});
t('拆分存储：会话再长，单次追加的写入次数不变', () => {
  let s = loadChatSession();
  for (let i = 0; i < 40; i += 1) s = appendMessage(s, { role: 'user', text: `第${i}条` });
  saveChatSession(s); // 先把这 40 条落盘，之后才是「纯追加」
  const lenBefore = s.messages.length;
  s = appendMessage(s, { role: 'user', text: '再加一条' });
  fake.resetWrites();
  eq(saveChatSession(s).ok, true);
  eq(fake.stats().writes, 3, '写入次数必须与会话长度无关');
  eq(loadChatSession().messages.length, lenBefore + 1);
});
t('revision 每次保存递增', () => {
  const idx = JSON.parse(fake.data.get('word-blade:chat-index'));
  ok(idx.revision > 0, 'revision 应已写入');
  const before = idx.revision;
  saveChatSession(loadChatSession());
  const after = JSON.parse(fake.data.get('word-blade:chat-index')).revision;
  eq(after, before + 1);
});
t('多标签页冲突：同会话被外部改动后拒绝陈旧快照', () => {
  const snapshot = loadChatSession();
  const otherTab = appendMessage(loadChatSession(), { role: 'assistant', text: '另一页的新回复' });
  eq(saveChatSession(otherTab).ok, true);
  loadSessionList();
  const r = saveChatSession(snapshot);
  eq(r.ok, false);
  eq(r.conflict, true);
  // 重新加载后应恢复正常
  loadChatSession();
  eq(saveChatSession(loadChatSession()).ok, true);
});
t('存储配额满时回报 full 而不是静默失败', () => {
  const s = loadChatSession();
  const next = appendMessage(s, { role: 'user', text: '会写失败的一条' });
  fake.failOn('word-blade:chat-msg:');
  const r = saveChatSession(next);
  fake.failOn(null);
  eq(r.ok, false);
  eq(r.full, true);
  loadChatSession();
});
t('清空会同时移除索引与全部消息 key', () => {
  clearChatSession();
  eq(fake.keysWithPrefix('word-blade:chat-index').length, 0);
  eq(fake.keysWithPrefix('word-blade:chat-msg:').length, 0);
  eq(loadChatSession(), null);
});
t('旧版单 key 存档会被自动迁移', () => {
  const legacy = {
    version: 1, id: 's_legacy', title: '老对话',
    profile: { name: '阿澈', gender: '男', customGender: '' },
    everyN: 3, difficulty: 'all',
    restConfig: { enabled: true, questionsBeforeRest: 10, restTurns: 10 },
    questionsSinceRest: 1, restTurnsLeft: 0,
    messages: [
      { id: 'm1', parentId: null, role: 'user', text: '好久不见', questionId: null, at: 1, usage: null },
      { id: 'm2', parentId: 'm1', role: 'assistant', text: '“嗯。”', questionId: null, at: 2, usage: null },
    ],
    usedQuestionIds: [],
  };
  fake.data.set('word-blade:chat-session', JSON.stringify(legacy));
  const loaded = loadChatSession();
  eq(loaded.messages.length, 2);
  eq(loaded.title, '老对话');
  ok(fake.keysWithPrefix('word-blade:chat-msg:').length >= 2, '迁移后应有消息 key');
  eq(fake.keysWithPrefix('word-blade:chat-session').length, 0, '旧 key 应被清掉');
});
t('旧窗口游标归零，正文与限额随存档往返保留', () => {
  let s = loadChatSession() || createSession();
  s = { ...s, trimCursor: 7, limits: { ...DEFAULT_LIMITS, historyLimit: 12 } };
  const bodies = s.messages.map((message) => message.text);
  ok(saveChatSession(s).ok);
  const back = loadChatSession();
  eq(back.trimCursor, 0);
  eq(back.version, 2);
  eq(back.messages.map((message) => message.text), bodies);
  eq(back.limits.historyLimit, 12);
});

/* ---------- endpoint 归一化 ---------- */
t('normalizeEndpoint 把 base URL 补成完整端点', () => {
  eq(normalizeEndpoint('https://api.deepseek.com/v1'), 'https://api.deepseek.com/v1/chat/completions');
  eq(normalizeEndpoint('https://api.deepseek.com'), 'https://api.deepseek.com/chat/completions');
  eq(normalizeEndpoint('https://api.openai.com/v1/'), 'https://api.openai.com/v1/chat/completions');
  eq(normalizeEndpoint('http://localhost:11434/v1'), 'http://localhost:11434/v1/chat/completions');
  eq(normalizeEndpoint('https://api.example.com/v1beta'), 'https://api.example.com/v1beta/chat/completions');
});
t('normalizeEndpoint 已经完整的端点原样保留', () => {
  eq(normalizeEndpoint('https://api.deepseek.com/v1/chat/completions'), 'https://api.deepseek.com/v1/chat/completions');
  eq(normalizeEndpoint('https://api.deepseek.com/chat/completions/'), 'https://api.deepseek.com/chat/completions');
  eq(normalizeEndpoint('http://127.0.0.1:5199/v1/chat/completions'), 'http://127.0.0.1:5199/v1/chat/completions');
});
t('normalizeEndpoint 不猜自定义路径', () => {
  eq(normalizeEndpoint('https://my.proxy/llm/gateway'), 'https://my.proxy/llm/gateway');
  eq(normalizeEndpoint('https://my.proxy/openai'), 'https://my.proxy/openai');
});
t('normalizeEndpoint 空值与非法输入不炸', () => {
  eq(normalizeEndpoint(''), '');
  eq(normalizeEndpoint(null), '');
  eq(normalizeEndpoint('   '), '');
  eq(normalizeEndpoint('not a url'), 'not a url');
});
t('端点归一化后仍能通过就绪判定', () => {
  eq(modelReadiness({ endpoint: 'https://api.deepseek.com/v1', apiKey: 'k' }).ready, true);
  eq(modelReadiness({ endpoint: '  https://api.deepseek.com/v1  ', apiKey: 'k' }).ready, true);
});
t('提示词要求空格标记与原文完全一致', () => {
  const sys = buildChatSystem(createProfile({ name: '阿澈' }));
  ok(sys.includes('空格标记必须与原文完全一致'), '缺空格标记一致性条款');
  ok(sys.includes('包括横线数量'), '未点明横线数量');
  ok(sys.includes('不要补成六个'), '未举出会犯的错');
});
t('自攻击清单点名改写空格标记', () => {
  ok(buildChatSystem(null).includes('改动空格标记'), '未点名该错误');
});

/* ---------- 删除消息 ---------- */
t('删除单条消息不影响其他消息', () => {
  let s = createSession();
  s = appendMessage(s, { role: 'user', text: '一' });
  s = appendMessage(s, { role: 'assistant', text: '二' });
  s = appendMessage(s, { role: 'user', text: '三' });
  const mid = s.messages[1].id;
  const after = deleteMessage(s, mid);
  eq(after.messages.length, 2);
  eq(after.messages.map((m) => m.text), ['一', '三']);
});
t('删除不存在的 id 是空操作', () => {
  let s = appendMessage(createSession(), { role: 'user', text: '一' });
  const after = deleteMessage(s, 'm_nope');
  eq(after.messages.length, 1);
  eq(after, s, '应原样返回同一个对象');
});
t('删除已裁剪楼层不复原正文或移走其他小总结', () => {
  const request = compileChatRequest(chatWithTurns(3, { ...DEFAULT_LIMITS, historyLimit: 4 }), '规则');
  const firstCompactedUser = request.session.messages.find((message) => message.role === 'user' && message.compacted);
  const after = deleteMessage(request.session, firstCompactedUser.id);
  eq(after.trimCursor, 0);
  eq(buildChatMessages(after, '规则'), request.messages);
  eq(after.messages.filter((message) => message.role === 'assistant').map((message) => message.summary), [turnSummary, turnSummary, turnSummary]);
  ok(after.messages.filter((message) => message.compacted).every((message) => message.text === ''));
});
t('会话摘要字段完整', () => {
  let s = appendMessage(createSession({ title: '测试对话' }), { role: 'user', text: '嗨' });
  const sum = summarizeSession(s);
  eq(sum.title, '测试对话');
  eq(sum.messageCount, 1);
  eq(sum.id, s.id);
  ok(sum.updatedAt > 0);
});

/* ---------- 多会话存储 ---------- */
t('两个会话互不干扰', () => {
  clearChatSession();
  let a = appendMessage(createSession({ title: '甲' }), { role: 'user', text: 'A1' });
  saveChatSession(a);
  let b = appendMessage(createSession({ title: '乙' }), { role: 'user', text: 'B1' });
  b = appendMessage(b, { role: 'assistant', text: 'B2' });
  saveChatSession(b);

  const list = loadSessionList();
  eq(list.sessions.length, 2);
  eq(list.currentId, b.id);
  const titles = list.sessions.map((x) => x.title).sort();
  eq(titles, ['乙', '甲'].sort());
  eq(loadChatSession(a.id).messages.length, 1);
  eq(loadChatSession(b.id).messages.length, 2);
});
t('侧栏摘要不含消息正文', () => {
  const list = loadSessionList();
  for (const s of list.sessions) {
    ok(!('messages' in s), '摘要里不该带 messages');
    ok(typeof s.messageCount === 'number', '摘要应带条数');
  }
});
t('切换当前会话只改 currentId', () => {
  const before = loadSessionList();
  const other = before.sessions.find((x) => x.id !== before.currentId).id;
  eq(setCurrentSession(other), true);
  eq(loadSessionList().currentId, other);
  eq(loadChatSession().id, other, '不传 id 时应读当前会话');
});
t('删会话只删它自己和它的消息', () => {
  const list = loadSessionList();
  const target = list.sessions.find((x) => x.id !== list.currentId);
  const msgsBefore = fake.keysWithPrefix('word-blade:chat-msg:').length;
  eq(deleteChatSession(target.id), true);
  const after = loadSessionList();
  eq(after.sessions.length, 1);
  ok(!after.sessions.some((x) => x.id === target.id), '被删会话还在列表里');
  ok(fake.keysWithPrefix('word-blade:chat-msg:').length < msgsBefore, '它的消息应该被清掉');
  ok(fake.keysWithPrefix('word-blade:chat-sess:').length === 1, '会话 key 也应删掉');
});
t('删掉当前会话时自动切到另一个', () => {
  clearChatSession();
  const a = appendMessage(createSession({ title: '甲' }), { role: 'user', text: 'A' });
  saveChatSession(a);
  const b = appendMessage(createSession({ title: '乙' }), { role: 'user', text: 'B' });
  saveChatSession(b);
  deleteChatSession(b.id);
  const list = loadSessionList();
  eq(list.currentId, a.id, '应回落到剩下的那个会话');
});
t('多会话下追加仍是常数次写入', () => {
  const s = loadChatSession();
  const grown = appendMessage(s, { role: 'user', text: '再一条' });
  fake.resetWrites();
  eq(saveChatSession(grown).ok, true);
  eq(fake.stats().writes, 3);
});

t('删消息会连带清掉它的存储 key（不留孤儿）', () => {
  clearChatSession();
  let s = createSession();
  s = appendMessage(s, { role: 'user', text: '一' });
  s = appendMessage(s, { role: 'assistant', text: '二' });
  s = appendMessage(s, { role: 'user', text: '三' });
  saveChatSession(s);
  const beforeKeys = fake.keysWithPrefix('word-blade:chat-msg:').length;
  const removedId = s.messages[1].id;

  const trimmed = deleteMessage(s, removedId);
  saveChatSession(trimmed);
  const afterKeys = fake.keysWithPrefix('word-blade:chat-msg:').length;

  eq(beforeKeys, 3);
  eq(afterKeys, 2, '被删消息的 key 应该一起清掉');
  ok(!fake.data.has('word-blade:chat-msg:' + removedId), '孤儿条目仍在存储里');
  eq(loadChatSession().messages.length, 2);
});

t('清扫会收掉无引用的消息条目', () => {
  clearChatSession();
  const s = appendMessage(createSession({ title: '甲' }), { role: 'user', text: '真消息' });
  saveChatSession(s);
  // 手工塞两条孤儿，模拟崩溃或旧版本残留
  fake.data.set('word-blade:chat-msg:m_orphan_1', JSON.stringify({ id: 'm_orphan_1', role: 'user', text: '孤儿' }));
  fake.data.set('word-blade:chat-msg:m_orphan_2', JSON.stringify({ id: 'm_orphan_2', role: 'user', text: '孤儿' }));
  eq(fake.keysWithPrefix('word-blade:chat-msg:').length, 3);

  eq(sweepOrphanMessages(), 2, '应清掉两条孤儿');
  eq(fake.keysWithPrefix('word-blade:chat-msg:').length, 1, '真消息必须留下');
  eq(loadChatSession().messages.length, 1, '会话仍能正常读回');
});
t('清扫不会误删另一个会话的消息', () => {
  clearChatSession();
  const a = appendMessage(createSession({ title: '甲' }), { role: 'user', text: 'A' });
  saveChatSession(a);
  const b = appendMessage(createSession({ title: '乙' }), { role: 'user', text: 'B' });
  saveChatSession(b);
  eq(fake.keysWithPrefix('word-blade:chat-msg:').length, 2);
  eq(sweepOrphanMessages(), 0, '没有孤儿就不该删任何东西');
  eq(fake.keysWithPrefix('word-blade:chat-msg:').length, 2);
});
t('没有索引时清扫安全返回', () => {
  clearChatSession();
  eq(sweepOrphanMessages(), 0);
});

/* ---------- 对话区内部滚动（防 CSS/JS 只改一半） ---------- */
t('对话模式的高度锁定：CSS 与 JS 两半都在', () => {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const html = readHtml(root);
  const js = readUiSources(root);
  const css = cssOf(html);
  // CSS 一侧：不锁死 body 高度，内层 overflow-y: auto 就形同虚设，滚的会是整页
  ok(/body\.chat-mode\s*\{[^}]*height:/.test(css), 'body.chat-mode 缺少高度锁定');
  ok(/body\.chat-mode\s*\{[^}]*overflow:\s*hidden/.test(css), 'body.chat-mode 缺少 overflow: hidden');
  // JS 一侧：类名必须真的挂上去，且只在对话模式
  ok(js.includes("classList.toggle('chat-mode'"), 'main.js 没有切换 chat-mode 类');
  ok(js.includes("toggle('chat-mode', isChat)"), 'chat-mode 应只在对话模式开启');
  // 对话区自身必须是可滚动容器
  ok(/#chat-thread\s*\{[^}]*overflow-y:\s*auto/.test(css), '#chat-thread 缺少 overflow-y: auto');
});

/* ---------- 资产清单：校验 ---------- */
function sampleManifest() {
  return {
    schemaVersion: 1,
    workId: 'word-blade',
    assets: [
      {
        id: 'bg-rain', kind: 'bg', isDefault: true,
        source: { type: 'local', path: 'assets/bg/rain.webp' },
        tags: ['雨', '夜'], preload: 'lazy', lifetime: 'chat', fallbackAssetId: null,
        provenance: { origin: '自绘', license: 'CC0' },
      },
      {
        id: 'bg-room', kind: 'bg',
        source: { type: 'local', path: 'assets/bg/room.webp' },
        tags: ['室内'], preload: 'eager', lifetime: 'chat', fallbackAssetId: 'bg-rain',
        provenance: { origin: '自绘', license: 'CC0' },
      },
      {
        id: 'sp-happy', kind: 'sprite',
        source: { type: 'local', path: 'assets/sp/happy.webp' },
        tags: ['开心'], preload: 'lazy', lifetime: 'chat', fallbackAssetId: null,
        provenance: { origin: '自绘', license: 'CC0' },
      },
      {
        id: 'st-blank', kind: 'sticker',
        source: { type: 'remote', path: 'https://example.com/blank.webp' },
        tags: ['无语', '尴尬'], preload: 'on-demand', lifetime: 'message', fallbackAssetId: null,
        provenance: { origin: '自绘', license: 'CC0' },
      },
      {
        id: 'st-blank2', kind: 'sticker',
        source: { type: 'remote', path: 'https://example.com/blank2.webp' },
        tags: ['无语'], preload: 'on-demand', lifetime: 'message', fallbackAssetId: 'st-blank',
        provenance: { origin: '自绘', license: 'CC0' },
      },
    ],
  };
}

t('出厂清单本身合法', () => {
  const v = validateManifest(ASSET_MANIFEST);
  eq(v.ok, true, `出厂清单有错：${v.errors.join('；')}`);
});
t('样例清单校验通过', () => {
  const v = validateManifest(sampleManifest());
  eq(v.ok, true, `样例有错：${v.errors.join('；')}`);
});
t('校验拦住重复 id', () => {
  const m = sampleManifest();
  m.assets.push({ ...m.assets[0] });
  ok(!validateManifest(m).ok);
  ok(validateManifest(m).errors.some((e) => e.includes('id 重复')));
});
t('校验拦住非法 kind 与 source.type', () => {
  const a = sampleManifest(); a.assets[0].kind = 'avatar';
  ok(!validateManifest(a).ok);
  const b = sampleManifest(); b.assets[0].source = { type: 'ftp', path: 'x' };
  ok(!validateManifest(b).ok);
});
t('校验拦住越界的本地路径', () => {
  for (const p of ['/abs/x.webp', '../out.webp', 'assets/../../x.webp', 'http://x/y.webp', '']) {
    const m = sampleManifest();
    m.assets[0].source = { type: 'local', path: p };
    ok(!validateManifest(m).ok, `应拦下：${JSON.stringify(p)}`);
  }
});
t('校验要求远端地址是 https', () => {
  const m = sampleManifest();
  m.assets[3].source = { type: 'remote', path: 'http://example.com/x.webp' };
  ok(!validateManifest(m).ok);
});
t('校验拦住非法的 bytes 与 sha256', () => {
  const a = sampleManifest(); a.assets[0].bytes = -1;
  ok(!validateManifest(a).ok);
  const b = sampleManifest(); b.assets[0].sha256 = 'xyz';
  ok(!validateManifest(b).ok);
  const c = sampleManifest(); c.assets[0].sha256 = 'a'.repeat(64);
  ok(validateManifest(c).ok, '合法 sha256 应通过');
});
t('校验拦住悬空或自指的 fallback', () => {
  const a = sampleManifest(); a.assets[0].fallbackAssetId = 'nope';
  ok(!validateManifest(a).ok, '悬空引用应报错');
  // 指向另一条已声明的资产是合法的
  const b = sampleManifest(); b.assets[0].fallbackAssetId = 'bg-room';
  eq(validateManifest(b).ok, true, '指向其他已声明资产应通过');
  ok(!validateManifest(b).errors.some((e) => e.includes('指向自己')));
  // 指向自己才是自指
  const c = sampleManifest(); c.assets[0].fallbackAssetId = c.assets[0].id;
  ok(validateManifest(c).errors.some((e) => e.includes('指向自己')), '自指应被拦下');
});
t('同类不能有两个默认项', () => {
  const m = sampleManifest();
  m.assets[1].isDefault = true; // bg-room 也想当默认
  const v = validateManifest(m);
  ok(!v.ok);
  ok(v.errors.some((e) => e.includes('已有默认项')));
});
t('缺授权与缺来源只报警告，不阻断', () => {
  const m = sampleManifest();
  delete m.assets[0].provenance;
  m.assets[1].provenance = { origin: '', license: 'unknown' };
  const v = validateManifest(m);
  eq(v.ok, true, '授权缺失不该让清单不可用');
  ok(v.warnings.some((w) => w.includes('provenance')));
  ok(v.warnings.some((w) => w.includes('授权状态未确认')));
});
t('缺 preload / lifetime 按默认处理并提示', () => {
  const m = sampleManifest();
  delete m.assets[0].preload;
  delete m.assets[0].lifetime;
  const v = validateManifest(m);
  eq(v.ok, true);
  ok(v.warnings.some((w) => w.includes('preload')));
  ok(v.warnings.some((w) => w.includes('lifetime')));
});

/* ---------- 资产清单：解析与回退 ---------- */
t('解析：id 精确命中', () => {
  const r = resolveAsset(sampleManifest(), { kind: 'bg', key: 'bg-room' });
  eq(r.via, 'id');
  eq(r.asset.id, 'bg-room');
});
t('解析：kind 不符的 id 不算命中', () => {
  const r = resolveAsset(sampleManifest(), { kind: 'sticker', key: 'bg-room' });
  eq(r.asset, null, 'sticker 类下没有 bg-room，该类也没有默认项');
  eq(r.via, null);
});
t('解析：标签命中', () => {
  const r = resolveAsset(sampleManifest(), { kind: 'sticker', key: '尴尬' });
  eq(r.via, 'tag');
  eq(r.asset.id, 'st-blank');
});
t('解析：模型编的键落到该类默认项', () => {
  const r = resolveAsset(sampleManifest(), { kind: 'bg', key: 'bg-不存在的图' });
  eq(r.via, 'default');
  eq(r.asset.id, 'bg-rain', '应回落到显式默认项');
});
t('解析：只有一条资产时它就是默认项', () => {
  // 单图场景下若不给兜底，模型一旦编错键就什么都显示不出来
  const r = resolveAsset(sampleManifest(), { kind: 'sprite', key: '模型编的表情' });
  eq(r.via, 'default');
  eq(r.asset.id, 'sp-happy');
});
t('解析：既无命中又无默认则返回 null', () => {
  // sticker 有两条、都没标默认，编的键应当落空而不是乱给一张
  eq(resolveAsset(sampleManifest(), { kind: 'sticker', key: '不存在' }).asset, null);
  eq(resolveAsset(sampleManifest(), {}).asset, null);
  eq(resolveAsset(emptyManifest(), { kind: 'bg', key: 'bg-rain' }).asset, null);
});
t('单条即默认：该类只有一条时用它兜底', () => {
  const m = sampleManifest();
  delete m.assets[0].isDefault; // bg 剩两条，不应有默认
  eq(kindDefault(m, 'bg'), null);
  eq(kindDefault(sampleManifest(), 'sprite').id, 'sp-happy', 'sprite 只有一条，它就是默认');
});
t('加载失败的兜底取一步', () => {
  const m = sampleManifest();
  eq(fallbackFor(m, findAsset(m, 'bg-room')).id, 'bg-rain');
  eq(fallbackFor(m, findAsset(m, 'bg-rain')), null, '没声明兜底就返回 null');
  eq(fallbackFor(m, null), null);
});
t('按标签挑选：命中多的优先，同分用 rng 定', () => {
  const m = sampleManifest();
  eq(pickByTags(m, { kind: 'sticker', tags: ['无语'], rng: () => 0 }).id, 'st-blank');
  // 两个都命中「无语」，用 rng 选
  const picked = new Set([
    pickByTags(m, { kind: 'sticker', tags: ['无语'], rng: () => 0 }).id,
    pickByTags(m, { kind: 'sticker', tags: ['无语'], rng: () => 0.99 }).id,
  ]);
  eq(picked.size, 2, '同分应能取到不同的两条');
});
t('按标签挑选：无标签随机取，都不命中落回默认', () => {
  const m = sampleManifest();
  ok(pickByTags(m, { kind: 'bg', tags: [], rng: () => 0 }), '无标签时应随机返回一条');
  eq(pickByTags(m, { kind: 'sticker', tags: ['完全不存在'] }), null, '不命中且无默认则为 null');
});
t('场景解析：字段翻成资产，缺字段走默认', () => {
  const art = resolveSceneArt(sampleManifest(), { bg: 'bg-room', spriteEmotion: 'sp-happy' });
  eq(art.bg.id, 'bg-room');
  eq(art.sprite.id, 'sp-happy');
  // 没给字段时：背景有显式默认项 → 用它；立绘只有一条 → 它就是默认项
  const dflt = resolveSceneArt(sampleManifest(), {});
  eq(dflt.bg.id, 'bg-rain', '没给背景字段应落到默认背景');
  eq(dflt.sprite.id, 'sp-happy', '立绘只有一条，按单条即默认');
  // 空清单下两者都必须为 null，不能让界面拿到坏对象
  const none = resolveSceneArt(emptyManifest(), { bg: 'x', spriteEmotion: 'y' });
  eq([none.bg, none.sprite], [null, null]);
});
t('场景解析是确定性的（同输入同输出）', () => {
  const m = sampleManifest();
  const a = resolveSceneArt(m, { bg: 'bg-rain' });
  const b = resolveSceneArt(m, { bg: 'bg-rain' });
  eq(a.bg.id, b.bg.id);
});
t('内联表情包标签解析', () => {
  const t1 = '前面的话<Sticker>无语</Sticker>后面的话';
  const tags = parseStickerTags(t1);
  eq(tags.length, 1);
  eq(tags[0].key, '无语');
  eq(t1.slice(tags[0].start, tags[0].end), '<Sticker>无语</Sticker>');
  eq(parseStickerTags('没有标签').length, 0);
});
t('内联表情包可多张且能去标签降级', () => {
  const t1 = 'a<Sticker>无语</Sticker>b<Sticker>开心</Sticker>c';
  eq(parseStickerTags(t1).map((x) => x.key), ['无语', '开心']);
  eq(stripStickerTags(t1), 'abc');
  ok(!stripStickerTags(t1).includes('Sticker'));
});
t('清单概况统计', () => {
  const d = describeManifest(sampleManifest());
  eq(d.total, 5);
  eq(d.byKind.bg, 2);
  eq(d.byKind.sticker, 2);
  eq(d.byKind.sprite, 1);
  eq(d.ready, true);
  const e = describeManifest(ASSET_MANIFEST);
  eq(e.byKind.sprite, emotionsWithArt().length);
  eq(e.byKind.bg, 4, '清晨、白昼、黄昏、月夜四张背景');
  eq(e.byKind.sticker, 4, '固定头像与三个功能插画');
  eq(e.total, emotionsWithArt().length + 8, '出厂清单 = 表情 + 固定头像 + 七张场景插画');
  eq(e.errors, 0);
});

/* ---------- 表情标签 ---------- */
t('表情表自身无冲突：id 唯一、别名不跨条目重复', () => {
  const ids = EMOTIONS.map((e) => e.id);
  eq(new Set(ids).size, ids.length, 'id 有重复');
  const seen = new Map();
  const clash = [];
  for (const e of EMOTIONS) {
    for (const a of [e.id, ...(e.aliases || [])]) {
      if (seen.has(a) && seen.get(a) !== e.id) clash.push(`${a} 同时属于 ${seen.get(a)} 与 ${e.id}`);
      seen.set(a, e.id);
    }
  }
  eq(clash, [], '别名冲突会让解析结果不确定');
});
t('十四个标准表情都有图，且每条都登记了两种风格', () => {
  const withArt = emotionsWithArt();
  eq(withArt.length, 14);
  for (const e of withArt) {
    for (const style of FACE_STYLES) {
      eq(faceUrlFor(e, style.id), `assets/mengjing/${style.id}/${e.slug}.webp`);
    }
    ok(e.aliases?.length >= 4, `${e.id} 的别名太少，模型换个写法就解析不到`);
  }
});
t('表情均使用本地资产，没有旧图床请求', () => {
  const sprites = ASSET_MANIFEST.assets.filter((a) => a.kind === 'sprite');
  const sources = sprites.flatMap((a) => [a.source, ...a.altSources]);
  eq(sources.length, 28);
  ok(sources.every((source) => source.type === 'local'));
  ok(sources.every((source) => source.path.startsWith('assets/mengjing/')));
  ok(!/https?:\/\/|img\.remit\.ee|picui\.ogmua\.cn/.test(JSON.stringify(ASSET_MANIFEST)));
});
t('两种风格共用表情协议，风格切换不改变提示词列表', () => {
  const [a, b] = FACE_STYLES;
  eq(DEFAULT_FACE_STYLE, a.id);
  eq(FACE_HOSTS, FACE_STYLES);
  eq(DEFAULT_FACE_HOST, DEFAULT_FACE_STYLE);
  const prompt = emotionPromptList();
  for (const e of emotionsWithArt()) {
    ok(faceUrlFor(e, a.id) !== faceUrlFor(e, b.id), `${e.id} 两种风格的地址不该相同`);
    eq(resolveFace(ASSET_MANIFEST, e.id, { style: a.id }).emotion,
      resolveFace(ASSET_MANIFEST, e.id, { style: b.id }).emotion);
  }
  for (const style of FACE_STYLES) {
    eq(new Set(emotionsWithArt().map((e) => faceUrlFor(e, style.id))).size, 14);
  }
  eq(emotionPromptList(), prompt);
});
t('原始图片寻址遇到非法风格或缺少素材信息时返回 null', () => {
  const e = emotionsWithArt()[0];
  eq(faceUrlFor(e, '不存在的风格'), null);
  eq(faceUrlFor({ id: 'missing' }), null);
  eq(faceUrlFor(undefined), null);
});
t('归一化：标准写法与别名都收敛到同一标签', () => {
  eq(normalizeEmotion('开心'), '开心');
  eq(normalizeEmotion('高兴'), '开心');
  eq(normalizeEmotion('  快乐  '), '开心');
  eq(normalizeEmotion('喜悦'), '开心');
  eq(normalizeEmotion('脸红'), '害羞');
  eq(normalizeEmotion('火大'), '生气');
  eq(normalizeEmotion('打哈欠'), '困倦');
});
t('归一化：认不出来返回 null，不硬猜', () => {
  eq(normalizeEmotion('狂喜'), null);
  eq(normalizeEmotion(''), null);
  eq(normalizeEmotion(null), null);
  eq(normalizeEmotion('Happy'), null, '英文标签不在表里，应落空而不是瞎猜');
});
t('强度分档：难过归到「失落」而不是「哭泣」', () => {
  eq(normalizeEmotion('难过'), '失落');
  eq(normalizeEmotion('伤心'), '失落');
  eq(normalizeEmotion('大哭'), '哭泣');
  eq(normalizeEmotion('委屈'), '哭泣');
  eq(normalizeEmotion('微笑'), '温柔', '微笑是暖版平静，不是张嘴大笑');
  ok(hasArt(normalizeEmotion('难过')), '「失落」使用独立的低落表情');
});
t('hasArt 区分有无立绘', () => {
  eq(hasArt('开心'), true);
  eq(hasArt('平静'), true);
  eq(hasArt('失落'), true);
  eq(hasArt('不存在的标签'), false);
});
t('表情标签解析：正常与认不出的都取出', () => {
  const tags = parseFaceTags('先说一句<Face>害羞</Face>再往下说');
  eq(tags.length, 1);
  eq(tags[0].raw, '害羞');
  eq(tags[0].canonical, '害羞');
  const weird = parseFaceTags('<Face>狂喜</Face>');
  eq(weird[0].raw, '狂喜');
  eq(weird[0].canonical, null, '认不出也要取出来，否则排查时看不到模型写了什么');
});
t('一条回复里多个表情取最后一个（立绘是持续状态）', () => {
  eq(lastFace('a<Face>开心</Face>b<Face>生气</Face>c'), '生气');
  eq(lastFace('没有标签'), null);
  eq(lastFace('<Face>狂喜</Face>'), null, '认不出的不算数');
});
t('去掉表情标签后文字不留痕迹', () => {
  const t1 = '前面<Face>开心</Face>后面';
  eq(stripFaceTags(t1), '前面后面');
  ok(!stripFaceTags(t1).includes('Face'));
});
t('解析立绘：有图直接命中对应资产，默认给的是本地文件', () => {
  const r = resolveFace(ASSET_MANIFEST, '开心');
  eq(r.emotion, '开心');
  eq(r.via, 'tag');
  eq(r.asset.id, 'face-开心');
  eq(r.src.type, 'local');
  eq(r.src.path, faceUrlFor(EMOTIONS.find((e) => e.id === '开心'), DEFAULT_FACE_STYLE));
});
t('解析立绘：风格参数与旧 host 参数均能选择对应图片', () => {
  const alt = FACE_STYLES[1].id;
  const def = resolveFace(ASSET_MANIFEST, '开心');
  const other = resolveFace(ASSET_MANIFEST, '开心', { style: alt });
  eq(def.asset.id, other.asset.id);
  eq(other.src.host, alt);
  eq(other.src.path, faceUrlFor(EMOTIONS.find((e) => e.id === '开心'), alt));
  ok(def.src.path !== other.src.path);
  eq(resolveFace(ASSET_MANIFEST, '开心', { host: alt }).src.path, other.src.path);
  eq(resolveFace(ASSET_MANIFEST, '开心', { style: DEFAULT_FACE_STYLE, host: alt }).src.path, def.src.path);
});
t('解析立绘：风格写错也不崩，回落到默认 Q 版', () => {
  const bad = resolveFace(ASSET_MANIFEST, '开心', { style: '不存在的风格' });
  eq(bad.asset.id, 'face-开心');
  eq(bad.src.path, faceUrlFor(EMOTIONS.find((e) => e.id === '开心'), DEFAULT_FACE_STYLE));
});
t('解析立绘：写别名也能落到同一张图', () => {
  const r = resolveFace(ASSET_MANIFEST, '高兴');
  eq(r.emotion, '开心');
  eq(r.asset.id, 'face-开心');
});
t('解析立绘：缺图的标签不给坏图，立绘留空并说明原因', () => {
  const partial = { ...ASSET_MANIFEST, assets: ASSET_MANIFEST.assets.filter((a) => a.id !== 'face-失落') };
  const r = resolveFace(partial, '失落');
  eq(r.emotion, '失落');
  eq(r.asset, null, '故意不设默认立绘，所以应为空而不是随便一张');
  eq(r.src, null);
  ok(r.reason.includes('还没有立绘'), `原因应说明清楚，实际：${r.reason}`);
});
t('解析立绘：认不出的标签同样留空并说明', () => {
  const r = resolveFace(ASSET_MANIFEST, '狂喜');
  eq(r.emotion, null);
  eq(r.asset, null);
  ok(r.reason.includes('认不出'));
  eq(resolveFace(ASSET_MANIFEST, '').asset, null, '没标签就没立绘');
});
t('清单里的表情条目由同一表情表派生：Q 版 + 立绘版', () => {
  const sprites = ASSET_MANIFEST.assets.filter((a) => a.kind === 'sprite');
  eq(sprites.length, emotionsWithArt().length);
  for (const e of emotionsWithArt()) {
    const a = sprites.find((x) => x.id === `face-${e.id}`);
    ok(a, `缺立绘条目：${e.id}`);
    eq(a.source.type, 'local');
    eq(a.source.path, faceUrlFor(e, DEFAULT_FACE_STYLE));
    eq(a.source.host, DEFAULT_FACE_STYLE);
    eq(a.altSources.length, FACE_STYLES.length - 1);
    for (const style of FACE_STYLES.slice(1)) {
      const alt = a.altSources.find((s) => s.host === style.id);
      ok(alt, `${e.id} 缺 ${style.id} 的图片`);
      eq(alt.type, 'local');
      eq(alt.path, faceUrlFor(e, style.id));
    }
    for (const alias of e.aliases) ok(a.tags.includes(alias), `${e.id} 的别名 ${alias} 未进 tags`);
    eq(a.lifetime, 'chat', '表情是持续状态');
    eq(a.isDefault, undefined, '故意不设默认表情');
  }
});
t('两种表情风格的来源标识互不冲突', () => {
  const dup = ASSET_MANIFEST.assets.filter((a) =>
    (a.altSources || []).some((s) => s.host === a.source?.host));
  eq(dup.map((a) => a.id), [], '备用里出现了与 source 相同的 host');
});

/* ---------- 固定头像与本地素材 ---------- */
t('旧人物背景不再登记，固定头像与表情风格相互独立', () => {
  eq(findAsset(ASSET_MANIFEST, CHAT_BG_ID), null);
  eq(kindDefault(ASSET_MANIFEST, 'bg'), null);
  ok(!JSON.stringify(ASSET_MANIFEST).includes('assets/bg/chat-room.jpg'));
  const avatar = findAsset(ASSET_MANIFEST, CHARACTER_AVATAR_ID);
  eq(avatar.kind, 'sticker');
  eq(avatar.source.type, 'local');
  eq(avatar.source.path, CHARACTER_AVATAR_PATH);
  eq(avatar.preload, 'eager');
  for (const style of FACE_STYLES) eq(sourceFor(avatar, style.id).path, CHARACTER_AVATAR_PATH);
});
t('36 张本地素材均存在，登记的 bytes / sha256 与文件一致', () => {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const seen = new Set();
  for (const asset of ASSET_MANIFEST.assets) {
    for (const source of [asset.source, ...(asset.altSources || [])]) {
      const abs = path.join(root, source.path);
      ok(fs.existsSync(abs), `素材文件不存在：${source.path}`);
      seen.add(source.path);
      const buf = fs.readFileSync(abs);
      const bytes = source.bytes ?? (source === asset.source ? asset.bytes : undefined);
      const sha256 = source.sha256 ?? (source === asset.source ? asset.sha256 : undefined);
      if (bytes != null) eq(buf.length, bytes, `${source.path} bytes 不匹配`);
      if (sha256) eq(crypto.createHash('sha256').update(buf).digest('hex'), sha256, `${source.path} sha256 不匹配`);
    }
  }
  eq(seen.size, 36);
});
t('出厂清单通过校验，且不再有「授权未确认」警告', () => {
  const v = validateManifest(ASSET_MANIFEST);
  eq(v.ok, true, `应有错：${v.errors.join('；')}`);
  eq(v.warnings, [], `本作素材不该再报授权警告：${v.warnings.join('；')}`);
});
t('校验器仍然会对「授权未确认」的第三方素材报警告（警告路径没被删掉）', () => {
  const m = emptyManifest();
  m.assets.push({
    id: 'third-party-x', kind: 'sticker',
    source: { type: 'remote', path: 'https://example.com/x.png' },
    tags: [], preload: 'lazy', lifetime: 'message',
    provenance: { origin: '网上找的', license: 'unknown' },
  });
  const v = validateManifest(m);
  eq(v.ok, true, '警告不阻断：授权不明仍可用，只是被标出来');
  ok(v.warnings.some((w) => w.includes('授权状态未确认')), '第三方素材的授权状态应被标出');
});
t('提示词：可用表情只列有立绘的，缺图的不出现', () => {
  const list = emotionPromptList();
  for (const e of emotionsWithArt()) ok(list.includes(e.id), `缺 ${e.id}`);
  for (const e of emotionsWithoutArt()) {
    ok(!list.includes(e.id), `「${e.id}」还没有立绘，不该进可用列表`);
  }
});
t('提示词：注入列表后带上表情规则与标签语法', () => {
  const sys = buildChatSystem(createProfile({ name: '阿澈' }), { emotionList: emotionPromptList() });
  ok(sys.includes('【表情立绘】'), '缺表情章节');
  ok(sys.includes('<Face>'), '未说明标签语法');
  ok(sys.includes('开心'), '未注入可用列表');
  ok(sys.includes('只在情绪确实发生变化时写一次'), '缺「不要每段都写」的约束');
  ok(sys.includes('别把标签当成台词的一部分'), '缺防念标签的约束');
  ok(sys.includes('失落（'), '失落已有独立表情，应可在对话中使用');
});
t('提示词：不传列表时不出现表情章节（保持向后兼容）', () => {
  const sys = buildChatSystem(createProfile({ name: '阿澈' }));
  ok(!sys.includes('【表情立绘】'), '未传列表就不该有表情章节');
  ok(sys.includes('【题目机制'), '其余章节不受影响');
});
t('表情统计口径', () => {
  const s = emotionStats();
  eq(s.total, EMOTIONS.length);
  eq(s.withArt, 14);
  eq(s.total - s.withArt, s.withoutArt);
  eq(s.withoutArt, 0);
  eq(emotionsWithoutArt().map((e) => e.id), []);
});

/* ---------- 表情与头像显示 ---------- */
t('表情贴在角色气泡里，不再是单独一条舞台', () => {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const ui = fs.readFileSync(path.join(root, 'src/ui/chat.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  ok(ui.includes('face-sticker'), '渲染层没有表情贴图');
  ok(/face\.src\.path/.test(ui), '渲染层应直接用外部解析好的地址，不该自己查清单');
  ok(!ui.includes('content/assets.js'), '渲染层不该读取资产清单');
  ok(!html.includes('id="chat-stage"'), '旧的立绘舞台还在，会和气泡里的表情重复显示');
  ok(html.includes('.face-sticker'), '缺表情贴图样式');
  const rule = /\.face-sticker\s*\{([^}]*)\}/.exec(html);
  ok(rule, '找不到 .face-sticker 规则');
  const decl = rule[1];
  ok(/width:\s*\d+px/.test(decl), '表情应定宽（缩放基准），不能靠百分比在窄气泡里越缩越小');
  ok(/height:\s*auto/.test(decl), '高度必须 auto 才能等比缩放；定高 + 百分比宽度会把方形图压变形并留出透明边');
  ok(/max-width:\s*100%/.test(decl), '必须限制 max-width，否则窄屏上会撑破气泡');
});
t('聊天背景使用无人物 CSS 渐变，名字保留清晰底色', () => {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const backgrounds = [...html.matchAll(/#chat-main\s*\{([^}]*)\}/g)].map((m) => m[1]);
  ok(backgrounds.some((rule) => /linear-gradient/.test(rule)), '聊天背景应有渐变');
  ok(backgrounds.every((rule) => !/url\(/.test(rule)), '聊天背景不应请求人物图片');
  ok(!html.includes('--chat-bg'), '旧背景变量仍在');
  ok(!html.includes('assets/bg/chat-room.jpg'), '旧人物背景仍在');
  const whoRules = [...html.matchAll(/\.msg-who\s*\{([^}]*)\}/g)].map((m) => m[1]);
  ok(whoRules.length > 0, '找不到 .msg-who 规则');
  ok(whoRules.some((d) => /background:\s*rgba\(/.test(d)));
});
t('表情风格与固定头像由编排层注入', () => {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const main = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');
  ok(/renderThread\(\{[\s\S]*?faceFor,/.test(main), 'main.js 应把表情解析函数交给 renderThread');
  ok(main.includes('resolveFace(ASSET_MANIFEST'), '编排层应解析表情');
  ok(/avatarSrc:\s*localMediaUrl\(CHARACTER_AVATAR_PATH\)/.test(main), '固定头像必须经过本地资产映射');
  ok(!main.includes('applyChatBackground'), '不应加载旧背景');
  ok(!main.includes("$('chat-face')"), '旧的立绘舞台元素引用没清干净');
});

/* ---------- 旧风格存档接口兼容 ---------- */
t('旧图床存档接口仍能保存风格 id', () => {
  const alternate = FACE_HOSTS[1].id;
  saveFaceHost(alternate);
  eq(loadFaceHost(), alternate);
  const raw = fake.data.get('word-blade:face-host');
  eq(raw, alternate);
  ok(!String(raw).includes('http'));
});
t('旧图床存档失效时回落默认 Q 版', () => {
  fake.data.set('word-blade:face-host', '这种图床不存在');
  eq(loadFaceHost(), DEFAULT_FACE_HOST);
  saveFaceHost('这种图床不存在');
  eq(loadFaceHost(), DEFAULT_FACE_HOST, '写了非法值应该落回默认，而不是把坏值存下来');
  fake.data.delete('word-blade:face-host');
  eq(loadFaceHost(), DEFAULT_FACE_HOST, '没存过就是默认');
});

/* ---------- 首屏体积：题库不再依赖全量词库 ---------- */
t('题库不再静态依赖全量词库（防止把 258 KB 加回首屏）', () => {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const qSrc = fs.readFileSync(path.join(root, 'src/content/cet4-questions.js'), 'utf8');
  ok(!/from\s+'\.\/cet4\.js'/.test(qSrc), '题库又 import 了 cet4.js，聊天模式首屏会白拉 258 KB');
  ok(qSrc.includes('SEED_LOOKUP'), '应使用内联查表');
  ok(qSrc.includes('SEED_LOOKUP_BEGIN') && qSrc.includes('SEED_LOOKUP_END'), '内联查表应带标记，便于工具重复刷新');
});
/* ---------- 单文件产物：只装运行时代码 ---------- */
t('打包器只顺着模块图走，不扫目录（扫目录会把测试脚本带进去）', () => {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const bSrc = fs.readFileSync(path.join(root, 'tools/build-single-html.mjs'), 'utf8');
  ok(/const ENTRY = 'src\/main\.js'/.test(bSrc), '入口应写死 src/main.js');
  ok(!/readdir/.test(bSrc), '出现 readdir 就是把整个目录扫进包里了，测试与维护脚本会一起被打进去');
  ok(bSrc.includes('dynamicImportSpecs'), '动态 import 的模块也要进包，否则切模式时会「模块未打包」');
});
t('单文件产物里没有测试与维护脚本', () => {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const out = path.join(root, 'dist/dreamwhale-vocab.html');
  if (!fs.existsSync(out)) { ok(true, '还没打包过（npm run build:single），跳过产物检查'); return; }
  const html = fs.readFileSync(out, 'utf8');
  ok(html.includes('__def("src/main.js"'), '入口模块没打进去');
  ok(!/__def\("tests\//.test(html), '测试脚本被打进单文件了');
  ok(!/__def\("tools\//.test(html), '维护脚本被打进单文件了');
  ok(!/serve\.mjs/.test(html), '本地预览服务器被打进单文件了');
  eq((html.match(/<script/gi) || []).length, 1, '产物里应只有一个 <script>');
  ok(!/<script[^>]*type="module"/.test(html), '产物里还留着 type="module" 的脚本标签，说明打包没接上');
  ok(html.includes('__def("src/engine/learning.js"'), '缺少学习引擎');
  ok(!html.includes('__def("src/engine/wordbank.js"'), '旧拼词引擎不应打包');
  for (const style of FACE_STYLES) ok(html.includes(style.id), `风格 ${style.id} 没进产物`);
  ok(!/img\.remit\.ee|picui\.ogmua\.cn|assets\/bg\/chat-room\.jpg/.test(html), '产物仍含旧图片来源');
});
t('单文件产物把本地资产挂进 __wbAssets，且值是 data URL', () => {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const out = path.join(root, 'dist/dreamwhale-vocab.html');
  if (!fs.existsSync(out)) { ok(true, '还没打包过，跳过'); return; }
  const html = fs.readFileSync(out, 'utf8');
  ok(html.includes('window.__wbAssets'), '产物里没有注入媒体映射表');
  const local = [...new Set(ASSET_MANIFEST.assets.flatMap((asset) => [asset.source, ...(asset.altSources || [])])
    .filter((source) => source?.type === 'local').map((source) => source.path))];
  eq(local.length, 36, `本地资产应有 28 张表情、一张头像和七张场景插画，实际 ${local.length} 个`);
  for (const p of local) {
    ok(html.includes(`"${p}":"data:image/webp;base64,`), `本地资产没挂进映射表：${p}`);
  }
  eq((html.match(/data:image\//g) || []).length, local.length, '产物里的 data URL 数量与本地资产数不一致');
});
t('表情与头像均经过单文件媒体映射', () => {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const main = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');
  ok(main.includes("from './platform/media.js'"), '编排层应引用本地媒体解析模块');
  ok(/function mediaUrlFor\(src\)/.test(main), '应有一个统一的地址解析口');
  ok(/localMediaUrl\(src\.path\)/.test(main), '本地地址要过映射表，否则单文件版会拿到取不到的相对路径');
  ok(/mediaUrlFor\(r\?\.src\)/.test(main), '解析出的表情未经过媒体映射');
  ok(/localMediaUrl\(CHARACTER_AVATAR_PATH\)/.test(main), '头像未经过媒体映射');
});
t('localMediaUrl：没有映射表时原样返回相对路径（多文件版就是这样）', () => {
  const saved = globalThis.__wbAssets;
  try {
    delete globalThis.__wbAssets;
    eq(localMediaUrl('assets/bg/x.jpg'), 'assets/bg/x.jpg');
    eq(localMediaUrl(''), '');
    eq(localMediaUrl(null), '');
    globalThis.__wbAssets = { 'assets/bg/x.jpg': 'data:image/jpeg;base64,AAA' };
    eq(localMediaUrl('assets/bg/x.jpg'), 'data:image/jpeg;base64,AAA');
    eq(localMediaUrl('assets/bg/unknown.jpg'), 'assets/bg/unknown.jpg', '映射表里没有就原样返回');
    eq(localMediaCount(), 1);
  } finally {
    if (saved === undefined) delete globalThis.__wbAssets; else globalThis.__wbAssets = saved;
  }
});
t('打包不会展开源码里的 $ 替换模式（踩过一次的坑）', () => {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const out = path.join(root, 'dist/dreamwhale-vocab.html');
  if (!fs.existsSync(out)) { ok(true, '还没打包过，跳过'); return; }
  const html = fs.readFileSync(out, 'utf8');
  // String.replace(pattern, 字符串) 会把替换文本里的 $& / $1 / $' 当模式展开。
  // 替换文本是整份源码，所以源码里出现这些串就会被改坏——这里逐一核对数量。
  const count = (s, re) => (s.match(re) || []).length;
  const srcAll = ['src/main.js', 'src/ui/chat.js'].map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
  ok(count(html, /\$&/g) >= count(srcAll, /\$&/g), '产物里的 $& 变少了，说明被当成替换模式展开过');
});
t('内联查表覆盖题库全部目标词（漏词会让提示与解析变空）', () => {
  // 判据：派生题目的 explanation 形如「词：中文释义」。查表漏词时会变成「词：」。
  const items = allQuestions();
  const broken = items.filter((q) => {
    const m = String(q.explanation || '');
    const idx = m.indexOf('：');
    return idx >= 0 && m.slice(idx + 1).trim().length === 0;
  });
  eq(broken.slice(0, 5).map((q) => q.id), [], '这些题的解析为空，说明查表漏了词——跑 node tools/refresh-question-lookup.mjs');
});
t('扩展题库规模与原始选择题兼容', () => {
  const original = allQuestions().filter(q => !/^dw-c[46]-/.test(q.id) && q.source !== 'project-original-pairs-2026');
  eq(original.length, 1276);
  eq(original.filter((q) => q.type === 'choice').length, 155);
  eq(original.filter((q) => q.type === 'fill').length, 517);
});

/* ---------- 结果 ---------- */
console.log(`\n通过 ${pass} 项，失败 ${failures.length} 项`);
if (failures.length) {
  console.log('\n失败明细：');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exitCode = 1;
} else {
  console.log('全部通过');
}
