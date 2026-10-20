import { supportsSpeech } from '../platform/runtime.js';
import { LEARNING_QUESTIONS, LEARNING_WORDS, QUESTION_TYPES, TOPICS } from '../content/learning-bank.js';
import { learningProgress, progressKey } from '../engine/learning.js';
import { catalogOf, studyOverview, roundPending, dayStart } from '../engine/study.js';
import { ROUND_LABELS } from '../engine/study-state.js';
import { mistakeArchive } from '../engine/mistakes.js';
import { localMediaUrl } from '../platform/media.js';
import { CHARACTER_AVATAR_PATH } from '../content/emotions.js';
import { SCENE_PATHS } from '../content/scenes.js';
import { speechButton, appendSpeech } from './speech.js';
import { BANKS, FREQUENCIES, matchesBank, frequencySources } from '../engine/banks.js';
import { CET6_WORDS, CET6_SOURCE, CET6_DICTIONARY_LICENSE } from '../content/cet6-words.js';
import { CET4_WORDS, CET4_SOURCE } from '../content/cet4-syllabus.js';
import { FREQUENCY_SOURCES } from '../content/frequency.js';

const node = (tag, cls = '', text = '') => { const e = document.createElement(tag); e.className = cls; e.textContent = text; return e; };
const button = (label, action, cls = '') => { const e = node('button', cls, label); e.type = 'button'; e.addEventListener('click', action); return e; };
const labels = { learn: '今日学习', library: '词库', practice: '专项训练' };

