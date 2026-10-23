import { copyText } from './platform/runtime.js';
import { emptyProfile, normalizeModelProfile, PROFILE_PRESETS, API_FORMATS, probe, modelReadiness, normalizeEndpoint } from './gateway/model.js';
import {
  DEFAULT_LIMITS, clampLimits,
} from './engine/limits.js';
import {
  loadProfile, saveProfile, storageAvailable,
  loadChatSession, saveChatSession, clearChatSession,
  loadSessionList, setCurrentSession, deleteChatSession, sweepOrphanMessages,
  loadUserProfile, saveUserProfile, loadMode, saveMode, MODES,
  loadFaceStyle, saveFaceStyle,
} from './storage/save.js';
import { RetryableError } from './engine/judge.js';
import { learningSummary } from './engine/learning.js';
import { buildChatPrompt } from './content/chat.js';
import { emotionPromptList, resolveFace, lastFace } from './engine/emotions.js';
import { localMediaUrl } from './platform/media.js';
import { SCENE_PATHS } from './content/scenes.js';
import { ASSET_MANIFEST } from './content/assets.js';
import { FACE_STYLES, DEFAULT_FACE_STYLE, CHARACTER_AVATAR_PATH } from './content/emotions.js';
import {
  createSession, assistantReplyCount, profileComplete, normalizeProfile, createProfile,
  totalUsage, deleteMessage,
} from './engine/chat.js';
import {
  repliesUntilNext, describeBank as describeQuestionBank, DEFAULT_EVERY_N,
  restLabel, restState, DEFAULT_REST,
} from './engine/questions.js';
import {
  renderThread, fillProfileForm, syncCustomVisibility, readProfileForm, profileFormError, chatToast,
  renderSessionList, renderAppearancePreview,
} from './ui/chat.js';
import { prepareUserTurn, generateChatTurn, replyAppliesTo, retainBodiesAfterSaveFailure } from './app/chat-turn.js';
import { recordRequest } from './app/request-record.js';
import { createLearningController } from './app/learning.js';
import { drawQuestion } from './engine/questions.js';
import { initResponsiveUI } from './ui/responsive.js';
import { initLayout } from './ui/layout.js';
import { initTutorial } from './ui/tutorial.js';
import { initClientSettings, downloadFile } from './ui/client-settings.js';
import { updateStreaming, updatePresentedMessage } from './ui/chat.js';
import { companionSegment, forkConversation, conversationMarkdown, plainMessageText } from './engine/client.js';
import { loadDraft, saveDraft, clearDrafts } from './storage/client.js';
import { initSelectionSpeech, autoReadReply, beginReplyReading, stopReading } from './ui/speech.js';

const $ = (id) => document.getElementById(id);
const NAV_IDS = { learn: 'nav-learn', library: 'nav-library', practice: 'nav-practice', chat: 'nav-chat' };

let profile = emptyProfile();

// 对话模式
let mode = 'chat';
let session = null;
let userProfile = null;
let chatBusy = false;
let faceStyle = DEFAULT_FACE_STYLE;
let learning = null;
let responsive = null;
let tutorial = null;
let client = null;
let replyController = null;
let partialReply = '';
let replyPresentation = null;
let draftTimer = null;

function persistDraft() {
  clearTimeout(draftTimer);
  if (!session) return true;
  try { saveDraft(session.id, $('chat-input').value); $('draft-status').textContent = $('chat-input').value ? '草稿已保存' : ''; return true; }
  catch { $('draft-status').textContent = '草稿未能保存，请复制后再离开'; return false; }
}

function restoreDraft() {
  try { $('chat-input').value = loadDraft(session?.id); $('draft-status').textContent = $('chat-input').value ? '已恢复草稿' : ''; }
  catch (error) { chatToast(error.message, { error:true }); }
  responsive?.sizeComposer();
}

function syncInteractionLocks() {
  for (const id of ['btn-save-settings', 'btn-clear-save']) $(id).disabled = chatBusy;
}

function renderStats() {
  const qb = describeQuestionBank();
  $('question-bank-info').textContent = qb.total + ' 道内置题。';
  try {
    const summary = learningSummary(learning.state());
    $('learning-stats').textContent = '练过 ' + summary.words + ' 个词，完成 ' + summary.attempts + ' 次作答，独立答对 ' + summary.independent + ' 次。当前有 ' + summary.due + ' 项到期复习。';
  } catch (error) { $('learning-stats').textContent = error.message; }
}

function fillFaceStyleSelect() {
  const sel = $('set-face-style');
  sel.replaceChildren(...FACE_STYLES.map((style) => {
    const o = document.createElement('option');
    o.value = style.id;
    o.textContent = style.label;
    return o;
  }));
}

function showFaceStylePreview() {
  renderAppearancePreview({
    hostEl: $('face-style-preview'),
    face: faceFor('<Face>平静</Face>', $('set-face-style').value),
    avatarSrc: localMediaUrl(CHARACTER_AVATAR_PATH),
  });
}

