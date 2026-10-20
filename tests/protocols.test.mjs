import test from 'node:test';
import assert from 'node:assert/strict';
import { callJson, callText, probe, normalizeEndpoint, modelReadiness, emptyProfile, PROFILE_PRESETS } from '../src/gateway/model.js';
import { normalizeUsage } from '../src/engine/usage.js';

const messages = [{ role:'system',content:'JSON only' },{ role:'user',content:'以前的问题' },{ role:'assistant',content:'以前的回答' },{ role:'user',content:'你好' }];
const options = { endpoint:'https://example.com/v1', model:'test-model', apiKey:'test-secret', timeoutMs:1000, maxOutputTokens:256 };
const jsonResponse = payload => new Response(JSON.stringify(payload),{headers:{'content-type':'application/json'}});
const fixtures = {
  chat: text => ({choices:[{message:{content:text},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:7,total_tokens:27,prompt_tokens_details:{cached_tokens:5}}}),
  responses: text => ({id:'resp-test',status:'completed',output:[{type:'reasoning',summary:[]},{type:'message',content:[{type:'output_text',text}]}],usage:{input_tokens:20,output_tokens:7,total_tokens:27,input_tokens_details:{cached_tokens:5}}}),
  anthropic: text => ({id:'msg-test',stop_reason:'end_turn',content:[{type:'thinking',thinking:'不要显示'},{type:'text',text}],usage:{input_tokens:12,cache_creation_input_tokens:3,cache_read_input_tokens:5,output_tokens:7}}),
  gemini: text => ({candidates:[{content:{parts:[{thought:true,text:'不要显示'},{text}]},finishReason:'STOP'}],usageMetadata:{promptTokenCount:20,candidatesTokenCount:5,thoughtsTokenCount:2,totalTokenCount:27,cachedContentTokenCount:5}}),
};
const chunks = {
  chat: [ {choices:[{delta:{content:'清晨'}}]}, {choices:[{delta:{content:'你好'},finish_reason:'stop'}]}, {choices:[],usage:fixtures.chat('').usage}, '[DONE]' ],
  responses: [ {type:'response.created',response:{status:'in_progress'}}, {type:'response.output_text.delta',delta:'清晨'}, {type:'response.reasoning_summary_text.delta',delta:'不要显示'}, {type:'response.output_text.delta',delta:'你好'}, {type:'response.completed',response:fixtures.responses('清晨你好')} ],
  anthropic: [ {type:'message_start',message:{usage:{input_tokens:12,cache_creation_input_tokens:3,cache_read_input_tokens:5,output_tokens:0}}}, {type:'ping'}, {type:'content_block_start',index:0,content_block:{type:'text',text:''}}, {type:'content_block_delta',index:0,delta:{type:'text_delta',text:'清晨'}}, {type:'content_block_delta',index:0,delta:{type:'text_delta',text:'你好'}}, {type:'content_block_stop',index:0}, {type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:7}}, {type:'message_stop'} ],
  gemini: [ {candidates:[{content:{parts:[{thought:true,text:'不要显示'},{text:'清晨'}]}}]}, {...fixtures.gemini('你好')} ],
};
function sse(items) {
  const bytes = new TextEncoder().encode(items.map(p => `${p.type ? `event: ${p.type}\r\n` : ''}data: ${typeof p==='string' ? p : JSON.stringify(p)}\r\n\r\n`).join(''));
  return new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=5)c.enqueue(bytes.slice(i,i+5));c.close();}}),{headers:{'content-type':'text/event-stream'}});
}

test('new defaults and presets keep protocols independent of providers',()=>{
  assert.equal(emptyProfile().model,'deepseek-flash');
  assert.equal(new Set(PROFILE_PRESETS.map(p=>p.id)).size,PROFILE_PRESETS.length);
  assert.equal(PROFILE_PRESETS.find(p=>p.id==='deepseek-responses').apiFormat,'responses');
});

