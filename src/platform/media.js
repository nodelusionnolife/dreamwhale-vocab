// 本地媒体地址解析。这是「本地文件的路径」变成「浏览器能取的地址」的唯一入口。
//
// 为什么需要它：多文件版里 assets/face/happy.jpg 是个相对路径，浏览器直接就能取；
// 但单文件版没有同级目录，必须换成内联的 data URL。
//
// 早先的做法是打包器在源码文本里找 'assets/...' 字面量替换——那对**运行时拼出来的路径无效**
// （路径由 slug 拼成模板字符串，源码里根本没有那个字面量），结果表情一张都没内联进去，
// 而打包器的统计还显示"已内联 12 个"。所以改成运行时查表：
//   - 多文件版：__wbAssets 不存在 → 原样返回相对路径
//   - 单文件版：打包器注入 __wbAssets 映射 → 返回 data URL
export function localMediaUrl(path) {
  if (!path) return '';
  const key = String(path);
  const map = globalThis.__wbAssets;
  return (map && map[key]) || key;
}

/**
 * 单文件版是否已注入媒体映射。测试与自检用。
 * @returns {number} 映射条数；0 表示当前是「按相对路径取图」的模式
 */
export function localMediaCount() {
  const map = globalThis.__wbAssets;
  return map ? Object.keys(map).length : 0;
}
