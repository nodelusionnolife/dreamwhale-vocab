import { supportsSpeech, saveTextFile } from '../platform/runtime.js';
import { LEARNING_QUESTIONS, LEARNING_WORDS, QUESTION_TYPES, TOPICS } from '../content/learning-bank.js';
import { learningProgress, progressKey } from '../engine/learning.js';
import { learningStatistics } from '../engine/learning-statistics.js';
import { catalogOf, studyOverview, pendingRounds, dayStart } from '../engine/study.js';
import { ROUND_LABELS } from '../engine/study-state.js';
import { mistakeArchive } from '../engine/mistakes.js';
import { localMediaUrl } from '../platform/media.js';
import { CHARACTER_AVATAR_PATH } from '../content/emotions.js';
import { SCENE_PATHS } from '../content/scenes.js';
import { speechButton, appendSpeech } from './speech.js';
import { BANKS, FREQUENCIES, matchesBank } from '../engine/banks.js';
import { CET6_WORDS } from '../content/cet6-words.js';
import { CET4_WORDS } from '../content/cet4-syllabus.js';

const node = (tag, cls = '', text = '') => { const e = document.createElement(tag); e.className = cls; e.textContent = text; return e; };
const button = (label, action, cls = '') => { const e = node('button', cls, label); e.type = 'button'; e.addEventListener('click', action); return e; };
const labels = { learn: '今日学习', library: '词库', practice: '专项训练' };