test('base URLs, full endpoints, deployment queries and Gemini model templates resolve correctly',()=>{
  assert.equal(normalizeEndpoint('https://example.com/v1/','responses'),'https://example.com/v1/responses');
  assert.equal(normalizeEndpoint('https://example.com/v1/chat/completions?api-version=preview','responses'),'https://example.com/v1/responses?api-version=preview');
  assert.equal(normalizeEndpoint('https://example.com/deployments/a/messages?x=1','anthropic'),'https://example.com/deployments/a/messages?x=1');
  assert.equal(normalizeEndpoint('https://api.anthropic.com','anthropic'),'https://api.anthropic.com/v1/messages');
  assert.equal(normalizeEndpoint('https://example.com/anthropic','anthropic'),'https://example.com/anthropic/v1/messages');
  assert.equal(normalizeEndpoint('https://example.com/v1beta','gemini','models/gemini-test',true),'https://example.com/v1beta/models/gemini-test:streamGenerateContent?alt=sse');
  assert.equal(normalizeEndpoint('https://example.com/v1beta/models/{model}:generateContent?test=1','gemini','hello world',true),'https://example.com/v1beta/models/hello%20world:streamGenerateContent?test=1&alt=sse');
  assert.equal(normalizeEndpoint('https://example.com/v1beta/models/test:streamGenerateContent?alt=sse&test=1','gemini','ignored'),'https://example.com/v1beta/models/test:generateContent?test=1');
  assert.equal(normalizeEndpoint('https://example.com/proxy/run?version=1','responses'),'https://example.com/proxy/run?version=1');
});

for (const format of Object.keys(fixtures)) {
  test(`${format}: text requests map roles, limits, auth and usage`,async()=>{
    let sent;
    const result = await callText({...options,apiFormat:format,sendTemperature:false},{messages,fetchImpl:async(url,init)=>{sent={url,...init,body:JSON.parse(init.body)};return jsonResponse(fixtures[format]('你好'));}});
    assert.equal(result.text,'你好');assert.equal(result.usage.total,27);assert.equal(result.usage.prompt,20);assert.equal(result.usage.cached,5);assert.equal(result.request.apiFormat,format);
    assert.equal(sent.body.temperature,undefined);assert.equal(sent.body.generationConfig?.temperature,undefined);
    assert.equal(sent.redirect,'error');
    if(format==='chat') { assert.deepEqual(sent.body.messages,messages);assert.equal(sent.body.max_tokens,256);assert.equal(sent.headers.Authorization,'Bearer test-secret'); }
    if(format==='responses') { assert.equal(sent.body.instructions,'JSON only');assert.deepEqual(sent.body.input,messages.slice(1));assert.equal(sent.body.max_output_tokens,256);assert.equal(sent.body.store,false);assert.equal(sent.body.messages,undefined);assert.equal(sent.headers.Authorization,'Bearer test-secret'); }
    if(format==='anthropic') { assert.equal(sent.body.system,'JSON only');assert.deepEqual(sent.body.messages,messages.slice(1));assert.equal(sent.body.max_tokens,256);assert.equal(sent.headers['x-api-key'],'test-secret');assert.equal(sent.headers['anthropic-version'],'2023-06-01');assert.equal(sent.headers.Authorization,undefined); }
    if(format==='gemini') { assert.deepEqual(sent.body.systemInstruction,{parts:[{text:'JSON only'}]});assert.deepEqual(sent.body.contents.map(m=>m.role),['user','model','user']);assert.equal(sent.body.generationConfig.maxOutputTokens,256);assert.equal(sent.body.model,undefined);assert.equal(sent.headers['x-goog-api-key'],'test-secret');assert.ok(sent.url.endsWith('/models/test-model:generateContent'));assert.ok(!sent.url.includes('test-secret')); }
  });
  test(`${format}: JSON grading and connection probes use the selected wire format`,async()=>{
    const sent=[];
    const fetchImpl=async(_,init)=>{sent.push(JSON.parse(init.body));return jsonResponse(fixtures[format]('{"ok":true}'));};
    const result=await callJson({...options,apiFormat:format},{system:'JSON only',user:'评价',prefill:'{',fetchImpl});
    assert.deepEqual(result.data,{ok:true});assert.equal(result.used.prefill,format==='chat');
    if(format==='chat') assert.equal(sent[0].response_format.type,'json_object');
    if(format==='responses') {assert.equal(sent[0].text.format.type,'json_object');assert.equal(sent[0].input.length,1);}
    if(format==='anthropic') {assert.equal(sent[0].response_format,undefined);assert.equal(sent[0].messages.length,1);assert.equal(result.used.jsonMode,false);}
    if(format==='gemini') assert.equal(sent[0].generationConfig.responseMimeType,'application/json');
    assert.equal((await probe({...options,apiFormat:format},{fetchImpl})).ok,true);
  });
  test(`${format}: split UTF-8 SSE events deliver text and final usage without exposing reasoning`,async()=>{
    const seen=[];let sent;
    const result=await callText({...options,apiFormat:format,stream:true},{messages,onDelta:text=>seen.push(text),fetchImpl:async(url,init)=>{sent={url,body:JSON.parse(init.body)};return sse(chunks[format]);}});
    assert.equal(result.text,'清晨你好');assert.equal(result.usage.total,27);assert.deepEqual(seen,['清晨','清晨你好']);
    assert.equal(sent.body.stream_options?.include_usage,format==='chat'?true:undefined);
    if(format==='gemini'){assert.equal(sent.body.stream,undefined);assert.ok(sent.url.endsWith(':streamGenerateContent?alt=sse'));}
    else assert.equal(sent.body.stream,true);
  });
  test(`${format}: non-stream JSON response to a stream request still works`,async()=>{
    const result=await callText({...options,apiFormat:format,stream:true},{messages,fetchImpl:async()=>jsonResponse(fixtures[format]('完整回复'))});
    assert.equal(result.text,'完整回复');assert.equal(result.usage.total,27);
  });
}

