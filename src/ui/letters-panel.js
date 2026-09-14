// 场景与字母面板的渲染。只负责画和回报点击，不含业务逻辑。

const PLACEHOLDER_NARRATIVE = '你的应对会接着挑战场景写在这里。';

export function selectedWord(run) {
  const cur = run?.current;
  if (!cur) return '';
  const byId = new Map(cur.pool.tiles.map((t) => [t.id, t.ch]));
  return cur.selection.map((id) => byId.get(id) || '').join('');
}

export function renderLetters({ tileHost, wordline, run, busy, onToggle }) {
  const cur = run?.current;
  const tiles = cur?.pool?.tiles || [];
  const selected = new Set(cur?.selection || []);

  tileHost.replaceChildren(
    ...tiles.map((t) => {
      const el = document.createElement('button');
      el.className = `tile${selected.has(t.id) ? ' sel' : ''}`;
      el.textContent = t.ch;
      el.dataset.tileId = t.id;
      el.disabled = Boolean(busy);
      el.addEventListener('click', () => onToggle(t.id));
      return el;
    }),
  );

  if (run?.over) {
    wordline.textContent = '本局已结束';
    wordline.classList.add('empty');
    return;
  }
  if (!cur) {
    wordline.textContent = '点「确定」开始下一场景';
    wordline.classList.add('empty');
    return;
  }
  const word = selectedWord(run);
  wordline.textContent = word || '点击下方字母拼出一个单词';
  wordline.classList.toggle('empty', !word);
}

export function renderHud({ els, run, failuresLeft, wildcardsLeft, difficultyLabel }) {
  els.scene.textContent = run?.sceneIndex ?? 1;
  els.turns.textContent = run?.outputTurns ?? 0;
  els.passed.textContent = run?.passedChallenges ?? 0;

  const limit = failureLimitText(run, failuresLeft);
  els.fail.textContent = limit;
  els.fail.className = Number.isFinite(failuresLeft) && failuresLeft <= 1 ? 'bad' : (Number.isFinite(failuresLeft) && failuresLeft <= 3 ? 'warn' : '');

  els.wildcard.textContent = wildcardsLeft === Infinity ? '∞' : String(wildcardsLeft);
  els.difficulty.textContent = difficultyLabel || '';
  els.tier.textContent = run?.tier ?? '基础';
}

function failureLimitText(run, failuresLeft) {
  const used = run?.failures ?? 0;
  if (failuresLeft === Infinity) return `${used} / ∞`;
  return `${used} / ${used + failuresLeft}`;
}

/** 挑战场景。scene 传 current 或 lastScene——已完成的那一场仍会显示，不被叙事覆盖。 */
export function renderScene({ textEl, objectiveWrap, objectiveText, tags, scene, loading, stale }) {
  tags.mode.textContent = scene?.mode || '应对';
  tags.shell.textContent = scene?.shell || '日常';
  if (scene?.meme) {
    tags.meme.textContent = `热梗 · ${scene.meme}`;
    tags.meme.classList.remove('hidden');
  } else {
    tags.meme.classList.add('hidden');
  }
  textEl.textContent = scene?.scene || (loading ? '正在抽词与出题…' : '');
  textEl.classList.toggle('stale', Boolean(stale));
  if (scene?.objective) {
    objectiveText.textContent = scene.objective;
    objectiveWrap.classList.remove('hidden');
  } else {
    objectiveWrap.classList.add('hidden');
  }
  if (!scene) {
    textEl.textContent = loading ? '正在抽词与出题…' : '点「确定」开始下一场景';
    textEl.classList.add('placeholder');
  } else {
    textEl.classList.remove('placeholder');
  }
}

/** 应对叙事。与挑战场景并排展示，不覆盖它。 */
export function renderVerdict({ paneEl, titleEl, narrativeEl, feedbackEl, detailEl, verdict }) {
  if (!verdict) {
    paneEl.classList.remove('ok', 'bad');
    titleEl.classList.add('hidden');
    titleEl.textContent = '';
    narrativeEl.textContent = PLACEHOLDER_NARRATIVE;
    narrativeEl.classList.add('placeholder');
    feedbackEl.classList.add('hidden');
    feedbackEl.textContent = '';
    detailEl.textContent = '';
    return;
  }
  paneEl.classList.toggle('ok', verdict.passed);
  paneEl.classList.toggle('bad', !verdict.passed);
  titleEl.classList.remove('hidden');
  titleEl.textContent = verdict.passed
    ? `应对生效 · ${verdict.word}`
    : `未能应对 · ${verdict.word}`;
  narrativeEl.classList.toggle('placeholder', !verdict.narrative);
  narrativeEl.textContent = verdict.narrative || PLACEHOLDER_NARRATIVE;
  feedbackEl.classList.remove('hidden');
  feedbackEl.textContent = verdict.feedback || '';
  const bits = [];
  if (verdict.reason) bits.push(verdict.reason);
  if (verdict.wordMeaning) bits.push(`释义与用法：${verdict.wordMeaning}`);
  if (!verdict.isRealWord) bits.push('判定为不存在的词');
  else if (!verdict.inScope) bits.push('判定为超出词表范围');
  detailEl.textContent = bits.join('　·　');
}

let toastTimer = null;
export function toast(message, { error = false, ms = 4200 } = {}) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
  el.classList.toggle('err', error);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
}
