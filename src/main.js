// 编排层：把内容、引擎、网关、存储、UI 串起来。
// 这里只做流程编排；难度、失败上限、万能词发放、统计全部由代码执行，不交给模型。

import { usableMemes } from './content/memes.js';
import {
  JUDGE_SYSTEM, buildSceneSystem,
  buildSceneUserMessage, buildJudgeUserMessage,
  SCENE_FLOOR_CHARS, prefillFor,
} from './content/prompts.js';
import { DIFFICULTIES, DEFAULT_DIFFICULTY, getDifficulty } from './content/difficulty.js';
import { buildLetterPool } from './engine/letters.js';
// 全量词库（258 KB）不在这里静态加载：它只有拼单词模式用得到，
// 而聊天模式是默认项。静态 import 会让每个聊天用户白拉这 258 KB。
let wordbankMod = null;
async function loadWordbank() {
  if (!wordbankMod) wordbankMod = await import('./engine/wordbank.js');
  return wordbankMod;
}
import { RetryableError, normalizeScene, normalizeJudge } from './engine/judge.js';
import {
  createRun, setScene, toggleTile, clearSelection, undoSelection, selectedWord,
  reroll, commitAttempt, applyVerdict, wildcardSubmit, pickWildcardWord,
  failureLimitOf, failuresLeft, wildcardsLeft,
} from './engine/state.js';
import { emptyStats, commitRun, viewStats } from './engine/stats.js';
import { callJson, emptyProfile, normalizeModelProfile, PROFILE_PRESETS, probe, modelReadiness, normalizeEndpoint } from './gateway/model.js';
import {
  DEFAULT_LIMITS, clampLimits,
} from './engine/limits.js';
import {
  loadRun, saveRun, clearRun, loadProfile, saveProfile, storageAvailable,
  loadStats, saveStats, clearStats,
  loadChatSession, saveChatSession, clearChatSession,
  loadSessionList, setCurrentSession, deleteChatSession, sweepOrphanMessages,
  loadUserProfile, saveUserProfile, loadMode, saveMode, MODES,
  loadFaceStyle, saveFaceStyle,
} from './storage/save.js';
import { renderLetters, renderHud, renderScene, renderVerdict, toast } from './ui/letters-panel.js';
import { buildChatPrompt } from './content/chat.js';
import { emotionPromptList, resolveFace, lastFace } from './engine/emotions.js';
import { localMediaUrl } from './platform/media.js';
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

const $ = (id) => document.getElementById(id);

let run = null;
let profile = emptyProfile();
let stats = emptyStats();
let busy = false;

// 对话模式
let mode = 'chat';
let session = null;
let userProfile = null;
let chatBusy = false;
let faceStyle = DEFAULT_FACE_STYLE;

/* ---------------- 渲染 ---------------- */

function currentScene() {
  return run?.current?.scene || run?.lastScene || null;
}

function render() {
  const activeRun = run && !run.committed ? run : null;
  renderHud({
    els: {
      scene: $('hud-scene'), turns: $('hud-turns'), passed: $('hud-passed'),
      fail: $('hud-fail'), wildcard: $('hud-wildcard'),
      difficulty: $('hud-difficulty'), tier: $('hud-tier'),
    },
    run,
    failuresLeft: run ? failuresLeft(run) : Infinity,
    wildcardsLeft: run ? wildcardsLeft(run) : 0,
    difficultyLabel: run ? getDifficulty(run.difficulty).label : '',
  });

  renderScene({
    textEl: $('scene-text'),
    objectiveWrap: $('scene-objective'),
    objectiveText: $('objective-text'),
    tags: { mode: $('tag-mode'), shell: $('tag-shell'), meme: $('tag-meme') },
    scene: currentScene(),
    loading: busy && !currentScene(),
    stale: !run?.current && Boolean(run?.lastScene),
  });

  renderLetters({
    tileHost: $('tiles'),
    wordline: $('wordline'),
    run,
    busy,
    onToggle: onToggleTile,
  });

  renderVerdict({
    paneEl: $('verdict-card'),
    titleEl: $('verdict-title'),
    narrativeEl: $('verdict-narrative'),
    feedbackEl: $('verdict-feedback'),
    detailEl: $('verdict-detail'),
    verdict: run?.lastVerdict || null,
  });

  const over = Boolean(run?.over);
  $('gameover').classList.toggle('hidden', !over);
  if (over) {
    $('gameover-text').textContent =
      `在「${getDifficulty(run.difficulty).label}」难度下失败 ${run.failures} 次，副本终止。`
      + `本局通过 ${run.passedChallenges} 个挑战，输出 ${run.outputTurns} 轮。`;
  }

  const primary = $('btn-submit');
  primary.textContent = over ? '本局已结束' : (run?.current ? '确定' : '继续下一场景');
  primary.disabled = busy || over;

  const noWildcard = !run || over || wildcardsLeft(run) <= 0;
  for (const id of ['btn-undo', 'btn-clear', 'btn-dice']) {
    $(id).disabled = busy || !run?.current || over;
  }
  $('btn-wildcard').disabled = busy || !run?.current || noWildcard;
  $('btn-wildcard').textContent = wildcardsLeft(run) === Infinity ? '万能词 ∞' : `万能词 ${wildcardsLeft(run) || 0}`;

  $('btn-stats').disabled = false;
}

