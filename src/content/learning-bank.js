import { CET4_QUESTION_BANK } from './cet4-questions.js';
import { CONTEXT_NOTES } from './context-notes.js';
import { EXPANSION_WORDS, EXPANSION_VOCABULARY } from './expansion-words.js';
import { EXPANSION_TASKS } from './expansion-tasks.js';
import { CET6_QUESTIONS } from './cet6-questions.js';
import { CET4_SYLLABUS_QUESTIONS } from './cet4-syllabus-questions.js';
import { CET6_FOCUS_QUESTIONS } from './cet6-focus.js';
import { HIGH_FREQUENCY_QUESTIONS } from './high-frequency-questions.js';
import { questionMetadata } from './question-metadata.js';
import { COVERAGE_QUESTIONS } from './high-frequency-coverage.js';
import { SPECIALTY_QUESTIONS } from './high-frequency-specialties.js';
import { EXTENSION_QUESTIONS } from './high-frequency-extension.js';
import { USAGE_QUESTIONS } from './high-frequency-usage.js';
import { TRANSFER_QUESTIONS } from './high-frequency-transfer.js';
import { buildHighFrequencyPairs } from './high-frequency-pairs.js';

export const QUESTION_TYPES = {
  choice: '语境选择', fill: '提示填空', collocation: '固定搭配', formation: '词形变化',
  confusion: '易混词', meaning: '词义辨认', correction: '改错', phrase: '短语',
  reading: '短文理解', writing: '情境表达', listening: '听音拼写',
};
export const TOPICS = {
  general: '综合词汇',
  education: '校园学习', career: '工作求职', technology: '数字生活', environment: '自然环境',
  health: '身心健康', travel: '旅行出行', community: '人际与社区', consumer: '消费理财', research: '研究探索',
};

