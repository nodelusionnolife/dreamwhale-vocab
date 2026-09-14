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
import { callJson, callText, emptyProfile, PROFILE_PRESETS, probe, modelReadiness, normalizeEndpoint } from './gateway/model.js';
import {
  DEFAULT_LIMITS, clampLimits, estimateTokens, estimateFrom, systemTokensFor, nextTrimCursor,
} from './engine/limits.js';
import {
  loadRun, saveRun, clearRun, loadProfile, saveProfile, storageAvailable,
  loadStats, saveStats, clearStats,
  loadChatSession, saveChatSession, clearChatSession,
  loadSessionList, setCurrentSession, deleteChatSession, sweepOrphanMessages,
  loadUserProfile, saveUserProfile, loadMode, saveMode, MODES,
  loadFaceHost, saveFaceHost,
} from './storage/save.js';
import { renderLetters, renderHud, renderScene, renderVerdict, toast } from './ui/letters-panel.js';
import { buildChatSystem } from './content/chat.js';
import { emotionPromptList, resolveFace, lastFace } from './engine/emotions.js';
import { resolveAsset } from './engine/assets.js';
import { localMediaUrl } from './platform/media.js';
import { ASSET_MANIFEST } from './content/assets.js';
import { FACE_HOSTS, DEFAULT_FACE_HOST } from './content/emotions.js';
import {
  createSession, appendMessage, assistantReplyCount, buildChatMessages, deriveTitle,
  renameSession, markQuestionUsed, profileComplete, normalizeProfile, createProfile, genderLabel,
  totalUsage, deleteMessage, summarizeSession,
} from './engine/chat.js';
import {
  drawQuestion, shouldAsk, repliesUntilNext, describeBank as describeQuestionBank, DEFAULT_EVERY_N,
  planInjection, applyRestState, restLabel, restState, DEFAULT_REST,
} from './engine/questions.js';
import {
  renderThread, fillProfileForm, syncCustomVisibility, readProfileForm, profileFormError, chatToast,
  renderSessionList,
} from './ui/chat.js';

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
let faceHost = DEFAULT_FACE_HOST; // 表情图床：两个图床同一批图，只换取图地址

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
  render();
}

/* ---------------- 一回合的链路 ---------------- */

async function callModel(system, user, kind) {
  const { data } = await callJson(
    { endpoint: profile.endpoint, model: profile.model, apiKey: profile.apiKey },
    { system, user, prefill: prefillFor(kind, profile.usePrefill !== false) },
  );
  return data;
}

/**
 * 抽词 → 出题 → 发牌。
 * 词源完全由代码决定：从四级核心/热点词库抽取主题词与标准答案，不让模型凭空想词。
 * 只有出题这一步交给模型，不合格就整体重来，最多三次。
 */
