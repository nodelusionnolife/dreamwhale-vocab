export const CET6_CONTEXTS = `
abbreviation|education|缩写词|FAQ is an ___ for frequently asked questions.|Write the full term before using an ___ in your essay.
dissertation|education|学位论文|Her doctoral ___ examines how children learn two languages.|The student revised his ___ after meeting his supervisor.
glossary|education|术语表|A ___ at the back of the book explains the technical terms.|Check the ___ if you do not understand a word in this chapter.
mentor|education|导师|My ___ gives me advice on choosing a research topic.|Each new student is paired with a ___ who offers guidance.
apprentice|career|学徒|The young ___ learned to repair engines under an experienced mechanic.|An ___ gains practical skills while working with a qualified professional.
appraise|career|评估|The manager will ___ each employee's performance at the end of the year.|We need an expert to ___ the value of the old building.
streamline|career|精简|The company plans to ___ its hiring process by removing repeated interviews.|A shared form can ___ the approval procedure and reduce delays.
meticulous|career|一丝不苟的|The accountant kept ___ records of every payment.|Her ___ preparation left very little room for error.
activate|technology|激活|Press this button to ___ the emergency alarm.|You must ___ your account before you can sign in.
configuration|technology|配置|The program failed because its network ___ was incorrect.|Save a copy of the current ___ before changing the server settings.
embed|technology|嵌入|The editor allows users to ___ a video in a web page.|We can ___ a small sensor in the device to measure temperature.
prototype|technology|原型|The engineers built a ___ to test their design before production.|Users tried the first ___ and suggested changes to the controls.
ecosystem|environment|生态系统|Removing one species can disturb the balance of an entire ___.|A healthy wetland ___ supports birds, insects, and many kinds of plants.
conserve|environment|节约；保护|Turning off unused lights helps ___ energy.|The reserve was established to ___ rare plants and animals.
erode|environment|侵蚀|Strong waves can gradually ___ the coastline.|Heavy rain may ___ bare soil on a steep hillside.
vegetation|environment|植被|Dense ___ covers the valley and protects the soil.|The fire destroyed much of the natural ___ on the hillside.
alleviate|health|减轻|Regular stretching may help ___ muscle tension.|The treatment aims to ___ pain and improve daily movement.
hygiene|health|卫生|Good hand ___ helps reduce the spread of infection.|The kitchen must meet strict food ___ standards.
rehabilitate|health|使康复|The program helps ___ patients after serious injuries.|Special exercises are used to ___ people recovering from surgery.
susceptible|health|易受影响的|Young children can be more ___ to certain infections.|Plants weakened by drought are especially ___ to disease.
venue|travel|活动场所|The organizers chose a larger ___ for the concert.|The conference ___ is a short walk from the railway station.
terrain|travel|地形|The hikers needed special equipment for the rocky ___.|The map shows the steep ___ along the mountain route.
trek|travel|长途跋涉|Their three-day ___ across the mountains required careful planning.|The guide checked the weather before the group began its ___.
panorama|travel|全景|From the tower, visitors can enjoy a ___ of the whole city.|The summit offers a magnificent ___ of snow-covered peaks.
compassion|community|同情；怜悯|She treated the frightened child with patience and ___.|The volunteers showed ___ for families who had lost their homes.
solidarity|community|团结|Workers stood together in ___ with their injured colleague.|The community organized a meal as a gesture of ___ after the flood.
mediate|community|调解|A neutral adviser was asked to ___ between the two neighbours.|The committee will ___ the dispute and help both sides reach an agreement.
reconcile|community|使和解；调和|They hope to ___ their differences through an honest conversation.|It is difficult to ___ these two conflicting accounts of the event.
refund|consumer|退款|The shop offered a full ___ for the damaged product.|Keep your receipt if you want to request a ___.
warranty|consumer|保修保证|The laptop comes with a two-year ___.|This repair is covered by the manufacturer's ___.
voucher|consumer|代金券|She used a gift ___ to pay for part of the meal.|The store sent customers a discount ___ for their next purchase.
counterfeit|consumer|伪造的|The cashier noticed that the banknote was ___.|Officials warned shoppers about ___ goods sold as genuine brands.
empirical|research|以观察或实验为依据的|The theory needs ___ evidence from carefully designed experiments.|Their conclusions are based on ___ data rather than speculation.
hypothesis|research|假设|The experiment was designed to test the researchers' ___.|A scientific ___ must lead to predictions that can be tested.
parameter|research|参数|Temperature is an important ___ in this model.|Change one ___ at a time to identify its effect on the result.
synthesis|research|综合|The review provides a ___ of findings from several studies.|A useful ___ connects separate pieces of evidence into a coherent explanation.
`.trim().split('\n').map(row => {
  const [word, topic, contextMeaning, ...examples] = row.split('|');
  return { word, topic, contextMeaning, examples };
});

