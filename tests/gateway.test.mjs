import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import {
  callJson, callText, isLocalEndpoint, modelReadiness, normalizeEndpoint,
  normalizeModelProfile, PROFILE_PRESETS,
} from '../src/gateway/model.js';
import { normalizeUsage, normalizeUsageShape, cacheHitRate } from '../src/engine/usage.js';

const options = { endpoint: 'https://example.com/v1', model: 'test-model', apiKey: 'test-key', timeoutMs: 1000 };
const response = (content = 'ok', extra = {}) => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify({ choices: [{ message: { content } }], ...extra }),
});
const modes = [
  { name: 'text', call: (opts, args) => callText(opts, { messages: [{ role: 'user', content: 'hi' }], ...args }) },
  { name: 'json', call: (opts, args) => callJson(opts, { system: 'JSON only', user: 'hi', ...args }) },
];

for (const { name, call } of modes) {
  test(`${name}: timeout covers a response body that never finishes`, async () => {
    let sentSignal;
    await assert.rejects(call({ ...options, timeoutMs: 10 }, {
      fetchImpl: async (_, init) => {
        sentSignal = init.signal;
        return { ok: true, status: 200, text: () => new Promise(() => {}) };
      },
    }), { kind: 'timeout' });
    assert.equal(sentSignal.aborted, true);
  });

  test(`${name}: a cancelled request is never sent`, async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    await assert.rejects(call(options, {
      signal: controller.signal,
      fetchImpl: async () => { calls += 1; return response(); },
    }), { kind: 'cancelled' });
    assert.equal(calls, 0);
  });

  test(`${name}: cancellation remains active after headers arrive`, async () => {
    const controller = new AbortController();
    let bodyStarted;
    const started = new Promise((resolve) => { bodyStarted = resolve; });
    let sentSignal;
    const pending = call(options, {
      signal: controller.signal,
      fetchImpl: async (_, init) => {
        sentSignal = init.signal;
        return {
          ok: true,
          status: 200,
          text: () => { bodyStarted(); return new Promise(() => {}); },
        };
      },
    });
    await started;
    controller.abort();
    await assert.rejects(pending, { kind: 'cancelled' });
    assert.equal(sentSignal.aborted, true);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  });

  test(`${name}: response body read failure stays a network error without retry`, async () => {
    const controller = new AbortController();
    let calls = 0;
    await assert.rejects(call(options, {
      signal: controller.signal,
      fetchImpl: async () => {
        calls += 1;
        return { ok: true, status: 200, text: async () => { throw new Error('connection reset'); } };
      },
    }), { kind: 'network' });
    assert.equal(calls, 1);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  });

  test(`${name}: a length-truncated completion is not accepted or retried`, async () => {
    let calls = 0;
    await assert.rejects(call(options, {
      fetchImpl: async () => {
        calls += 1;
        return response('{}', { choices: [{ message: { content: '{}' }, finish_reason: 'length' }] });
      },
    }), { kind: 'length' });
    assert.equal(calls, 1);
  });

  test(`${name}: forwards the requested output budget and preserves unknown usage`, async () => {
    const controller = new AbortController();
    let sentBody;
    const result = await call({ ...options, maxOutputTokens: 256 }, {
      signal: controller.signal,
      fetchImpl: async (_, init) => {
        sentBody = JSON.parse(init.body);
        return response('{}', { usage: { prompt_tokens: 200, completion_tokens: 10, prompt_cache_hit_tokens: null } });
      },
    });
    assert.equal(sentBody.max_tokens, 256);
    assert.deepEqual(result.usage, { prompt: 200, completion: 10, total: 210, cached: null });
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  });

  test(`${name}: omits an output limit when it was not configured`, async () => {
    let sentBody;
    await call(options, {
      fetchImpl: async (_, init) => { sentBody = JSON.parse(init.body); return response('{}'); },
    });
    assert.equal('max_tokens' in sentBody, false);
  });
}

test('invalid output limits fail before any request', async () => {
  for (const value of [0, -1, 1.5, Infinity, '256']) {
    await assert.rejects(callText({ ...options, maxOutputTokens: value }, {
      messages: [{ role: 'user', content: 'hi' }],
      fetchImpl: async () => assert.fail('must not send'),
    }), { kind: 'schema' });
  }
});

