// 真实模型自动抽查。运行：
//   WORD_BLADE_KEY=sk-xxx node tools/sweep-check.mjs --rounds 10
//
// 为什么密钥只从环境变量读：写成 --key 参数会进 shell 历史、也会出现在进程列表里。
// 脚本自身不打印密钥、不写任何文件。
//
// 它复用应用自己的引擎模块（提示词、题库、限额、用量解析），所以测的是真实链路，
// 而不是另写一套近似实现。检查项见下方 CHECKS。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/* ---------------- 环境与参数 ---------------- */

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const KEY = process.env.WORD_BLADE_KEY || '';
if (!KEY) {
  console.error('缺少密钥。用法：WORD_BLADE_KEY=sk-xxx node tools/sweep-check.mjs --rounds 10');
  console.error('（密钥只从环境变量读，避免写入 shell 历史。）');
  process.exit(2);
}

const cfg = {
  endpoint: arg('endpoint', 'https://api.deepseek.com/v1'),
  model: arg('model', 'deepseek-flash'),
  rounds: Math.max(1, Math.min(60, Number(arg('rounds', 10)) || 10)),
  every: Math.max(1, Math.min(20, Number(arg('every', 2)) || 2)),
  temperature: Number(arg('temperature', 0.9)) || 0.9,
  // 休息期：出满 qbefore 题后连休 restturns 轮。想验休息期就把它调小
  qbefore: Math.max(1, Math.min(100, Number(arg('qbefore', 10)) || 10)),
  restturns: Math.max(0, Math.min(100, Number(arg('restturns', 10)) || 0)),
  historyLimit: Math.max(2, Math.min(500, Number(arg('history', 60)) || 60)),
  maxContext: Math.max(1000, Number(arg('maxctx', 64000)) || 64000),
};

/* ---------------- 引擎 ---------------- */

const { buildChatSystem } = await import(pathToFileURL(path.join(root, 'src/content/chat.js')).href);
const { emotionPromptList } = await import(pathToFileURL(path.join(root, 'src/engine/emotions.js')).href);
const { createSession, appendMessage, assistantReplyCount, buildChatMessages, deriveTitle } =
  await import(pathToFileURL(path.join(root, 'src/engine/chat.js')).href);
const { drawQuestion, renderQuestionBody, planInjection, applyRestState } =
  await import(pathToFileURL(path.join(root, 'src/engine/questions.js')).href);
const { callText } = await import(pathToFileURL(path.join(root, 'src/gateway/model.js')).href);
const { parseMarkers } = await import(pathToFileURL(path.join(root, 'src/engine/markers.js')).href);

/* ---------------- 驱动 ---------------- */

const PROFILE = { name: '阿澈', gender: '男', customGender: '' };

const LETTERS = 'ABCDEFGH';

/**
 * 针对某道题，按指定意图生成作答文本。
 * 关键：错选项由「正确答案的实际位置」推出来，保证真的是错的——
 * 之前按轮次硬编码「选 B 就是错」，碰上答案恰好在 B 就会误判。
 */
function answerFor(question, kind) {
  if (kind === 'giveup') return '我真的不会，你直接讲吧';
  if (question.type === 'fill' || !Array.isArray(question.options) || !question.options.length) {
    return kind === 'correct' ? `我猜是 ${question.answer}` : '我随便填个 zzz，应该不对';
  }
  const right = question.options.indexOf(question.answer);
  if (right < 0) return kind === 'correct' ? `我选 ${question.answer}` : '我选 A';
  const wrong = right === 0 ? 1 : 0;
  return kind === 'correct'
    ? `我选 ${LETTERS[right]}，就它了`
    : `我选 ${LETTERS[wrong]}，感觉是这个`;
}

const BRANCH_CYCLE = ['wrong', 'correct', 'giveup'];
const BRANCH_LABEL = { wrong: '答错', correct: '答对', giveup: '说不会' };

const rows = [];
const problems = [];