const rows = `
opportunity|n.|机会|career|The internship gave me an ___ to learn from experienced engineers.|We are looking for an ___ to work abroad.
responsibility|n.|责任|community|It is our ___ to keep the shared kitchen clean.|Taking care of the class plants is my ___ this week.
communication|n.|沟通|career|Clear ___ helps a team avoid misunderstandings.|Regular ___ between parents and teachers supports learning.
information|n.|信息|technology|Please check the ___ on the official website before applying.|The guide provides useful ___ about local buses.
development|n.|发展|community|The new library supports the ___ of the local community.|The course focuses on the ___ of practical skills.
environment|n.|环境|environment|We all have a duty to protect the ___.|Plants grow better in a warm and humid ___.
accommodation|n.|住宿|travel|We booked our ___ before buying the train tickets.|The university offers affordable ___ for first-year students.
recommendation|n.|推荐建议|consumer|I bought this camera on a friend's ___.|Could you give me a ___ for a quiet restaurant?
concentration|n.|专注力|education|Loud music can affect your ___ while studying.|A short break helped her regain her ___.
confidence|n.|信心|education|Regular practice gave him the ___ to speak in public.|The teacher helped me build ___ in my writing.
independent|adj.|独立的|education|Living away from home taught me to be more ___.|The project encourages ___ thinking.
considerate|adj.|体贴的|community|It was ___ of you to turn the music down.|Please be ___ of people who need to sleep.
convenient|adj.|方便的|travel|Is Friday afternoon a ___ time for our meeting?|The hotel is in a ___ location near the station.
appropriate|adj.|合适的|career|Choose clothes that are ___ for a job interview.|The teacher selected books ___ for young readers.
necessary|adj.|必要的|health|A good night's sleep is ___ for recovery.|Please bring all the ___ documents to the appointment.
significant|adj.|显著的|research|The study found a ___ difference between the two groups.|The new method led to a ___ improvement in accuracy.
efficient|adj.|高效的|technology|The new printer is faster and more ___ than the old one.|An ___ transport system saves commuters time.
reliable|adj.|可靠的|technology|Check that your information comes from a ___ source.|We need a ___ internet connection for the meeting.
available|adj.|有空的或可获得的|career|Are you ___ for a meeting on Friday?|Tickets are still ___ at the front desk.
flexible|adj.|灵活的|career|The company offers ___ working hours.|We need a ___ plan that can change with the weather.
affordable|adj.|负担得起的|consumer|Students need ___ housing near campus.|The shop sells good food at ___ prices.
sustainable|adj.|可持续的|environment|The city is investing in ___ transport.|We need a more ___ way to produce energy.
temporary|adj.|临时的|career|She found a ___ job during the summer holiday.|The road closure is only ___.
permanent|adj.|永久的|community|The exhibition will become a ___ part of the museum.|The accident caused ___ damage to the bridge.
permission|n.|许可|education|You need your teacher's ___ to leave early.|Ask for ___ before using someone else's photo.
application|n.|申请|career|Please submit your ___ before the deadline.|Her ___ for the scholarship was successful.
appointment|n.|预约|health|I have a dental ___ at three o'clock.|Please call to cancel your ___ if you cannot come.
achievement|n.|成就|education|Finishing her first novel was a major ___.|The award recognizes outstanding academic ___.
requirement|n.|要求|career|A valid driving licence is a ___ for this job.|Please check every entry ___ before applying.
improvement|n.|改进|education|Your pronunciation shows a clear ___.|We noticed an ___ in the quality of the reports.
explanation|n.|解释|education|The teacher gave a clear ___ of the rule.|Could you provide an ___ for the delay?
imagination|n.|想象力|education|Reading stories can develop a child's ___.|Designing a new game takes both skill and ___.
participation|n.|参与|community|The course encourages active ___ in class discussions.|Student ___ made the festival a success.
relationship|n.|关系|community|Trust is important in any ___.|The study explores the ___ between sleep and memory.
understanding|n.|理解|education|The course deepened my ___ of local history.|Thank you for your patience and ___.
transportation|n.|交通运输|travel|Public ___ makes it easier to get around the city.|The company will cover the cost of ___.
destination|n.|目的地|travel|We reached our ___ just before sunset.|Choose your ___ before booking a flight.
reservation|n.|预订|travel|I would like to make a ___ for two people.|Please confirm your hotel ___ by email.
maintenance|n.|维护|technology|Regular ___ keeps the machines working safely.|The website is closed for ___ this evening.
privacy|n.|隐私|technology|Check the app's ___ settings before sharing photos.|Please respect other people's ___.
password|n.|密码|technology|Use a different ___ for each account.|Never share your ___ in a public chat.
evidence|n.|证据|research|There is little ___ to support that claim.|The team collected ___ from several sources.
conclusion|n.|结论|research|We cannot reach a ___ without more data.|The report ends with a brief ___.
comparison|n.|比较|research|The article makes a ___ between two teaching methods.|A careful ___ of prices can save you money.
advantage|n.|优势|career|Experience is an ___ when applying for this position.|One ___ of cycling is its low cost.
disadvantage|n.|劣势|consumer|The main ___ of this model is its short battery life.|Living far from campus can be a ___ for students.
consequence|n.|后果|environment|Every decision can have an unexpected ___.|Water shortages are one ___ of the long drought.
awareness|n.|意识|environment|The campaign aims to raise ___ of food waste.|Education can increase public ___ of road safety.
volunteer|n.|志愿者|community|Each ___ helped visitors find their seats.|She works as a ___ at the local animal shelter.
neighbourhood|n.|街区|community|There is a small park in our ___.|The new cafe has become popular in the ___.
anxiety|n.|焦虑|health|Talking to a friend helped reduce her ___ before the exam.|He felt some ___ about starting a new job.
recovery|n.|康复|health|Rest is important for a full ___ after an illness.|The doctor was pleased with the patient's ___.
nutrition|n.|营养|health|Good ___ is important for healthy growth.|The course teaches students about food and ___.
ingredient|n.|原料|consumer|Flour is the main ___ in this recipe.|Check each ___ if you have a food allergy.
receipt|n.|收据|consumer|Keep your ___ in case you need to return the item.|The cashier gave me a ___ after I paid.
refund|n.|退款|consumer|I asked for a ___ because the item was broken.|You can receive a full ___ within seven days.
subscription|n.|订阅|technology|My magazine ___ expires next month.|You can cancel your ___ in the account settings.
deadline|n.|截止时间|career|We must finish the report before the ___.|The application ___ has been extended by a week.
feedback|n.|反馈|education|The teacher gave useful ___ on my essay.|We welcome ___ from everyone who uses the service.
collaboration|n.|合作|career|The project was completed through close ___ between the teams.|Successful ___ requires clear communication.
`.trim().split('\n').map((line) => line.split('|'));