function changeFaceStyle() {
  const selected = $('set-face-style').value;
  const next = FACE_STYLES.some((item) => item.id === selected) ? selected : DEFAULT_FACE_STYLE;
  if (!saveFaceStyle(next)) {
    $('set-face-style').value = faceStyle;
    $('face-style-status').textContent = '表情偏好未能保存，请检查浏览器存储空间与权限。';
    showFaceStylePreview();
    return;
  }
  faceStyle = next;
  $('face-style-status').textContent = '';
  showFaceStylePreview();
  if (session) renderChat();
}

function openSettings({ tab = 'general', firstTime = false } = {}) {
  stopReading();
  if (learning && !learning.saveDraft()) return;
  responsive?.closePanels();
  $('endpoint').value = profile.endpoint || '';
  $('model').value = profile.model || '';
  $('apiKey').value = profile.apiKey || '';
  $('set-provider').value = profile.provider || 'custom';
  $('set-cache-mode').value = profile.cacheMode || 'auto';
  $('set-debug-summary').checked = session?.debugSummaries === true;
  $('preset').value = PROFILE_PRESETS.find((p) => p.endpoint === profile.endpoint && p.model === profile.model)?.id || 'custom';
  $('set-mode').value = mode;
  $('set-everyn').value = String(session?.everyN || DEFAULT_EVERY_N);
  $('set-qdiff').value = session?.difficulty || 'all';
  const rst = restState(session);
  $('set-rest-enable').checked = rst.enabled;
  $('set-qbefore').value = String(rst.questionsBeforeRest);
  $('set-restturns').value = String(rst.restTurns);
  const lim = clampLimits(session?.limits);
  $('set-limits-enable').checked = lim.enabled;
  $('set-renderlimit').value = String(lim.renderLimit);
  $('set-historylimit').value = String(lim.historyLimit);
  $('set-maxcontext').value = String(lim.maxContextTokens);
  $('set-face-style').value = faceStyle;
  $('face-style-status').textContent = '';
  showEndpointNote();
  showLimitsNote();
  showFaceStylePreview();
  client?.open(session);
  profileFirstTime = firstTime;
  fillProfileForm({ nameEl: $('pf-name'), genderEl: $('pf-gender'), customEl: $('pf-custom'), customWrap: $('pf-custom-wrap'), profile: userProfile });
  $('pf-error').textContent = '';
  $('btn-save-settings').textContent = firstTime ? '保存并开始对话' : '保存';
  client?.showTab(tab);
  $('settings').showModal();
  $('settings').scrollTop = 0;
  $('btn-settings').setAttribute('aria-expanded', 'true');
  if (tab === 'profile') $('pf-name').focus();
}

function showLimitsNote() {
  const lim = clampLimits({
    enabled: $('set-limits-enable').checked,
    renderLimit: $('set-renderlimit').value,
    historyLimit: $('set-historylimit').value,
    maxContextTokens: $('set-maxcontext').value,
  });
  const kept = (session?.messages || []).filter((message) => !message.compacted).length;
  $('limits-note').textContent = lim.enabled
    ? `当前保留 ${kept} 条正文，上限 ${lim.historyLimit} 条；小总结另行保留。上下文预算约 ${lim.maxContextTokens.toLocaleString('en-US')} token（含小总结与回复余量）。`
    : `自动裁剪已关闭。上下文预算约 ${lim.maxContextTokens.toLocaleString('en-US')} token；已有小总结继续保留。`;
}

function showEndpointNote() {
  $('test-result').textContent = '';
  const raw = $('endpoint').value.trim();
  const note = $('endpoint-note');
  if (!raw) {
    note.textContent = '';
    return;
  }
  const url = normalizeEndpoint(raw, $('set-api-format').value, $('model').value, $('set-stream').checked);
  if (url === raw.replace(/\/+$/, '')) {
    note.textContent = `将请求：${url}`;
  } else {
    note.textContent = `已自动补全 → 将请求：${url}`;
  }
}

