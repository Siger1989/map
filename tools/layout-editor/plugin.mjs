import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, basename, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateLayout, emptyLayout } from './model.mjs';
const root = fileURLToPath(new URL('../..', import.meta.url));
const files = new Map(
  [
    'index.html',
    'editor.css',
    'editor.mjs',
    'selection.mjs',
    'model.mjs',
    'geometry.mjs',
    'gestures.mjs',
    'alignment.mjs',
    'layers.mjs',
    'anchors.mjs',
    'anchorRenderer.mjs',
    'clipping.mjs',
    'resize.mjs',
    'gallery.html',
  ].map((n) => [
    n,
    resolve(
      root,
      [
        'model.mjs',
        'selection.mjs',
        'geometry.mjs',
        'gestures.mjs',
        'alignment.mjs',
        'layers.mjs',
        'anchors.mjs',
        'anchorRenderer.mjs',
        'clipping.mjs',
        'resize.mjs',
      ].includes(n)
        ? 'modules/uiLayout'
        : 'tools/layout-editor',
      n,
    ),
  ]),
);
export default function layoutEditor({
  draftPath = resolve(root, 'config/ui-layout-draft.json'),
} = {}) {
  const draft = draftPath;
  return {
    name: 'shantu-local-layout-editor',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = (req.url || '').split('?')[0];
        if (!path.startsWith('/__layout')) return next();
        const json = (code, data) => {
          res.statusCode = code;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify(data));
        };
        res.setHeader('Cache-Control', 'no-store');
        try {
          if (path === '/__layout/draft') {
            if (req.method === 'GET') {
              try {
                return json(
                  200,
                  validateLayout(JSON.parse(await readFile(draft, 'utf8'))),
                );
              } catch (error) {
                if (error.code === 'ENOENT') return json(200, emptyLayout());
                throw error;
              }
            }
            if (req.method !== 'POST')
              return json(405, { error: '不支持此操作' });
            if (
              req.headers['x-shantu-layout'] !== '1' ||
              req.headers.origin !== `http://${req.headers.host}` ||
              !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || '')
            )
              return json(403, { error: '只允许本机布局窗口保存' });
            const chunks = [];
            let bytes = 0;
            for await (const chunk of req) {
              chunks.push(chunk);
              bytes += chunk.length;
              if (bytes > 256 * 1024)
                return json(413, { error: '布局文件过大' });
            }
            const layout = validateLayout(
              JSON.parse(Buffer.concat(chunks).toString('utf8')),
            );
            await mkdir(dirname(draft), { recursive: true });
            const temporary = `${draft}.${randomUUID()}.tmp`;
            await writeFile(temporary, JSON.stringify(layout, null, 2) + '\n');
            await rename(temporary, draft);
            return json(200, {
              saved: true,
              path: 'config/ui-layout-draft.json',
            });
          }
          if (req.method !== 'GET') return json(405, { error: '只支持读取' });
          const name =
            path === '/__layout' || path === '/__layout/'
              ? 'index.html'
              : path.slice('/__layout/'.length);
          let file = files.get(name);
          if (
            name.startsWith('screenshots/') &&
            /^\d{2}-[a-z0-9-]+\.png$/.test(basename(name)) &&
            name === `screenshots/${basename(name)}`
          )
            file = resolve(
              root,
              'artifacts/screenshots/ui-0228',
              basename(name),
            );
          if (!file) return json(404, { error: '页面不存在' });
          const types = {
            html: 'text/html; charset=utf-8',
            css: 'text/css; charset=utf-8',
            mjs: 'text/javascript; charset=utf-8',
            png: 'image/png',
          };
          res.setHeader(
            'Content-Type',
            types[file.split('.').at(-1)] || 'application/octet-stream',
          );
          res.end(await readFile(file));
        } catch (error) {
          json(error.code === 'ENOENT' ? 404 : 400, { error: error.message });
        }
      });
    },
  };
}
