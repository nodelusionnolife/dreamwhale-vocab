import { emotionsWithArt, faceUrlFor, FACE_STYLES, DEFAULT_FACE_STYLE, CHARACTER_AVATAR_PATH } from './emotions.js';
import { SCENE_ASSETS } from './scenes.js';

export const ASSET_KINDS = ['bg', 'sprite', 'sticker'];
export const PRELOAD_POLICIES = ['eager', 'lazy', 'on-demand'];
export const LIFETIMES = ['chat', 'message'];
export const ASSET_SCHEMA_VERSION = 1;
export const CHAT_BG_ID = 'bg-chat-room';
export const CHARACTER_AVATAR_ID = 'mengjing-avatar';

const CHARACTER_PROVENANCE = {
  origin: 'AI 生成的梦鲸角色素材',
  license: '经项目作者授权用于梦鲸词汇项目展示与随项目分发',
};

const LOCAL_ASSET_METADATA = {
  'assets/mengjing/chibi/angry.webp': { bytes: 78520, sha256: 'e24c31572738e255803fd7fec13a5a9b6f623e332035c57075d249ea5eca5c0d' },
  'assets/mengjing/chibi/crying.webp': { bytes: 74690, sha256: '281d69071250519f5ee5210c3992e6c46e87dab17de3ba8c2fea875c8f1a0755' },
  'assets/mengjing/chibi/excited.webp': { bytes: 77846, sha256: '5c3bfa8c3e8c8af1383f7c237c7b297e266ab79276b0729f9ca7b030c87f034a' },
  'assets/mengjing/chibi/gentle.webp': { bytes: 75700, sha256: '28a130341a8799d0626fc1146355ae88b64c6eacd1fa23cbe7e20ffa96745f65' },
  'assets/mengjing/chibi/happy.webp': { bytes: 75860, sha256: '548d7661a9833d4ff5215f596ec5d20516508b270adbf19342af571abf5315e0' },
  'assets/mengjing/chibi/helpless.webp': { bytes: 73084, sha256: '345afd78d04d43294e4ae9080606fdfc7d408d95575cce6ed190b5ae59f16dce' },
  'assets/mengjing/chibi/neutral.webp': { bytes: 79480, sha256: '1dd62cb9672b4af6051f9077483e81db914da1df6dbe568b98d058cafad90d8e' },
  'assets/mengjing/chibi/proud.webp': { bytes: 78338, sha256: '698a42f65f8117617ca21e6fdc644d828ea59af3c4b85ea9eb367593eeb3ec14' },
  'assets/mengjing/chibi/sad.webp': { bytes: 75562, sha256: '9d1bfb0762c32f6515dfbb5b3ecbf91569344408882ee5df6ec445e3628704ae' },
  'assets/mengjing/chibi/serious.webp': { bytes: 79150, sha256: '7b65ffa90aa92689b8d7f5198b65f59f2eb285d34146f9b0f69c5eb4e125b334' },
  'assets/mengjing/chibi/shy.webp': { bytes: 78478, sha256: 'eb812e823e035d5f4949b9b2d9b3cb2a3a3ffc2ef779cfcc941c6dcb3da06498' },
  'assets/mengjing/chibi/sleepy.webp': { bytes: 74712, sha256: 'e9bdf0bee54bedda5d0d4aaf82d16663290fe1f2e4877fc3b806be17abb75711' },
  'assets/mengjing/chibi/surprised.webp': { bytes: 77292, sha256: 'db007dbaca8c23979a830b6e1055ba45527644cc2fde62e65332362495fc7b72' },
  'assets/mengjing/chibi/thinking.webp': { bytes: 74844, sha256: '23f978b6158aa2395982a34cda36088dee652895421ccf50a60d28de11f8d040' },
  'assets/mengjing/portrait/angry.webp': { bytes: 83674, sha256: '3bfd96845d85cc07964ef8bbceb1af2d441ab51ad6fe406cf9c1adb821888b7f' },
  'assets/mengjing/portrait/crying.webp': { bytes: 84282, sha256: 'a1442e29f1fc35bf22f5026af87742605497c7e2809c582ae7e9ddd6e6a7b620' },
  'assets/mengjing/portrait/excited.webp': { bytes: 82932, sha256: '0e72e92200426abc45ba9141f83da6e280557cba15436602d96992ec702fb413' },
  'assets/mengjing/portrait/gentle.webp': { bytes: 84346, sha256: '2ac2ab7f363e11a368d455cdb34dc5f78c2edf318e4dac9801171a8f36e7fe7f' },
  'assets/mengjing/portrait/happy.webp': { bytes: 85496, sha256: '849007daf5b40b1e04ebf368486c2a8f309ef93fe6d58ec3661d59378325428b' },
  'assets/mengjing/portrait/helpless.webp': { bytes: 81404, sha256: 'fb3a31d4ebc4fdb888a780387ff52bfb75d6e7888c4e23ffa0349c0b7a994094' },
  'assets/mengjing/portrait/neutral.webp': { bytes: 80800, sha256: 'a11c6c2395ee5a8047a09d063f53a1dde69f6096b75cd31abe6f36cb43b048ed' },
  'assets/mengjing/portrait/proud.webp': { bytes: 79782, sha256: '9c05da344262149e50f947a6b539589b51a124269ed79c260f3c6f7f6827bf05' },
  'assets/mengjing/portrait/sad.webp': { bytes: 83466, sha256: '6eea32a948b5bf9576bc72e73b8347bdbadd6e09fd9989018161c112c3698512' },
  'assets/mengjing/portrait/serious.webp': { bytes: 83060, sha256: 'ab2a3540f6eb38759af30125d05139fe348624d135b2109fab50cd00aefb08d2' },
  'assets/mengjing/portrait/shy.webp': { bytes: 82956, sha256: '21867cae39cf3b8b3c95523766a6482b6bf20425d7c80e9c0e0759de4c6df1b2' },
  'assets/mengjing/portrait/sleepy.webp': { bytes: 78340, sha256: 'a601cf201b1be9e16ca0bbb6cf61b77ef22dfbe6214c771842c425014f4d66e1' },
  'assets/mengjing/portrait/surprised.webp': { bytes: 84160, sha256: '8bc38889290c9cff775b3a6fdb3020b1aac29f4672894e4caea45909ce5465fe' },
  'assets/mengjing/portrait/thinking.webp': { bytes: 83004, sha256: 'f6dbd6872556fd15b1fa3fd19f84e3c9fbe520b8290bd2456e714435675c4110' },
  'assets/mengjing/avatar.webp': { bytes: 30876, sha256: 'c33471b8f50d0584733a03d9964b8589d79f3d6899f4db2f7720b64d2fcd12e8' },
};

