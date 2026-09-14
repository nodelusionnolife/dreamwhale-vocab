// 统计数据。纯逻辑，不得 import 浏览器 API。
//
// 统计口径：
//   bestPassed   该难度下单局最高的通过挑战数（进行中的这一局也参与比较）
//   totalPassed  该难度下累计通过的挑战数（含进行中的这一局）
//   runs         该难度下已结算的局数
//
// 一致性关键：一局结束时才把这一局的数字「结算」进累计量，
// 展示时再叠加当前进行中的这一局，因此反复刷新不会重复计数。

export const STATS_VERSION = 1;

export function emptyStats() {
  return { version: STATS_VERSION, byDifficulty: {} };
}

function blankBucket() {
  return { closedPassed: 0, closedTurns: 0, closedRuns: 0, bestPassed: 0, bestTurns: 0 };
}

/** 一局结束（失败上限触发、切换难度、或手动重开）时结算。 */
export function commitRun(stats, difficultyId, run) {
  const base = stats?.byDifficulty?.[difficultyId] || blankBucket();
  const passed = Number(run?.passedChallenges) || 0;
  const turns = Number(run?.outputTurns) || 0;
  return {
    ...stats,
    byDifficulty: {
      ...stats.byDifficulty,
      [difficultyId]: {
        closedPassed: base.closedPassed + passed,
        closedTurns: base.closedTurns + turns,
        closedRuns: base.closedRuns + 1,
        bestPassed: Math.max(base.bestPassed, passed),
        bestTurns: Math.max(base.bestTurns, turns),
      },
    },
  };
}

/** 读取某难度的展示口径。activeRun 传入当前进行中的那一局，可为 null。 */
export function viewStats(stats, difficultyId, activeRun = null) {
  const b = stats?.byDifficulty?.[difficultyId] || blankBucket();
  const isActive = activeRun && activeRun.difficulty === difficultyId;
  const livePassed = isActive ? Number(activeRun.passedChallenges) || 0 : 0;
  const liveTurns = isActive ? Number(activeRun.outputTurns) || 0 : 0;
  return {
    bestPassed: Math.max(b.bestPassed, livePassed),
    totalPassed: b.closedPassed + livePassed,
    bestTurns: Math.max(b.bestTurns, liveTurns),
    totalTurns: b.closedTurns + liveTurns,
    runs: b.closedRuns,
  };
}

/** 全难度总览，供统计面板使用。 */
export function viewAll(stats, activeRun = null, difficulties = []) {
  return difficulties.map((d) => ({
    id: d.id,
    label: d.label,
    ...viewStats(stats, d.id, activeRun),
  }));
}

export function normalizeStats(raw) {
  if (!raw || raw.version !== STATS_VERSION) return emptyStats();
  const byDifficulty = {};
  for (const [k, v] of Object.entries(raw.byDifficulty || {})) {
    byDifficulty[k] = {
      closedPassed: Number(v?.closedPassed) || 0,
      closedTurns: Number(v?.closedTurns) || 0,
      closedRuns: Number(v?.closedRuns) || 0,
      bestPassed: Number(v?.bestPassed) || 0,
      bestTurns: Number(v?.bestTurns) || 0,
    };
  }
  return { version: STATS_VERSION, byDifficulty };
}
