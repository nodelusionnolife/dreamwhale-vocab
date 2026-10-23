import { USAGE_QUESTIONS } from './high-frequency-usage.js';

const byId = new Map(USAGE_QUESTIONS.map(q => [q.id, q]));
const rows = `
c4-collocation-adapt|career|Night-shift workers often need time to adapt ___ a different sleep schedule.|adapt to 可表示适应新的工作作息，不局限于气候或校园环境。
c4-collocation-aware|technology|Many users were unaware of the charge yesterday, but they are now aware ___ it.|aware of 后可接代词 it，表示已知道这笔费用。
c4-collocation-prompt|health|The unexpected symptoms prompted the doctors ___ their calculations before changing the dose.|prompt sb to check 表示促使某人检查，不能直接接 checking。
c4-collocation-restrict|technology|Editing rights are restricted ___ the document owner; other users can only read it.|be restricted to 限定权限持有人，能阅读不代表能修改。
c6-collocation-adverse|career|Frequent interruptions can have an adverse effect ___ the team's concentration.|an adverse effect on 表示对专注力产生不利影响。
c6-collocation-random|research|To avoid choosing only large seeds, the researcher took a sample at ___.|at random 表示随机抽取，而非按大小挑选。
c6-collocation-deduce|research|The historian deduced the year of the journey ___ the dates in two diaries.|deduce A from B 指从证据推断结论，日记是依据。
c6-collocation-intervene|education|The teacher intervened ___ the argument when the two pupils could no longer resolve it themselves.|intervene in 表示介入争执，后面接事件而非介入者。
c4-formation-promote|career|用 promote 的名词形式填空：After her ___, she became responsible for training new supervisors.|promotion 表示职位提升；此处不涉及商品促销。
c4-formation-globe|environment|用 globe 的同词族副词填空：The report compares how rainfall patterns are changing ___.|globally 是 global 的副词形式，此处表示在全球范围内。
c4-formation-omit|education|用 omit 的过去分词填空：One source had been ___ from the bibliography, although it was cited in the essay.|had been 后接过去分词 omitted，omit 在此双写 t。
c4-formation-undergo|health|用 undergo 的过去式填空：The patient ___ a routine examination yesterday and returned home the same day.|underwent 是 undergo 的过去式，yesterday 明确为过去时间。
c6-formation-allergic|health|用 allergic 的单数名词形式填空：The label asks customers to report any ___ to ingredients before ordering.|any 后可接单数 allergy，指对食材的过敏。
c6-formation-chronic|career|用 chronic 的副词形式填空：The maintenance department is ___ understaffed, so delays recur every month.|chronically 修饰 understaffed，recurring delays 表示长期问题。
c6-formation-distil|research|用 distil 的过去分词填空：The laboratory uses ___ water so dissolved minerals will not affect the result.|distilled water 为蒸馏水，过去分词作 water 的定语。
c6-formation-expire|consumer|用 expire 的名词形式填空：The voucher cannot be used after its ___ date, even if it has never been redeemed.|expiry/expiration date 都可表示到期日，未使用不代表不会到期。
c4-confusion-acquire|education|During the pottery course, beginners ___ the skills needed to shape a bowl on a wheel.|acquire skills 表示学会技能；课程语境区别于询问或要求。
c4-confusion-consume|technology|Leaving several video apps running can ___ battery power even when the screen is off.|consume 表示消耗电量，设备无须亮屏才会耗电。
c4-confusion-derive|research|These estimates ___ from measurements taken last winter, so they may not reflect current conditions.|derive from 表示数据来源，未声称旧数据一定准确适用于现在。
c4-confusion-decline|career|She liked the proposed role but decided to ___ the offer because the hours conflicted with her studies.|decline the offer 是婉拒职位邀请，此处不表示数量下降。
c6-confusion-allergic|health|The visitor is ___ to cats, so the host arranged a room that the pets never enter.|allergic to 表示过敏；安排房间的目的在于减少接触。
c6-confusion-conserve|environment|The reserve limits night lighting to ___ the natural habitats of bats and other wildlife.|conserve habitats 表示保护栖息地，不是只保存一份记录。
c6-confusion-conceive|research|The designers ___ of a quieter engine before building a model to test their idea.|conceive of 表示构思尚未实现的方案，与实际接收或感知不同。
c6-confusion-default|consumer|The company is in ___ because it has failed to make the payments required by its lease.|in default 表示没有履行合同付款义务，不等于只存在预算赤字。
c4-correction-essential|technology|只替换方括号中的介词：A reliable connection is essential [at] uploading the large files before the deadline.|essential for/to 均可表示对完成任务必不可少，后接 uploading。
c4-correction-campus|education|只替换方括号中的介词，表达“在校园里”：The student newspaper is available [to] campus throughout the term.|on campus 表示在校园里，适用于校园内领取报纸的情境。
c4-correction-impose|environment|只替换方括号中的介词：The park imposes a limit [to] the number of visitors allowed near nesting birds.|impose a limit on/upon 表示对游客数量施加限制。
c4-correction-undertake|consumer|只替换方括号中的部分：The shop undertook [replacing] any faulty battery within the first year.|undertake to replace 表示承诺更换，并有一年期限。
c6-correction-inherent|research|只替换方括号中的介词：Some uncertainty is inherent [with] estimating a population from a small sample.|inherent in 后可接动名词，表示估算过程本身包含的不确定性。
c6-correction-impart|education|只替换方括号中的介词：The workshop imparts practical sewing skills [with] beginners.|impart sth to sb 表示向学习者传授技能，不照搬 share with。
c6-correction-elaborate|career|只替换方括号中的介词：Before approving the budget, the board asked her to elaborate [at] the staffing plan.|elaborate on/upon 表示详细说明人员安排。
c6-correction-intimidate|community|只替换方括号中的部分：No resident should be intimidated [to leave] a public meeting for expressing a different view.|intimidate sb into leaving 表示恐吓某人使其离开。
c4-phrase-code|career|用 code 补全三个词，表示“行为准则”：New employees read the company's ___ before meeting clients.|code of conduct/behaviour/behavior/practice 都可表达规范行为的准则。
c4-phrase-campus|education|用 campus 补全两个词，表示“在校园里”：During exam week, the library is the quietest place to study ___.|on campus 指校园范围内，地点不局限于宿舍。
c4-phrase-impose|environment|用 impose 补全四个词，以 impose 开头，表示“对……施加限制”：To protect the shore, the council may ___ new waterfront buildings.|impose a limit/restriction on 表示施加限制，on 引出受限对象。
c4-phrase-obstacle|education|用 obstacle 补全三个词，表示“……的障碍”：Unclear instructions can be ___ participation in the workshop, even when materials are free.|an obstacle to/for participation 指参加活动的障碍，免费材料不能消除说明不清的问题。
c6-phrase-threshold|career|用 threshold 补全三个词，表示“在……的门槛上”：After years of training, she felt she was ___ of a new career.|on/at the threshold of 可比喻即将进入新阶段，of 已给出。
c6-phrase-turnover|health|用 turnover 补全两个词，表示“员工流动率”：More predictable schedules helped the clinic reduce ___.|staff/employee turnover 指员工离职与替换的情况，此处不指销售额。
c6-phrase-elaborate|research|用 elaborate 补全两个词，表示“详细阐述”：The reviewer asked the authors to ___ how they selected the sample.|elaborate on/upon 后可接 how 引导的从句，要求说明抽样方法。
c6-phrase-skeptical|consumer|用 skeptical 补全两个词，表示“对……持怀疑态度”：Buyers should remain ___ promises that a product will last forever.|skeptical/sceptical of/about 均可，永久寿命的宣传需要证据。
`.trim();

export const TRANSFER_QUESTIONS = rows.split('\n').map(row => {
  const [suffix, topic, stem, explanation] = row.split('|');
  const [level, type, word] = suffix.split('-');
  const base = byId.get(`dw-${level}-usage-${type}-${word}`);
  if (!base || !explanation) throw new Error(`Invalid transfer question: ${suffix}`);
  return { ...base, id: `dw-${level}-transfer-${type}-${word}`, version: 1, topic, stem, explanation,
    difficultyBasis: explanation, source: 'project-original-transfer-2026' };
});