export function createStudyViews({ host, getState, questionCard, start, resume, end, savePlan, favorite, exportRecords, importRecords, isBusy, canUseModel, openSettings, navigate, pause }) {
  const catalogs = Object.fromEntries(Object.keys(BANKS).map(bank => [bank, Object.fromEntries(Object.keys(FREQUENCIES).map(frequency => [frequency, catalogOf(LEARNING_QUESTIONS.filter(q => matchesBank(q, bank, frequency)))]))]));
  const catalogFor = state => catalogs[state.plan.bank][state.plan.frequency || 'all'];
  const sixWords = new Map(CET6_WORDS.map(entry => [entry.word, entry]));
  const fourWords = new Map(CET4_WORDS.map(entry => [entry.word, entry]));
  const definitions = new Map(LEARNING_WORDS.map((entry) => [entry.word, `${entry.pos} ${entry.meaning}`]));
  let page = 'learn';
  let studying = false;
  let planEditing = false;
  let libraryFilter = 'all';
  let librarySection = 'words';
  let mistakeFilter = 'pending';
  let mistakeQuery = '';
  let libraryTopic = 'all';
  let libraryPage = 1;
  const pageSize = 40;
  let query = '';
  let selected = null;
  let trainingTopic = 'all';
  let difficulty = 'all';
  let trainingCount = 10;
  let notice = null;

  async function exportStatistics() {
    try { await saveTextFile('dreamwhale-question-statistics.json', JSON.stringify({ kind: 'dreamwhale-question-statistics', version: 1, createdAt: new Date().toISOString(), ...learningStatistics(getState(), LEARNING_QUESTIONS) }, null, 2)); }
    catch (error) { notice = { text: error.message, error: true }; render(); }
  }

  function select(title, value, options, change) {
    const label = node('label', 'study-filter', title);
    const input = node('select'); input.setAttribute('aria-label', title);
    for (const [id, text] of Object.entries(options)) { const option = node('option', '', text); option.value = id; input.append(option); }
    input.value = value;
    input.addEventListener('change', () => change(input.value));
    label.append(input);
    return label;
  }

  function illustration(key, cls) {
    const image = node('img', cls);
    image.src = localMediaUrl(SCENE_PATHS[key]); image.alt = ''; image.decoding = 'async';
    return image;
  }

  function heading(title, subtitle, anchor) {
    const h = node('div', 'page-heading');
    h.append(node('h1', '', title), node('p', 'muted', subtitle));
    if (anchor) { h.classList.add('illustrated-heading'); h.append(illustration(anchor, 'heading-anchor')); }
    return h;
  }

  function action(label, run, state, cls = 'primary') {
    const b = button(label, run, cls);
    b.disabled = isBusy();
    return b;
  }

  function bankPicker(state) {
    const box = node('section', 'bank-picker');
    const tabs = node('div', 'filter-tabs'); tabs.setAttribute('role', 'group'); tabs.setAttribute('aria-label', '题库选择');
    tabs.append(node('strong', '', '题库'));
    for (const [id, name] of Object.entries(BANKS)) {
      const tab = button(name, () => {
        if (!savePlan({ bank: id })) return;
        selected = null; libraryPage = 1; planEditing = false; libraryTopic = trainingTopic = difficulty = 'all'; render();
      }, state.plan.bank === id ? 'active' : 'ghost');
      tab.setAttribute('aria-pressed', String(state.plan.bank === id)); tab.disabled = isBusy(); tabs.append(tab);
    }
    const frequencies = node('div', 'filter-tabs'); frequencies.setAttribute('role', 'group'); frequencies.setAttribute('aria-label', '词频范围');
    frequencies.append(node('strong', '', '范围'));
    for (const [id, name] of Object.entries(FREQUENCIES)) {
      const tab = button(name, () => {
        if (!savePlan({ frequency: id })) return;
        selected = null; libraryPage = 1; planEditing = false; libraryTopic = trainingTopic = difficulty = 'all'; render();
      }, (state.plan.frequency || 'all') === id ? 'active' : 'ghost');
      tab.setAttribute('aria-pressed', String((state.plan.frequency || 'all') === id)); tab.disabled = isBusy(); frequencies.append(tab);
    }
    box.append(tabs, frequencies); host.append(box);
  }

  function continuation(state) {
    const pending = pendingRounds(state);
    if (!pending.length) return;
    const list = node('details', 'pending-rounds'); list.open = true;
    list.append(node('summary', '', `未完成的练习 · ${pending.length} 组`), node('p', 'muted', '可以继续其中一组，也可以在下方开启其他练习。'));
    for (const { round, practice } of pending) {
      const box = node('section', 'resume-card');
      const text = node('div');
      text.append(node('strong', '', `${ROUND_LABELS[round.kind]}${round.type !== 'all' && QUESTION_TYPES[round.type] ? ' · ' + QUESTION_TYPES[round.type] : ''}`),
        node('p', 'muted', `${round.bank ? BANKS[round.bank] + ' · ' : ''}${FREQUENCIES[round.frequency || 'all']} · 已完成 ${round.index} / ${round.items.length} 词`),
        node('p', 'muted', `${TOPICS[round.topic] || '全部主题'} · ${new Date(round.startedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 开始`));
      const controls = node('div', 'actions');
      const continueButton = button('继续本组', () => resume(round.id), 'primary');
      const finish = button('结束本组', () => end(practice.id, round.id), 'ghost');
      continueButton.disabled = finish.disabled = isBusy();
      controls.append(continueButton, finish); box.append(text, controls); list.append(box);
    }
    host.append(list);
  }

  function home(state) {
    const overview = studyOverview(LEARNING_QUESTIONS, state, Date.now(), { audio: supportsSpeech(), semantic: canUseModel() });
    const welcome = heading('今日学习', new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }));
    welcome.classList.add('scene-hero');
    welcome.append(node('p', 'scene-greeting', '海风翻开书页，今天也一起记住一点。'));
    const avatar = node('img', 'today-avatar'); avatar.src = localMediaUrl(CHARACTER_AVATAR_PATH); avatar.alt = '梦鲸'; welcome.append(avatar); host.append(welcome);
    bankPicker(state);
    continuation(state);
    const grid = node('div', 'dashboard-grid');
    const plan = node('section', 'plan-card surface');
    const title = node('div', 'section-heading');
    const complete = !overview.newRemaining && !overview.reviewRemaining && overview.newDone + overview.reviewDone > 0;
    title.append(node('h2', '', complete ? '今日计划已完成' : '今日计划'), button(planEditing ? '收起计划' : '调整计划', () => { planEditing = !planEditing; render(); }, 'text-button'));
    plan.append(title, node('p', 'plan-topic', `${BANKS[state.plan.bank]} · ${FREQUENCIES[state.plan.frequency || 'all']} · ${TOPICS[overview.plan.topic] || '全部主题'}`));
    const stats = node('div', 'plan-metrics');
    for (const [name, done, goal] of [['新学', overview.newDone, overview.newTarget], ['复习', overview.reviewDone, overview.reviewTarget]]) {
      const metric = node('div');
      const value = node('p', 'plan-number'); value.append(node('strong', '', done), node('span', '', goal ? ` / ${goal}` : ' 暂无任务'));
      const progress = node('progress'); progress.max = Math.max(1, goal); progress.value = Math.min(done, goal); progress.setAttribute('aria-label', `${name}进度`);
      metric.append(node('span', 'muted', name), value, progress); stats.append(metric);
    }
    plan.append(stats);
    if (planEditing) {
      const editor = node('form', 'plan-editor');
      let draft = { ...overview.plan };
      editor.append(select('词汇范围', draft.topic, { all: '全部主题', ...TOPICS }, (value) => { draft.topic = value; }),
        select('每日新学', draft.newGoal, { 5: '5 词', 10: '10 词', 15: '15 词', 20: '20 词', 30: '30 词' }, (value) => { draft.newGoal = Number(value); }),
        select('每日复习', draft.reviewGoal, { 5: '5 词', 10: '10 词', 15: '15 词', 20: '20 词', 30: '30 词' }, (value) => { draft.reviewGoal = Number(value); }));
      const save = node('button', 'primary', '保存计划'); save.type = 'submit'; editor.append(save);
      editor.addEventListener('submit', (event) => { event.preventDefault(); if (savePlan(draft)) { planEditing = false; render(); } });
      plan.append(editor);
    }
    const controls = node('div', 'plan-start');
    const newCount = Math.min(overview.newRemaining || 5, overview.newAvailable, 10);
    const reviewCount = Math.min(overview.reviewRemaining || 5, overview.reviewAvailable, 10);
    const learn = action(newCount ? `${overview.newRemaining ? '开始新学' : '再学一组'} · ${newCount} 词` : '当前范围已学完', () => start('new', { count: newCount }), state);
    const review = action(reviewCount ? `复习与进阶 · ${reviewCount} 词` : '暂无复习与进阶', () => start('review', { count: reviewCount }), state, 'secondary');
    learn.disabled ||= !newCount; review.disabled ||= !reviewCount;
    controls.append(learn, review); plan.append(controls);
    plan.append(node('p', 'plan-footnote', `${overview.total} 个词与表达 · 已接触 ${overview.seen} 个 · ${overview.due} 个词到期 · ${overview.advance} 个词可进阶`), node('p', 'muted', '先复习到期内容，再练已学词的拼写和用法。进阶安排从次日开始。'));
    const rail = node('section', 'surface weekly-card'); rail.append(node('h2', '', '最近七天 · 全部题库'));
    const week = node('div', 'week-grid');
    for (let offset = 6; offset >= 0; offset--) {
      const day = new Date(); day.setDate(day.getDate() - offset); const from = dayStart(day.getTime()); day.setDate(day.getDate() + 1); const to = dayStart(day.getTime());
      const count = new Set(state.events.filter((event) => event.at >= from && event.at < to && ['correct', 'revealed'].includes(event.status)).map((event) => event.word)).size;
      const item = node('div', `week-day${count ? ' studied' : ''}${offset === 0 ? ' today' : ''}`);
      item.append(node('span', '', offset === 0 ? '今天' : new Date(from).toLocaleDateString('zh-CN', { weekday: 'narrow' })), node('strong', '', count || '·')); week.append(item);
    }
    rail.append(week, node('p', 'muted', '每天完成一点，让记忆慢慢长出来。'));
    const counts = node('div', 'quick-counts');
    const errorCount = mistakeArchive(state, LEARNING_QUESTIONS).filter((entry) => entry.archivedAt === null && matchesBank(entry.question || { targetWords: [entry.word] }, state.plan.bank, state.plan.frequency)).length;
    const favoriteCount = catalogFor(state).filter(entry => state.favorites.includes(entry.word)).length;
    counts.append(button(`错题集  ${errorCount} 题`, () => { librarySection = 'mistakes'; navigate('library'); }, 'text-button'), button(`薄弱巩固  ${overview.weak} 词`, () => { librarySection = 'words'; libraryFilter = 'weak'; navigate('library'); }, 'text-button'), button(`我的收藏  ${favoriteCount} 词`, () => { librarySection = 'words'; libraryFilter = 'favorites'; navigate('library'); }, 'text-button'));
    rail.append(counts); grid.append(plan, rail); host.append(grid);
    const entry = node('section', 'route-grid');
    for (const [titleText, body, anchor, run] of [['词库', '按主题浏览，查看释义和用法。', 'library', () => { librarySection = 'words'; navigate('library'); }], ['专项训练', '拼写、搭配、听辨，挑一项练习。', 'practice', () => navigate('practice')], ['错题集', '回看错过的题，把它们慢慢学会。', 'mistakes', () => { librarySection = 'mistakes'; navigate('library'); }]]) {
      const tile = button('', run, 'route-card'); tile.append(illustration(anchor, 'route-anchor'), node('strong', '', titleText), node('span', '', body), node('b', '', '→')); entry.append(tile);
    }
    host.append(entry);
    const statistics = learningStatistics(state, LEARNING_QUESTIONS);
    if (statistics.types.length) {
      const panel = node('details', 'surface bank-source');
      panel.append(node('summary', '', '各题型学习情况 · 全部题库'), node('p', 'muted', '每次遇到一道题计一次练习，答对率只看首次作答；提示和讲解按本次是否使用计数。'));
      for (const row of statistics.types) panel.append(node('p', '', `${QUESTION_TYPES[row.type] || row.type}：练习 ${row.attempts} 次，首次独立答对 ${Math.round(row.correct / row.attempts * 100)}%，用过提示 ${row.hinted} 次，看讲解 ${row.revealed} 次，反复出错 ${row.repeatedErrors} 题。`));
      panel.append(button('导出题目统计', exportStatistics, 'ghost')); host.append(panel);
    }
  }

  function definition(entry) {
    const advanced = sixWords.get(entry.word);
    const basic = fourWords.get(entry.word);
    const basicMeaning = definitions.get(entry.word) || (basic && `${basic.pos} ${basic.meaning}`);
    if (advanced && entry.questions.some(q => q.bank === 'cet6')) {
      const meaning = `${advanced.pos} ${advanced.meaning}`;
      return entry.questions.some(q => matchesBank(q, 'cet4')) && basicMeaning ? `${basicMeaning} / ${meaning}` : meaning;
    }
    return basicMeaning || entry.questions.find((q) => q.hint && /^(n\.|v\.|adj\.|adv\.)/.test(q.hint))?.hint || entry.questions[0].explanation.split('\n')[0];
  }

  function wordStatus(entry, state, progress) {
    const items = entry.questions.map((q) => progress[progressKey(q)]).filter(Boolean);
    if (items.some((p) => p.dueAt <= Date.now())) return '待复习';
    if (items.some((p) => p.streak === 0)) return '待巩固';
    return items.length ? '学习中' : '未学习';
  }

  function library(state) {
    const catalog = catalogFor(state);
    const questionCount = catalog.reduce((n, entry) => n + entry.questions.length, 0);
    host.append(heading(librarySection === 'mistakes' ? '错题集' : '词库', librarySection === 'mistakes' ? '错过的题，陪你一道一道学会。' : `${BANKS[state.plan.bank]} · ${FREQUENCIES[state.plan.frequency || 'all']} · ${catalog.length} 个词与表达 · ${questionCount} 道题`, librarySection === 'mistakes' ? 'mistakes' : 'library'));
    bankPicker(state);
    const sections = node('div', 'filter-tabs library-sections'); sections.setAttribute('aria-label', '词库内容');
    for (const [key, text] of [['words', '全部词汇'], ['mistakes', '错题集']]) {
      const tab = button(text, () => { librarySection = key; selected = null; render(); }, librarySection === key ? 'active' : 'ghost');
      tab.id = `library-${key}`; tab.setAttribute('aria-pressed', String(librarySection === key)); sections.append(tab);
    }
    host.append(sections);
    continuation(state);
    if (librarySection === 'mistakes') { mistakes(state); recordTools(); return; }
    const progress = learningProgress(state);
    if (selected) {
      const entry = catalog.find((item) => item.word === selected);
      if (!entry) { selected = null; return library(state); }
      const detail = node('article', 'word-detail surface');
      detail.append(button('← 返回词库', () => { selected = null; render(); }, 'text-button'), node('p', 'eyebrow', entry.topics.map((topic) => TOPICS[topic]).join(' · ')), node('h2', '', entry.word), node('p', 'word-definition', definition(entry)));
      detail.append(speechButton(entry.questions.find(q => q.audioText)?.audioText || entry.word, '朗读单词'));
      const examples = [...new Map(entry.questions.filter((q) => ['choice', 'fill', 'collocation', 'phrase', 'confusion', 'formation', 'reading'].includes(q.type)).map((q) => [q.variantGroup, q])).values()].slice(0, 2);
      for (const q of examples) {
        const example = node('div', 'word-example');
        const sentence = q.stem.replace(/_{2,}/g, q.answer);
        const explanation = q.explanation.startsWith(`${sentence}\n`) ? q.explanation.slice(sentence.length + 1) : q.explanation;
        example.append(node('p', '', sentence)); appendSpeech(example, sentence, '朗读例句'); example.append(node('p', 'muted', explanation)); detail.append(example);
      }
      const controls = node('div', 'actions');
      controls.append(action('练习这个词', () => start('drill', { word: entry.word, topic: 'all', count: 1 }), state), favorite(entry.word, state));
      detail.append(controls); host.append(detail); return;
    }
    const filters = node('div', 'library-controls');
    const search = node('input', 'word-search'); search.placeholder = '查找单词、短语或释义'; search.setAttribute('aria-label', '查找词汇'); search.value = query;
    filters.append(search, select('主题', libraryTopic, { all: '全部主题', ...TOPICS }, (value) => { libraryTopic = value; libraryPage = 1; render(); }));
    host.append(filters);
    const tabs = node('div', 'filter-tabs'); tabs.setAttribute('aria-label', '词库分类');
    for (const [value, text] of Object.entries({ all: '全部', new: '未学', learning: '已学', due: '待复习', weak: '待巩固', favorites: '收藏' })) {
      const tab = button(text, () => { libraryFilter = value; libraryPage = 1; render(); }, libraryFilter === value ? 'active' : 'ghost'); tab.setAttribute('aria-pressed', String(libraryFilter === value)); tabs.append(tab);
    }
    host.append(tabs);
    const list = node('div', 'library-list'); host.append(list);
    function draw() {
      list.replaceChildren();
      const matches = catalog.filter((entry) => {
        const status = wordStatus(entry, state, progress);
        return (libraryTopic === 'all' || entry.topics.includes(libraryTopic)) && `${entry.word} ${definition(entry)}`.toLowerCase().includes(query.toLowerCase().trim())
          && (libraryFilter === 'all' || libraryFilter === 'new' && status === '未学习' || libraryFilter === 'learning' && status !== '未学习'
            || libraryFilter === 'due' && status === '待复习' || libraryFilter === 'weak' && entry.questions.some((q) => progress[progressKey(q)]?.streak === 0)
            || libraryFilter === 'favorites' && state.favorites.includes(entry.word));
      });
      const pages = Math.max(1, Math.ceil(matches.length / pageSize));
      libraryPage = Math.min(libraryPage, pages);
      const offset = (libraryPage - 1) * pageSize;
      const count = node('p', 'result-count', matches.length ? `共 ${matches.length} 个词与表达 · 显示 ${offset + 1}–${Math.min(offset + pageSize, matches.length)}` : '0 个词与表达');
      count.setAttribute('role', 'status'); list.append(count);
      function pagination(position) {
        const nav = node('nav', 'library-pagination'); nav.setAttribute('aria-label', `词库${position}翻页`);
        const changePage = (value) => { libraryPage = value; draw(); list.querySelector('.library-pagination').focus(); list.scrollIntoView({ block: 'start' }); };
        nav.tabIndex = -1;
        const previous = button('上一页', () => changePage(libraryPage - 1), 'secondary'); previous.disabled = libraryPage === 1;
        const next = button('下一页', () => changePage(libraryPage + 1), 'secondary'); next.disabled = libraryPage === pages;
        const jump = select(`页码 / ${pages}`, String(libraryPage), Object.fromEntries(Array.from({ length: pages }, (_, i) => [i + 1, String(i + 1)])), value => changePage(Number(value)));
        jump.querySelector('select').setAttribute('aria-label', '页码');
        nav.append(previous, jump, next); return nav;
      }
      if (matches.length) list.append(pagination('顶部'));
      if (!matches.length) list.append(node('p', 'empty-state', '这里暂时没有词，试试其他分类或主题。'));
      for (const entry of matches.slice(offset, offset + pageSize)) {
        const row = node('article', 'library-row');
        const link = button('', () => { selected = entry.word; render(); }, 'word-open');
        link.append(node('strong', '', entry.word), node('span', 'muted', definition(entry)));
        const status = node('span', 'word-status', wordStatus(entry, state, progress));
        const actions = node('div', 'word-row-actions'); actions.append(speechButton(entry.questions.find(q => q.audioText)?.audioText || entry.word, '朗读', `朗读 ${entry.word}`), favorite(entry.word, state));
        row.append(link, status, actions); list.append(row);
      }
      if (matches.length) list.append(pagination('底部'));
    }
    search.addEventListener('input', () => { query = search.value; libraryPage = 1; draw(); }); draw();
    if (['favorites', 'weak', 'due'].includes(libraryFilter)) {
      const kind = { favorites: 'favorites', weak: 'mistakes', due: 'review' }[libraryFilter];
      host.append(action(`开始${ROUND_LABELS[kind]}`, () => start(kind, { count: 10, topic: libraryTopic }), state));
    }
    recordTools();
  }

  function recordTools() {
    const tools = node('div', 'learning-tools');
    tools.append(button('导出学习记录', exportRecords, 'ghost'), button('导入学习记录', importRecords, 'ghost'), node('span', 'muted', '学习记录保存在当前浏览器。')); host.append(tools);
  }

  function mistakes(state) {
    const archive = mistakeArchive(state, LEARNING_QUESTIONS).filter(entry => matchesBank(entry.question || { targetWords: [entry.word] }, state.plan.bank, state.plan.frequency));
    const pending = archive.filter((entry) => entry.archivedAt === null);
    const rules = node('div', 'mistake-rules'); rules.id = 'mistake-rules';
    rules.append(node('strong', '', '答错自动收录，学会自动归档'), node('p', '', '连续两次独立答对，且两次间隔至少一天，移入「已巩固」。提示或看讲解后重新累计；再次答错会回到「待巩固」。'));
    host.append(rules);
    const tabs = node('div', 'filter-tabs'); tabs.setAttribute('aria-label', '错题分类');
    for (const [key, title, count] of [['pending', '待巩固', pending.length], ['archived', '已巩固', archive.length - pending.length], ['all', '全部错题', archive.length]]) {
      const tab = button(`${title} ${count}`, () => { mistakeFilter = key; render(); }, mistakeFilter === key ? 'active' : 'ghost'); tab.setAttribute('aria-pressed', String(key === mistakeFilter)); tabs.append(tab);
    }
    host.append(tabs);
    const controls = node('div', 'mistake-controls');
    const search = node('input', 'word-search'); search.placeholder = '查找单词、题目或当时的答案'; search.setAttribute('aria-label', '查找错题'); search.value = mistakeQuery;
    const retry = action('重练待巩固错题', () => start('errors', { count: 10, topic: 'all' }), state); retry.disabled ||= !pending.some((entry) => entry.question && (entry.question.grading !== 'semantic' || canUseModel()) && (entry.question.type !== 'listening' || supportsSpeech()));
    controls.append(search, retry); host.append(controls);
    const list = node('div', 'mistake-list'); host.append(list);
    function draw() {
      list.replaceChildren();
      const matches = archive.filter((entry) => (mistakeFilter === 'all' || (mistakeFilter === 'archived') === (entry.archivedAt !== null))
        && `${entry.word} ${entry.question?.stem || ''} ${entry.lastWrongAnswer}`.toLowerCase().includes(mistakeQuery.toLowerCase().trim()));
      if (!matches.length) { list.append(node('p', 'empty-state', !archive.length ? '还没有错题。答错时会自动收进这里，不用手动整理。' : mistakeFilter === 'archived' ? '暂时没有符合条件的已巩固题目，继续按间隔独立练习吧。' : '这里暂时没有符合条件的错题。')); return; }
      for (const entry of matches) {
        const card = node('article', 'mistake-card surface');
        const meta = node('div', 'mistake-meta'); meta.append(node('strong', '', entry.word), node('span', 'pill', entry.archivedAt === null ? `巩固 ${entry.successes} / 2` : '已巩固'));
        meta.append(speechButton(entry.question?.audioText || entry.word, '朗读单词'));
        card.append(meta, node('h2', '', entry.question?.stem || '原题暂不可用'), node('p', 'muted', `${QUESTION_TYPES[entry.question?.type] || '词汇练习'} · 答错 ${entry.wrongCount} 次 · 最近 ${new Date(entry.lastWrongAt).toLocaleDateString('zh-CN')}`));
        if (entry.question) appendSpeech(card, entry.question.stem, '朗读题干');
        const details = node('details', 'mistake-detail'); details.append(node('summary', '', '查看当时答案与讲解'));
        details.append(node('p', 'mistake-answer', `当时答案：${entry.lastWrongAnswer || '未记录'}`));
        if (entry.question) details.append(node('p', 'reference-answer', `参考答案：${entry.question.answer}`), node('p', '', entry.question.explanation));
        else details.append(node('p', '', '这条历史记录没有保存原题，当前题库中也没有同版本题目。作答记录仍然保留。'));
        if (entry.question) appendSpeech(details, `${entry.question.answer}\n${entry.question.explanation}`, '朗读答案与例句');
        card.append(details);
        if (entry.archivedAt === null && entry.question) {
          const requiresModel = entry.question.grading === 'semantic' && !canUseModel();
          const run = action(requiresModel ? '配置模型后重练' : '重练这道题', () => requiresModel ? openSettings() : start('errors', { questionKey: entry.key, topic: 'all', count: 1 }), state, 'secondary');
          run.disabled ||= entry.question.type === 'listening' && !(supportsSpeech()); card.append(run);
        } else if (entry.archivedAt !== null) card.append(node('p', 'muted', `${new Date(entry.archivedAt).toLocaleDateString('zh-CN')} 已巩固，记录继续保留。`));
        list.append(card);
      }
    }
    search.addEventListener('input', () => { mistakeQuery = search.value; draw(); }); draw();
  }

  function training(state) {
    host.append(heading('专项训练', '选择每组题数，每词一道；词量不足时按实际数量出题。', 'practice'));
    bankPicker(state);
    continuation(state);
    const filters = node('div', 'training-filters');
    filters.append(select('训练主题', trainingTopic, { all: '全部主题', ...TOPICS }, (value) => { trainingTopic = value; render(); }), select('训练难度', difficulty, { all: '基础与进阶', basic: '基础', advanced: '进阶' }, (value) => { difficulty = value; render(); }), select('每组题数', trainingCount, { 10: '10 题', 20: '20 题', 30: '30 题' }, (value) => { trainingCount = Number(value); render(); })); host.append(filters);
    const grid = node('div', 'training-grid');
    const descriptions = { choice: '放进句子，辨认词义。', fill: '借助语境，主动想起单词。', meaning: '辨认单词与释义的对应关系。', listening: '听读音，写出单词。', collocation: '把常用搭配记在一起。', formation: '看清词性，选对形式。', confusion: '辨清长得像、意思近的词。', phrase: '练习常见短语与介词。', correction: '发现错误，改成自然表达。', reading: '在短文中判断具体含义。', writing: '把单词用进自己的句子。' };
    for (const [type, title] of Object.entries(QUESTION_TYPES)) {
      const pool = LEARNING_QUESTIONS.filter((q) => matchesBank(q, state.plan.bank, state.plan.frequency) && q.type === type && (trainingTopic === 'all' || q.topic === trainingTopic) && (difficulty === 'all' || q.difficulty === difficulty));
      const count = new Set(pool.map((q) => q.targetWords[0])).size;
      const card = node('article', 'training-card surface');
      const category = ['choice', 'meaning', 'confusion', 'reading'].includes(type) ? '理解词义' : ['fill', 'listening'].includes(type) ? '主动回忆' : '学会运用';
      card.append(node('span', 'training-type', category), node('h2', '', title), node('p', 'muted', descriptions[type]), node('p', 'training-count', `${count} 个词 · ${pool.length} 道题`));
      const requiresModel = type === 'writing' && !canUseModel();
      const run = action(requiresModel ? '对照范例练习' : '开始训练 →', () => start('drill', { type, topic: trainingTopic, difficulty, count: trainingCount, ...(type === 'writing' ? { semantic: true } : {}) }), state, 'secondary');
      run.disabled ||= !count || type === 'listening' && !(supportsSpeech());
      card.append(run); grid.append(card);
    }
    host.append(grid);
  }

  function session(state) {
    const round = state.round;
    if (!round) { studying = false; return home(state); }
    const top = node('div', 'round-heading');
    const back = button(round.finishedAt !== null ? `返回${labels[page]}` : '暂存并返回', () => { if (!pause()) return; studying = false; render(); }, 'text-button'); back.disabled = isBusy();
    top.append(back, node('span', '', `${round.bank ? BANKS[round.bank] + ' · ' : ''}${FREQUENCIES[round.frequency || 'all']} · ${ROUND_LABELS[round.kind]}`)); host.append(top);
    if (round.finishedAt !== null) {
      const card = node('section', 'round-summary surface');
      const independent = round.results.filter((result) => result.independent).length;
      const assisted = round.results.filter((result) => result.status === 'correct' && !result.independent).length;
      const revealed = round.results.filter((result) => result.status === 'revealed').length;
      card.append(node('p', 'eyebrow', '一点一滴，都算数'), node('h1', '', round.endedEarly ? '这一组先到这里' : '一组练习完成了'), node('p', 'muted', `已走完 ${round.results.length} / ${round.items.length} 词`));
      const metrics = node('div', 'summary-metrics');
      for (const [count, label] of [[independent, '独立答对'], [assisted, '提示或重试后答对'], [revealed, '看过讲解'], [round.results.filter((r) => r.status === 'skipped').length, '跳过']]) { const item = node('div'); item.append(node('strong', '', count), node('span', '', label)); metrics.append(item); }
      card.append(metrics);
      const results = node('ul', 'round-results');
      for (const result of round.results) { const row = node('li'); row.append(node('strong', '', result.word), node('span', '', result.independent ? '独立答对' : result.status === 'correct' ? '还需巩固' : result.status === 'revealed' ? '已看讲解' : '已跳过')); results.append(row); }
      card.append(results);
      const controls = node('div', 'actions');
      controls.append(button('休息一下', () => { studying = false; render(); }, 'primary'), button('查看错题集', () => { librarySection = 'mistakes'; navigate('library'); }, 'secondary')); card.append(controls); host.append(card); return;
    }
    const track = node('div', 'round-progress');
    const bar = node('progress'); bar.max = round.items.length; bar.value = round.index; bar.setAttribute('aria-label', '本组进度');
    track.append(node('span', '', `第 ${round.index + 1} / ${round.items.length} 词`), bar); host.append(track);
    const focused = node('div', 'focus-exercise'); focused.append(questionCard(state, 'practice')); host.append(focused);
  }

  function render(state = getState(), message = notice) {
    notice = message;
    host.replaceChildren();
    host.dataset.page = studying ? 'session' : page;
    if (notice?.text) { const error = node('p', notice.error ? 'study-error' : 'study-note', notice.text); error.setAttribute('role', notice.error ? 'alert' : 'status'); host.append(error); }
    if (studying) session(state);
    else if (page === 'library') library(state);
    else if (page === 'practice') training(state);
    else home(state);
    for (const tab of host.classList.contains('hidden') ? [] : document.querySelectorAll('[data-study-page]')) {
      const active = tab.dataset.studyPage === page;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-current', active ? 'page' : 'false');
    }
  }

  function setPage(value) { page = labels[value] ? value : 'learn'; studying = false; selected = null; render(); }
  return { render, setPage, showRound: () => { studying = true; }, showMistakes: () => { librarySection = 'mistakes'; selected = null; studying = false; render(); }, page: () => page };
}