export function createStudyViews({ host, getState, questionCard, start, end, savePlan, favorite, exportRecords, importRecords, isBusy, canUseModel, openSettings, navigate, pause }) {
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
  let query = '';
  let selected = null;
  let trainingTopic = 'all';
  let difficulty = 'all';
  let notice = null;

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
    b.disabled = isBusy() || roundPending(state);
    return b;
  }

  function sourceLink(text, url) {
    const link = node('a', '', text); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; return link;
  }

  function bankPicker(state) {
    const box = node('section', 'bank-picker');
    const tabs = node('div', 'filter-tabs'); tabs.setAttribute('role', 'group'); tabs.setAttribute('aria-label', '题库选择');
    tabs.append(node('strong', '', '题库'));
    for (const [id, name] of Object.entries(BANKS)) {
      const tab = button(name, () => {
        if (!savePlan({ bank: id })) return;
        selected = null; planEditing = false; libraryTopic = trainingTopic = difficulty = 'all'; render();
      }, state.plan.bank === id ? 'active' : 'ghost');
      tab.setAttribute('aria-pressed', String(state.plan.bank === id)); tab.disabled = isBusy(); tabs.append(tab);
    }
    const frequencies = node('div', 'filter-tabs'); frequencies.setAttribute('role', 'group'); frequencies.setAttribute('aria-label', '词频范围');
    frequencies.append(node('strong', '', '范围'));
    for (const [id, name] of Object.entries(FREQUENCIES)) {
      const tab = button(name, () => {
        if (!savePlan({ frequency: id })) return;
        selected = null; planEditing = false; libraryTopic = trainingTopic = difficulty = 'all'; render();
      }, (state.plan.frequency || 'all') === id ? 'active' : 'ghost');
      tab.setAttribute('aria-pressed', String((state.plan.frequency || 'all') === id)); tab.disabled = isBusy(); frequencies.append(tab);
    }
    const info = node('details', 'bank-source');
    info.append(node('summary', '', '词表来源与收录范围'),
      node('p', '', '四级：大纲未标★主词及原有扩展练习；六级：大纲★标记词；混合：合并两类。选择用于学习、词库、专项和聊天出题。'),
      node('p', '', `大纲词条：四级 ${CET4_WORDS.length.toLocaleString()} 个拼法，六级 ${CET6_WORDS.length.toLocaleString()} 个主词。四级并列拼法分列，同形词合并；派生词栏未另行展开。练习为自编题。`),
      node('p', '', '高频：同级别两个渠道共同收录的词。资料为历史备考词表，不是官方考频排名。六级中的基础词可在四级或混合题库练习。'),
      sourceLink(CET6_SOURCE.title, CET6_SOURCE.indexUrl),
      node('p', '', '中文释义整理自 ECDICT，并校订部分词义与词性。'));
    const references = node('ul');
    for (const source of FREQUENCY_SOURCES) {
      const item = node('li'); item.append(sourceLink(source.title, source.url)); references.append(item);
    }
    info.append(references, sourceLink('ECDICT · MIT License', CET6_SOURCE.dictionary));
    const license = node('details'); license.append(node('summary', '', '查看词典许可'), node('pre', '', CET6_DICTIONARY_LICENSE)); info.append(license);
    box.append(tabs, frequencies, info); host.append(box);
  }

  function continuation(state) {
    if (!roundPending(state)) return;
    const box = node('section', 'resume-card');
    const text = node('div');
    text.append(node('strong', '', '有一组练习等你继续'), node('p', 'muted', `${state.round.bank ? BANKS[state.round.bank] + ' · ' : ''}${FREQUENCIES[state.round.frequency || 'all']} · ${ROUND_LABELS[state.round.kind]} · 已完成 ${state.round.index} / ${state.round.items.length} 词`));
    const controls = node('div', 'actions');
    const resume = button('继续本组', () => { studying = true; render(); }, 'primary');
    const finish = button('结束本组', () => { studying = true; end(state.active.practice.id); }, 'ghost');
    resume.disabled = finish.disabled = isBusy();
    controls.append(resume, finish); box.append(text, controls); host.append(box);
  }

  function home(state) {
    const overview = studyOverview(LEARNING_QUESTIONS, state);
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
    const reviewCount = Math.min(overview.reviewRemaining || 5, overview.due, 10);
    const learn = action(newCount ? `${overview.newRemaining ? '开始新学' : '再学一组'} · ${newCount} 词` : '当前范围已学完', () => start('new', { count: newCount }), state);
    const review = action(reviewCount ? `到期复习 · ${reviewCount} 词` : '暂无到期复习', () => start('review', { count: reviewCount }), state, 'secondary');
    learn.disabled ||= !newCount; review.disabled ||= !reviewCount;
    controls.append(learn, review); plan.append(controls);
    plan.append(node('p', 'plan-footnote', `${overview.total} 个词与表达 · 已接触 ${overview.seen} 个 · 当前 ${overview.due} 个词到期`));
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
      const sourceWord = sixWords.get(entry.word);
      if (sourceWord && entry.questions.some(q => q.bank === 'cet6')) detail.append(sourceLink(`六级大纲词 · 第 ${sourceWord.pdfPages.map(p => p - 5).join('、')} 页`, `${CET6_SOURCE.url}#page=${sourceWord.pdfPages[0]}`));
      const basicWord = fourWords.get(entry.word);
      if (basicWord && entry.questions.some(q => q.bank === 'cet4')) detail.append(sourceLink(`四级大纲词 · 第 ${basicWord.pdfPages.map(p => p - 5).join('、')} 页`, `${CET4_SOURCE.url}#page=${basicWord.pdfPages[0]}`));
      const evidence = [...new Set(entry.questions.flatMap(frequencySources))];
      if (evidence.length) {
        const links = node('div', 'word-frequency');
        links.append(node('p', 'muted', entry.questions.some(q => frequencySources(q).length >= 2) ? '高频 · 多渠道共同收录' : '收录词表'));
        for (const id of evidence) {
          const source = FREQUENCY_SOURCES.find(s => s.id === id);
          const line = node('p'); line.append(sourceLink(source.title, source.url)); links.append(line);
        }
        detail.append(links);
      }
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
    filters.append(search, select('主题', libraryTopic, { all: '全部主题', ...TOPICS }, (value) => { libraryTopic = value; render(); }));
    host.append(filters);
    const tabs = node('div', 'filter-tabs'); tabs.setAttribute('aria-label', '词库分类');
    for (const [value, text] of Object.entries({ all: '全部', new: '未学', learning: '已学', due: '待复习', weak: '待巩固', favorites: '收藏' })) {
      const tab = button(text, () => { libraryFilter = value; render(); }, libraryFilter === value ? 'active' : 'ghost'); tab.setAttribute('aria-pressed', String(libraryFilter === value)); tabs.append(tab);
    }
    host.append(tabs);
    const list = node('div', 'library-list'); host.append(list);
    let visibleCount = 80;
    function draw() {
      list.replaceChildren();
      const matches = catalog.filter((entry) => {
        const status = wordStatus(entry, state, progress);
        return (libraryTopic === 'all' || entry.topics.includes(libraryTopic)) && `${entry.word} ${definition(entry)}`.toLowerCase().includes(query.toLowerCase().trim())
          && (libraryFilter === 'all' || libraryFilter === 'new' && status === '未学习' || libraryFilter === 'learning' && status !== '未学习'
            || libraryFilter === 'due' && status === '待复习' || libraryFilter === 'weak' && entry.questions.some((q) => progress[progressKey(q)]?.streak === 0)
            || libraryFilter === 'favorites' && state.favorites.includes(entry.word));
      });
      list.append(node('p', 'result-count', `${matches.length} 个词与表达`));
      if (!matches.length) list.append(node('p', 'empty-state', '这里暂时没有词，试试其他分类或主题。'));
      for (const entry of matches.slice(0, visibleCount)) {
        const row = node('article', 'library-row');
        const link = button('', () => { selected = entry.word; render(); }, 'word-open');
        link.append(node('strong', '', entry.word), node('span', 'muted', definition(entry)));
        const status = node('span', 'word-status', wordStatus(entry, state, progress));
        const actions = node('div', 'word-row-actions'); actions.append(speechButton(entry.questions.find(q => q.audioText)?.audioText || entry.word, '朗读', `朗读 ${entry.word}`), favorite(entry.word, state));
        row.append(link, status, actions); list.append(row);
      }
      if (matches.length > visibleCount) list.append(button(`加载更多 · 还有 ${matches.length - visibleCount} 词`, () => { visibleCount += 80; draw(); }, 'secondary'));
    }
    search.addEventListener('input', () => { query = search.value; visibleCount = 80; draw(); }); draw();
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
    host.append(heading('专项训练', '每组最多 10 个词，练完看结果。', 'practice'));
    bankPicker(state);
    continuation(state);
    const filters = node('div', 'training-filters');
    filters.append(select('训练主题', trainingTopic, { all: '全部主题', ...TOPICS }, (value) => { trainingTopic = value; render(); }), select('训练难度', difficulty, { all: '基础与进阶', basic: '基础', advanced: '进阶' }, (value) => { difficulty = value; render(); })); host.append(filters);
    const grid = node('div', 'training-grid');
    const descriptions = { choice: '放进句子，辨认词义。', fill: '借助语境，主动想起单词。', meaning: '辨认单词与释义的对应关系。', listening: '听读音，写出单词。', collocation: '把常用搭配记在一起。', formation: '看清词性，选对形式。', confusion: '辨清长得像、意思近的词。', phrase: '练习常见短语与介词。', correction: '发现错误，改成自然表达。', reading: '在短文中判断具体含义。', writing: '把单词用进自己的句子。' };
    for (const [type, title] of Object.entries(QUESTION_TYPES)) {
      const pool = LEARNING_QUESTIONS.filter((q) => matchesBank(q, state.plan.bank, state.plan.frequency) && q.type === type && (trainingTopic === 'all' || q.topic === trainingTopic) && (difficulty === 'all' || q.difficulty === difficulty));
      const count = new Set(pool.map((q) => q.targetWords[0])).size;
      const card = node('article', 'training-card surface');
      const category = ['choice', 'meaning', 'confusion', 'reading'].includes(type) ? '理解词义' : ['fill', 'listening'].includes(type) ? '主动回忆' : '学会运用';
      card.append(node('span', 'training-type', category), node('h2', '', title), node('p', 'muted', descriptions[type]), node('p', 'training-count', `${count} 个词 · ${pool.length} 道题`));
      const requiresModel = type === 'writing' && !canUseModel();
      const run = action(requiresModel ? '配置模型后练习' : '开始训练 →', () => requiresModel ? openSettings() : start('drill', { type, topic: trainingTopic, difficulty, count: 10 }), state, 'secondary');
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
