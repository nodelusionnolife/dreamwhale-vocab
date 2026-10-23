# 梦鲸词汇 · 题库与资料来源

梦鲸词汇内置四级、六级和混合词库，提供本地词汇练习、听写与情境表达。本页说明题库规模、词汇级别、高频筛选、释义来源及内容再生成方法。

资料核对日期：2026-10-20。题库数量按当前源码统计；资料年份与来源日期不代表真题考频年份。

## 题库范围

| 题库 | 词与表达 | 题目 | 高频词与表达 | 高频题目 |
|---|---:|---:|---:|---:|
| 四级 | 4,378 | 12,096 | 290 | 3,286 |
| 六级 | 1,262 | 4,786 | 188 | 2,487 |
| 混合 | 5,636 | 16,882 | 477 | 5,773 |

混合词库按应用词条去重，因此词数不直接等于四级与六级相加。题目包含语境选择、提示填空、固定搭配、词形变化、易混词、词义辨认、改错、短语、短文理解、情境表达和听音拼写，共 11 种题型。

词义与听写覆盖所收录的大纲主词。全部 477 个高频词均有语境练习，并至少有一种搭配、词形、易混、改错、短语、短文或情境表达专项。已有的 2,855 个「级别＋目标词＋题型」组合，每个至少有两道不同题目；这不表示每个词都具备全部 11 种题型。

短文理解覆盖四级高频词 150/290、六级 101/188；情境表达覆盖四级 226/290、六级 141/188。各题型题量、覆盖词数及公开参考见 [高频专项说明](high-frequency-exercises.md)。

题目为项目自编练习，不是官方真题，也不等同于完整模拟试卷。客观题由本地规则判分；情境表达可由用户配置的模型评价，或离线作答后对照范例。题库尚未完成逐题独立教师审校与难度标定。

## 级别与词形

词汇级别依据中国教育考试网发布的《全国大学英语四、六级考试大纲（2016 年修订版）》。