test('local endpoint exceptions require an exact parsed loopback host', () => {
  for (const endpoint of ['http://localhost:11434/v1', 'https://LOCALHOST/v1', 'http://127.0.0.1/v1', 'http://[::1]:11434/v1']) {
    assert.equal(isLocalEndpoint(endpoint), true, endpoint);
    assert.equal(modelReadiness({ endpoint }).ready, true, endpoint);
  }
  for (const endpoint of ['http://localhost.example/v1', 'http://127.0.0.1.example/v1', 'http://localhost@evil.example/v1']) {
    assert.equal(isLocalEndpoint(endpoint), false, endpoint);
    assert.equal(modelReadiness({ endpoint }).ready, false, endpoint);
  }
});

test('invalid endpoints are rejected before credentials or a fetch are used', async () => {
  for (const endpoint of ['not a url', 'javascript:alert(1)', 'file:///localhost/v1', 'ftp://example.com/v1', 'https://user:password@example.com/v1']) {
    assert.equal(modelReadiness({ endpoint, apiKey: 'key' }).kind, 'invalid-endpoint', endpoint);
    await assert.rejects(callText({ ...options, endpoint }, {
      messages: [{ role: 'user', content: 'hi' }],
      fetchImpl: async () => assert.fail('must not send'),
    }), { kind: 'invalid-endpoint' });
  }
});

test('endpoint normalization preserves queries and custom gateway paths', () => {
  assert.equal(normalizeEndpoint('https://example.com/v1/?route=/'), 'https://example.com/v1/chat/completions?route=/');
  assert.equal(normalizeEndpoint('https://example.com/v1/chat/completions/?route=/'), 'https://example.com/v1/chat/completions?route=/');
  assert.equal(normalizeEndpoint('https://example.com/custom/gateway/?route=/'), 'https://example.com/custom/gateway/?route=/');
  assert.equal(modelReadiness({ endpoint: 'https://example.com/v1', apiKey: '   ' }).kind, 'no-key');
});

test('usage nulls, blanks, booleans and invalid counts remain unknown', () => {
  for (const value of [null, undefined, '', ' ', false, true, [], {}, -1, Infinity, 0.5]) {
    assert.equal(normalizeUsage({ prompt_tokens: value, completion_tokens: value, total_tokens: value, cached_tokens: value }), null);
    assert.equal(normalizeUsageShape({ prompt: value, completion: value, total: value, cached: value }), null);
  }
  assert.deepEqual(normalizeUsageShape({ prompt: null, completion: 12, total: null, cached: null }), {
    prompt: null, completion: 12, total: null, cached: null,
  });
  assert.deepEqual(normalizeUsageShape({ prompt: '100', completion: 0, cached: 0 }), {
    prompt: 100, completion: 0, total: 100, cached: 0,
  });
});

test('cache ratio only uses valid reported cached and prompt counts', () => {
  assert.equal(cacheHitRate({ prompt: 100, cached: 0 }), 0);
  assert.equal(cacheHitRate({ prompt: 100, cached: 80 }), 0.8);
  for (const usage of [{ prompt: 0, cached: 0 }, { prompt: null, cached: 80 }, { prompt: 100, cached: null }, { prompt: 100, cached: 101 }, { prompt: 100, cached: -1 }]) {
    assert.equal(cacheHitRate(usage), null);
  }
  assert.equal(normalizeUsage({ prompt_tokens: 100, prompt_cache_hit_tokens: 120 }).cached, null);
});

test('legacy profiles retain credentials and infer only exact provider origins', () => {
  const old = { endpoint: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKey: 'private', usePrefill: false };
  assert.deepEqual(normalizeModelProfile(old), { ...old, provider: 'openai', cacheMode: 'auto', apiFormat: 'chat', authMode: 'auto', sendTemperature: true, streamUsage: true, jsonMode: 'auto', tokenField: 'max_tokens' });
  assert.equal(normalizeModelProfile({ ...old, endpoint: 'https://api.openai.com.evil.example/v1' }).provider, 'custom');
  assert.equal(normalizeModelProfile({ ...old, provider: 'custom' }).provider, 'custom');
  assert.equal(normalizeModelProfile({ ...old, cacheMode: 'off' }).cacheMode, 'standard');
  assert.ok(PROFILE_PRESETS.some((preset) => preset.provider === 'openrouter'));
});

