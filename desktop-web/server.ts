import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, realpath } from 'node:fs/promises';
import { dirname, resolve, relative, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { GET as terrain } from '../app/api/terrain/[z]/[x]/[y]/route';
import { GET as geology } from '../app/api/geology/tiles/[z]/[x]/[y]/route';
import { GET as satellite } from '../app/api/satellite/route';
import { GET as geocloud } from '../app/api/geology/geocloud/route';

const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.pbf': 'application/x-protobuf',
};
/** Local delivery adapter. Reuses the application's four APIs and serves only bundled public files. */
export function createDesktopServer(root: string) {
  const publicRoot = resolve(root);
  return createServer(async (req, res) => {
    try {
      const port = (res.socket?.address() as { port: number })?.port;
      if (
        !['127.0.0.1:' + port, 'localhost:' + port].includes(
          req.headers.host ?? '',
        )
      ) {
        res.writeHead(403).end();
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { Allow: 'GET, HEAD' }).end();
        return;
      }
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
      const pathname = decodeURIComponent(url.pathname);
      let result: Response | undefined;
      const tile = pathname.match(
        /^\/api\/(terrain|geology\/tiles)\/([^/]+)\/([^/]+)\/([^/]+)$/,
      );
      if (tile) {
        const context = {
          params: Promise.resolve({ z: tile[2], x: tile[3], y: tile[4] }),
        };
        result = await (tile[1] === 'terrain' ? terrain : geology)(
          new Request(url),
          context,
        );
      } else if (pathname === '/api/satellite') result = await satellite();
      else if (pathname === '/api/geology/geocloud')
        result = await geocloud(new Request(url));
      else if (pathname.startsWith('/api/'))
        result = new Response('Not found', { status: 404 });
      if (result) {
        res.writeHead(result.status, Object.fromEntries(result.headers));
        res.end(
          req.method === 'HEAD'
            ? undefined
            : Buffer.from(await result.arrayBuffer()),
        );
        return;
      }
      if (pathname.includes('\\') || pathname.includes('\0')) {
        res.writeHead(400).end();
        return;
      }
      const file = await realpath(
        resolve(
          publicRoot,
          '.' + (pathname === '/' ? '/index.html' : pathname),
        ),
      );
      const local = relative(publicRoot, file);
      if (
        local === '..' ||
        local.startsWith('..' + sep) ||
        resolve(file) === publicRoot
      ) {
        res.writeHead(403).end();
        return;
      }
      const info = await stat(file);
      if (!info.isFile()) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, {
        'Content-Type':
          mime[extname(file).toLowerCase()] ?? 'application/octet-stream',
        'Content-Length': info.size,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control':
          extname(file) === '.html' ? 'no-cache' : 'public, max-age=3600',
      });
      if (req.method === 'HEAD') res.end();
      else await pipeline(createReadStream(file), res);
    } catch (error) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
      res
        .writeHead(missing ? 404 : 400)
        .end(missing ? 'Not found' : 'Request unavailable');
    }
  });
}

if (
  import.meta.url.startsWith('file:') &&
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const port = Number(process.env.SHANTU_WEB_PORT || 8787);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw Error('SHANTU_WEB_PORT must be 1024–65535');
  const server = createDesktopServer(
    resolve(dirname(fileURLToPath(import.meta.url)), 'web'),
  );
  server.on('error', (error) => {
    console.error('山兔网页未启动：', error.message);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}/`;
    console.log(`山兔网页版：${url}\n请保留此窗口，关闭后本地网页服务停止。`);
    if (process.env.SHANTU_NO_OPEN === '1') return;
    const command =
      process.platform === 'win32'
        ? 'cmd.exe'
        : process.platform === 'darwin'
          ? 'open'
          : 'xdg-open';
    execFile(
      command,
      process.platform === 'win32' ? ['/c', 'start', '', url] : [url],
      () => {},
    );
  });
}