- [官方考试大纲栏目](https://cet.neea.edu.cn/xhtml1/folder/16113/1588-1.htm)
- [官方 PDF](https://cet.neea.edu.cn/res/Home/1704/55b02330ac17274664f06d9d3db8249d.pdf)
- PDF SHA-256：`9166d3c03b7bc43abd9d9df91bd2ef8085b4419286f1e5ca100dea68f3cfd1f1`

PDF 第 20 页、书内第 15 页说明词表分四级和六级，六级用 ★ 标出。大纲词表不提供词性、释义和读音。提取范围为 PDF 第 21–149 页，每条记录保留 PDF 页码与原始词形；书内页码比 PDF 页码小 5。

### 四级

按 PDF 主词栏的位置提取未标 ★ 的记录，不将右侧派生词混入主词。共 4,114 条主词记录，展开并列拼法和缩略语、合并同形词后为 4,126 个拼法。原始行保存在 `syllabus-primary-rows.json`，词形、页码及词典匹配保存在 `cet4-syllabus-entries.json`。

英美拼法分别可练，保留 a/an、I、TV、according to、ought to 等形式。résumé 与 resume 分列；résumé 的听写也接受不带重音的拼法。应用另含项目扩展词与表达，四级目录共 4,378 条。

### 六级

提取到 1,263 条 ★ 主词记录。aesthetic 与 esthetic/aesthetic 指向同一主词及拼法，合并后为 1,262 条，两个来源页码均保留。六级词库专练大纲标记词，不包含全部四级基础词；混合词库包含两级练习。

括号拼法与英美拼法展开到 `accepts`；右侧派生词不另收为主词。`steward(ess)` 以 steward 为主词，不将 stewardess 当作相同读音的拼写答案。原文 `sober/-re` 的可疑变体保存在 `syllabusForms`，练习只接受 sober。

appropriate、converse、invalid、staple 在大纲中同时有未标记与 ★ 记录。六级条目分别采用拨款/挪用、相反的、久病体弱者、订书钉的词义；练习级别按具体来源记录与义项确定，不仅凭拼写判断。

### 统计口径

提取范围是大纲主词，不逐项展开右侧派生词。官方前言所写的 5,418 词与提取的 5,377 条主词记录（4,114＋1,263）口径不同，差额尚未逐项解释。应用中的拼法数、词条数和题目数各有用途，不能将应用词数直接称为官方大纲词数或宣称覆盖全部派生词。

## 高频筛选

高频范围采用同级别两个渠道共同收录、且能匹配应用词库的词。同站系列文章只算一个渠道，重复词不增加票数。匹配使用小写与明确列出的拼写变体，不猜测词干；同形词的拼写命中不能证明其每个义项都高频。

这些数据是历史备考词表的交集，不是官方真题考频排名，也不能据此认定各渠道使用了独立语料。

| 级别 | 渠道 | 提取的不同拼法 | 收录范围 |
|---|---|---:|---|
| 四级 | [南京大学公开词汇表](https://dafls.nju.edu.cn/_upload/article/files/55/2c/9209ba354046acf4ab8936ba8cb8/e7d4e041-7cb7-4da4-b6c7-b8aa3be48094.pdf) | 1,793 | PDF 第 26–40 页 A / B 级，含高频、学术和次高频词 |
| 四级 | [新东方在线 10 天突破四级高频词汇](https://cet4.koolearn.com/20140630/786400.html) | 570 | 2014 年完整 10 篇，572 条单词记录去重，短语不计作单词 |
| 六级 | [云南农业大学公开 1500 词资料](https://xsc.ynau.edu.cn/media/7/files/102_2022-04-28084239.pdf) | 1,500 | 37 页完整编号词表，原编者与考频年份未注明 |
| 六级 | [新东方在线六级高频词汇 List 1–56](https://cet6.koolearn.com/20190530/827662.html) | 1,551 | 2019 年完整 56 篇，1,698 条规范化记录去重 |

南京大学资料前言写 B 级 1,221 词，实际提取 A 级 570、B 级 1,223，项目保留实际提取数。新东方页面注明资料来源为网络，没有提供真题频次。云南农业大学文件链接目录含日期 2022-04-28，不能据此认定资料编写年份。六级资料中出现的四级基础词仍按官方大纲归类。

四级大纲拼法中 287 个达到标准，另有 3 个项目扩展词命中，共 290 个；六级为 188 个；混合去重为 477 个。

- `frequency-sources.json` 保存材料 URL、下载字节数、SHA-256，以及词语对应的页码或网页链接。
- `frequency-comparison.json` 保存逐词交集与渠道命中记录。
- 应用单词页展示命中渠道；词库导出提供逐词来源与题型覆盖数据。

有道 2010 年四六级表的 Fq 属于查询或教材等指标，不能当作考试出现次数，因此不参与筛选。沪江 500 词资料的下载链接在核对时失效，扫描版《新东方 26 天四级高频词汇》未取得可核验的完整文字，两者也未计入。项目仅保存比对所需的词语与来源事实，不复制这些渠道的释义、例句或商业题目。

## 释义与许可

中文释义采用社区词典 [ECDICT](https://github.com/skywind3000/ECDICT) 的 `ecdict.csv`，按大纲词条匹配，再结合项目校订文件生成练习释义。ECDICT 不作为四级、六级的级别依据。仓库保留 [ECDICT MIT 许可全文](ECDICT-LICENSE.txt)，应用来源面板同样包含该许可。

| 项目 | 记录 |
|---|---|
| 数据文件 | [ecdict.csv](https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv) |
| 下载日期 | 2026-10-20 |
| 文件大小 | 65,933,428 字节 |
| SHA-256 | `1a6947e04785db63613a92e14903cdae7954f7e84860b10e68e5c7cbb3f9c3cf` |

数据以下载日期和文件哈希定位；GitHub 提交未核实，不能声称已固定到某个提交。

`cet6-entries.json` 保留匹配到的原始释义与大纲页码。`cet6-overrides.txt` 校订 153 条，涉及不适合作为首义的释义、明显误义与同形异义词。cliché 未在该份词典中匹配，由项目补充常见义。生成时统一词性标记，取首个释义行最多三项用于题目。

四级使用同一词典与 `cet4-overrides.txt` 中的常用义校订，例如 china 的瓷器义、stale 的形容词义、weekday 的工作日义；少数未匹配词由项目补充。[tan](https://dictionary.cambridge.org/dictionary/english/tan)、[afloat](https://dictionary.cambridge.org/dictionary/english/afloat)、[random](https://dictionary.cambridge.org/dictionary/english/random) 的常见词义或词性另与剑桥词典核对，未复制其英文释义或例句。

练习释义不是完整词典。项目尚未逐词完成独立词典交叉审校，自动数据检查不能替代词义审校。

## 内容文件

| 路径 | 内容 |
|---|---|
| `syllabus-primary-rows.json` | 大纲主词栏原始记录 |
| `cet4-syllabus-entries.json`、`cet6-entries.json` | 词形、来源页码及词典匹配 |
| `cet4-overrides.txt`、`cet6-overrides.txt` | 项目释义校订 |
| `frequency-sources.json`、`frequency-comparison.json` | 高频渠道事实与逐词比对 |
| `../src/content/cet4-syllabus-questions.js` | 四级大纲词练习 |
| `../src/content/cet6-words.js`、`cet6-questions.js` | 六级词条、许可及练习数据 |
| `../src/content/cet6-contexts.js`、`cet6-focus.js` | 六级语境与专项练习 |
| `../src/content/high-frequency-*.js` | 高频语境、专项与题目覆盖数据 |
| `../src/content/question-metadata.js` | 题目技能与难度信息 |

## 再生成与导出

应用运行不需要 PDF、CSV、Python 或另行下载词库。以下流程供维护内容时使用，不影响日常离线练习。

先将与记录哈希相同的大纲 PDF、ECDICT CSV，以及 `frequency-sources.json` 的 `documents` 所列材料，放入 `preview.local/cet-sources/` 对应路径。四级 PDF 提取需要 Python 的 `pdfplumber`，六级与高频 PDF 提取需要 `pypdf`。高频提取脚本校验来源哈希，材料变化时不会静默替换。

```bash
python tools/extract-cet4-syllabus.py --pdf preview.local/cet-sources/cet-syllabus-2016.pdf --dictionary preview.local/cet-sources/ecdict.csv
python tools/extract-cet6.py --pdf preview.local/cet-sources/cet-syllabus-2016.pdf --dictionary preview.local/cet-sources/ecdict.csv
```

六级提取结果写入 `preview.local/cet-sources/cet6-extracted.json`，核对后用于维护 `content-sources/cet6-entries.json`。词形与释义完成核对后，生成应用数据并检查：

```bash
node tools/build-cet4-syllabus.mjs
node tools/build-cet6.mjs
python tools/extract-frequency.py
node tools/build-frequency.mjs
npm test
node tools/export-wordbanks.mjs dist/wordbanks
```

仅调整释义时，可编辑对应校订文件并运行该级生成脚本。调整词形、接受拼法或来源时，需要同步生成高频匹配数据，并核对统计与导出结果。下载缓存不参与应用运行和源码发布。

导出的题库 JSON 属于内容数据；「学习记录导入」接受的是学习备份，不能用来导入题库。听音练习使用系统语音，实际离线朗读取决于设备已安装的英语声音；在线聊天与在线语音服务另行配置。
