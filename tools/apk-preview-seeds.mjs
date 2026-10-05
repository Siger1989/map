import { readFile } from 'node:fs/promises';

const assetPath = '/native/default-map-sources.json';
const loopback = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '::ffff:127.0.0.1']);

/** Private APK seed configuration is served only to the opted-in loopback preview. */
export function apkPreviewSeeds({ enabled, privatePath }) {
  return {
    name: 'shantu-private-apk-preview-seeds',
    apply: 'serve',
    configureServer(server) {
      if (!enabled) return;
      server.middlewares.use(async (req, res, next) => {
        if ((req.url ?? '/').split('?', 1)[0] !== assetPath) return next();
        const configuredHost = server.config.server.host;
        let incoming;
        try { incoming = new URL(`http://${req.headers.host ?? ''}`); } catch {}
        const address = server.httpServer?.address();
        const listenPort = address && typeof address === 'object' ? address.port : server.config.server.port;
        const permitted = (!configuredHost || typeof configuredHost === 'string' && loopback.has(configuredHost)) &&
          loopback.has(req.socket.remoteAddress) && incoming && loopback.has(incoming.hostname) &&
          !incoming.username && !incoming.password && Number(incoming.port || 80) === listenPort &&
          req.headers['sec-fetch-site'] !== 'cross-site' &&
          (!req.headers.origin || req.headers.origin === incoming.origin);
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        if (!permitted) { res.statusCode = 404; res.end('Not found'); return; }
        if (!['GET', 'HEAD'].includes(req.method)) { res.statusCode = 405; res.end('Method not allowed'); return; }
        try {
          const bytes = await readFile(privatePath);
          if (bytes.byteLength > 1024 * 1024) throw Error('Invalid seed size');
          const manifest = JSON.parse(bytes.toString('utf8'));
          if (manifest.version !== 1 || !Array.isArray(manifest.maps) || !manifest.maps.length || manifest.maps.length > 100)
            throw Error('Invalid seed manifest');
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Content-Length', String(bytes.byteLength));
          res.end(req.method === 'HEAD' ? undefined : bytes);
        } catch { res.statusCode = 404; res.end('Preview seed configuration unavailable'); }
      });
    },
  };
}