function setBusy(v) {
  busy = v;
  syncInteractionLocks();
  render();
}

function syncInteractionLocks() {
  for (const id of ['btn-save-settings', 'btn-clear-save', 'btn-pf-save', 'btn-restart', 'btn-reset-stats']) {
    $(id).disabled = busy || chatBusy;
  }
}

/* ---------------- 一回合的链路 ---------------- */

async function callModel(system, user, kind) {
  const { data } = await callJson(
    { ...profile },
    { system, user, prefill: prefillFor(kind, profile.usePrefill !== false), requestContext: { sessionId: run?.id, promptVersion: `wordblade-${kind}` } },
  );
  return data;
}

/**
 * 抽词 → 出题 → 发牌。
 * 词源完全由代码决定：从四级核心/热点词库抽取主题词与标准答案，不让模型凭空想词。
 * 只有出题这一步交给模型，不合格就整体重来，最多三次。
 */
async function advance() {
  if (busy || run.over) return;
  setBusy(true);

  let words;
  try {
    const { drawWords } = await loadWordbank();
    words = drawWords({
      usedWords: run.usedWords,
      hotOnly: run.tier === '基础', // 基础档只抽高频词，进阶档放开到全部四级核心词
      count: 2,
    });
  } catch (err) {
    setBusy(false);
    toast(`抽词失败：${err.message}`, { error: true, ms: 7000 });
    return;
  }

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const sceneRaw = await callModel(
        buildSceneSystem(usableMemes()),
        buildSceneUserMessage({ tier: run.tier, words, usedScenes: run.usedScenes }),
        'scene',
      );
      const scene = normalizeScene(sceneRaw, { words, minChars: SCENE_FLOOR_CHARS });

      const pool = buildLetterPool(scene.words.map((w) => w.word));
      run = setScene(run, { scene, pool });
      saveRun(run);
      setBusy(false);
      return;
    } catch (err) {
      const last = attempt === 3;
      if (!last && err instanceof RetryableError) {
        toast(`第 ${attempt} 次出题不合格（${err.kind}），重试中…`);
        continue;
      }
      setBusy(false);
      toast(describeError(err), { error: true, ms: 7000 });
      return;
    }
  }
}

async function submit() {
  if (busy) return;
  if (!run?.current) {
    toast('还没有进行中的场景，点「继续下一场景」开始');
    return;
  }
  const word = selectedWord(run);
  if (!word) {
    toast('先从字母面板拼出一个单词');
    return;
  }
  await runJudge({ word, viaWildcard: false });
}

/**
 * 万能词：从本轮目标词里随机取一个作为预设的正确答案，直接发给模型。
 * 不强制成功——目标词本来就该通过判定，让模型正常判。
 */
async function submitWildcard() {
  if (busy) return;
  if (!run?.current) {
    toast('还没有进行中的场景，点「继续下一场景」开始');
    return;
  }
  const word = pickWildcardWord(run.current.scene);
  if (!word) {
    toast('本轮没有可用的预设答案', { error: true });
    return;
  }
  await runJudge({ word, viaWildcard: true });
}