test('native streams require protocol completion and retain usage on failure',async()=>{
  for(const [format,frames] of [
    ['responses',[{type:'response.output_text.delta',delta:'半句'},'[DONE]']],
    ['anthropic',chunks.anthropic.slice(0,-1)],
    ['gemini',chunks.gemini.slice(0,1)],
  ]) await assert.rejects(callText({...options,apiFormat:format,stream:true},{messages,fetchImpl:async()=>sse(frames)}),{kind:'network'});
  const partial={...fixtures.responses('半句'),status:'incomplete',incomplete_details:{reason:'max_output_tokens'}};
  await assert.rejects(callText({...options,apiFormat:'responses',stream:true},{messages,fetchImpl:async()=>sse([{type:'response.incomplete',response:partial}])}),e=>e.kind==='length'&&e.usage.total===27);
  await assert.rejects(callText({...options,apiFormat:'gemini',stream:true},{messages,fetchImpl:async()=>sse([{candidates:[{finishReason:'SAFETY'}]}])}),{kind:'incomplete'});
  await assert.rejects(callText({...options,apiFormat:'anthropic',stream:true},{messages,fetchImpl:async()=>sse([{type:'error',error:{message:'overloaded'}}])}),/overloaded/);
});

test('failed and truncated native JSON responses cannot become successful answers',async()=>{
  const cases=[['responses',{...fixtures.responses('半句'),status:'incomplete',incomplete_details:{reason:'max_output_tokens'}},'length'],['responses',{...fixtures.responses('半句'),status:'in_progress'},'incomplete'],['anthropic',{...fixtures.anthropic('半句'),stop_reason:'max_tokens'},'length'],['gemini',{...fixtures.gemini('半句'),candidates:[{finishReason:'MAX_TOKENS'}]},'length']];
  for(const [apiFormat,payload,kind] of cases) await assert.rejects(callJson({...options,apiFormat},{system:'JSON',user:'评价',fetchImpl:async()=>jsonResponse(payload)}),e=>e.kind===kind&&e.usage.total===27);
});

