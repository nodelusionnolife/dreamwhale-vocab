// 资产清单（图片 / 表情包 / 立绘 / 背景）的唯一事实来源。
//
// 设计约束（对着本项目的实际情况来，不是通用模板）：
//   1. 图片数据绝不进消息、绝不进 localStorage。消息里只存「键」。
//      iNeed 沙箱的 localStorage 垫片约 1MB，一张 base64 图就能撑爆。
//      所以图走文件或远端 URL，清单只负责把键映射到地址。
//   2. 清单是代码资产，随构建发布，不随玩家存档走。
//   3. 每条资产必须记来源与授权。本作素材为驾驶员自绘，但清单里仍逐条登记——
//      一旦将来引入第三方素材，来源与授权是事后唯一能追溯的依据。
//      缺授权不阻断开发，但会被校验器标为警告。
//
// 清单形状对齐资料库的 media-manifest-contract（sillytavern-media-live2d-runtime）：
//   { id, kind, source:{type,path}, bytes, sha256, preload, lifetime, fallbackAssetId }
//   另加本项目需要的 tags 与 provenance。

/** 三类渲染面。背景与立绘走场景 JSON 的结构化通道；表情包走正文内联标签。 */
export const ASSET_KINDS = ['bg', 'sprite', 'sticker'];

/** 预载时机。eager = 进游戏就取；lazy = 用到前一批取；on-demand = 用到才取。 */
export const PRELOAD_POLICIES = ['eager', 'lazy', 'on-demand'];

/** 生命周期。chat = 整场有效；message = 只在那条消息里有效。 */
export const LIFETIMES = ['chat', 'message'];

import { emotionsWithArt, faceUrlFor, FACE_HOSTS, DEFAULT_FACE_HOST } from './emotions.js';

export const ASSET_SCHEMA_VERSION = 1;

/**
 * 立绘条目从表情表派生，保证「标准标签」只有一个事实来源。
 * 补一张新立绘 = 在 emotions.js 里给那条加 hosts，这里自动跟进，提示词也自动跟进。
 *
 * 每张图登记两个图床地址：source 是默认图床，altSources 是备用。
 * 切换只换取图地址、不换图——两张是同一张立绘。
 * **图不进仓库**：这个作品本来就要联网调模型，表情本地化并不能让它离线可用。
 *
 * 注意：这里**故意不设默认立绘**。挑任何一张当默认都会让「没指定情绪」的时刻
 * 偏向那个情绪。等将来真有中性到能当底图的那张，再把它标成 isDefault: true。
 */
function buildFaceAssets() {
  const others = FACE_HOSTS.map((h) => h.id).filter((id) => id !== DEFAULT_FACE_HOST);
  return emotionsWithArt().map((e) => ({
    id: `face-${e.id}`,
    kind: 'sprite',
    source: { type: 'remote', path: faceUrlFor(e, DEFAULT_FACE_HOST), host: DEFAULT_FACE_HOST },
    altSources: others
      .map((h) => ({ type: 'remote', path: faceUrlFor(e, h), host: h }))
      .filter((s) => s.path),
    // 标准标签 + 全部别名都进 tags：模型写近义词也能解析到同一张图
    tags: [e.id, ...e.aliases],
    preload: 'lazy',
    lifetime: 'chat',
    fallbackAssetId: null,
    provenance: {
      origin: '本作角色表情（驾驶员自绘，托管在自有图床）',
      license: '本作素材',
    },
  }));
}

/**
 * 对话背景。这是 `bg` 渲染面里唯一的条目，所以它自动成为该类默认项
 * （kindDefault：该类只有一条时就是它）——不额外标 isDefault，避免两处说法。
 *
 * 走本地文件而不是远端：背景是整场都在的底图，第三方免费图床挂了整页就空一块。
 * 单文件产物里由打包器把路径换成内联 data URL，见 tools/build-single-html.mjs。
 *
 * bytes / sha256 是真算出来的（282,454 字节），换图必须同步更新，测试会核。
 */
function buildBgAssets() {
  return [{
    id: 'bg-chat-room',
    kind: 'bg',
    source: { type: 'local', path: 'assets/bg/chat-room.jpg' },
    tags: ['房间', '日常', '鲸'],
    preload: 'eager',
    lifetime: 'chat',
    fallbackAssetId: null,
    bytes: 282454,
    sha256: '4e147ef748e6902dc20d1052d678b5a1376d9ec6b9878514017628d031c54230',
    provenance: {
      origin: '本作对话背景（驾驶员自绘）',
      license: '本作素材',
    },
  }];
}

/**
 * 清单本体。
 * 立绘与背景都由上面的函数派生；表情包（sticker）仍是空的，加条目时照抄 ASSET_TEMPLATE。
 */
export const ASSET_MANIFEST = {
  schemaVersion: ASSET_SCHEMA_VERSION,
  workId: 'dreamwhale-vocab',
  assets: [...buildFaceAssets(), ...buildBgAssets()],
};

/** 对话背景在清单里的 id。界面与测试都用这个常量，不写死字符串。 */
export const CHAT_BG_ID = 'bg-chat-room';

/** 单条资产的完整形状，照抄改值即可。 */
export const ASSET_TEMPLATE = {
  id: 'bg-rainy-street',
  kind: 'bg',
  source: { type: 'local', path: 'assets/bg/rainy-street.webp' },
  tags: ['雨', '夜', '街头'],
  preload: 'lazy',
  lifetime: 'chat',
  fallbackAssetId: null,
  provenance: { origin: '自绘 / 或写清来源', license: '写清授权，未确认就填 unknown' },
  // 本地资产可声明以下两项，校验器会核；远端资产可留空
  bytes: null,
  sha256: null,
};

/** 内联表情包的标签语法。与 <Question> 平行，便于同一个渲染器切分。 */
export const STICKER_TAG = 'Sticker';

/** 空清单，供测试与「先跑通再加图」的场景使用。 */
export function emptyManifest() {
  return { schemaVersion: ASSET_SCHEMA_VERSION, workId: 'dreamwhale-vocab', assets: [] };
}