const coreWords = rows.map(([word, pos, meaning, topic, first, second]) => ({
  word, pos, meaning, topic, senseId: `${word}:core`, examples: [first, second],
}));

const topicAliases = { campus: 'education', transport: 'travel', media: 'technology', housing: 'community', safety: 'community', workplace: 'career', teamwork: 'career' };

const legacy = CET4_QUESTION_BANK.items.map((q) => {
  const note = CONTEXT_NOTES[q.answer];
  const hint = note ? `${note.pos} ${note.meaning}` : q.hint;
  const stem = q.answer === 'price' ? 'The amount customers pay rose: the ___ of the product increased by ten percent.' : q.stem;
  return {
    ...q, stem, version: 2, skill: q.type === 'choice' ? 'recognition' : 'recall',
    senseId: q.answer === 'available' ? 'available:obtainable' : `${q.answer}:core`, variantGroup: q.variantGroup || q.id,
    topic: q.answer === 'pulse' ? 'health' : q.answer === 'threat' ? 'technology' : topicAliases[q.topic] || q.topic,
    hint, promptHint: q.type === 'fill' ? `${hint || q.explanation}；首字母 ${q.answer[0]}，${q.answer.length} 个字母` : '',
    accepts: q.accepts || [q.answer], grading: 'exact',
    explanation: `${note?.explanation || q.explanation}\n${stem.replace(/_+/g, q.answer)}`,
    source: 'project-original',
  };
});

export const LEARNING_WORDS = [...coreWords, ...EXPANSION_WORDS];

const vocabulary = coreWords.flatMap((w, i) => {
  const base = {
    version: 1, topic: w.topic, difficulty: w.word.length > 10 ? 'advanced' : 'basic',
    answer: w.word, accepts: w.word === 'neighbourhood' ? ['neighbourhood', 'neighborhood'] : [w.word],
    targetWords: [w.word], senseId: w.senseId, source: 'project-original', grading: 'exact',
    hint: `${w.pos} ${w.meaning}`, explanation: `${w.word}：${w.meaning}。`,
  };
  return [
    ...w.examples.map((stem, j) => ({
      ...base, id: `dw-context-${i + 1}-${j + 1}`, type: 'fill', skill: 'recall', stem,
      senseId: w.word === 'available' ? `available:${j === 0 ? 'free' : 'obtainable'}` : w.senseId,
      variantGroup: `dw-context-${i + 1}-${j + 1}`,
      promptHint: `${w.pos} ${w.meaning}；首字母 ${w.word[0]}，${w.word.length} 个字母`,
      explanation: `${stem.replace('___', w.word)}\n${w.word} 在这里表示“${w.meaning}”。`,
    })),
    {
      ...base, id: `dw-meaning-${i + 1}`, type: 'meaning', skill: 'recognition',
      stem: `请选择“${w.meaning}”对应的词。`, variantGroup: `dw-meaning-${i + 1}`,
      options: [w.word, ...[1, 7, 17].map((n) => coreWords[(i + n) % coreWords.length].word)],
    },
    {
      ...base, id: `dw-listen-${i + 1}`, type: 'listening', skill: 'listening',
      stem: '听读音，写出你听到的单词。', audioText: w.word, promptHint: '', variantGroup: `dw-listen-${i + 1}`,
    },
  ];
});

