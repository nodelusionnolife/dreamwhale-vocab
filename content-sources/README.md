# 四六级词库与高频来源

核对日期：2026-10-20。

## 级别与词形

采用中国教育考试网「考试大纲」栏目当前链接的《全国大学英语四、六级考试大纲（2016年修订版）》：

- [官方栏目](https://cet.neea.edu.cn/xhtml1/folder/16113/1588-1.htm)
- [官方 PDF](https://cet.neea.edu.cn/res/Home/1704/55b02330ac17274664f06d9d3db8249d.pdf)
- SHA-256：`9166d3c03b7bc43abd9d9df91bd2ef8085b4419286f1e5ca100dea68f3cfd1f1`

PDF 第 20 页、书内第 15 页说明词表分四级和六级，六级用 ★ 标出，词表不提供词性、释义和读音。提取范围为 PDF 第 21–149 页，保留每条的 PDF 页码及原始词形；书内页码比 PDF 页码小 5。

共提取 1,263 条 ★ 主词记录。aesthetic 与 esthetic/aesthetic 指向同一主词及拼法，合并后为 1,262 条，两个来源页码均保留。括号拼法和英美拼法展开到 `accepts`；右侧派生词不另收为主词。`steward(ess)` 以 steward 为主词，不将 stewardess 当作相同读音的拼写答案。原文 `sober/-re` 的可疑变体保留在 `syllabusForms`，练习只接受 sober。

四个同形词在大纲同时有未标记与 ★ 记录：appropriate、converse、invalid、staple。新题分别使用拨款/挪用、相反的、久病体弱者、订书钉的词义。旧题继续保留原身份和词义，不按这四个单词的拼写一概升为六级。

六级选择专练大纲标记词，不包含全部四级基础词；混合包含四级与六级练习。

0.6.0 按 PDF 主词栏的位置重新提取未标 ★ 的四级记录，防止把右侧派生词混入。得到 4,114 条未标记主词记录，展开并列拼法和缩略语、合并同形词后得到 4,126 个拼法；原始行在 `syllabus-primary-rows.json`，词形、页码及词典匹配在 `cet4-syllabus-entries.json`。英美拼法分别可练，保留 a/an、I、TV、according to、ought to 等形式。四级 résumé 和 resume 分列；听写接受 résumé 的不带重音拼法。

这里补齐的是提取出的大纲主词范围，不逐项展开右侧派生词。官方前言所写的 5,418 词与本次 5,377 条主词记录（4,114 + 1,263）不是同一统计口径，尚未逐项解释该总数差额；不把应用拼法数宣称为官方词数。原有扩展题保留，因此四级应用目录实际为 4,378 个词与表达。

## 高频比对

采用同级别两个渠道共同收录的词，并与应用题库匹配。同一系列几十篇文章只算一个渠道，重复词不增加票数。按小写和明确列出的拼写变体匹配，不做词干猜测；同形词只说明拼写出现，不能证明其具体义项高频。这些是历史备考词表的交集，不是官方真题考频排名，也不代表各渠道用了独立语料。

| 级别 | 渠道 | 实际提取的不同拼法 | 收录范围 |
|---|---|---:|---|
| 四级 | [南京大学公开词汇表](https://dafls.nju.edu.cn/_upload/article/files/55/2c/9209ba354046acf4ab8936ba8cb8/e7d4e041-7cb7-4da4-b6c7-b8aa3be48094.pdf) | 1,793 | PDF 第 26–40 页 A / B 级，含高频、学术和次高频词 |
| 四级 | [新东方在线 10 天突破四级高频词汇](https://cet4.koolearn.com/20140630/786400.html) | 570 | 2014 年完整 10 篇；572 条单词记录去重，短语不冒充单词 |
| 六级 | [云南农业大学公开 1500 词资料](https://xsc.ynau.edu.cn/media/7/files/102_2022-04-28084239.pdf) | 1,500 | 37 页完整编号词表，原编者与考频年份未注明 |
| 六级 | [新东方在线六级高频词汇 List 1–56](https://cet6.koolearn.com/20190530/827662.html) | 1,551 | 2019 年完整 56 篇；1,698 条规范化记录去重 |

南京大学资料前言写 B 级 1,221 词，实际主词提取为 A 级 570、B 级 1,223；保留实际提取数。新东方页面注明资料来源为网络，未提供真题频次；云南农业大学文件链接目录日期为 2022-04-28，不能据此认定资料编写年份。六级资料也列了许多四级基础词，级别以官方大纲标记为准，不把它们重新归入六级。

四级大纲拼法中 287 个达到标准，另有 3 个原有扩展词命中，共 290 个；六级 188 个；混合去重为 477 个。原始来源事实在 `frequency-sources.json`，含每份材料 URL、下载字节数、SHA-256 和每个词的页码或网页链接；逐词交集在 `frequency-comparison.json`。发布目录另有包括旧扩展词的 CSV 对照表，应用单词页可查看命中渠道。

另检查了有道 2010 年四六级表，但其中 Fq 来自查询或教材等指标，不是考试出现次数，未用于筛选；沪江的 500 词下载链接失效，无法读取全文，未计入；扫描版《新东方 26 天四级高频词汇》未取得可核验的完整文字，也未计入。本项目不复制这些渠道的释义、例句或商业题目，只保存用于比对的单词与来源事实。

## 释义

采用 [ECDICT](https://github.com/skywind3000/ECDICT) 的 `ecdict.csv`，按官方词条匹配。ECDICT 是社区词典，不能替代官方大纲作为级别依据。保留 [MIT 许可全文](ECDICT-LICENSE.txt)，应用来源面板亦包含许可全文。

- 数据地址：`https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv`
- 下载日期：2026-10-20。
- 文件大小：65,933,428 字节。
- SHA-256：`1a6947e04785db63613a92e14903cdae7954f7e84860b10e68e5c7cbb3f9c3cf`
- GitHub 提交查询未成功，因此以下载日期和文件哈希定位本次数据，不声称已固定到某个提交。

`cet6-entries.json` 保留匹配到的原始释义及大纲页码。`cet6-overrides.txt` 校订 153 条，包含过时或不适合作为首义的释义、明显误义和同形异义词；cliché 在下载的词典中没有匹配，使用本项目补充的常见义。生成时统一词性标记，取首个释义行最多三项用于题目。没有逐词提供完整词典的全部义项，也未声称所有词义经独立词典交叉复核。

四级同样使用该词典与 `cet4-overrides.txt` 中的常用义校订，例如 china 的瓷器义、stale 的形容词义、weekday 的工作日义。少数没有匹配的词由项目补充。自动数据检查不等于逐词人工词典审校。

补充核查：[tan](https://dictionary.cambridge.org/dictionary/english/tan)、[afloat](https://dictionary.cambridge.org/dictionary/english/afloat)、[random](https://dictionary.cambridge.org/dictionary/english/random) 的常见词义或词性另与剑桥词典核对。未复制其英文释义或例句。

## 题目与再生成

每个六级词新增词义辨认、听音拼写各一题。36 个词另编两个语境填空及一个语境选择，七类专项各另编两题，合计新增 2,646 题。所有语境和题目为项目自编，没有复制官方样卷或其他商业软件题目。准确拼写与客观选择在本地判分；情境表达继续由用户配置的模型评价。

来源事实、释义和题目分别保存在：

- `cet6-entries.json`：官方词形、页码与匹配的词典释义。
- `cet6-overrides.txt`：简明释义校订。
- `../src/content/cet6-words.js`：应用使用的生成数据和许可。
- `../src/content/cet6-contexts.js`：自编语境与专项题。
- `../src/content/cet6-questions.js`：稳定题号、选项及判分数据。

维护者下载相同哈希的 PDF 和 CSV 后，使用安装了 pypdf 的 Python 运行：

```text
python tools/extract-cet6.py --pdf preview.local/cet-sources/cet-syllabus-2016.pdf --dictionary preview.local/cet-sources/ecdict.csv
```

提取结果写入 `preview.local/cet-sources/cet6-extracted.json`；核对后更新 `content-sources/cet6-entries.json`。仅修改释义时，编辑校订文件再执行：

```text
node tools/build-cet6.mjs
npm test
```

应用运行不需要 PDF、CSV、Python、网络或下载词库。听音沿用系统语音，实际离线能力取决于系统已安装的英语语音；在线聊天语音服务不参与单词练习。

## 0.6.0 题目与复现

当前高频专项的原创题、公开参考和各题型覆盖情况见 [四六级高频专项题](high-frequency-exercises.md)。以下保留初始词表补全时的数量与再生成步骤。

四级新增 8,252 道词义与听写题，每个大纲拼法各两题；保留原 1,220 题。六级新增 213 道重点题：64 个交叉命中词各两道语境填空和一道选择，共 192 题；搭配、短语、词形、易混、改错、阅读、表达七类各三题。它们由项目编写，不是真题。运行时四级 9,472 题，六级 2,915 题，混合 12,387 题；高频分别为 662、616、1,278 题。语境和专项覆盖部分词，词义及听写覆盖大纲主词。

四级再生成需要 pdfplumber；高频 PDF 提取需要 pypdf。按 `frequency-sources.json` 的 documents 下载文件到 `preview.local/cet-sources/` 的同名位置，提取脚本会校验 SHA-256，网页变化时拒绝静默替换。下载缓存不参与运行与发布。

```text
python tools/extract-cet4-syllabus.py --pdf preview.local/cet-sources/cet-syllabus-2016.pdf --dictionary preview.local/cet-sources/ecdict.csv
node tools/build-cet4-syllabus.mjs
python tools/extract-frequency.py
node tools/build-frequency.mjs
npm test
node tools/export-wordbanks.mjs dist/releases/0.6.0
```

`cet4-syllabus-questions.js` 与 `cet6-focus.js` 为新增题目入口。完整题库 JSON 是内容数据，学习记录导入按钮只接受学习备份，不接受题库 JSON。复现来源提取已验证字节一致；后续修改题词、接受拼法或来源后，应重建频率文件、检查范围统计再导出。
