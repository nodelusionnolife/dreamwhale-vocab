// 表情标签词表。这是「标准标签」的唯一事实来源。
//
// 为什么要别名表：模型不会只写「开心」，它会写高兴／快乐／愉快／喜悦。
// 只认一种写法就会出现「图有、标签也对、却解析不到」的假故障。
// 所以每个标准标签带一组别名，解析时先归一化再查找。
//
// 表情图走远程图床，不进仓库：这个作品本来就要联网调模型才能玩，
// 表情再本地化并不能让它离线可用，只会把素材塞进仓库、把首包撑大。
// 两个图床装的是同一批图，默认图床 A，设置里可切到图床 B（切换只换取图地址，不换图）。
//
// 别名只收「强度和这张图匹配」的写法。强度不符的宁可归到缺图的预留位，
// 也不要硬套一张情绪过重的图（比如有点难过却上了大哭图）。

/** 图床。第一个是默认，其余是备用，手动切换。 */
export const FACE_HOSTS = [
  {
    id: 'remit',
    label: '图床 A · img.remit.ee',
    note: '默认。直链无扩展名。',
  },
  {
    id: 'picui',
    label: '图床 B · picui.ogmua.cn',
    note: '备用。webp 直链。',
  },
];

export const DEFAULT_FACE_HOST = FACE_HOSTS[0].id;

/**
 * 标准表情表。
 * - id：标准标签，模型输出的就是这个（中文，因为提示词是中文，模型选中文最稳）
 * - hosts：各图床下的直链；key 必须来自 FACE_HOSTS
 * - aliases：模型可能写的同义写法，解析时都归到这个 id
 */
export const EMOTIONS = [
  {
    id: '兴奋',
    aliases: ['激动', '欢呼', '雀跃', '惊喜', '热血', '斗志'],
    hosts: {
      remit: 'https://img.remit.ee/i/2EevWsD84jI2',
      picui: 'https://picui.ogmua.cn/s1/2026/09/14/6aa78858dcd73.webp',
    },
  },
  {
    id: '哭泣',
    aliases: ['哭', '大哭', '泪目', '眼泪', '抽泣', '委屈'],
    hosts: {
      remit: 'https://img.remit.ee/i/3o08GuTkXsVv',
      picui: 'https://picui.ogmua.cn/s1/2026/09/14/6aa78858d9be5.webp',
    },
  },
  {
    id: '生气',
    aliases: ['恼怒', '愠怒', '不满', '火大', '气愤', '愤怒'],
    hosts: {
      remit: 'https://img.remit.ee/i/tjdpJ2qF5TuT',
      picui: 'https://picui.ogmua.cn/s1/2026/09/14/6aa78858e9f5e.webp',
    },
  },
  {
    id: '害羞',
    aliases: ['脸红', '不好意思', '羞涩', '腼腆', '娇羞'],
    hosts: {
      remit: 'https://img.remit.ee/i/Y74MKvafZr6H',
      picui: 'https://picui.ogmua.cn/s1/2026/09/14/6aa78858f0221.webp',
    },
  },
  {
    id: '惊讶',
    aliases: ['吃惊', '震惊', '错愕', '意外', '慌张', '慌乱'],
    hosts: {
      remit: 'https://img.remit.ee/i/1Rhlul6MsWpj',
      picui: 'https://picui.ogmua.cn/s1/2026/09/14/6aa78858e9951.webp',
    },
  },
  {
    id: '得意',
    aliases: ['自得', '坏笑', '得意洋洋', '狡黠'],
    hosts: {
      remit: 'https://img.remit.ee/i/YcYAZgGKfLHI',
      picui: 'https://picui.ogmua.cn/s1/2026/09/14/6aa788a1207f9.webp',
    },
  },
  {
    id: '困倦',
    aliases: ['困', '打哈欠', '疲惫', '睡意', '犯困', '没精神'],
    hosts: {
      remit: 'https://img.remit.ee/i/yDPJopc0HjV0',
      picui: 'https://picui.ogmua.cn/s1/2026/09/14/6aa788a121906.webp',
    },
  },
  {
    id: '开心',
    aliases: ['高兴', '快乐', '愉快', '喜悦', '开怀', '欢喜'],
    hosts: {
      remit: 'https://img.remit.ee/i/op1lkcQHktPb',
      picui: 'https://picui.ogmua.cn/s1/2026/09/14/6aa788a124475.webp',
    },
  },
  {
    id: '思索',
    aliases: ['思考', '疑惑', '困惑', '歪头', '琢磨', '想了想', '沉吟'],
    hosts: {
      remit: 'https://img.remit.ee/i/HXEuPpuYVnn1',
      picui: 'https://picui.ogmua.cn/s1/2026/09/14/6aa788f9547b5.webp',
    },
  },
  {
    id: '温柔',
    aliases: ['柔和', '宠溺', '轻轻笑', '温暖', '含笑', '微笑'],
    hosts: {
      remit: 'https://img.remit.ee/i/zQjOvgUtoteQ',
      picui: 'https://picui.ogmua.cn/s1/2026/09/14/6aa788f94de95.webp',
    },
  },
  {
    id: '平静',
    aliases: ['中性', '平常', '默认', '无表情', '淡淡', '如常'],
    hosts: {
      remit: 'https://img.remit.ee/i/kOrHaR1sqUKy',
      picui: 'https://picui.ogmua.cn/s1/2026/09/14/6aa788f94ef61.webp',
    },
  },

  // —— 预留位：标签已标准化，尚无立绘 ——
  {
    id: '无奈',
    aliases: ['无语', '汗', '尴尬', '扶额', '叹气', '哭笑不得'],
    hosts: null,
    note: '学生答得很离谱或说了蠢话时的主表情。缺它就只能用「生气」，情绪过重。',
  },
  {
    id: '认真',
    aliases: ['严肃', '专注', '正经', '郑重'],
    hosts: null,
    note: '宣布规则、纠错、讲重点时需要。缺它会出现「讲正经事时还在笑」。',
  },
  {
    id: '失落',
    aliases: ['低落', '沮丧', '受伤', '黯然', '泄气', '难过', '伤心'],
    hosts: null,
    note: '轻度的难过，和「哭泣」不是一个量级。现在只有大哭，没有小失落。',
  },
];

/** 标准标签集合。 */
export const EMOTION_IDS = EMOTIONS.map((e) => e.id);

/** 立绘标签语法。与 <Question> / <Sticker> 平行，便于同一个渲染器切分。 */
export const FACE_TAG = 'Face';

/** 某条表情在指定图床下的地址；没有该图床的登记时返回 null。 */
export function faceUrlFor(emotion, host = DEFAULT_FACE_HOST) {
  const h = emotion?.hosts;
  if (!h || !host) return null;
  return h[host] || null;
}

/** 有图可用的标签。 */
export function emotionsWithArt() {
  return EMOTIONS.filter((e) => Boolean(faceUrlFor(e)));
}

/** 预留位（标签已定、缺图）。 */
export function emotionsWithoutArt() {
  return EMOTIONS.filter((e) => !faceUrlFor(e));
}

/** 演示/文档用：把标准表渲染成一行可读文本。 */
export function describeEmotionTable() {
  return EMOTIONS.map((e) => `${e.id}${faceUrlFor(e) ? '' : '（缺图）'}`).join(' / ');
}