/**
 * 判定的关键是：技术性失败必须回滚，不能算玩家的输出轮数、也不计失败次数。
 * 只有拿到语义合法的判定，才把这次提交写进存档。
 * 模型偶尔漏字段或返回不合法 JSON 是常态，所以这里自带重试。
 */
async function runJudge({ word, viaWildcard }) {
  const before = run;
  let next = viaWildcard ? wildcardSubmit(run, word) : commitAttempt(run, word);
  setBusy(true);

  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const raw = await callModel(
        JUDGE_SYSTEM,
        buildJudgeUserMessage({ scene: next.current.scene, word }),
        'judge',
      );
      const verdict = normalizeJudge(raw, { word });

      if (verdict.passed) {
        run = applyVerdict(next, verdict);
        settleIfOver();
        saveRun(run);
        setBusy(false);
        const granted = grantedWildcard(run);
        toast(granted
          ? `应对生效，通过 ${run.passedChallenges} 次，奖励 1 个万能词`
          : (viaWildcard ? '万能词送出预设答案，点「继续下一场景」开始新副本' : '应对生效，点「继续下一场景」开始新副本'));
        return;
      }

      // 不通过：按难度计失败；未触顶则重发手牌，触顶则本局结束
      const nextPool = buildLetterPool(next.current.scene.words.map((w) => w.word));
      run = applyVerdict(next, verdict, { nextPool });
      settleIfOver();
      saveRun(run);
      setBusy(false);
      if (run.over) {
        toast(`失败 ${run.failures} 次，本局结束`, { error: true, ms: 6000 });
      } else {
        const left = failuresLeft(run);
        toast(Number.isFinite(left)
          ? `未能应对，还剩 ${left} 次失败机会，手牌已重发`
          : '未能应对，手牌已重发，再试一次');
      }
      return;
    } catch (err) {
      lastErr = err;
      if (err instanceof RetryableError && attempt < 3) {
        toast(`模型回复不合格（${err.kind}），第 ${attempt + 1} 次重试中…`);
        continue;
      }
      break;
    }
  }

  run = before; // 回滚：技术性失败不计轮数、不计失败、不改手牌、不消耗道具
  setBusy(false);
  toast(describeError(lastErr), { error: true, ms: 7000 });
}

/** 判断这一次通过是否刚好触发万能词奖励（仅用于提示）。 */
function grantedWildcard(after) {
  const every = getDifficulty(after.difficulty).wildcardGrantEvery;
  return Boolean(every) && after.passedChallenges % every === 0;
}

/* ---------------- 统计 ---------------- */

/**
 * 本局结束时自动结算一次统计，并打上 committed 标记防止重复计数
 * （否则刷新页面后再点重开会把同一局算两遍）。
 */
function settleIfOver() {
  if (!run || run.committed || !run.over) return run;
  stats = commitRun(stats, run.difficulty, run);
  saveStats(stats);
  run = { ...run, committed: true };
  saveRun(run);
  return run;
}

/** 主动结算当前这一局（重开、换难度、清档前调用），并打上已结算标记防止重复计数。 */
function commitCurrentRun() {
  if (!run || run.committed) return;
  stats = commitRun(stats, run.difficulty, run);
  saveStats(stats);
  run = { ...run, committed: true };
  saveRun(run);
}

