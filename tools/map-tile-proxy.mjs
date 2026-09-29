import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';

const TIMEOUT_MS = 12_000;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 4;
const ALLOWED_PORTS = new Set([80, 443, 8000, 8080, 8443, 8880, 8888, 20262]);
const MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/gif']);

function imageMime(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))) return 'image/gif';
  if (bytes.length >= 16 && bytes.toString('ascii', 4, 8) === 'ftyp' && ['avif', 'avis'].includes(bytes.toString('ascii', 8, 12))) return 'image/avif';
  return undefined;
}

function ipv4Number(value) {
  return value.split('.').reduce((number, part) => (number * 256) + Number(part), 0) >>> 0;
}

function inV4(address, base, bits) {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipv4Number(address) & mask) === (ipv4Number(base) & mask);
}

function publicV4(address) {
  const blocked = [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
    ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
    ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
    ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
  ];
  return !blocked.some(([base, bits]) => inV4(address, base, bits));
}

function publicV6(address) {
  const normalized = address.toLowerCase().split('%')[0];
  if (normalized.startsWith('::ffff:') || normalized === '::' || normalized === '::1') return false;
  // Only global unicast is accepted. Special-purpose/documentation and transition ranges are excluded.
  if (!/^[23][0-9a-f]{3}:/.test(normalized)) return false;
  const halves = normalized.split('::');
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length > 1 && halves[1] ? halves[1].split(':') : [];
  const words = [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  if (words.length !== 8 || words.some((word) => !/^[0-9a-f]{1,4}$/.test(word))) return false;
  const value = BigInt(`0x${words.map((word) => word.padStart(4, '0')).join('')}`);
  const special2001 = value >= 0x20010000000000000000000000000000n && value < 0x20010200000000000000000000000000n;
  const documentation =
    (value >= 0x20010db8000000000000000000000000n && value < 0x20010db9000000000000000000000000n) ||
    (value >= 0x3fff0000000000000000000000000000n && value < 0x3fff1000000000000000000000000000n);
  const transition6to4 = value >= 0x20020000000000000000000000000000n && value < 0x20030000000000000000000000000000n;
  return (value >> 125n) === 1n && !special2001 && !documentation && !transition6to4;
}

export function isPublicAddress(address) {
  const family = net.isIP(address.split('%')[0]);
  return family === 4 ? publicV4(address) : family === 6 ? publicV6(address) : false;
}

function validateUrl(raw) {
  if (typeof raw !== 'string' || raw.length < 1 || raw.length > 4096 || /[\u0000-\u0020{}\\]/.test(raw))
    throw new Error('Invalid map tile URL');
  let url;
  try { url = new URL(raw); } catch { throw new Error('Invalid map tile URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Unsupported map tile URL');
  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
  if (!ALLOWED_PORTS.has(port)) throw new Error('Unsupported map tile port');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (!hostname || hostname.endsWith('.') || hostname.includes('%'))
    throw new Error('Invalid map tile host');
  return { url, hostname, port };
}

async function resolvePublic(hostname, lookup) {
  let records;
  if (net.isIP(hostname)) records = [{ address: hostname, family: net.isIP(hostname) }];
  else records = await lookup(hostname, { all: true, verbatim: true });
  if (!records?.length || records.some((record) => !isPublicAddress(record.address)))
    throw new Error('Map tile host is not public');
  return records;
}

function requestPinned(url, hostname, address, family, port, timeoutMs, maxBytes, signal) {
  return new Promise((resolve, reject) => {
    const secure = url.protocol === 'https:';
    const transport = secure ? https : http;
    const agent = secure ? new https.Agent({ keepAlive: false }) : new http.Agent({ keepAlive: false });
    agent.createConnection = () => secure
      ? tls.connect({ host: address, family, port, servername: net.isIP(hostname) ? undefined : hostname, rejectUnauthorized: true })
      : net.connect({ host: address, family, port });
    const options = {
      protocol: url.protocol,
      hostname: url.hostname,
      port,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      agent,
      headers: {
        Accept: 'image/avif,image/webp,image/png,image/jpeg',
        'Accept-Encoding': 'identity',
        'User-Agent': 'Shantu-Map-Tile/1.0',
      },
      ...(secure && !net.isIP(hostname) ? { servername: hostname } : {}),
    };
    const request = transport.request(options, (response) => {
      const status = response.statusCode ?? 0;
      const location = response.headers.location;
      if ([301, 302, 303, 307, 308].includes(status) && location) {
        response.resume();
        agent.destroy();
        resolve({ status, location });
        return;
      }
      const mime = String(response.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase();
      const declared = Number(response.headers['content-length']);
      if (status !== 200 || (Number.isFinite(declared) && declared > maxBytes)) {
        response.destroy();
        agent.destroy();
        reject(Object.assign(new Error('Map tile response rejected'), { upstreamStatus: status }));
        return;
      }
      const chunks = [];
      let total = 0;
      response.on('data', (chunk) => {
        total += chunk.length;
        if (total > maxBytes) {
          response.destroy(new Error('Map tile response too large'));
          return;
        }
        chunks.push(chunk);
      });
      response.once('error', (error) => { agent.destroy(); reject(error); });
      response.once('end', () => {
        agent.destroy();
        const body = Buffer.concat(chunks, total), verifiedMime = imageMime(body);
        if (!verifiedMime) { reject(Object.assign(new Error('Map tile is not an image'), { upstreamStatus: status })); return; }
        resolve({ status: 200, mime: verifiedMime, body });
      });
    });
    const timeout = setTimeout(() => request.destroy(new Error('Map tile request timed out')), timeoutMs);
    const abort = () => request.destroy(signal.reason instanceof Error ? signal.reason : new Error('Map tile request aborted'));
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
    request.once('error', (error) => { clearTimeout(timeout); signal?.removeEventListener('abort', abort); agent.destroy(); reject(error); });
    request.once('close', () => { clearTimeout(timeout); signal?.removeEventListener('abort', abort); });
    request.end();
  });
}

export async function fetchPublicMapTile(rawUrl, {
  lookup = dns.lookup,
  request = requestPinned,
  timeoutMs = TIMEOUT_MS,
  maxBytes = MAX_BYTES,
  signal,
} = {}) {
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const { url, hostname, port } = validateUrl(current);
    const records = await resolvePublic(hostname, lookup);
    const response = await request(url, hostname, records[0].address, records[0].family, port, timeoutMs, maxBytes, signal);
    if (!response.location) {
      if (response.status !== 200 || !MIME.has(response.mime) || !response.body || response.body.byteLength > maxBytes)
        throw new Error('Map tile response rejected');
      return response;
    }
    if (hop === MAX_REDIRECTS) throw new Error('Too many map tile redirects');
    current = new URL(response.location, url).href;
  }
  throw new Error('Map tile request failed');
}

export async function proxyMapTileRequest(request) {
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  const rawUrl = new URL(request.url).searchParams.get('url');
  if (!rawUrl) return new Response('Missing tile URL', { status: 400 });
  try {
    const tile = await fetchPublicMapTile(rawUrl, { signal: request.signal });
    return new Response(tile.body, {
      status: 200,
      headers: {
        'Content-Type': tile.mime,
        'Cache-Control': 'private, max-age=300',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return new Response('Map tile unavailable', {
      status: 502,
      headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
    });
  }
}

export function mapTileVitePlugin() {
  return {
    name: 'shantu-map-tile-proxy',
    enforce: 'pre',
    configureServer(server) {
      server.middlewares.use('/api/map-tile', async (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405;
          res.end('Method not allowed');
          return;
        }
        try {
          const incoming = new URL(req.url ?? '/', 'http://vite.local');
          if (incoming.pathname !== '/') {
            res.statusCode = 404;
            res.end('Not found');
            return;
          }
          const rawUrl = incoming.searchParams.get('url');
          if (!rawUrl) {
            res.statusCode = 400;
            res.end('Missing tile URL');
            return;
          }
          const abort = new AbortController();
          const cancel = () => abort.abort();
          res.once('close', cancel);
          let tile;
          try { tile = await fetchPublicMapTile(rawUrl, { signal: abort.signal }); }
          finally { res.removeListener('close', cancel); }
          res.statusCode = 200;
          res.setHeader('Content-Type', tile.mime);
          res.setHeader('Cache-Control', 'private, max-age=300');
          res.setHeader('X-Content-Type-Options', 'nosniff');
          res.end(tile.body);
        } catch {
          res.statusCode = 502;
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader('X-Content-Type-Options', 'nosniff');
          res.end('Map tile unavailable');
        }
      });
    },
  };
}
