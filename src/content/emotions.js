export const FACE_STYLES = [
  { id: 'chibi', label: 'Q版' },
  { id: 'portrait', label: '立绘版' },
];

export const DEFAULT_FACE_STYLE = 'chibi';
export const CHARACTER_AVATAR_PATH = 'assets/mengjing/avatar.webp';
export const FACE_HOSTS = FACE_STYLES;
export const DEFAULT_FACE_HOST = DEFAULT_FACE_STYLE;

export const EMOTIONS = [
  { id: '兴奋', slug: 'excited', aliases: ['激动', '欢呼', '雀跃', '惊喜', '热血', '斗志'] },
  { id: '哭泣', slug: 'crying', aliases: ['哭', '大哭', '泪目', '眼泪', '抽泣', '委屈'] },
  { id: '生气', slug: 'angry', aliases: ['恼怒', '愠怒', '不满', '火大', '气愤', '愤怒'] },
  { id: '害羞', slug: 'shy', aliases: ['脸红', '不好意思', '羞涩', '腼腆', '娇羞'] },
  { id: '惊讶', slug: 'surprised', aliases: ['吃惊', '震惊', '错愕', '意外', '慌张', '慌乱'] },
  { id: '得意', slug: 'proud', aliases: ['自得', '坏笑', '得意洋洋', '狡黠'] },
  { id: '困倦', slug: 'sleepy', aliases: ['困', '打哈欠', '疲惫', '睡意', '犯困', '没精神'] },
  { id: '开心', slug: 'happy', aliases: ['高兴', '快乐', '愉快', '喜悦', '开怀', '欢喜'] },
  { id: '思索', slug: 'thinking', aliases: ['思考', '疑惑', '困惑', '歪头', '琢磨', '想了想', '沉吟'] },
  { id: '温柔', slug: 'gentle', aliases: ['柔和', '宠溺', '轻轻笑', '温暖', '含笑', '微笑'] },
  { id: '平静', slug: 'neutral', aliases: ['中性', '平常', '默认', '无表情', '淡淡', '如常'] },
  { id: '无奈', slug: 'helpless', aliases: ['无语', '汗', '尴尬', '扶额', '叹气', '哭笑不得'] },
  { id: '认真', slug: 'serious', aliases: ['严肃', '专注', '正经', '郑重'] },
  { id: '失落', slug: 'sad', aliases: ['低落', '沮丧', '受伤', '黯然', '泄气', '难过', '伤心'] },
];

export const EMOTION_IDS = EMOTIONS.map((emotion) => emotion.id);
export const FACE_TAG = 'Face';

export function faceUrlFor(emotion, style = DEFAULT_FACE_STYLE) {
  if (!emotion?.slug || !FACE_STYLES.some((entry) => entry.id === style)) return null;
  return `assets/mengjing/${style}/${emotion.slug}.webp`;
}

export function emotionsWithArt() {
  return EMOTIONS.filter((emotion) => Boolean(faceUrlFor(emotion)));
}

export function emotionsWithoutArt() {
  return EMOTIONS.filter((emotion) => !faceUrlFor(emotion));
}

export function describeEmotionTable() {
  return EMOTIONS.map((emotion) => `${emotion.id}${faceUrlFor(emotion) ? '' : '（缺图）'}`).join(' / ');
}