function renderStats() {
  const activeRun = run && !run.committed ? run : null;
  // 词库是按需加载的：聊天模式下大概率还没加载，这时不为了显示一行统计把它拉下来
  if (wordbankMod) {
    const bank = wordbankMod.describeBank();
    $('bank-info').textContent =
      `词库（拼单词模式，已加载）：四级核心 ${bank.total} 词，其中高频（COCA 前 ${bank.hotRankMax} 名）${bank.hot} 词；`
      + `词长 ${bank.minLen}–${bank.maxLen} 字母。`;
  } else {
    $('bank-info').textContent =
      '词库（拼单词模式）：尚未加载。它约 258 KB，只在切到拼单词模式时才按需拉取，'
      + '这样聊天模式的首屏不必为它买单。';
  }
  const qb = describeQuestionBank();
  const types = Object.entries(qb.byType).map(([k, v]) => `${k} ${v}`).join(' / ');
  const diffs = Object.entries(qb.byDifficulty).map(([k, v]) => `${k} ${v}`).join(' / ');
  $('question-bank-info').textContent =
    `题库（对话模式）：${qb.total} 题（${types}；${diffs}），批次 ${qb.id}。`;
  const head = '<tr><th>难度</th><th>最高通过</th><th>累计通过</th><th>已结算局数</th><th>最高输出轮数</th></tr>';
  const rows = DIFFICULTIES.map((d) => {
    const v = viewStats(stats, d.id, activeRun);
    const cls = activeRun && activeRun.difficulty === d.id ? ' class="active"' : '';
    return `<tr${cls}><td>${d.label}</td><td>${v.bestPassed}</td><td>${v.totalPassed}</td><td>${v.runs}</td><td>${v.bestTurns}</td></tr>`;
  }).join('');
  $('stats-table').innerHTML = head + rows;
}

/* ---------------- 交互 ---------------- */

function onToggleTile(tileId) {
  if (busy || !run?.current || run.over) return;
  run = toggleTile(run, tileId);
  render();
}

function onReroll() {
  if (busy || !run?.current || run.over) return;
  try {
    const pool = buildLetterPool(run.current.scene.words.map((w) => w.word));
    run = reroll(run, { pool });
    saveRun(run);
    render();
  } catch (err) {
    toast(err.message, { error: true });
  }
}

async function restartRun() {
  if (busy || chatBusy) return;
  commitCurrentRun();
  run = createRun({ tier: run?.tier || '基础', difficulty: run?.difficulty || DEFAULT_DIFFICULTY });
  saveRun(run);
  render();
  await advance();
}

/* ---------------- 设置 ---------------- */

function fillDifficultySelect() {
  const sel = $('difficulty');
  sel.replaceChildren(...DIFFICULTIES.map((d) => {
    const o = document.createElement('option');
    o.value = d.id;
    o.textContent = `${d.label} · ${d.note}`;
    return o;
  }));
}

