import { defineConfig } from 'vite';
import { ASSET_MANIFEST } from './src/content/assets.js';
import fs from 'node:fs';
import path from 'node:path';

export default defineConfig({
  base: './',
  publicDir: false,
  server: { strictPort: true },
  build: { outDir: 'app-dist', emptyOutDir: true, target: 'es2022' },
  plugins: [{
    name: 'dreamwhale-native',
    transformIndexHtml: { order: 'pre', handler(html) {
      return html.replace('./src/main.js', './src/platform/entry.js');
    } },
    writeBundle() {
      const sources = ASSET_MANIFEST.assets.flatMap(a => [a.source, ...(a.altSources || [])]);
      for (const source of sources) {
        if (source?.type !== 'local') continue;
        const dest = path.join('app-dist', source.path);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(source.path, dest);
      }
    },
  }],
});