function clampInt(raw, min, max, fallback) {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function clampEveryN(raw) {
  return clampInt(raw, 1, 20, DEFAULT_EVERY_N);
}

function initSettings() {
  const preset = $('preset');
  const option = (value, text) => { const o=document.createElement('option'); o.value=value; o.textContent=text; return o; };
  const providers = new Map(PROFILE_PRESETS.map(p=>[p.provider, p.label.split(' · ')[0]]));
  $('set-provider').replaceChildren(...[...providers].map(([id,label])=>option(id,label)));
  $('set-api-format').replaceChildren(...Object.entries(API_FORMATS).map(([id,label])=>option(id,label)));
  preset.replaceChildren(...PROFILE_PRESETS.map((p) => {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = p.label;
    return o;
  }));
  preset.addEventListener('change', () => {
    const p = PROFILE_PRESETS.find((x) => x.id === preset.value);
    $('set-provider').value = p?.provider || p?.id || 'custom';
    if (p && p.endpoint) {
      let sameOrigin = false;
      try { sameOrigin = new URL($('endpoint').value).origin === new URL(p.endpoint).origin; } catch {}
      if (!sameOrigin) $('apiKey').value = '';
      $('endpoint').value = p.endpoint;
      $('model').value = p.model;
      $('set-api-format').value = p.apiFormat;
      $('set-auth-mode').value = p.authMode;
      $('set-cache-mode').value = p.cacheMode;
      $('set-send-temperature').checked = p.sendTemperature;
      $('set-stream-usage').checked = p.streamUsage;
      $('set-json-mode').value = p.jsonMode;
      $('set-token-field').value = p.tokenField;
      syncProtocolFields();
      showEndpointNote();
    }
  });

  fillFaceStyleSelect();
  $('set-face-style').addEventListener('change', changeFaceStyle);
  for (const id of ['set-limits-enable', 'set-renderlimit', 'set-historylimit', 'set-maxcontext']) {
    $(id).addEventListener('change', showLimitsNote);
  }
  function syncProtocolFields() {
    const format=$('set-api-format').value;
    $('chat-compatibility').hidden=format!=='chat';
    $('set-temperature').disabled=!$('set-send-temperature').checked;
    $('set-temperature').max=format==='anthropic'?'1':'2';
    if(format==='anthropic' && Number($('set-temperature').value)>1) $('set-temperature').value='1';
    $('temperature-label').textContent=`表达随机性（0–${format==='anthropic'?'1':'2'}）`;
    $('set-json-mode').disabled=format==='anthropic';
  }
  for (const id of ['endpoint','model']) $(id).addEventListener('input', showEndpointNote);
  for (const id of ['set-api-format','set-stream','set-send-temperature']) $(id).addEventListener('change',()=>{syncProtocolFields();showEndpointNote();});

  $('btn-test').addEventListener('click', async () => {
    const out = $('test-result');
    out.textContent = '正在测试…';
    try {
      const r = await probe(client.readProfile());
      out.textContent = `连接成功。模型返回：${r.preview}`;
    } catch (err) {
      out.textContent = `连接失败：${describeError(err)}`;
    }
  });

  $('btn-save-settings').addEventListener('click', async () => {
    if (chatBusy || learning?.isBusy()) { chatToast('先等当前评价完成。'); return; }
    const rawProfile = readProfileForm({ nameEl: $('pf-name'), genderEl: $('pf-gender'), customEl: $('pf-custom') });
    let nextUserProfile = userProfile;
    if (profileFirstTime || profileComplete(userProfile) || rawProfile.name || rawProfile.customGender) {
      const error = profileFormError({ nameEl: $('pf-name'), genderEl: $('pf-gender'), customEl: $('pf-custom') });
      if (error) { $('pf-error').textContent = error; client.showTab('profile'); $('pf-name').focus(); return; }
      nextUserProfile = normalizeProfile(createProfile(rawProfile));
    }
    let clientSettings;
    try { clientSettings = client.save(); } catch(error) { chatToast(error.message,{error:true}); return; }
    if (!saveProfile(clientSettings.profile)) {
      chatToast('模型设置未能保存，请检查浏览器存储空间与权限', { error: true });
      return;
    }
    profile = clientSettings.profile;

    const settingsSession = session || createSession({ profile: userProfile });
    {
      const nextSession = {
        ...settingsSession,
        profile: nextUserProfile,
        modelId: clientSettings.modelId,
        assistantConfig: clientSettings.assistantConfig,
        everyN: clampEveryN($('set-everyn').value),
        difficulty: $('set-qdiff').value || 'all',
        debugSummaries: $('set-debug-summary').checked,
        restConfig: {
          enabled: $('set-rest-enable').checked,
          questionsBeforeRest: clampInt($('set-qbefore').value, 1, 100, DEFAULT_REST.questionsBeforeRest),
          restTurns: clampInt($('set-restturns').value, 1, 100, DEFAULT_REST.restTurns),
        },
        limits: clampLimits({
          enabled: $('set-limits-enable').checked,
          renderLimit: $('set-renderlimit').value,
          historyLimit: $('set-historylimit').value,
          maxContextTokens: $('set-maxcontext').value,
          trimRatio: settingsSession.limits?.trimRatio ?? DEFAULT_LIMITS.trimRatio,
        }),
      };
      // 改了「每几题休息」就重置本周期计数，避免刚改完就立刻触发或永远不触发
      nextSession.questionsSinceRest = Math.min(nextSession.questionsSinceRest, nextSession.restConfig.questionsBeforeRest - 1);
      if (!persistSession(nextSession)) return;
      session = nextSession;
    }
    if (nextUserProfile && !saveUserProfile(nextUserProfile)) {
      $('pf-error').textContent = '档案未能保存，请检查本机存储空间后重试。'; client.showTab('profile'); return;
    }
    userProfile = nextUserProfile;

    // 玩法模式切换
    const nextMode = Object.values(MODES).includes($('set-mode').value) ? $('set-mode').value : MODES.learn;
    if (!saveMode(nextMode)) { chatToast('页面偏好未能保存，请检查浏览器存储空间与权限。', { error: true }); return; }
    mode = nextMode;

    $('settings').close();
    applyMode();
    if (mode === MODES.chat) {
      if (!session) bootChat();
      else renderChat();
    } else learning?.setPage(mode);
  });

  $('btn-clear-save').addEventListener('click', async () => {
    if (chatBusy || learning?.isBusy()) return;
    if (!window.confirm('清空所有聊天记录？此操作无法撤销，学习记录和收藏会保留。')) return;
    if (!clearChatSession()) {
      chatToast('清空失败，原存档未能全部移除，请检查浏览器存储权限', { error: true });
      return;
    }
    clearTimeout(draftTimer);
    $('chat-input').value = '';
    let draftsCleared = true;
    try { clearDrafts(); } catch { draftsCleared = false; }
    session = createSession({
      profile: userProfile,
      everyN: clampEveryN($('set-everyn').value),
      difficulty: $('set-qdiff').value || 'all',
    });
    const saved = persistSession(session);
    $('settings').close();
    applyMode();
    if (mode === MODES.chat) renderChat();
    else learning.render();
    if (saved) chatToast(draftsCleared ? '对话已清空，学习记录已保留' : '对话已清空，但草稿未能移除，请检查浏览器存储权限。', { error:!draftsCleared });
  });
}

function initStats() {
  $('btn-stats').addEventListener('click', () => { renderStats(); $('stats-dialog').showModal(); });
  $('btn-close-stats').addEventListener('click', () => $('stats-dialog').close());
}



function describeError(err) {
  if (err instanceof RetryableError) {
    const map = {
      'no-key': '还没有填写 API Key，请打开导航栏中的「设置」',
      'no-endpoint': '还没有配置模型接口地址',
      'invalid-endpoint': '接口地址无效，请使用完整的 http 或 https 地址',
      cancelled: '请求已取消，可以重新生成',
      length: '回复达到长度上限而中断，请提高上下文预算或让回复更简短后重试',
      network: '连不上这个地址。请检查网络、代理与地址，并确认端点允许浏览器跨域访问（CORS）；HTTPS 页面不能请求普通 HTTP 远程端点',
      timeout: '请求超时，可以重试或检查模型连接',
      http: err.message,
      'not-json': '接口返回的不是 JSON，通常说明地址填的是网页而不是 API 端点',
      empty: '模型没有返回内容，可以重试',
      schema: err.message,
      contradiction: '模型返回的字段自相矛盾，已自动重试',
    };
    return map[err.kind] || err.message;
  }
  return err?.message || String(err);
}

/* ---------------- 启动 ---------------- */

/* ================= 对话模式（一期：单会话） ================= */

/** 端点与 Key 是否就绪。判定逻辑来自网关，此处不再自己写一份。 */
function hasModel() {
  return modelReadiness(profile).ready;
}

/** 落盘并把冲突/配额问题报给用户，不让它静默失败。 */
function persistSession(next) {
  const r = saveChatSession(next);
  if (r.ok) return true;
  if (r.conflict) {
    chatToast('另一个标签页改动了这段对话，本次没有保存。请先复制未保存的内容，再刷新页面继续。', { error: true, ms: 9000 });
  } else if (r.full) {
    chatToast('本地存储已满，本次没有保存。请先复制未保存的内容，再删除不需要的会话腾出空间。', { error: true, ms: 9000 });
  } else {
    chatToast(`保存失败：${r.error || '未知原因'}`, { error: true, ms: 7000 });
  }
  return false;
}

function applyMode() {
  const isChat = mode === MODES.chat;
  // chat 模式下锁死页面高度，让滚轮落在对话区内部而不是整页
  document.body.classList.toggle('chat-mode', isChat);
  $('view-chat').classList.toggle('hidden', !isChat);
  $('view-learn').classList.toggle('hidden', isChat);
  $('hud-chat-group').classList.toggle('hidden', !isChat);
  // 侧栏切换按钮只在窄屏有意义，宽屏侧栏常驻
  $('btn-side').classList.toggle('hidden', !isChat);
  for (const value of Object.values(MODES)) {
    $(NAV_IDS[value]).classList.toggle('active', value === mode);
    $(NAV_IDS[value]).setAttribute('aria-current', value === mode ? 'page' : 'false');
  }
  $('btn-chat-practice').classList.toggle('hidden', !isChat);
  responsive?.sync();
}

function renderChat() {
  // 侧栏从索引读取会话摘要（不含消息），所以切会话/列列表都不必加载历史
  const list = loadSessionList();
  renderSessionList({
    hostEl: $('session-list'),
    sessions: list.sessions,
    currentId: session?.id || list.currentId,
    onSelect: switchSession,
    onNew: newSession,
    onDelete: removeSession,
    onAction: sessionAction,
    searchText: id => (loadChatSession(id)?.messages || []).map(m=>m.compacted ? m.summary || '' : m.text).join('\n'),
    busy: chatBusy,
  });

  renderThread({
    hostEl: $('chat-thread'),
    session,
    busy: chatBusy,
    onRegenerate: regenerateLast,
    onDeleteMessage: removeMessage,
    faceFor,
    avatarSrc: localMediaUrl(CHARACTER_AVATAR_PATH),
    debugSummaries: session?.debugSummaries === true,
    onMessageAction: messageAction,
    presentation: replyPresentation?.sessionId === session?.id ? replyPresentation : null,
  });
  if (partialReply && chatBusy) updateStreaming($('chat-thread'), partialReply);
  client?.syncChat(session?.modelId,session?.assistantConfig);
  const replies = session ? assistantReplyCount(session) : 0;
  $('hud-chat-turns').textContent = String(replies);
  $('hud-chat-mode').textContent = '对话';
  const until = repliesUntilNext({ assistantReplyCount: replies, everyN: session?.everyN });
  $('hud-chat-until').textContent = until === null ? '关' : String(until);

  // 休息期状态
  const rest = restLabel(session);
  $('hud-chat-rest').textContent = rest.text;
  $('hud-chat-rest').classList.toggle('resting', rest.resting);

  // 会话累计 token：只统计拿到用量的轮次；缓存命中率只在端点报过缓存字段时才算
  const u = session ? totalUsage(session) : { total: 0, turns: 0, cacheHitRate: null };
  if (u.turns) {
    const base = `${u.total.toLocaleString('en-US')}（${u.turns} 轮`;
    const rate = u.cacheHitRate === null ? '' : `，缓存命中 ${Math.round(u.cacheHitRate * 100)}%`;
    $('hud-chat-tokens').textContent = `${base}${rate}）`;
  } else {
    $('hud-chat-tokens').textContent = '—';
  }

  $('btn-chat-send').disabled = chatBusy;
  $('btn-chat-send').textContent = chatBusy ? '…' : '发送';
  $('btn-chat-stop').hidden = !chatBusy;
  $('btn-export-chat').disabled = chatBusy || !session;
  learning?.attachChat(session);
}

/**
 * 清单里的「来源」→ 浏览器能取的地址。
 * 本地资产要过一层映射表（单文件版把它换成内联 data URL）；远程地址原样用。
 */
function mediaUrlFor(src) {
  if (!src?.path) return '';
  return src.type === 'local' ? localMediaUrl(src.path) : src.path;
}

/**
 * 把一条角色回复解析成要点缀的表情。
 * 认不出的标签与缺图的标签都返回 null，界面就不贴图，绝不贴一张错的。
 * @returns {{emotion:string, src:{path:string}}|null}
 */
function faceFor(text, style = faceStyle) {
  const r = resolveFace(ASSET_MANIFEST, lastFace(text), { style });
  const path = mediaUrlFor(r?.src);
  return path ? { emotion: r.emotion, src: { path } } : null;
}

function setChatBusy(v) {
  chatBusy = v;
  syncInteractionLocks();
  renderChat();
}

function bootChat() {
  // 启动时顺手收掉无引用的消息条目（崩溃或旧版本可能留下）
  sweepOrphanMessages();
  session = loadChatSession();
  if (!session) {
    session = createSession({ profile: userProfile, everyN: DEFAULT_EVERY_N, difficulty: 'all' });
    persistSession(session);
  }
  if (session.deletedAt) { newSession(); return; }
  profile = client?.profile(session.modelId) || profile;
  restoreDraft();
  // 已有档案就统一注入到当前会话（会话自带档案时以会话为准）
  if (session.profile) userProfile = normalizeProfile(session.profile) || userProfile;
  else if (userProfile) {
    session = { ...session, profile: userProfile };
    persistSession(session);
  }

  renderChat();

  if (!tutorial?.active && !profileComplete(userProfile)) {
    openProfile({ firstTime: true });
    return;
  }
  if (!tutorial?.active && !hasModel()) {
    chatToast('还没配置模型端点，请打开导航栏中的「设置」');
  }
}


async function sendChat() {
  if (chatBusy || learning?.isBusy()) return;
  if (!profileComplete(userProfile)) {
    openProfile({ firstTime: true });
    return;
  }
  if (!hasModel()) {
    chatToast('先配置模型端点和 Key', { error: true });
    openSettings();
    return;
  }
  const input = $('chat-input');
  const text = input.value.trim();
  if (!text) {
    chatToast('先说点什么吧');
    return;
  }

  setChatBusy(true);
  try {
    const next = prepareUserTurn(session, text, {
      canAsk: !learning?.hasPending(session),
      chooseQuestion: (opts) => drawQuestion({ ...opts, learning: learning?.state() }),
    });
    next.modelId = session.modelId || client.activeId();
    next.assistantConfig = session.assistantConfig || client.companion();
    if (!persistSession(next)) return;
    session = next;
    input.value = '';
    persistDraft();
    responsive?.sizeComposer();
    renderChat();
    await generateReply();
  } catch (err) {
    chatToast(describeError(err), { error: true, ms: 8000 });
  } finally {
    setChatBusy(false);
  }
}

/**
 * 请模型对「当前会话末尾那条用户消息」作出回应。
 * 正常发送与「重新生成」都走这里，避免两份实现。
 */
async function generateReply() {
  stopReading();
  const snapshot = session;
  replyController = new AbortController();
  partialReply = '';
  let frame = null;
  const presentation = { sessionId: snapshot.id, messageId: null, text: '', done: false };
  replyPresentation = presentation;
  const present = text => {
    if (replyPresentation !== presentation || session?.id !== snapshot.id) return;
    presentation.text = text;
    partialReply = text;
    if (frame === null) frame = requestAnimationFrame(() => {
      frame = null;
      if (replyPresentation !== presentation || session?.id !== snapshot.id) return;
      if (presentation.messageId) updatePresentedMessage($('chat-thread'), presentation.messageId, presentation.text);
      else updateStreaming($('chat-thread'), partialReply);
    });
  };
  let narration = null;
  try {
    narration = beginReplyReading({ onText: present, onDone() {
      presentation.done = true;
      if (presentation.messageId && replyPresentation === presentation && session?.id === snapshot.id) {
        const text = session.messages.find(message => message.id === presentation.messageId)?.text || presentation.text;
        updatePresentedMessage($('chat-thread'), presentation.messageId, text, faceFor);
      }
    } });
    const system = buildChatPrompt(snapshot.profile, { emotionList: emotionPromptList() });
    system.segments.push(companionSegment(snapshot.assistantConfig || client.companion()));
    const next = await generateChatTurn(snapshot, system, { ...profile }, { signal: replyController.signal, onDelta: text => {
      if (replyController?.signal.aborted) return;
      if (narration) narration.push(text); else present(text);
    } });
    if (!replyAppliesTo(session, snapshot)) { narration?.stop(); return false; }
    if (!persistSession(next)) {
      session = retainBodiesAfterSaveFailure(snapshot, next);
      narration?.stop();
      return false;
    }
    session = next;
    const reply = next.messages.at(-1);
    presentation.messageId = reply?.id;
    if (narration) narration.finish(reply?.text);
    else { presentation.done = true; autoReadReply(reply?.text); }
    return true;
  } catch (err) {
    narration?.stop();
    if (err.requestRecord && replyAppliesTo(session, snapshot)) {
      const next = recordRequest(snapshot, err.requestRecord);
      persistSession(next);
      session = next;
    }
    chatToast(describeError(err), { error: true, ms: 8000 });
    return false;
  } finally {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    replyController = null;
    partialReply = '';
  }
}

/**
 * 重新生成：末尾那条用户消息没有被回应时（超时、断网、页面被关），
 * 不用重打一遍字，直接再请一次模型。
 */
async function regenerateLast() {
  if (chatBusy || learning?.isBusy()) return;
  if (!hasModel()) {
    chatToast('先配置模型端点和 Key', { error: true });
    openSettings();
    return;
  }
  const last = session?.messages?.[session.messages.length - 1];
  if (!last || last.role !== 'user') {
    chatToast('末尾没有待回应的消息');
    return;
  }
  if (!persistSession(session)) return;
  setChatBusy(true);
  try {
    await generateReply();
  } finally {
    setChatBusy(false);
  }
}

/* ---------------- 多会话 ---------------- */

function editDialog(title, value, multiline = false) {
  return new Promise(resolve=>{
    const dialog=document.createElement('dialog');dialog.className='text-editor';
    const heading=document.createElement('h2');heading.textContent=title;
    const form=document.createElement('form');form.method='dialog';
    const input=document.createElement(multiline?'textarea':'input');input.value=value;input.required=true;input.maxLength=multiline?60000:40;input.setAttribute('aria-label',title);if(multiline)input.rows=9;
    const actions=document.createElement('div');actions.className='actions';
    const cancel=document.createElement('button');cancel.type='button';cancel.textContent='取消';cancel.addEventListener('click',()=>dialog.close());
    const save=document.createElement('button');save.type='submit';save.textContent=multiline?'另存分支并发送':'保存';save.className='primary';
    actions.append(cancel,save);form.append(input,actions);dialog.append(heading,form);document.body.append(dialog);
    let result=null;form.addEventListener('submit',event=>{event.preventDefault();if(!input.value.trim())return;result=input.value.trim();dialog.close();});
    dialog.addEventListener('close',()=>{dialog.remove();resolve(result);},{once:true});dialog.showModal();input.focus();
  });
}

async function messageAction(action,id) {
  if(chatBusy || learning?.isBusy())return;
  const snapshot=session;
  const message=snapshot?.messages.find(m=>m.id===id);if(!message)return;
  try {
    if(action==='copy') {
      const text=plainMessageText(message);
      await copyText(text);
      chatToast('已复制');return;
    }
    stopReading();
    const editText=action==='edit'?await editDialog('编辑消息 · 保留原对话',message.text,true):undefined;
    if(editText===null || session!==snapshot || chatBusy)return;
    if(!persistDraft())return;
    const next=forkConversation(snapshot,id,{editText,regenerate:action==='regenerate'});
    if(!persistSession(next))return;
    session=next;profile=client.profile(session.modelId);restoreDraft();renderChat();
    if(action==='branch') {
      chatToast('已创建分支，原对话已保留');
      return;
    }
    await regenerateLast();
  } catch(error){chatToast(error.message,{error:true});}
}

async function sessionAction(action,id) {
  if(chatBusy || learning?.isBusy())return;
  try {
    const current=session?.id===id;
    if(current && action==='trash')stopReading();
    const target=current?session:loadChatSession(id);if(!target)throw new Error('对话无法读取。');
    if(action==='purge'){if(window.confirm('永久删除这段对话？无法撤销。'))removeSession(id);return;}
    const changes={};
    if(action==='rename'){const name=await editDialog('重命名对话',target.title);if(name===null)return;changes.title=name;changes.titleManual=true;}
    if(action==='pin')changes.pinned=!target.pinned;
    if(action==='archive')changes.archived=!target.archived;
    if(action==='trash')changes.deletedAt=Date.now();
    if(action==='restore'){changes.deletedAt=null;changes.archived=false;}
    if(!persistDraft())return;
    const next={...target,...changes,updatedAt:Date.now()};if(!persistSession(next))return;
    if(current)session=next;else if(session)setCurrentSession(session.id);
    if(current && action==='trash') {
      const other=loadSessionList().sessions.find(s=>s.id!==id&&!s.deletedAt&&!s.archived);
      if(other){session=loadChatSession(other.id);setCurrentSession(other.id);profile=client.profile(session.modelId);restoreDraft();}
      else newSession();
    }
    renderChat();
    if(action==='trash')chatToast('已移入回收站，可以随时恢复');
  }catch(error){chatToast(error.message,{error:true});}
}

/** 新建会话。已填过档案就沿用它，省得每次重填。 */
function newSession() {
  if (chatBusy) return;
  stopReading();
  if (!persistDraft()) return;
  if (session && !persistSession(session)) return;
  const next = createSession({
    profile: userProfile,
    everyN: session?.everyN ?? DEFAULT_EVERY_N,
    difficulty: session?.difficulty ?? 'all',
    restConfig: session?.restConfig,
    limits: session?.limits,
    debugSummaries: session?.debugSummaries === true,
  });
  next.modelId = client.activeId();
  next.assistantConfig = client.companion();
  if (!persistSession(next)) return;
  session = next;
  profile = client.profile(session.modelId);
  restoreDraft();
  responsive?.closePanels();
  renderChat();
  chatToast('新开了一段对话');
}

function switchSession(id) {
  if (chatBusy || !id) return;
  stopReading();
  if (session?.id === id) {
    responsive?.closePanels({ restoreFocus: true });
    return;
  }
  if (!persistDraft() || (session && !persistSession(session))) return;
  const next = loadChatSession(id);
  if (!next) {
    chatToast('这个对话读不出来了', { error: true });
    return;
  }
  if (!setCurrentSession(id)) {
    chatToast('切换失败，请刷新后再试', { error: true });
    return;
  }
  session = next;
  profile = client.profile(session.modelId);
  restoreDraft();
  responsive?.closePanels({ restoreFocus: true });
  renderChat();
}

function removeSession(id) {
  if (chatBusy || !id) return;
  const wasCurrent = session?.id === id;
  if (wasCurrent) stopReading();
  if (!deleteChatSession(id)) {
    chatToast('删除失败，存档可能已被其他页面修改，请刷新后重试', { error: true });
    return;
  }
  let draftRemoved = true;
  try { saveDraft(id, ''); } catch { draftRemoved = false; }
  if (wasCurrent) {
    const list = loadSessionList();
    session = list.currentId ? loadChatSession(list.currentId) : null;
    if (!session) {
      session = createSession({ profile: userProfile });
      persistSession(session);
    }
  }
  renderChat();
  chatToast(draftRemoved ? '对话已删除' : '对话已删除，但草稿未能移除，请检查浏览器存储权限。', { error:!draftRemoved });
}

function removeMessage(id) {
  if (chatBusy) return;
  stopReading();
  const next = deleteMessage(session, id);
  if (!persistSession(next)) return;
  session = next;
  renderChat();
}

/* ---------------- user 档案 ---------------- */

let profileFirstTime = false;

function openProfile({ firstTime = false } = {}) {
  openSettings({ tab: 'profile', firstTime });
}

function initProfileDialog() {
  $('pf-gender').addEventListener('change', () => syncCustomVisibility({
    genderEl: $('pf-gender'), customWrap: $('pf-custom-wrap'),
  }));

}

/* ================= 启动 ================= */

async function boot() {
  for (const scene of ['day', 'night']) document.documentElement.style.setProperty(`--scene-${scene}`, `url("${localMediaUrl(SCENE_PATHS[scene])}")`);
  initSettings();
  initStats();
  initProfileDialog();
  initSelectionSpeech();

  profile = normalizeModelProfile(loadProfile() || emptyProfile());
  userProfile = loadUserProfile();
  session = loadChatSession();
  client = initClientSettings({ legacy:profile, notify:text=>chatToast(text,{error:true}), isBusy:()=>chatBusy||learning?.isBusy(),
    beforeRestore:()=>persistDraft() && (!learning || learning.saveDraft()),
    onModel:entry=>{if(session){const next={...session,modelId:entry.id};if(!persistSession(next)){client.syncChat(session.modelId,session.assistantConfig);return;}session=next;}profile=entry.profile;renderChat();},
  });
  profile = client.profile(session?.modelId);
  if (session?.profile) userProfile = normalizeProfile(session.profile) || userProfile;
  mode = loadMode();
  faceStyle = loadFaceStyle();
  initLayout({ select: $('set-layout'), status: $('layout-status'), notify: (text) => chatToast(text, { error: true }) });
  responsive = initResponsiveUI({ chat: $('view-chat'), main: $('chat-main'), sidebar: $('session-side'), practice: $('chat-practice'), sideButton: $('btn-side'), practiceButton: $('btn-chat-practice'), overlay: $('chat-overlay'), composer: $('chat-input') });
  learning = createLearningController({ host: $('view-learn'), chatHost: $('chat-practice'), getProfile: () => profile, openSettings, navigate: (value) => $(NAV_IDS[value]).click(), notify: (text) => chatToast(text, { error: true, ms: 7000 }) });
  for (const nextMode of Object.values(MODES)) {
    $(NAV_IDS[nextMode]).addEventListener('click', async () => {
      if (chatBusy || learning.isBusy()) { chatToast('先等当前回复完成。'); return; }
      if (!learning.saveDraft()) return;
      if (!saveMode(nextMode)) { chatToast('页面偏好未能保存。', { error: true }); return; }
      mode = nextMode;
      applyMode();
      if (mode === MODES.chat) {
        if (!session) bootChat();
        else { renderChat(); if (!tutorial?.active && !profileComplete(userProfile)) openProfile({ firstTime: true }); }
      }
      else learning.setPage(mode);
    });
  }
  document.querySelector('.brand').addEventListener('click', (event) => { event.preventDefault(); $('nav-learn').click(); });
  $('btn-close-settings').addEventListener('click', () => $('settings').close());
  $('settings').addEventListener('close', () => $('btn-settings').setAttribute('aria-expanded', 'false'));
  window.addEventListener('resize', applyMode);

  // 共用按钮
  $('btn-settings').addEventListener('click', openSettings);

  // 对话模式的按钮
  $('btn-chat-send').addEventListener('click', sendChat);
  $('btn-chat-stop').addEventListener('click',()=>{ replyController?.abort(); stopReading(); });
  $('btn-export-chat').addEventListener('click',()=>{if(session)downloadFile(`${session.title.replace(/[\\/:*?"<>|]/g,'_')}.md`,conversationMarkdown(session),'text/markdown;charset=utf-8').catch(error=>chatToast(error.message,{error:true}));});
  $('chat-input').addEventListener('input',()=>{clearTimeout(draftTimer);$('draft-status').textContent='';draftTimer=setTimeout(persistDraft,450);});
  $('chat-input').addEventListener('blur',persistDraft);
  window.addEventListener('pagehide',persistDraft);
  window.addEventListener('dreamwhale:pause',()=>{persistDraft();learning?.saveDraft();});
  window.addEventListener('dreamwhale:back',event=>{
    const dialogs=[...document.querySelectorAll('dialog[open]')];
    if(dialogs.length){dialogs.at(-1).close();event.preventDefault();return;}
    if($('view-chat').matches('.side-open,.practice-open')){responsive.closePanels();event.preventDefault();return;}
    if(mode!==MODES.learn){$('nav-learn').click();event.preventDefault();}
  });
  const networkStatus=()=>{$('connection-status').textContent=navigator.onLine?'':'离线 · 本地学习仍可使用';};
  window.addEventListener('online',networkStatus);window.addEventListener('offline',networkStatus);networkStatus();
  restoreDraft();
  $('chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && client.preferences().enterSend && !window.matchMedia('(pointer: coarse)').matches) {
      e.preventDefault();
      sendChat();
    }
  });

  applyMode();
  if (mode !== MODES.chat) learning.setPage(mode);

  if (!storageAvailable()) {
    chatToast('当前环境无法使用本地存储，请允许浏览器存储后再发送', { error: true, ms: 6000 });
  }

  tutorial = initTutorial({
    navigate: (page, mistakes) => {
      if (mode !== page) {
        mode = page; applyMode();
        if (page === MODES.chat) bootChat(); else learning.setPage(page);
      }
      if (mistakes) learning.showMistakes();
    },
    getFaceStyle: () => faceStyle,
    notify: (text) => chatToast(text, { error: true }),
    canStart: () => {
      if (chatBusy || learning.isBusy()) { chatToast('等这一轮完成，再让梦鲸带你逛逛。'); return false; }
      if (!learning.saveDraft()) return false;
      responsive.closePanels();
      for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
      learning.setPage(mode === MODES.chat ? 'learn' : mode);
      return true;
    },
    onClose: () => { saveMode(mode); },
  });
  $('btn-tutorial').addEventListener('click', () => tutorial.start({ restart: true }));
  if (tutorial.shouldStart()) tutorial.start();
  else if (mode === MODES.chat) bootChat();
}

boot().catch(error=>chatToast(`启动失败：${error.message}。原有数据未清空。`,{error:true,ms:30000}));