const tasks = [
  ['collocation','make a decision','education','We need to ___ a decision today.','make','do,play,build','make a decision 表示“作出决定”。'],
  ['collocation','take responsibility','career','A good leader will ___ responsibility for mistakes.','take','make,do,play','take responsibility for 表示“为……承担责任”。'],
  ['collocation','pay attention','education','Please ___ attention to the instructions.','pay','make,do,keep','pay attention to 表示“注意”。'],
  ['collocation','make progress','education','You will ___ progress with regular practice.','make','do,take,play','make progress 表示“取得进步”，progress 是不可数名词。'],
  ['collocation','keep a promise','community','You should always ___ a promise once you have made it.','keep','do,take,play','keep a promise 表示“信守承诺”。'],
  ['collocation','raise awareness','environment','The campaign will ___ awareness of plastic waste.','raise','rise,arise,arrive','raise awareness of 表示“提高对……的认识”。'],
  ['phrase','depend on','education','Success depends ___ regular practice.','on','','depend on 表示“依靠、取决于”。'],
  ['phrase','look after','community','Please look ___ my cat while I am away.','after','into,up,at','look after 表示“照顾”。'],
  ['phrase','give up','health','He decided to give ___ smoking.','up','in,out,away','give up doing 表示“放弃做某事”。'],
  ['phrase','put off','career','We had to put ___ the meeting until next week.','off','out,up,on','put off 表示“推迟”。'],
  ['phrase','look forward to','travel','I look forward ___ seeing you again.','to','','look forward to 后接名词或动名词。'],
  ['phrase','in spite of','travel','___ the rain, we enjoyed the trip.','In spite of','Because,Although,Unless','in spite of 后接名词短语，表示“尽管”。'],
  ['confusion','affect','health','Smoking can adversely ___ your health.','affect','effect','affect 常作动词，表示“影响”；effect 常作名词表示“影响、效果”。'],
  ['confusion','effect','research','The medicine had no noticeable ___ on the symptoms.','effect','affect','这里需要名词 effect。'],
  ['confusion','borrow','education','Could I ___ your pen for a minute?','borrow','lend','borrow 指借入；lend 指借出。'],
  ['confusion','lend','community','Could you ___ me your umbrella?','lend','borrow','lend somebody something 表示“把某物借给某人”。'],
  ['confusion','economic','research','The report examines the causes of the ___ crisis.','economic','economical','economic 表示“经济的”；economical 表示“节省的”。'],
  ['confusion','rise','consumer','Prices tend to ___ when supply is limited.','rise','raise','rise 是不及物动词；raise 通常需要宾语。'],
  ['formation','decision','career','Her ___ was final. (decide)','decision','','形容词性物主代词后，这里需要名词 decision。'],
  ['formation','successful','career','The event was very ___. (success)','successful','','was 后需要形容词 successful。'],
  ['formation','carefully','education','Please read the instructions ___. (careful)','carefully','','修饰 read，用副词 carefully。'],
  ['formation','improvement','education','There has been a clear ___. (improve)','improvement','','冠词和形容词之后需要名词 improvement。'],
  ['formation','creative','education','The task encourages ___ thinking. (create)','creative','','修饰 thinking，用形容词 creative。'],
  ['formation','pollution','environment','The city is taking steps to reduce air ___. (pollute)','pollution','','air pollution 表示“空气污染”。'],
  ['correction','suggest doing','community','将错误部分改成正确形式：She suggested to leave early.（替换 to leave）','leaving','','suggest doing something，不能在该结构中使用 suggest to do。'],
  ['correction','information','technology','改正一个词：This information are useful.（替换 are）','is','','information 是不可数名词，谓语使用 is。'],
  ['correction','interested in','education','改正一个词：I am interested on history.（替换 on）','in','','be interested in 表示“对……感兴趣”。'],
  ['correction','advice','career','改正一个词：She gave me some advices.（替换 advices）','advice','','advice 是不可数名词，没有 advices 这种普通复数形式。'],
  ['reading','reserve','travel','The workshop has only twenty places. To reserve a seat, email us by Friday. There is no fee, but please tell us if you cannot attend.\n文中的 reserve 最接近哪个意思？','book','repair,remove,share','reserve a seat 表示“预订座位”，这里与 book 同义。'],
  ['reading','charge','consumer','The hotel offers free breakfast. It charges guests ten pounds for parking each night. Bicycles can be kept in the courtyard at no cost.\n这里的 charges 表示什么？','收取费用','充电,指控,冲锋','宾馆按夜收取停车费，charge 在这里表示“收费”。'],
  ['reading','available','education','Dr Lee is teaching until noon on Tuesday. She is available from two to four in the afternoon. Please email before visiting her office.\n什么时候可以与老师见面？','周二下午两点至四点','周二上午十点,周二中午十二点,周二下午五点','available 在这里表示“有空的”。'],
  ['writing','available','career','用 available 写一句英文，礼貌询问老师周五是否有空。','Are you available on Friday?','','必须询问对方周五是否有空，使用 available；不要求逐字一致。'],
  ['writing','although','travel','用 although 合并：It was raining. We went out.','Although it was raining, we went out.','','保留“下雨但仍外出”的让步关系，使用 although；语序可以不同。'],
  ['writing','recommend','community','用 recommend 写一句英文，向朋友推荐一本书。','I recommend this book to you.','','需要表达向朋友推荐书的意思，并正确使用 recommend。'],
];

