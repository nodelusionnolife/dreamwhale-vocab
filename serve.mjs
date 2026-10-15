// 零依赖静态服务器，只用于本地预览。运行：node serve.mjs [端口]
// 不用于生产部署。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
};

function isWithin(base, target) {
  const rel = path.relative(base, target);
  return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

export function createPreviewServer(directory = root) {
  const base = fs.realpathSync(directory);
  return http.createServer(async (req, res) => {
    const respond = (status, text) => res.writeHead(status, {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    }).end(req.method === 'HEAD' ? undefined : text);

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      respond(405, 'method not allowed');
      return;
    }

    let url;
    try {
      url = decodeURIComponent((req.url || '/').split('?')[0]).replace(/\\/g, '/');
      if (!url.startsWith('/') || url.includes('\0')) throw new Error('invalid path');
    } catch {
      respond(400, 'bad request');
      return;
    }

    const full = path.resolve(base, `.${url === '/' ? '/index.html' : url}`);
    if (!isWithin(base, full) || url.split('/').some((part) => part.startsWith('.') && part !== '.' && part !== '..')) {
      respond(403, 'forbidden');
      return;
    }

    try {
      const actual = await fs.promises.realpath(full);
      if (!isWithin(base, actual) || path.relative(base, actual).split(path.sep).some((part) => part.startsWith('.'))) {
        respond(403, 'forbidden');
        return;
      }
      const data = await fs.promises.readFile(actual);
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(full).toLowerCase()] || 'application/octet-stream',
        'Content-Length': data.length,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch {
      respond(404, '404 not found');
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const port = Number(process.argv[2] || 5173);
  const server = createPreviewServer();
  server.listen(port, '127.0.0.1', () => {
    console.log(`词刃本地预览： http://127.0.0.1:${server.address().port}/`);
  });
}
