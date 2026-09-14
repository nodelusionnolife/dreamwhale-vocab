// 游戏难度参数。全部由代码控制，不交给模型判断。
// 驾驶员可直接改这里的数字，改完刷新页面即生效。
//
// 字段含义：
//   failureLimit        一局内允许的失败次数上限；null 表示无限
//   wildcardStart       开局持有的万能词数量；null 表示无限
//   wildcardGrantEvery  每成功通过这么多次，发放一个万能词；null 表示不发放
//
// 注意：这是「游戏难度」，与词汇档位（基础 / 进阶，由 AI 抽词时使用）是两条独立的轴。

export const DIFFICULTIES = [
  {
    id: 'baby',
    label: '宝宝',
    failureLimit: null,
    wildcardStart: null,
    wildcardGrantEvery: null,
    note: '无限失败、无限万能词，纯练习',
  },
  {
    id: 'easy',
    label: '简单',
    failureLimit: null,
    wildcardStart: 5,
    wildcardGrantEvery: 2,
    note: '无限失败；每通过 2 次奖励 1 个万能词，开局 5 个',
  },
  {
    id: 'normal',
    label: '普通',
    failureLimit: 25,
    wildcardStart: 3,
    wildcardGrantEvery: 3,
    note: '最多失败 25 次；每通过 3 次奖励 1 个万能词，开局 3 个',
  },
  {
    id: 'hard',
    label: '困难',
    failureLimit: 12,
    wildcardStart: 1,
    wildcardGrantEvery: 5,
    note: '最多失败 12 次；每通过 5 次奖励 1 个万能词，开局 1 个',
  },
  {
    id: 'hell',
    label: '地狱',
    failureLimit: 5,
    wildcardStart: 0,
    wildcardGrantEvery: 10,
    note: '最多失败 5 次；每通过 10 次奖励 1 个万能词，开局 0 个',
  },
];

export const DEFAULT_DIFFICULTY = 'normal';

export function getDifficulty(id) {
  return DIFFICULTIES.find((d) => d.id === id) || DIFFICULTIES.find((d) => d.id === DEFAULT_DIFFICULTY);
}