async function advance() {
  if (run.over) return;
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

function fillFaceHostSelect() {
  const sel = $('set-facehost');
  sel.replaceChildren(...FACE_HOSTS.map((h) => {
    const o = document.createElement('option');
    o.value = h.id;
    o.textContent = `${h.label}${h.id === DEFAULT_FACE_HOST ? '（默认）' : '（备用）'} · ${h.note}`;
    return o;
  }));
}

function showFaceHostNote() {
  const h = FACE_HOSTS.find((x) => x.id === $('set-facehost').value);
  $('facehost-note').textContent = h
    ? (h.id === DEFAULT_FACE_HOST
      ? '两个图床装的是同一批表情图，切换只换取图地址。当前是默认图床。'
      : '当前用备用图床。若图片加载不出来，就是这条线路不通，切回默认即可。')
    : '';
}

function openSettings() {
  $('endpoint').value = profile.endpoint || '';
  $('model').value = profile.model || '';
  $('apiKey').value = profile.apiKey || '';
  $('usePrefill').checked = profile.usePrefill !== false;
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
  $('set-facehost').value = faceHost;
  showEndpointNote();
  showLimitsNote();
  showDifficultyNote();
  showFaceHostNote();
  $('settings').showModal();
}

function showLimitsNote() {  const lim = clampLimits({
    enabled: $('set-limits-enable').checked,
    renderLimit: $('set-renderlimit').value,
    historyLimit: $('set-historylimit').value,
    maxContextTokens: $('set-maxcontext').value,
  });
  const kept = Math.max(0, (session?.messages?.length || 0) - (session?.trimCursor || 0));
  $('limits-note').textContent = lim.enabled
    ? `当前发送 ${kept} 条历史（上限 ${lim.historyLimit} 条 / ${lim.maxContextTokens.toLocaleString('en-US')} token）。`
      + '超出预算时才裁剪，一次裁到 70%，两次裁剪之间前缀保持不变（这样前缀缓存才有效）。'
    : '限额已关闭：每轮把完整历史发给模型，token 会随轮数平方增长。';
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
    if (p && p.endpoint) {
      $('endpoint').value = p.endpoint;
      $('model').value = p.model;
      showEndpointNote();
    }
  });

  fillDifficultySelect();
  fillFaceHostSelect();
  $('difficulty').addEventListener('change', showDifficultyNote);
  $('set-facehost').addEventListener('change', showFaceHostNote);
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
      });
      out.textContent = `连接成功。模型返回：${r.preview}`;
    } catch (err) {
      out.textContent = `连接失败：${describeError(err)}`;
    }
  });

  $('btn-save-settings').addEventListener('click', async () => {
    profile = {
      endpoint: $('endpoint').value.trim(),
      model: $('model').value.trim(),
      apiKey: $('apiKey').value.trim(),
      usePrefill: $('usePrefill').checked,
    };
    saveProfile(profile);

    // 表情图床（两个图床同一批图，切换只换取图地址）
    faceHost = FACE_HOSTS.some((h) => h.id === $('set-facehost').value)
      ? $('set-facehost').value
      : DEFAULT_FACE_HOST;
    saveFaceHost(faceHost);

    // 对话模式参数
    if (session) {
      session = {
        ...session,
        everyN: clampEveryN($('set-everyn').value),
        difficulty: $('set-qdiff').value || 'all',
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
      session.questionsSinceRest = Math.min(session.questionsSinceRest, session.restConfig.questionsBeforeRest - 1);
      saveChatSession(session);
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
      renderChat();
    }
  });

  $('btn-clear-save').addEventListener('click', async () => {
    commitCurrentRun();
    clearRun();
    clearChatSession();
    run = createRun({ tier: $('tier').value || '基础', difficulty: $('difficulty').value || DEFAULT_DIFFICULTY });
    saveRun(run);
    session = createSession({
      profile: userProfile,
      everyN: clampEveryN($('set-everyn').value),
      difficulty: $('set-qdiff').value || 'all',
    });
    saveChatSession(session);
    $('settings').close();
    applyMode();
    if (mode === MODES.wordblade) {
      render();
      await advance();
    } else {
      renderChat();
      chatToast('对话已清空，从头再聊一次');
    }
  });
}

function initStats() {
  $('btn-stats').addEventListener('click', () => { renderStats(); $('stats-dialog').showModal(); });
  $('btn-stats-2').addEventListener('click', () => { renderStats(); $('stats-dialog').showModal(); });
  $('btn-close-stats').addEventListener('click', () => $('stats-dialog').close());
  $('btn-reset-stats').addEventListener('click', () => {
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
      network: '连不上这个地址。检查接口地址是否正确、是否需要代理；如果页面是 https 而接口是 http，浏览器会直接拦掉',
      timeout: '请求超时。场景较长时出题会比较慢，可以重试或换更快的模型',
      http: '接口返回了错误。常见原因：Key 不对、模型名写错、余额不足、该端点不允许浏览器直连（CORS）',
      'not-json': '接口返回的不是 JSON，通常说明地址填的是网页而不是 API 端点',
      empty: '模型没有返回内容，可以重试',
      schema: '模型返回的字段不符合协议（多为漏字段），已自动重试',
      contradiction: '模型返回的字段自相矛盾，已自动重试',
    };
    return map[err.kind] || `模型调用失败：${err.message}`;
  }
  return err?.message || String(err);
}