test('known OpenAI requests keep routing stable across appended turns and separate sessions', async () => {
  const profile = { ...options, provider: 'openai', endpoint: 'https://api.openai.com/v1', model: 'gpt-4o-mini', cacheMode: 'auto' };
  const bodies = [];
  const send = async (sessionId, promptVersion = '1', text = 'hi') => callText(profile, {
    requestContext: { sessionId, promptVersion },
    messages: [{ role: 'user', content: text }],
    fetchImpl: async (_, init) => { bodies.push(JSON.parse(init.body)); return response('ok', { id: 'completion-1' }); },
  });
  const first = await send('session-one');
  await send('session-one', '1', 'another turn');
  await send('session-two');
  await send('session-one', '2');
  assert.equal(bodies[0].prompt_cache_key, bodies[1].prompt_cache_key);
  assert.notEqual(bodies[0].prompt_cache_key, bodies[2].prompt_cache_key);
  assert.notEqual(bodies[0].prompt_cache_key, bodies[3].prompt_cache_key);
  assert.ok(bodies[0].prompt_cache_key.length <= 64);
  assert.equal(first.request.routing, 'prompt_cache_key');
  assert.equal(first.request.responseId, 'completion-1');
  assert.ok(!JSON.stringify(first.request).includes(options.apiKey));
  assert.ok(!JSON.stringify(first.request).includes('another turn'));
});

