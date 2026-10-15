import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runInNewContext, Script } from 'node:vm';
import { createPreviewServer } from '../serve.mjs';
import { ASSET_MANIFEST } from '../src/content/assets.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BUILDER = path.join(ROOT, 'tools/build-single-html.mjs');

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dreamwhale-tooling-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function fixture(t, files) {
  const directory = temporaryDirectory(t);
  const defaults = {
    'package.json': '{"type":"module"}',
    'index.html': '<!doctype html>\n<script type="module" src="./src/main.js"></script>\n',
    'src/content/assets.js': 'export const ASSET_MANIFEST = { assets: [] };\n',
    'tools/build-single-html.mjs': fs.readFileSync(BUILDER, 'utf8'),
  };
  for (const [name, content] of Object.entries({ ...defaults, ...files })) {
    const target = path.join(directory, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return directory;
}

function build(directory, output = path.join(directory, 'out.html')) {
  execFileSync(process.execPath, [path.join(directory, 'tools/build-single-html.mjs'), output], {
    cwd: directory, stdio: 'pipe',
  });
  return fs.readFileSync(output, 'utf8');
}

function scriptFrom(html) {
  const match = /<script>\n([\s\S]*?)\s*<\/script>/.exec(html);
  assert.ok(match, 'single classic script is present');
  return match[1];
}

function request(server, pathname, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path: pathname, method }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

test('preview serves GET and HEAD, and stays available after malformed URLs', async (t) => {
  const directory = temporaryDirectory(t);
  fs.writeFileSync(path.join(directory, 'index.html'), '<h1>ready</h1>');
  const server = createPreviewServer(directory).listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await once(server, 'listening');

  for (const pathname of ['/%E0%A4%A', '/%00']) {
    assert.equal((await request(server, pathname)).status, 400);
  }
  const page = await request(server, '/?view=chat');
  assert.equal(page.status, 200);
  assert.equal(page.body, '<h1>ready</h1>');
  assert.equal(page.headers['x-content-type-options'], 'nosniff');
  const head = await request(server, '/', 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.body, '');
  assert.equal(head.headers['content-length'], String(Buffer.byteLength(page.body)));
  assert.equal((await request(server, '/', 'POST')).status, 405);
  assert.equal((await request(server, '/missing')).status, 404);
});

test('preview denies sibling-prefix traversal, hidden files and symlink escapes', async (t) => {
  const directory = temporaryDirectory(t);
  const root = path.join(directory, 'site');
  const sibling = path.join(directory, 'site-private');
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  fs.mkdirSync(sibling);
  fs.writeFileSync(path.join(root, '.git/config'), 'private git configuration');
  fs.writeFileSync(path.join(sibling, 'secret.txt'), 'outside');
  fs.symlinkSync(sibling, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  fs.symlinkSync(path.join(root, '.git'), path.join(root, 'git-alias'), process.platform === 'win32' ? 'junction' : 'dir');
  const server = createPreviewServer(root).listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await once(server, 'listening');

  for (const pathname of ['/../site-private/secret.txt', '/%2e%2e%2fsite-private/secret.txt', '/%2e%2e%5csite-private%5csecret.txt', '/.git/config', '/%2egit/config', '/linked/secret.txt', '/git-alias/config']) {
    const response = await request(server, pathname);
    assert.equal(response.status, 403, pathname);
    assert.equal(response.body, 'forbidden');
  }
});

test('single-file build preserves named imports and defers dynamic import evaluation', async (t) => {
  const directory = fixture(t, {
    'src/main.js': "import { value as answer } from './value.js';\nwindow.answer = answer;\nwindow.load = () => import('./lazy.js');\n",
    'src/value.js': 'export const value = 42;\n',
    'src/lazy.js': 'window.loaded = true;\nexport const value = 7;\n',
  });
  const context = { window: {} };
  runInNewContext(scriptFrom(build(directory)), context);
  assert.equal(context.window.answer, 42);
  assert.equal(context.window.loaded, undefined);
  const loading = context.window.load();
  assert.equal(context.window.loaded, undefined);
  assert.equal((await loading).value, 7);
  assert.equal(context.window.loaded, true);
});

test('dynamic module exceptions reject the import promise', async (t) => {
  const directory = fixture(t, {
    'src/main.js': "window.load = () => import('./failed.js');\n",
    'src/failed.js': "throw new Error('module failed');\n",
  });
  const context = { window: {} };
  runInNewContext(scriptFrom(build(directory)), context);
  let loading;
  assert.doesNotThrow(() => { loading = context.window.load(); });
  await assert.rejects(loading, /module failed/);
  await assert.rejects(context.window.load(), /module failed/);
});

test('single-file build rejects circular dependencies before replacing an artifact', (t) => {
  const directory = fixture(t, {
    'src/main.js': "import { value } from './other.js';\nexport const initial = 1;\nwindow.result = value;\n",
    'src/other.js': "import { initial } from './main.js';\nexport const value = initial;\n",
    'out.html': 'previous valid artifact',
  });
  assert.throws(() => build(directory), /循环依赖/);
  assert.equal(fs.readFileSync(path.join(directory, 'out.html'), 'utf8'), 'previous valid artifact');
});

test('syntax errors leave the previous single-file artifact intact', (t) => {
  const directory = fixture(t, {
    'src/main.js': 'const broken = ;\n',
    'out.html': 'previous valid artifact',
  });
  assert.throws(() => build(directory), /SyntaxError/);
  assert.equal(fs.readFileSync(path.join(directory, 'out.html'), 'utf8'), 'previous valid artifact');
});

test('current application builds from source with its local assets and lazy wordbank', (t) => {
  const output = path.join(temporaryDirectory(t), 'app.html');
  const html = build(ROOT, output);
  const script = scriptFrom(html);
  assert.doesNotThrow(() => new Script(script));
  assert.equal((html.match(/<script/gi) || []).length, 1);
  assert.ok(script.includes('__def("src/engine/wordbank.js"'));
  const paths = [...new Set(ASSET_MANIFEST.assets.flatMap((asset) => [asset.source, ...(asset.altSources || [])])
    .filter((source) => source?.type === 'local').map((source) => source.path))];
  assert.equal(paths.length, 29);
  for (const assetPath of paths) assert.ok(script.includes(`"${assetPath}":"data:image/webp;base64,`), assetPath);
  assert.equal((script.match(/data:image\//g) || []).length, paths.length);
  assert.ok(!/img\.remit\.ee|picui\.ogmua\.cn|assets\/bg\/chat-room\.jpg/.test(script));
  assert.ok(!/<script[^>]*type="module"/.test(html));
});

test('single-file assets include alternate local sources exactly once', (t) => {
  const directory = fixture(t, {
    'src/main.js': 'window.ready = true;\n',
    'src/content/assets.js': `export const ASSET_MANIFEST = { assets: [
      { id: 'face', source: { type: 'local', path: 'assets/q.webp' }, bytes: 3,
        altSources: [{ type: 'local', path: 'assets/p.webp' }] },
      { id: 'duplicate', source: { type: 'local', path: 'assets/p.webp' }, bytes: 4 },
      { id: 'remote', source: { type: 'remote', path: 'https://example.com/image.webp' },
        altSources: [{ type: 'local', path: 'assets/alt.webp' }] }
    ] };\n`,
    'assets/q.webp': 'q12',
    'assets/p.webp': 'p123',
    'assets/alt.webp': 'alt',
  });
  const context = { window: {} };
  runInNewContext(scriptFrom(build(directory)), context);
  const map = context.window.__wbAssets;
  assert.deepEqual(Object.keys(map).sort(), ['assets/alt.webp', 'assets/p.webp', 'assets/q.webp']);
  assert.equal(map['assets/p.webp'], `data:image/webp;base64,${Buffer.from('p123').toString('base64')}`);
});

test('alternate source metadata is checked without inheriting primary bytes', (t) => {
  const directory = fixture(t, {
    'src/main.js': 'window.ready = true;\n',
    'src/content/assets.js': `export const ASSET_MANIFEST = { assets: [
      { id: 'face', source: { type: 'local', path: 'assets/q.webp' }, bytes: 3,
        altSources: [{ type: 'local', path: 'assets/p.webp', bytes: 99 }] }
    ] };\n`,
    'assets/q.webp': 'q12',
    'assets/p.webp': 'p123',
    'out.html': 'previous valid artifact',
  });
  assert.throws(() => build(directory), /bytes 声明 99，实际 4/);
  assert.equal(fs.readFileSync(path.join(directory, 'out.html'), 'utf8'), 'previous valid artifact');
});