/* ---------------- 启动 ---------------- */

/* ================= 对话模式（一期：单会话） ================= */

/** 端点与 Key 是否就绪。判定逻辑来自网关，此处不再自己写一份。 */
function hasModel() {
  return modelReadiness(profile).ready;
}

/**
 * 推进历史窗口。只在超预算时才裁（滞后），两次裁剪之间窗口起点不动，
 * 这样系统提示词之后的前缀保持字节稳定，前缀缓存才吃得满。
 */
function advanceWindow(currentSession, systemText) {
  const u = totalUsage(currentSession);
  const lastReal = u.turns ? u.prompt : null;
  const sysTokens = systemTokensFor({
    systemText,
    lastRealPromptTokens: lastReal,
    lastHistoryEstimate: currentSession.messages.length ? estimateFrom(currentSession.messages, currentSession.trimCursor || 0) : null,
  });
  const plan = nextTrimCursor({
    messages: currentSession.messages,
    systemTokens: sysTokens,
    cursor: currentSession.trimCursor || 0,
    limits: currentSession.limits,
  });
  return {
    session: { ...currentSession, trimCursor: plan.cursor },
    plan,
    systemTokens: sysTokens,
  };
}

/** 落盘并把冲突/配额问题报给用户，不让它静默失败。 */
function persistSession(next) {
  const r = saveChatSession(next);
  if (r.ok) return next;
  if (r.conflict) {
    chatToast('另一个标签页改动了这段对话，为避免覆盖，本次没有保存。刷新页面后再继续。', { error: true, ms: 9000 });
  } else if (r.full) {
    chatToast('本地存储已满，本次没有保存。去设置里调小「发送的历史消息上限」或清空存档重开。', { error: true, ms: 9000 });
  } else {
    chatToast(`保存失败：${r.error || '未知原因'}`, { error: true, ms: 7000 });
  }
  return next;
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
 * 地址在这里才定（要用当前图床），渲染层只收结果——换图床重渲染整条消息才会变。
 * 认不出的标签与缺图的标签都返回 null，界面就不贴图，绝不贴一张错的。
 * @returns {{emotion:string, src:{path:string}}|null}
 */
function faceFor(text) {
  const r = resolveFace(ASSET_MANIFEST, lastFace(text), { host: faceHost });
  const path = mediaUrlFor(r?.src);
  return path ? { emotion: r.emotion, src: { path } } : null;
}

/**
 * 对话背景。底图是清单里的 bg 资产，走 cover 铺满，交给 CSS 缩放。
 * 这里只把地址写进 CSS 变量，尺寸与压暗全在样式里，改版不用动 JS。
 */
function applyChatBackground() {
  const src = resolveAsset(ASSET_MANIFEST, { kind: 'bg' })?.asset?.source;
  const path = mediaUrlFor(src);
  // 地址可能来自清单，虽然是自己写的，仍按不可信处理：只拼进 url() 并转义引号
  document.documentElement.style.setProperty(
    '--chat-bg',
    path ? `url("${path.replace(/["\\]/g, '\\$&')}")` : 'none',
  );
}

function setChatBusy(v) {
  chatBusy = v;
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
  if (chatBusy) return;
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

  // 1) 代码决定这一轮是否插题（含休息期判断），并推进休息状态
  const replies = assistantReplyCount(session);
  const plan = planInjection({ assistantReplyCount: replies, everyN: session.everyN, session });
  session = applyRestState(session, plan.next);

  let question = null;
  if (plan.inject) {
    try {
      question = drawQuestion({ session, difficulty: session.difficulty });
    } catch (err) {
      chatToast(`抽题失败：${err.message}`, { error: true });
    }
  }

  // 2) 落一条用户消息：只存原文 + 题目 id（题目本身不显示在用户气泡里）
  session = appendMessage(session, { role: 'user', text, questionId: question?.id || null });
  if (question) session = markQuestionUsed(session, question.id);
  session = renameSession(session, deriveTitle(session));
  persistSession(session);
  input.value = '';
  renderChat();

  // 3) 请模型回应（含历史窗口推进）
  await generateReply();

  setChatBusy(false);
}

/**
 * 请模型对「当前会话末尾那条用户消息」作出回应。
 * 正常发送与「重新生成」都走这里，避免两份实现。
 */
async function generateReply() {
  try {
    const system = buildChatSystem(session.profile, { emotionList: emotionPromptList() });
    const { session: withWindow } = advanceWindow(session, system);
    session = withWindow;
    const messages = buildChatMessages(session, system, { cursor: session.trimCursor || 0 });
    const { text: reply, usage } = await callText(
      { endpoint: profile.endpoint, model: profile.model, apiKey: profile.apiKey },
      { messages },
    );
    session = appendMessage(session, { role: 'assistant', text: reply, usage });
    persistSession(session);
    return true;
  } catch (err) {
    chatToast(describeError(err), { error: true, ms: 8000 });
    return false;
  }
}

/**
 * 重新生成：末尾那条用户消息没有被回应时（超时、断网、页面被关），
 * 不用重打一遍字，直接再请一次模型。
 */
async function regenerateLast() {
  if (chatBusy) return;
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
  setChatBusy(true);
  await generateReply();
  setChatBusy(false);
}

/* ---------------- 多会话 ---------------- */

/** 新建会话。已填过档案就沿用它，省得每次重填。 */
function newSession() {
  if (chatBusy) return;
  session = createSession({
    profile: userProfile,
    everyN: session?.everyN ?? DEFAULT_EVERY_N,
    difficulty: session?.difficulty ?? 'all',
    restConfig: session?.restConfig,
    limits: session?.limits,
  });
  persistSession(session);
  renderChat();
  chatToast('新开了一段对话');
}

function switchSession(id) {
  if (chatBusy || !id) return;
  if (session?.id === id) {
    $('view-chat').classList.remove('side-open');
    return;
  }
  persistSession(session); // 先把当前这段落盘
  const next = loadChatSession(id);
  if (!next) {
    chatToast('这个对话读不出来了', { error: true });
    return;
  }
  session = next;
  setCurrentSession(id);
  $('view-chat').classList.remove('side-open');
  renderChat();
}

function removeSession(id) {
  if (chatBusy || !id) return;
  const wasCurrent = session?.id === id;
  deleteChatSession(id);
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
  session = deleteMessage(session, id);
  persistSession(session);
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
    const err = profileFormError({ nameEl: $('pf-name'), genderEl: $('pf-gender'), customEl: $('pf-custom') });
    if (err) {
      $('pf-error').textContent = err;
      return;
    }
    const raw = readProfileForm({ nameEl: $('pf-name'), genderEl: $('pf-gender'), customEl: $('pf-custom') });
    userProfile = normalizeProfile(createProfile(raw));
    saveUserProfile(userProfile);
    if (session) {
      session = { ...session, profile: userProfile };
      saveChatSession(session);
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

  profile = loadProfile() || emptyProfile();
  stats = loadStats();
  userProfile = loadUserProfile();
  mode = loadMode();
  faceHost = loadFaceHost();
  applyChatBackground();

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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChat();
    }
  });

  applyMode();

  if (!storageAvailable()) {
    chatToast('当前环境无法使用本地存储，对话不会保存', { error: true, ms: 6000 });
  }

  if (mode === MODES.wordblade) await bootWordblade();
  else bootChat();
}

boot();