test('OpenRouter uses session_id and standard requests omit optional routing', async () => {
  const profile = { ...options, provider: 'openrouter', endpoint: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini' };
  const bodies = [];
  for (const cacheMode of ['auto', 'auto', 'standard']) {
    await callText({ ...profile, cacheMode }, {
      messages: [{ role: 'user', content: 'hi' }],
      requestContext: { sessionId: 'saved-session', promptVersion: 'v1' },
      fetchImpl: async (_, init) => { bodies.push(JSON.parse(init.body)); return response(); },
    });
  }
  assert.equal(typeof bodies[0].session_id, 'string');
  assert.equal(bodies[0].session_id, bodies[1].session_id);
  assert.equal('prompt_cache_key' in bodies[0], false);
  assert.equal('session_id' in bodies[2], false);
});

test('unverified endpoints, models and standard mode never receive cache extensions', async () => {
  const cases = [
    { provider: 'openai', endpoint: 'https://api.openai.com/v1', model: 'gpt-5.6' },
    { provider: 'openai', endpoint: 'https://api.openai.com/v1', model: 'gpt-4o-mini-future' },
    { provider: 'openai', endpoint: 'https://api.openai.com/v1', model: 'gpt-4o-mini', cacheMode: 'standard' },
    { provider: 'openai', endpoint: 'https://api.openai.com.evil.example/v1', model: 'gpt-4o-mini' },
    { provider: 'openai', endpoint: 'https://api.openai.com/custom/path', model: 'gpt-4o-mini' },
    { provider: 'custom', endpoint: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    { provider: 'openrouter', endpoint: 'https://proxy.example/api/v1', model: 'openai/gpt-4o-mini' },
    { provider: 'deepseek', endpoint: 'https://api.deepseek.com', model: 'deepseek-chat' },
    { provider: 'ollama', endpoint: 'http://localhost:11434/v1', model: 'qwen2.5:7b' },
  ];
  for (const profile of cases) {
    const result = await callText({ ...options, ...profile }, {
      messages: [{ role: 'user', content: 'hi' }],
      requestContext: { sessionId: 'session', promptVersion: 'v1' },
      fetchImpl: async (_, init) => {
        const body = JSON.parse(init.body);
        assert.equal('prompt_cache_key' in body, false);
        assert.equal('session_id' in body, false);
        assert.equal('cache_control' in body, false);
        assert.equal('prompt_cache_options' in body, false);
        return response();
      },
    });
    assert.equal(result.request.routing, 'none');
  }
});

test('invalid provider settings and request arguments fail before fetch', async () => {
  for (const patch of [{ provider: 'bogus' }, { cacheMode: 'on' }, { model: '' }, { model: null }, { temperature: NaN }, { temperature: '1' }, { temperature: -1 }, { timeoutMs: 0 }, { timeoutMs: Infinity }]) {
    await assert.rejects(callText({ ...options, ...patch }, {
      messages: [{ role: 'user', content: 'hi' }],
      fetchImpl: async () => assert.fail('must not send'),
    }), { kind: 'schema' });
  }
  for (const requestContext of [null, [], { sessionId: '' }, { sessionId: 42 }, { promptVersion: 'x'.repeat(257) }]) {
    await assert.rejects(callText(options, {
      messages: [{ role: 'user', content: 'hi' }], requestContext,
      fetchImpl: async () => assert.fail('must not send'),
    }), { kind: 'schema' });
  }
  for (const messages of [[null], [{ role: 'user', content: {} }], [{ role: 'bogus', content: 'hi' }]]) {
    await assert.rejects(callText(options, { messages, fetchImpl: async () => assert.fail('must not send') }), { kind: 'schema' });
  }
});

test('cache-write and reported miss usage survive normalization without inflating totals', () => {
  const usage = normalizeUsage({
    prompt_tokens: 100, completion_tokens: 10,
    prompt_tokens_details: { cached_tokens: 60, cache_write_tokens: 20 },
    prompt_cache_miss_tokens: 20,
  });
  assert.deepEqual(usage, { prompt: 100, completion: 10, total: 110, cached: 60, cacheWrite: 20, uncached: 20 });
  assert.deepEqual(normalizeUsageShape(JSON.parse(JSON.stringify(usage))), usage);
  assert.deepEqual(normalizeUsage({ prompt_tokens: 10, prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } }), {
    prompt: 10, completion: null, total: null, cached: 0, cacheWrite: 0,
  });
  assert.equal('cacheWrite' in normalizeUsageShape({ prompt: 100, cached: 90, cacheWrite: 20 }), false);
  assert.equal('uncached' in normalizeUsageShape({ prompt: 100, cached: 40, cacheWrite: 40, uncached: 40 }), false);
  assert.equal('uncached' in normalizeUsage({ prompt_tokens: 100, prompt_tokens_details: { cached_tokens: 50 } }), false);
});

for (const { name, call } of modes) {
  test(`${name}: failed completions retain reported usage and request metadata`, async () => {
    for (const finishReason of ['length', 'stop']) {
      let error;
      try {
        await call(options, {
          fetchImpl: async () => response('', {
            id: 'failed-completion',
            choices: [{ message: { content: '' }, finish_reason: finishReason }],
            usage: { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 50, cache_write_tokens: 25 } },
          }),
        });
      } catch (err) { error = err; }
      assert.ok(error);
      assert.equal(error.kind, finishReason === 'length' ? 'length' : 'empty');
      assert.equal(error.usage.cacheWrite, 25);
      assert.equal(error.usage.total, 120);
      assert.equal(error.request.responseId, 'failed-completion');
      assert.equal(error.request.finishReason, finishReason);
      assert.equal(error.request.attempts, 1);
    }
  });
}

test('JSON parsing failures preserve billed usage', async () => {
  await assert.rejects(callJson(options, {
    system: 'JSON only', user: 'hi',
    fetchImpl: async () => response('not valid JSON', { usage: { prompt_tokens: 10, completion_tokens: 5 } }),
  }), (error) => error.kind === 'not-json' && error.usage.total === 15 && error.request.attempts === 1);
});

test('JSON compatibility retries retain stable routing and earlier reported usage', async () => {
  const bodies = [];
  const result = await callJson({ ...options, provider: 'openrouter', endpoint: 'https://openrouter.ai/api/v1' }, {
    system: 'JSON only', user: 'hi', requestContext: { sessionId: 'same-session' },
    fetchImpl: async (_, init) => {
      bodies.push(JSON.parse(init.body));
      if (bodies.length === 1) return {
        ok: false, status: 400,
        text: async () => JSON.stringify({ error: { message: 'response_format unsupported' }, usage: { prompt_tokens: 2, completion_tokens: 0 } }),
      };
      return response('{}', { usage: { prompt_tokens: 10, completion_tokens: 2 } });
    },
  });
  assert.equal(bodies[0].session_id, bodies[1].session_id);
  assert.equal(result.request.attempts, 2);
  assert.equal(result.usage.total, 12);
  assert.equal(result.request.priorUsage[0].usage.total, 2);
  assert.equal(result.used.jsonMode, false);
});
