// 零依赖 mock 模型服务，仅用于离线端到端自测，不参与生产。
// 运行：node tests/mock-model.mjs [端口]
//
// 抽词已改由代码从四级词库执行（src/engine/wordbank.js），mock 不再负责抽词。
// 它从用户消息里解析本轮目标词，再用「提交词是否等于目标词之一」来模拟判定。

import http from 'node:http';

const port = Number(process.argv[2] || 5199);

const SCENE_TEXT = `下午三点十七分，会议室的白板还留着上一场会的字迹。我抱着笔记本站在门口，看见自己的名字被写在任务清单第一行，后面跟着的项目代号我连听都没听过。
老陈从背后拍了我一下，说这个活是我主动接的，群里已经通知了。我愣了一下，摸出手机翻聊天记录——那条消息不是我发的，语气却模仿得和我一模一样，连我习惯用的那个语气词都没落下。
周围的同事都在低头看屏幕，没有人抬头，也没有人否认。空调的风从头顶吹下来，把白板边角的一张便签吹得哗哗响。我忽然明白这不是误会：有人需要一个承担后果的名字，而我的名字最便宜、最好用。
窗外天阴着，云压得很低。我数了数在场的人，七个，其中三个刚才还在群里给那条消息点了赞。空气里有一种被安排好的安静，仿佛所有人都在等我点头，好把这件事彻底钉死。
我攥着笔记本的边缘，指节发白。现在开口就算认，不开口就算默认。我要做的不是解释清楚——解释在这里没有用——而是让这间屋子里的空气先停下来，让那个把名字推给我的人先沉不住气。`;

const NARRATIVE_OK = `我把笔记本合上一半，指尖压住封面，先让自己慢下来。我开口的时候声音不高，只把那条消息的发送时间、我的在岗记录和这份任务的交接链条一件件摆出来，没有人插话。
老陈的笑僵在脸上，他大概没想到我会当场把时间线摊平。我说我可以在群里补一条说明，把这件事的来龙去脉写清楚，谁接的、什么时候接的、依据是什么，一条不落。我说这话时手是稳的，语气里没有火气，也不带求人的意思——我只是把该在哪一步定下来的东西，重新放回它该在的位置上。会议室里那股被安排好的安静散了，有人开始低头翻自己的记录。`;

const NARRATIVE_FAIL = `我张了张嘴，说出口的那句话轻飘飘地落在桌面上了。它跟眼前这件事根本不在一个世界里——我说的是一个和温度、和体贴有关的词，而这里要的是把责任退回去的力气。话一出口，老陈立刻笑了，说这不就对了嘛，看你也没意见。
周围的空气重新合拢，比刚才更紧。我意识到自己刚才那一下不但没把名字从清单上摘下来，反而替它按了个手印。窗外还是那片压得很低的云，而我已经失去了这一轮里最宝贵的东西：先开口的那个位置。`;

/** 从「本轮两个目标词：cope（v.，应付）、brace（v.，稳住）」里取出两个词。 */
function wordsFromSceneMessage(user) {
  const m = user.match(/本轮两个目标词：([^\n]+)/);
  if (!m) return [];
  return [...m[1].matchAll(/([a-z]+)（/g)].map((x) => x[1]);
}

/** 从「本轮目标词（仅供参考，不是唯一答案）：cope、brace」里取出两个词。 */
function wordsFromJudgeMessage(user) {
  const m = user.match(/本轮目标词（[^）]*）：([^\n]+)/);
  if (!m) return [];
  return m[1].split('、').map((s) => s.trim()).filter(Boolean);
}

function sceneFor(words) {
  return {
    plan: '会议室下午，同事把锅推给我，冲突焦点是这个名字谁认',
    mode: '应对',
    shell: '日常',
    meme: '劳务派遣',
    scene: SCENE_TEXT,
    objective: '稳住局面，不被带偏',
    why_fits: `${words[0] || '第一个词'} 与 ${words[1] || '第二个词'} 都能回应当前处境`,
  };
}