function showDifficultyNote() {
  $('difficulty-note').textContent = getDifficulty($('difficulty').value).note;
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

function openSettings() {
  $('endpoint').value = profile.endpoint || '';
  $('model').value = profile.model || '';
  $('apiKey').value = profile.apiKey || '';
  $('usePrefill').checked = profile.usePrefill !== false;
  $('set-provider').value = profile.provider || 'custom';
  $('set-cache-mode').value = profile.cacheMode || 'auto';
  $('set-debug-summary').checked = session?.debugSummaries === true;
  $('preset').value = PROFILE_PRESETS.find((p) => p.endpoint === profile.endpoint && p.model === profile.model)?.id || 'custom';
  $('tier').value = run?.tier || '基础';
  $('difficulty').value = run?.difficulty || DEFAULT_DIFFICULTY;
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
  showDifficultyNote();
  showFaceStylePreview();
  $('settings').showModal();
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

/** 边填边显示「最终会请求哪个地址」，让归一化可见而不是魔法。 */
function showEndpointNote() {
  const raw = $('endpoint').value.trim();
  const note = $('endpoint-note');
  if (!raw) {
    note.textContent = '';
    return;
  }
  const url = normalizeEndpoint(raw);
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
      $('endpoint').value = p.endpoint;
      $('model').value = p.model;
      showEndpointNote();
    }
  });

  fillDifficultySelect();
  fillFaceStyleSelect();
  $('difficulty').addEventListener('change', showDifficultyNote);
  $('set-face-style').addEventListener('change', changeFaceStyle);
  for (const id of ['set-limits-enable', 'set-renderlimit', 'set-historylimit', 'set-maxcontext']) {
    $(id).addEventListener('change', showLimitsNote);
  }
  $('endpoint').addEventListener('input', showEndpointNote);

  $('btn-test').addEventListener('click', async () => {
    const out = $('test-result');
    out.textContent = '正在测试…';
    try {
      const r = await probe({
        endpoint: $('endpoint').value.trim(),
        model: $('model').value.trim(),
        apiKey: $('apiKey').value.trim(),
        provider: $('set-provider').value,
        cacheMode: $('set-cache-mode').value,
      });
      out.textContent = `连接成功。模型返回：${r.preview}`;
    } catch (err) {
      out.textContent = `连接失败：${describeError(err)}`;
    }
  });

  $('btn-save-settings').addEventListener('click', async () => {
    if (busy || chatBusy) return;
    const nextProfile = normalizeModelProfile({
      endpoint: $('endpoint').value.trim(),
      model: $('model').value.trim(),
      apiKey: $('apiKey').value.trim(),
      usePrefill: $('usePrefill').checked,
      provider: $('set-provider').value,
      cacheMode: $('set-cache-mode').value,
    });
    if (!saveProfile(nextProfile)) {
      chatToast('模型设置未能保存，请检查浏览器存储空间与权限', { error: true });
      return;
    }
    profile = nextProfile;

    // 对话模式参数
    if (session) {
      const nextSession = {
        ...session,
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
          trimRatio: session.limits?.trimRatio ?? DEFAULT_LIMITS.trimRatio,
        }),
      };
      // 改了「每几题休息」就重置本周期计数，避免刚改完就立刻触发或永远不触发
      nextSession.questionsSinceRest = Math.min(nextSession.questionsSinceRest, nextSession.restConfig.questionsBeforeRest - 1);
      if (!persistSession(nextSession)) return;
      session = nextSession;
    }

    // 玩法模式切换
    const nextMode = $('set-mode').value === MODES.wordblade ? MODES.wordblade : MODES.chat;
    const modeChanged = nextMode !== mode;
    mode = nextMode;
    saveMode(mode);

    // 拼单词模式的档位
    const tier = $('tier').value;
    const difficulty = $('difficulty').value;
    const runChanged = run && (tier !== run.tier || difficulty !== run.difficulty);
    if (runChanged) {
      commitCurrentRun();
      run = createRun({ tier, difficulty });
      saveRun(run);
    }

    $('settings').close();
    applyMode();
    if (mode === MODES.wordblade) {
      if (modeChanged || runChanged) { await bootWordblade(); } else if (!run.current && !run.over) { await advance(); }
    } else {
      if (!session) bootChat();
      else renderChat();
    }
  });

  $('btn-clear-save').addEventListener('click', async () => {
    if (busy || chatBusy) return;
    if (!clearChatSession()) {
      chatToast('清空失败，原存档未能全部移除，请检查浏览器存储权限', { error: true });
      return;
    }
    commitCurrentRun();
    clearRun();
    run = createRun({ tier: $('tier').value || '基础', difficulty: $('difficulty').value || DEFAULT_DIFFICULTY });
    saveRun(run);
    session = createSession({
      profile: userProfile,
      everyN: clampEveryN($('set-everyn').value),
      difficulty: $('set-qdiff').value || 'all',
    });
    const saved = persistSession(session);
    $('settings').close();
    applyMode();
    if (mode === MODES.wordblade) {
      render();
      await advance();
    } else {
      renderChat();
      if (saved) chatToast('对话已清空，从头再聊一次');
    }
  });
}

function initStats() {
  $('btn-stats').addEventListener('click', () => { renderStats(); $('stats-dialog').showModal(); });
  $('btn-stats-2').addEventListener('click', () => { renderStats(); $('stats-dialog').showModal(); });
  $('btn-close-stats').addEventListener('click', () => $('stats-dialog').close());
  $('btn-reset-stats').addEventListener('click', () => {
    if (busy || chatBusy) return;
    clearStats();
    stats = emptyStats();
    renderStats();
    toast('统计已清空');
  });
}

/* ---------------- 错误提示 ---------------- */