export const CET6_TASKS = [
  ['collocation', 'allocate', 'career', 'The committee will ___ funds for staff training.', 'allocate', ['alleviate', 'erode', 'hover'], 'allocate funds 表示“分配资金”。'],
  ['collocation', 'hypothesis', 'research', 'Researchers collected data to test a ___.', 'hypothesis', ['panorama', 'voucher', 'wardrobe'], 'test a hypothesis 表示“检验假设”。'],
  ['phrase', 'adhere', 'career', 'All staff must adhere ___ the safety rules.', 'to', ['for', 'with', 'at'], 'adhere to 表示“遵守；坚持”。'],
  ['phrase', 'susceptible', 'health', 'These plants are susceptible ___ frost damage.', 'to', ['with', 'for', 'by'], 'be susceptible to 表示“易受……影响”。'],
  ['confusion', 'complement', 'community', 'Their different skills ___ each other, making them a strong team.', 'complement', ['compliment'], 'complement 表示“补充、使完善”；compliment 表示“称赞”。'],
  ['confusion', 'credible', 'research', 'The claim is supported by several independent and ___ sources.', 'credible', ['credulous'], 'credible 表示“可信的”；credulous 表示“轻信的”。'],
  ['formation', 'hypothesis', 'research', 'Write the plural of hypothesis: The team tested two competing ___.', 'hypotheses', null, 'hypothesis 的复数是 hypotheses。'],
  ['formation', 'synthesis', 'research', 'Write the plural of synthesis: The book compares several ___ of earlier research.', 'syntheses', null, 'synthesis 的复数是 syntheses。'],
  ['correction', 'conducive', 'education', 'Correct the preposition only: A quiet room is conducive for focused study.', 'to', null, 'be conducive to 表示“有助于……”；把 for 改为 to。'],
  ['correction', 'entrust', 'community', 'Correct the preposition only: She entrusted the documents for her colleague.', 'to', null, 'entrust something to somebody 表示“把某物托付给某人”；把 for 改为 to。'],
  ['reading', 'empirical', 'research', 'The team measured water quality at twenty sites for six months. Their report used these observations to assess the effect of a new filter.\nWhat makes their evidence empirical?', 'It comes from direct observation and measurement.', ['It depends only on personal preference.', 'It was accepted without collecting data.', 'It predicts outcomes without testing them.'], 'empirical 指以观察或实验为依据；文中说明团队持续测量并使用观测结果。'],
  ['reading', 'conserve', 'environment', 'A town repaired leaking pipes and encouraged shorter showers. Its goal was to use less water without reducing access to essential services.\nWhat does conserve water mean in this context?', 'Use water carefully and avoid waste.', ['Increase water use at every household.', 'Prevent anyone from using water.', 'Replace all water with another liquid.'], 'conserve water 表示节约用水；修漏和缩短淋浴时间都在减少浪费。'],
  ['writing', 'alleviate', 'health', 'Write one English sentence using alleviate to describe reducing stress.', 'A short walk can help alleviate stress after work.', null, 'alleviate 后直接接需要减轻的问题，如 stress、pain 或 pressure。'],
  ['writing', 'reconcile', 'community', 'Write one English sentence using reconcile to describe resolving differences.', 'The two neighbours tried to reconcile their differences through discussion.', null, 'reconcile differences 表示调和分歧；也可用 reconcile A with B。'],
];