async function run() {
  let session = createSession({
    profile: PROFILE,
    everyN: cfg.every,
    difficulty: 'all',
    restConfig: { enabled: cfg.restturns > 0, questionsBeforeRest: cfg.qbefore, restTurns: cfg.restturns },
    limits: { enabled: true, renderLimit: 500, historyLimit: cfg.historyLimit, maxContextTokens: cfg.maxContext, trimRatio: 0.7 },
  });
  let pendingQuestion = null; // 上一轮出的题：下一轮要对它作答
  let pendingKind = null;     // 这次用哪种作答意图（答错 / 答对 / 说不会）
  let kindIdx = 0;
  const FILLER = ['好久不见，你还记得我吗', '今天天气不错', '刚考完试，有点累'];

  for (let turn = 1; turn <= cfg.rounds; turn += 1) {
    // 1) 代码决定是否插题
    const plan = planInjection({ assistantReplyCount: assistantReplyCount(session), everyN: cfg.every, session });
    session = applyRestState(session, plan.next);
    let question = null;
    if (plan.inject) {
      question = drawQuestion({ session, difficulty: session.difficulty });
      session = { ...session, usedQuestionIds: [...session.usedQuestionIds, question.id] };
      // 题目一发出就排队：下一轮对它作答，意图按顺序轮换，三种分支一次跑全
      pendingQuestion = question;
      pendingKind = BRANCH_CYCLE[kindIdx % BRANCH_CYCLE.length];
      kindIdx += 1;
    }

    // 有题待答就作答，否则闲聊。作答与题目严格一一对应，不会出现同一题被连答两次
    const answering = Boolean(pendingQuestion && !question);
    const userText = answering ? answerFor(pendingQuestion, pendingKind) : FILLER[turn % FILLER.length];
    session = appendMessage(session, { role: 'user', text: userText, questionId: question?.id || null });
    session = { ...session, title: deriveTitle(session) };

    // 2) 调模型
    const system = buildChatSystem(session.profile, { emotionList: emotionPromptList() });
    const messages = buildChatMessages(session, system, { cursor: session.trimCursor || 0 });
    let reply = '';
    let usage = null;
    try {
      const r = await callText(
        { endpoint: cfg.endpoint, model: cfg.model, apiKey: KEY, temperature: cfg.temperature },
        { messages },
      );
      reply = r.text;
      usage = r.usage;
    } catch (err) {
      problems.push(`第 ${turn} 轮请求失败：${err.message}`);
      break;
    }
    session = appendMessage(session, { role: 'assistant', text: reply, usage });

    // 3) 检查
    const segs = parseMarkers(reply);
    const kinds = new Set(segs.map((s) => s.type));
    const echoed = (reply.match(/<Question>([\s\S]*?)<\/Question>/) || [])[1] || null;

    let echoVerdict = '—';
    if (question) {
      const stem = renderQuestionBody(question).split('\n')[0];
      const blanksOf = (t) => (String(t).match(/_+/g) || []).map((x) => x.length);
      const stemEchoed = String(echoed || '').includes(stem);
      const sameBlanks = JSON.stringify(blanksOf(stem)) === JSON.stringify(blanksOf(echoed || ''));
      echoVerdict = stemEchoed ? (sameBlanks ? '逐字一致' : '内容一致·空格被改写') : '题干不一致';
      if (!stemEchoed) problems.push(`第 ${turn} 轮题目回显与题库不一致`);
      if (stemEchoed && !sameBlanks) {
        problems.push(`第 ${turn} 轮空格标记被改写（期望 ${JSON.stringify(blanksOf(stem))}，实际 ${JSON.stringify(blanksOf(echoed))}）`);
      }
    } else if (echoed) {
      problems.push(`第 ${turn} 轮没有插题，模型却自己出了题`);
    }

    if (/<AnswerKey>/.test(reply)) problems.push(`第 ${turn} 轮泄露了 <AnswerKey>`);

    // 作答分支行为：只判「刚刚答完的那一轮」，且按该轮的意图分别核对
    let branch = '';
    if (answering) {
      const q = pendingQuestion;
      const hasAnswer = new RegExp(`\\b${q.answer}\\b`, 'i').test(reply);
      const label = BRANCH_LABEL[pendingKind];
      if (pendingKind === 'wrong') {
        branch = hasAnswer ? `${label}·却说出了答案 ✗` : `${label}·只给提示 ✓`;
        if (hasAnswer) problems.push(`第 ${turn} 轮（${q.id}）答错时直接说出了答案「${q.answer}」`);
      } else if (pendingKind === 'giveup') {
        branch = hasAnswer ? `${label}·已讲解 ✓` : `${label}·未讲解 ✗`;
        if (!hasAnswer) problems.push(`第 ${turn} 轮（${q.id}）说不会时没有给出答案「${q.answer}」`);
      } else {
        branch = `${label}·已回应`;
      }
      pendingQuestion = null;
      pendingKind = null;
    }

    rows.push({
      turn,
      user: userText.slice(0, 10),
      replyChars: reply.length,
      completion: usage?.completion ?? null,
      prompt: usage?.prompt ?? null,
      cached: usage?.cached ?? null,
      markers: `${kinds.has('env') ? '环' : '—'}${kinds.has('action') ? '动' : '—'}${kinds.has('thought') ? '心' : '—'}${kinds.has('speech') ? '话' : '—'}`,
      inject: plan.inject ? '题' : '休',
      why: { rest: '休息期', cadence: '未到节奏', normal: '常规', 'last-before-rest': '本周期末题' }[plan.reason] || plan.reason,
      question: question ? question.id : '',
      echo: echoVerdict,
      branch,
    });
  }

  report();
}