function describeError(err) {
  if (err instanceof RetryableError) {
    const map = {
      'no-key': '还没有填写 API Key，点右上角「设置」',
      'no-endpoint': '还没有配置模型接口地址',
      'invalid-endpoint': '接口地址无效，请使用完整的 http 或 https 地址',
      cancelled: '请求已取消，可以重新生成',
      length: '回复达到长度上限而中断，请提高上下文预算或让回复更简短后重试',
      network: '连不上这个地址。检查接口地址是否正确、是否需要代理；如果页面是 https 而接口是 http，浏览器会直接拦掉',
      timeout: '请求超时。场景较长时出题会比较慢，可以重试或换更快的模型',
      http: '接口返回了错误。常见原因：Key 不对、模型名写错、余额不足、该端点不允许浏览器直连（CORS）',
      'not-json': '接口返回的不是 JSON，通常说明地址填的是网页而不是 API 端点',
      empty: '模型没有返回内容，可以重试',
      schema: '模型返回的字段不符合协议（多为漏字段），已自动重试',
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
  $('view-wordblade').classList.toggle('hidden', isChat);
  $('hud-chat-group').classList.toggle('hidden', !isChat);
  $('hud-wordblade-group').classList.toggle('hidden', isChat);
  // 侧栏切换按钮只在窄屏有意义，宽屏侧栏常驻
  $('btn-side').classList.toggle('hidden', !isChat || window.innerWidth > 860);
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
  });
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
  // 已有档案就统一注入到当前会话（会话自带档案时以会话为准）
  if (session.profile) userProfile = normalizeProfile(session.profile) || userProfile;
  else if (userProfile) {
    session = { ...session, profile: userProfile };
    persistSession(session);
  }

  renderChat();

  if (!profileComplete(userProfile)) {
    openProfile({ firstTime: true });
    return;
  }
  if (!hasModel()) {
    chatToast('还没配置模型端点，先点右上角「设置」');
  }
}

/**
 * 发送。按钮不是直接发送——先由代码判断这一轮要不要插题：
 * 需要插题就抽一道，把题目与用户消息拼成一段文本，题目用 <Question> 包裹。
 * 对错由模型在对话里判断（按驾驶员确认），代码不判。
 */
async function sendChat() {
  if (chatBusy || busy) return;
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
    const next = prepareUserTurn(session, text);
    if (!persistSession(next)) return;
    session = next;
    input.value = '';
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
  const snapshot = session;
  try {
    const system = buildChatPrompt(snapshot.profile, { emotionList: emotionPromptList() });
    const next = await generateChatTurn(snapshot, system, { ...profile });
    if (!replyAppliesTo(session, snapshot)) return false;
    if (!persistSession(next)) {
      session = retainBodiesAfterSaveFailure(snapshot, next);
      return false;
    }
    session = next;
    return true;
  } catch (err) {
    if (err.requestRecord && replyAppliesTo(session, snapshot)) {
      const next = recordRequest(snapshot, err.requestRecord);
      persistSession(next);
      session = next;
    }
    chatToast(describeError(err), { error: true, ms: 8000 });
    return false;
  }
}

/**
 * 重新生成：末尾那条用户消息没有被回应时（超时、断网、页面被关），
 * 不用重打一遍字，直接再请一次模型。
 */