// 模拟「正确答案能过、别的不能过」：提交词必须是本轮两个目标词之一
function judgeFor(word, targets) {
  const pass = targets.includes(word);
  return {
    passed: pass,
    word,
    is_real_word: pass,
    in_scope: pass,
    semantic_fit: pass ? 'pass' : 'fail',
    narrative: pass ? NARRATIVE_OK : NARRATIVE_FAIL,
    reason: pass ? '词义贴合当前处境' : '该词无法回应当前挑战',
    feedback: pass ? '你稳住了局面，对方接不上话。' : '方向不对，再想想怎么镇住场子。',
    word_meaning: pass ? '稳住、使镇定；常用于稳定情绪或局势' : '（该词不适用于本挑战）',
  };
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
};

/** 对话模式的假回复：四类标记齐全 + 表情标签；若用户消息里夹了题，就原样回显。 */
function chatReply(lastUserContent) {
  const m = String(lastUserContent || '').match(/<Question>([\s\S]*?)<\/Question>/);
  if (m) {
    return '[她从抽屉里摸出一张折好的小纸条]<Face>兴奋</Face>(鲸鱼娘把纸条推到你面前，指尖敲了敲纸边)【这道题不难，看他能不能答上来】“来，先做这个。”\n\n'
      + `<Question>${m[1]}</Question>`;
  }
  return '[窗外的雨声一直没停]<Face>温柔</Face>(鲸鱼娘把下巴搁在桌沿上看着你)【他今天怎么这么安静】“然后呢？你继续说。”';
}

http
  .createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors).end();
      return;
    }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let system = '';
      let user = '';
      let lastUser = '';
      let msgCount = 0;
      let prefill = '';
      try {
        const parsed = JSON.parse(body);
        msgCount = parsed?.messages?.length || 0;
        system = parsed?.messages?.[0]?.content || '';
        user = parsed?.messages?.[1]?.content || '';
        prefill = parsed?.messages?.[2]?.content || '';
        const users = (parsed?.messages || []).filter((m) => m.role === 'user');
        lastUser = users.length ? users[users.length - 1].content : '';
      } catch { /* ignore */ }

      let payload;
      let chatText = '';
      if (system.includes('你是鲸鱼娘')) {
        chatText = chatReply(lastUser);
      } else if (system.includes('场景出题器')) {
        payload = sceneFor(wordsFromSceneMessage(user));
      } else if (system.includes('裁判')) {
        const m = user.match(/玩家提交的单词：(\S+)/);
        payload = judgeFor((m?.[1] || '').toLowerCase(), wordsFromJudgeMessage(user));
      } else if (system.includes('只返回 JSON')) {
        payload = { ok: true, hello: 'world' };
      } else {
        payload = { error: 'mock 无法识别 system' };
      }

      const content = chatText || JSON.stringify(payload);
      // 假用量：模拟前缀缓存——轮数越多，可复用的前缀越长
      const promptTokens = 900 + msgCount * 37 + system.length;
      const completionTokens = Math.round(content.length / 1.6);
      const cacheHit = msgCount > 1 ? Math.round((promptTokens - 300) * 0.8) : 0;
      const out = JSON.stringify({
        choices: [{ message: { role: 'assistant', content } }],
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens,
          prompt_cache_hit_tokens: cacheHit,
          prompt_cache_miss_tokens: promptTokens - cacheHit,
        },
      });
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
      res.end(out);
      const brief = chatText
        ? (lastUser.includes('<Question>') ? '对话回复（含题）' : '对话回复')
        : String(payload.why_fits || payload.word || '');
      console.log(`mock ← ${system.slice(0, 10)}… msgs=${msgCount} tok=${promptTokens}(+${cacheHit}缓存)+${completionTokens} → ${brief.slice(0, 24)}`);
    });
  })
  .listen(port, () => console.log(`mock 模型服务： http://127.0.0.1:${port}/v1/chat/completions`));