const extra = tasks.map(([type, word, topic, stem, answer, wrong, explanation], i) => ({
  id: `dw-skill-${i + 1}`, version: 1, type, topic, stem, answer,
  options: wrong ? [answer, ...wrong.split(',')] : undefined,
  accepts: [answer], targetWords: [word], senseId: word === 'available' ? 'available:free' : `${word}:core`,
  skill: type === 'writing' ? 'production' : type === 'formation' ? 'formation' : ['phrase','collocation','correction'].includes(type) ? 'usage' : 'recognition',
  difficulty: ['writing','reading','correction'].includes(type) ? 'advanced' : 'basic',
  grading: type === 'writing' ? 'semantic' : 'exact', rubric: type === 'writing' ? explanation : undefined,
  explanation, hint: ({ writing: '先确认要表达的意思，再检查目标词的用法。', formation: '看空格在句中作什么成分，再把括号里的词改成相应词性。', reading: '回到目标词前后的句子，寻找时间、动作和因果线索。', correction: '检查搭配、词性，以及名词与动词的单复数是否一致。', confusion: '先判断需要名词还是动词，再看动作的方向和意思。', collocation: '把空格和后面的名词连起来，想想常见搭配。', phrase: '想清楚整句的动作或转折关系，再选择介词或副词。' })[type],
  variantGroup: `dw-skill-${i + 1}`, source: 'project-original',
}));

const previousQuestions = [...legacy, ...vocabulary, ...extra, ...EXPANSION_VOCABULARY, ...EXPANSION_TASKS, ...CET6_QUESTIONS, ...CET4_SYLLABUS_QUESTIONS, ...CET6_FOCUS_QUESTIONS, ...HIGH_FREQUENCY_QUESTIONS, ...COVERAGE_QUESTIONS, ...SPECIALTY_QUESTIONS, ...EXTENSION_QUESTIONS, ...USAGE_QUESTIONS, ...TRANSFER_QUESTIONS].map(questionMetadata);
export const PAIRED_QUESTIONS = buildHighFrequencyPairs(previousQuestions).map(questionMetadata);
export const LEARNING_QUESTIONS = [...previousQuestions, ...PAIRED_QUESTIONS];
export const LEARNING_BANK_VERSION = '2026-10-learning-v11';