async function regenerateLast() {
  if (chatBusy || busy) return;
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

/** 新建会话。已填过档案就沿用它，省得每次重填。 */
function newSession() {
  if (chatBusy) return;
  if (session && !persistSession(session)) return;
  const next = createSession({
    profile: userProfile,
    everyN: session?.everyN ?? DEFAULT_EVERY_N,
    difficulty: session?.difficulty ?? 'all',
    restConfig: session?.restConfig,
    limits: session?.limits,
    debugSummaries: session?.debugSummaries === true,
  });
  if (!persistSession(next)) return;
  session = next;
  renderChat();
  chatToast('新开了一段对话');
}

function switchSession(id) {
  if (chatBusy || !id) return;
  if (session?.id === id) {
    $('view-chat').classList.remove('side-open');
    return;
  }
  if (!persistSession(session)) return;
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
  $('view-chat').classList.remove('side-open');
  renderChat();
}

function removeSession(id) {
  if (chatBusy || !id) return;
  const wasCurrent = session?.id === id;
  if (!deleteChatSession(id)) {
    chatToast('删除失败，存档可能已被其他页面修改，请刷新后重试', { error: true });
    return;
  }
  if (wasCurrent) {
    const list = loadSessionList();
    session = list.currentId ? loadChatSession(list.currentId) : null;
    if (!session) {
      session = createSession({ profile: userProfile });
      persistSession(session);
    }
  }
  renderChat();
  chatToast('对话已删除');
}

function removeMessage(id) {
  if (chatBusy) return;
  const next = deleteMessage(session, id);
  if (!persistSession(next)) return;
  session = next;
  renderChat();
}

/* ---------------- user 档案 ---------------- */

let profileFirstTime = false;

function openProfile({ firstTime = false } = {}) {
  profileFirstTime = firstTime;
  fillProfileForm({
    nameEl: $('pf-name'),
    genderEl: $('pf-gender'),
    customEl: $('pf-custom'),
    customWrap: $('pf-custom-wrap'),
    profile: userProfile,
  });
  $('pf-error').textContent = '';
  $('btn-pf-save').textContent = firstTime ? '开始对话' : '保存';
  $('profile-dialog').showModal();
  $('pf-name').focus();
}

function initProfileDialog() {
  $('pf-gender').addEventListener('change', () => syncCustomVisibility({
    genderEl: $('pf-gender'), customWrap: $('pf-custom-wrap'),
  }));

  $('btn-pf-save').addEventListener('click', () => {
    if (busy || chatBusy) return;
    const err = profileFormError({ nameEl: $('pf-name'), genderEl: $('pf-gender'), customEl: $('pf-custom') });
    if (err) {
      $('pf-error').textContent = err;
      return;
    }
    const raw = readProfileForm({ nameEl: $('pf-name'), genderEl: $('pf-gender'), customEl: $('pf-custom') });
    const nextProfile = normalizeProfile(createProfile(raw));
    if (session) {
      const next = { ...session, profile: nextProfile };
      if (!persistSession(next)) return;
      session = next;
    }
    userProfile = nextProfile;
    if (!saveUserProfile(userProfile)) {
      $('pf-error').textContent = '默认档案未能保存，请检查浏览器存储空间与权限';
      renderChat();
      return;
    }
    $('profile-dialog').close();
    renderChat();
    if (profileFirstTime && session && !session.messages.length) {
      chatToast(`好，从今往后她就叫你「${userProfile.name}」了`);
    }
  });

  $('btn-profile').addEventListener('click', () => openProfile());
}

/* ================= 启动 ================= */

async function bootWordblade() {
  run = loadRun() || createRun({ tier: '基础', difficulty: DEFAULT_DIFFICULTY });
  render();

  if (run.over) {
    commitCurrentRun();
    render();
    return;
  }
  if (!hasModel()) {
    toast('先填写 API Key 才能开始出题');
    openSettings();
    return;
  }
  if (!run.current) await advance();
}

async function boot() {
  initSettings();
  initStats();
  initProfileDialog();

  profile = normalizeModelProfile(loadProfile() || emptyProfile());
  stats = loadStats();
  userProfile = loadUserProfile();
  mode = loadMode();
  faceStyle = loadFaceStyle();

  // 共用按钮
  $('btn-settings').addEventListener('click', openSettings);

  // 拼单词模式的按钮：只在对应模式下生效
  $('btn-submit').addEventListener('click', () => {
    if (mode !== MODES.wordblade) return;
    if (busy || run?.over) return;
    if (!run.current) advance();
    else submit();
  });
  $('btn-restart').addEventListener('click', () => { if (mode === MODES.wordblade) restartRun(); });
  $('btn-undo').addEventListener('click', () => { if (mode === MODES.wordblade) { run = undoSelection(run); render(); } });
  $('btn-clear').addEventListener('click', () => { if (mode === MODES.wordblade) { run = clearSelection(run); render(); } });
  $('btn-dice').addEventListener('click', () => { if (mode === MODES.wordblade) onReroll(); });
  $('btn-wildcard').addEventListener('click', () => { if (mode === MODES.wordblade) submitWildcard(); });

  // 对话模式的按钮
  $('btn-chat-send').addEventListener('click', sendChat);
  $('btn-side').addEventListener('click', () => $('view-chat').classList.toggle('side-open'));
  $('chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      sendChat();
    }
  });

  applyMode();

  if (!storageAvailable()) {
    chatToast('当前环境无法使用本地存储，请允许浏览器存储后再发送', { error: true, ms: 6000 });
  }

  if (mode === MODES.wordblade) await bootWordblade();
  else bootChat();
}

boot();