test('custom auth, token field, JSON and stream options survive actual requests',async()=>{
  for(const authMode of ['bearer','api-key','x-api-key','x-goog-api-key','none']) {
    let headers;
    await callText({...options,authMode},{messages,fetchImpl:async(_,init)=>{headers=init.headers;return jsonResponse(fixtures.chat('ok'));}});
    assert.equal(headers[authMode==='bearer'?'Authorization':authMode],authMode==='none'?undefined:authMode==='bearer'?'Bearer test-secret':'test-secret');
    if(authMode==='none') assert.ok(!JSON.stringify(headers).includes('test-secret'));
  }
  assert.equal(modelReadiness({endpoint:'https://example.com',authMode:'none'}).ready,true);
  assert.equal(modelReadiness({endpoint:'https://example.com'}).ready,false);
  let sent;
  await callText({...options,tokenField:'max_completion_tokens',stream:true,streamUsage:false},{messages,fetchImpl:async(_,init)=>{sent=JSON.parse(init.body);return sse(chunks.chat);}});
  assert.equal(sent.max_completion_tokens,256);assert.equal(sent.max_tokens,undefined);assert.equal(sent.stream_options,undefined);
  await callJson({...options,jsonMode:'off'},{system:'JSON',user:'hi',fetchImpl:async(_,init)=>{sent=JSON.parse(init.body);return jsonResponse(fixtures.chat('{}'));}});
  assert.equal(sent.response_format,undefined);
});

test('Responses and Gemini JSON compatibility retry only when the service rejects the format',async()=>{
  for(const apiFormat of ['responses','gemini']) {
    const sent=[];
    const result=await callJson({...options,apiFormat},{system:'JSON',user:'hi',fetchImpl:async(_,init)=>{
      sent.push(JSON.parse(init.body));
      return sent.length===1?new Response(JSON.stringify({error:{message:apiFormat==='responses'?'text.format json_object unsupported':'response_mime_type unsupported'}}),{status:400}):jsonResponse(fixtures[apiFormat]('{}'));
    }});
    assert.equal(result.request.attempts,2);assert.equal(result.used.jsonMode,false);
    assert.equal(sent[1].text,undefined);assert.equal(sent[1].generationConfig?.responseMimeType,undefined);
  }
});

test('invalid formats are rejected before sending; cancellation and timeout cover native streams',async()=>{
  for(const patch of [{apiFormat:'unknown'},{authMode:'custom-secret'},{tokenField:'token'},{sendTemperature:'false'}]) await assert.rejects(callText({...options,...patch},{messages,fetchImpl:async()=>assert.fail('must not send')}),{kind:'schema'});
  const controller=new AbortController();
  const pending=callText({...options,apiFormat:'responses',stream:true},{messages,signal:controller.signal,fetchImpl:()=>new Promise(()=>{})});controller.abort();await assert.rejects(pending,{kind:'cancelled'});
  await assert.rejects(callText({...options,apiFormat:'gemini',stream:true,timeoutMs:10},{messages,fetchImpl:()=>new Promise(()=>{})}),{kind:'timeout'});
});

test('usage reports missing values as unknown and counts Anthropic cache input once',()=>{
  assert.equal(normalizeUsage({},'responses'),null);
  assert.deepEqual(normalizeUsage({input_tokens:10,cache_read_input_tokens:20,cache_creation_input_tokens:5,output_tokens:4},'anthropic'),{prompt:35,completion:4,total:39,cached:20,cacheWrite:5});
  assert.equal(normalizeUsage({promptTokenCount:20},'gemini').completion,null);
});
