import http from 'node:http';

const port = Number(process.argv[2] || 5199);
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST,OPTIONS' };

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, cors).end(); return; }
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    try {
      const request = JSON.parse(body);
      const path = new URL(req.url,'http://localhost').pathname;
      const format = path.endsWith('/responses') ? 'responses' : path.endsWith('/messages') ? 'anthropic' : /:(?:streamGenerateContent|generateContent)$/.test(path) ? 'gemini' : 'chat';
      const messages = request.messages || request.input || request.contents || [];
      if (!Array.isArray(messages) || !messages.length || (format==='anthropic' && !request.max_tokens)) throw new Error('Invalid messages');
      const system = request.instructions || request.system || request.systemInstruction?.parts?.map(p=>p.text).join('') || messages.find(m=>m.role==='system')?.content || '';
      const last = messages.findLast(m=>m.role==='user');
      const user = last?.content || last?.parts?.map(p=>p.text).join('') || '';
      let content;
      if (system.includes('你是梦鲸')) {
        const question = user.match(/<Question>([\s\S]*?)<\/Question>/);
        content = '[窗外的雨轻轻敲着玻璃]<Face>温柔</Face>(梦鲸把笔记本推到你面前)“今天遇到什么有意思的事了？慢慢说，我听着。”'
          + (question ? `\n<Question>${question[1]}</Question>` : '')
          + '\n<TurnSummary>用户正在分享今天的生活，梦鲸邀请继续交流，并鼓励完成身边的小练习。</TurnSummary>';
      } else if (system.includes('英语练习评阅者')) {
        const answer = JSON.parse(user).submission || '';
        const status = answer.includes('uncertain') ? 'uncertain' : /available|although|recommend/i.test(answer) ? 'correct' : 'incorrect';
        content = JSON.stringify({ status, explanation: status === 'correct' ? '本地测试评阅已通过。' : status === 'uncertain' ? '本地测试返回不确定结果。' : '本地测试未匹配目标词，请重试。' });
      } else content = JSON.stringify({ ok: true, message: '本地测试连接成功' });
      const usage={prompt_tokens:1000,completion_tokens:100,total_tokens:1100};
      const nativeUsage={input_tokens:1000,output_tokens:100,total_tokens:1100};
      const geminiUsage={promptTokenCount:1000,candidatesTokenCount:100,totalTokenCount:1100};
      const full = format==='responses' ? {id:'local-response',status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:content}]}],usage:nativeUsage}
        : format==='anthropic' ? {id:'local-message',type:'message',content:[{type:'text',text:content}],stop_reason:'end_turn',usage:nativeUsage}
        : format==='gemini' ? {candidates:[{content:{role:'model',parts:[{text:content}]},finishReason:'STOP'}],usageMetadata:geminiUsage}
        : {choices:[{message:{role:'assistant',content},finish_reason:'stop'}],usage};
      if (request.stream || path.endsWith(':streamGenerateContent')) {
        res.writeHead(200, { ...cors, 'Content-Type':'text/event-stream' });
        const send = payload => res.write(`${payload.type?`event: ${payload.type}\n`:''}data: ${JSON.stringify(payload)}\n\n`);
        if(format==='anthropic') {send({type:'message_start',message:{usage:{input_tokens:1000,output_tokens:0}}});send({type:'content_block_start',index:0,content_block:{type:'text',text:''}});}
        let at=0;
        const timer=setInterval(()=>{
          if(at<content.length){
            const delta=content.slice(at,at+8);at+=8;
            send(format==='responses'?{type:'response.output_text.delta',delta}:format==='anthropic'?{type:'content_block_delta',index:0,delta:{type:'text_delta',text:delta}}:format==='gemini'?{candidates:[{content:{parts:[{text:delta}]}}]}:{choices:[{delta:{content:delta}}]});
          } else {
            clearInterval(timer);
            if(format==='responses')send({type:'response.completed',response:full});
            else if(format==='anthropic'){send({type:'content_block_stop',index:0});send({type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:100}});send({type:'message_stop'});}
            else if(format==='gemini')send({candidates:[{finishReason:'STOP'}],usageMetadata:geminiUsage});
            else {send({choices:[{delta:{},finish_reason:'stop'}],usage});res.write('data: [DONE]\n\n');}
            res.end();
          }
        },user.includes('停止测试')?500:15);
        res.on('close',()=>clearInterval(timer));
        return;
      }
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }).end(JSON.stringify(full));
    } catch { res.writeHead(400, cors).end('Invalid request'); }
  });
}).listen(port, '127.0.0.1', () => console.log(`本地测试模型：http://127.0.0.1:${port}/v1/chat/completions`));
