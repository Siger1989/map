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

export function createPinnedRequester({
  connectTcp = net.connect,
  connectTls = tls.connect,
  maxEntries = 16,
  idleTimeoutMs = 30_000,
} = {}) {
  const agents = new Map();

  function destroyEntry(key, entry) {
    if (entry.active || agents.get(key) !== entry) return false;
    clearTimeout(entry.timer);
    agents.delete(key);
    entry.agent.destroy();
    return true;
  }

  function scheduleIdleEviction(key, entry) {
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      if (entry.active || agents.get(key) !== entry) return;
      const remaining = idleTimeoutMs - (Date.now() - entry.lastUsed);
      if (remaining > 0) scheduleIdleEviction(key, entry);
      else destroyEntry(key, entry);
    }, idleTimeoutMs);
    entry.timer.unref?.();
  }

  function acquire(url, hostname, address, family, port) {
    const secure = url.protocol === 'https:';
    const servername = secure && !net.isIP(hostname) ? hostname : '';
    // DNS is resolved and validated for every request before this key is used.
    const key = JSON.stringify([url.protocol, hostname, servername, address, family, port]);
    let entry = agents.get(key);
    if (entry) {
      clearTimeout(entry.timer);
      entry.timer = undefined;
      entry.active++;
      entry.lastUsed = Date.now();
      return { agent: entry.agent, release() { release(key, entry); } };
    }

    // Opportunistically trim expired entries and make room only by evicting idle agents.
    const now = Date.now();
    for (const [candidateKey, candidate] of agents) {
      if (!candidate.active && now - candidate.lastUsed >= idleTimeoutMs) destroyEntry(candidateKey, candidate);
    }
    if (agents.size >= maxEntries) {
      const oldest = [...agents.entries()]
        .filter(([, candidate]) => !candidate.active)
        .sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
      if (oldest) destroyEntry(oldest[0], oldest[1]);
    }

    // If every pool slot is busy, do not expand memory/socket bounds or evict active users.
    if (agents.size >= maxEntries) {
      const oneShot = secure ? new https.Agent({ keepAlive: false, maxSockets: 1 }) : new http.Agent({ keepAlive: false, maxSockets: 1 });
      oneShot.createConnection = createConnection;
      return { agent: oneShot, release() { oneShot.destroy(); } };
    }

    const agentOptions = { keepAlive: true, maxSockets: 4, maxFreeSockets: 2, maxTotalSockets: 4 };
    const agent = secure ? new https.Agent(agentOptions) : new http.Agent(agentOptions);
    agent.createConnection = createConnection;
    function createConnection(_options, callback) {
      return secure
        ? connectTls({ host: address, family, port, servername: servername || undefined, rejectUnauthorized: true }, callback)
        : connectTcp({ host: address, family, port }, callback);
    }

    entry = { agent, active: 1, lastUsed: Date.now(), timer: undefined };
    agents.set(key, entry);
    return { agent, release() { release(key, entry); } };
  }

  function release(key, entry) {
    if (entry.active <= 0) return;
    entry.active--;
    if (!entry.active && agents.get(key) === entry) scheduleIdleEviction(key, entry);
  }

  return function requestPinned(url, hostname, address, family, port, timeoutMs, maxBytes, signal) {
    return new Promise((resolve, reject) => {
    const secure = url.protocol === 'https:';
    const transport = secure ? https : http;
    const lease = acquire(url, hostname, address, family, port);
    const { agent } = lease;
    let leaseReleased = false;
    const releaseLease = () => {
      if (leaseReleased) return;
      leaseReleased = true;
      lease.release();
    };
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
    let settled = false;
    const settleReject = (error) => { if (settled) return; settled = true; reject(error); };
    const settleResolve = (value) => { if (settled) return; settled = true; resolve(value); };
    let request;
    try { request = transport.request(options, (response) => {
      const status = response.statusCode ?? 0;
      const location = response.headers.location;
      if ([301, 302, 303, 307, 308].includes(status) && location) {
        settleResolve({ status, location });
        response.destroy();
        return;
      }
      const mime = String(response.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase();
      const declared = Number(response.headers['content-length']);
      if (status !== 200 || (Number.isFinite(declared) && declared > maxBytes)) {
        response.destroy();
        settleReject(Object.assign(new Error('Map tile response rejected'), { upstreamStatus: status }));
        return;
      }
      const chunks = [];
      let total = 0;
      response.on('data', (chunk) => {
        total += chunk.length;
        if (total > maxBytes) {
          response.destroy(new Error('Map tile response too large'));
          settleReject(new Error('Map tile response too large'));
          return;
        }
        chunks.push(chunk);
      });
      response.once('error', settleReject);
      response.once('end', () => {
        const body = Buffer.concat(chunks, total), verifiedMime = imageMime(body);
        if (!verifiedMime) { settleReject(Object.assign(new Error('Map tile is not an image'), { upstreamStatus: status })); return; }
        settleResolve({ status: 200, mime: verifiedMime, body });
      });
    }); } catch (error) { releaseLease(); settleReject(error); return; }
    const cleanup = () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    };
    const fail = (error) => {
      if (settled) return;
      settleReject(error);
      cleanup();
      releaseLease();
      request.destroy(error);
    };
    const timeout = setTimeout(() => fail(new Error('Map tile request timed out')), timeoutMs);
    const abort = () => fail(signal.reason instanceof Error ? signal.reason : new Error('Map tile request aborted'));
    request.once('error', (error) => { cleanup(); releaseLease(); settleReject(error); });
    request.once('close', () => { cleanup(); releaseLease(); });
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
    request.end();
    });
  };
}

const requestPinned = createPinnedRequester();

export async function fetchPublicMapTile(rawUrl, {
  lookup = dns.lookup,
  request = requestPinned,
  timeoutMs = TIMEOUT_MS,
  maxBytes = MAX_BYTES,
  signal,
} = {}) {
  let current = rawUrl;
  const deadlineAt = Date.now() + timeoutMs;
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(new Error('Map tile request timed out')), timeoutMs);
  const abort = () => deadline.abort(signal.reason instanceof Error ? signal.reason : new Error('Map tile request aborted'));
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const raceSignal = (promise) => new Promise((resolve, reject) => {
    if (deadline.signal.aborted) { reject(deadline.signal.reason); return; }
    const onAbort = () => reject(deadline.signal.reason);
    deadline.signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => deadline.signal.removeEventListener('abort', onAbort));
  });
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const remainingMs = deadlineAt - Date.now();
      if (remainingMs <= 0) throw new Error('Map tile request timed out');
      const { url, hostname, port } = validateUrl(current);
      const records = await raceSignal(resolvePublic(hostname, lookup));
      const response = await raceSignal(request(
        url, hostname, records[0].address, records[0].family, port, remainingMs, maxBytes, deadline.signal,
      ));
      if (!response.location) {
        if (response.status !== 200 || !MIME.has(response.mime) || !response.body || response.body.byteLength > maxBytes)
          throw new Error('Map tile response rejected');
        return response;
      }
      if (hop === MAX_REDIRECTS) throw new Error('Too many map tile redirects');
      current = new URL(response.location, url).href;
    }
    throw new Error('Map tile request failed');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
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
