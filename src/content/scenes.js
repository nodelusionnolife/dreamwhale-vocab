export const SCENE_PATHS = {
  dawn: 'assets/scenes/cg-dawn-room.webp',
  dusk: 'assets/scenes/cg-dusk-room.webp',
  day: 'assets/scenes/cg-day-library.webp',
  night: 'assets/scenes/cg-night-room.webp',
  library: 'assets/scenes/anchor-library.webp',
  practice: 'assets/scenes/anchor-practice.webp',
  mistakes: 'assets/scenes/anchor-mistakes.webp',
};

const entries = [
  ['cg-dawn-room', 'bg', 'dawn', 129174, '26feb69086961d89512a2d5b014963642756b13eac8b4fa07bb3d716dbc9e005', ['海边书房', '清晨']],
  ['cg-dusk-room', 'bg', 'dusk', 140136, '6a617bb230a7e4491376aac0f5a8c9118eb9c87f8c684b41cdf756ad59ac131a', ['海边书房', '黄昏']],
  ['cg-day-library', 'bg', 'day', 121660, '5cbacffee02db316b33c230f43fd1c83efb1c2f66193ac86e9c32e0e5a18ce1b', ['海边书房', '白昼']],
  ['cg-night-room', 'bg', 'night', 99842, '195c57605ec0f51006e99e82c19e392c74087603e77e66f05eb8efc4a36dc650', ['海边书房', '月夜']],
  ['anchor-library', 'sticker', 'library', 253034, '2f823eacce95277c03d2d6cb401d1fcb4976b1b0d6b27bf7d705c165dbced77f', ['词库', '书本']],
  ['anchor-practice', 'sticker', 'practice', 242656, '870eb1bea96d2618f4303a225ad503afccf556b7471d085c8571930140209f29', ['练习', '罗盘']],
  ['anchor-mistakes', 'sticker', 'mistakes', 115374, '97aa9dcc85546238030899ccf4d2da24d7dad783eb94362aeb3c58ef876b2027', ['错题集', '笔记本']],
];

export const SCENE_ASSETS = entries.map(([id, kind, key, bytes, sha256, tags]) => ({
  id, kind, source: { type: 'local', path: SCENE_PATHS[key], bytes, sha256 }, tags,
  preload: key === 'day' ? 'eager' : 'lazy', lifetime: 'chat', fallbackAssetId: null,
  provenance: { origin: '按用户要求使用内置 image_gen 生成；提示词见 assets/scenes/prompts.json', license: '为梦鲸词汇项目生成并随项目提供的 AI 图像' },
}));