/* ---------------- 报告 ---------------- */

function avg(arr) {
  const v = arr.filter((x) => typeof x === 'number' && Number.isFinite(x));
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
}

function report() {
  const pad = (s, n) => String(s ?? '').padEnd(n);

  console.log('');
  console.log(`=== 抽查结果（${cfg.model} · ${rows.length} 轮 · 每 ${cfg.every} 轮一题）===`);
  console.log('');
  console.log(`${pad('轮', 4)}${pad('标记', 7)}${pad('出题', 6)}${pad('原因', 13)}${pad('题目', 8)}${pad('回显', 20)}${pad('字数', 6)}${pad('输出', 6)}${pad('输入', 8)}${pad('缓存', 7)}分支`);
  for (const r of rows) {
    console.log(`${pad(r.turn, 4)}${pad(r.markers, 7)}${pad(r.inject, 6)}${pad(r.why, 13)}${pad(r.question, 8)}${pad(r.echo, 20)}${pad(r.replyChars, 6)}${pad(r.completion, 6)}${pad(r.prompt, 8)}${pad(r.cached, 7)}${r.branch}`);
  }

  const prompts = rows.map((r) => r.prompt);
  const cacheds = rows.map((r) => r.cached).filter((x) => typeof x === 'number');
  const totalPrompt = prompts.reduce((a, b) => a + (b || 0), 0);
  const totalCached = cacheds.reduce((a, b) => a + b, 0);
  const totalOut = rows.reduce((a, b) => a + (b.completion || 0), 0);

  console.log('');
  console.log('=== 汇总 ===');
  console.log(`回复字数：平均 ${avg(rows.map((r) => r.replyChars))}（最短 ${Math.min(...rows.map((r) => r.replyChars))} / 最长 ${Math.max(...rows.map((r) => r.replyChars))}）`);
  console.log(`token：输入合计 ${totalPrompt.toLocaleString('en-US')}（其中缓存命中 ${totalCached.toLocaleString('en-US')}，${totalPrompt ? Math.round((totalCached / totalPrompt) * 100) : 0}%）｜输出合计 ${totalOut.toLocaleString('en-US')}`);
  console.log(`标记覆盖：${rows.filter((r) => r.markers === '环动心话').length}/${rows.length} 轮四类齐全`);
  const qRows = rows.filter((r) => r.question);
  console.log(`题目：共出 ${qRows.length} 道，逐字一致 ${qRows.filter((r) => r.echo === '逐字一致').length} 道，空格被改写 ${qRows.filter((r) => r.echo === '内容一致·空格被改写').length} 道，不一致 ${qRows.filter((r) => r.echo === '题干不一致').length} 道`);

  console.log('');
  if (problems.length) {
    console.log(`=== 发现 ${problems.length} 个问题 ===`);
    for (const p of problems) console.log('  ✗ ' + p);
    process.exitCode = 1;
  } else {
    console.log('=== 没有发现硬性问题 ===');
  }
  console.log('');
}

run();