function localSource(path, host) {
  const metadata = LOCAL_ASSET_METADATA[path];
  if (!metadata) throw new Error('本地素材缺少元数据：' + path);
  return { type: 'local', path, ...(host ? { host } : {}), ...metadata };
}

function buildFaceAssets() {
  const otherStyles = FACE_STYLES.filter((style) => style.id !== DEFAULT_FACE_STYLE);
  return emotionsWithArt().map((emotion) => ({
    id: `face-${emotion.id}`,
    kind: 'sprite',
    source: localSource(faceUrlFor(emotion), DEFAULT_FACE_STYLE),
    altSources: otherStyles.map((style) => localSource(faceUrlFor(emotion, style.id), style.id)),
    tags: [emotion.id, ...emotion.aliases],
    preload: 'lazy',
    lifetime: 'chat',
    fallbackAssetId: null,
    provenance: { ...CHARACTER_PROVENANCE },
  }));
}

export const ASSET_MANIFEST = {
  schemaVersion: ASSET_SCHEMA_VERSION,
  workId: 'dreamwhale-vocab',
  assets: [
    ...buildFaceAssets(),
    ...SCENE_ASSETS,
    {
      id: CHARACTER_AVATAR_ID,
      kind: 'sticker',
      source: localSource(CHARACTER_AVATAR_PATH),
      tags: ['梦鲸头像'],
      preload: 'eager',
      lifetime: 'chat',
      fallbackAssetId: null,
      provenance: { ...CHARACTER_PROVENANCE },
    },
  ],
};

export const ASSET_TEMPLATE = {
  id: 'bg-rainy-street',
  kind: 'bg',
  source: { type: 'local', path: 'assets/bg/rainy-street.webp' },
  tags: ['雨', '夜', '街头'],
  preload: 'lazy',
  lifetime: 'chat',
  fallbackAssetId: null,
  provenance: { origin: '待登记来源', license: 'unknown' },
  bytes: null,
  sha256: null,
};

export const STICKER_TAG = 'Sticker';

export function emptyManifest() {
  return { schemaVersion: ASSET_SCHEMA_VERSION, workId: 'dreamwhale-vocab', assets: [] };
}
