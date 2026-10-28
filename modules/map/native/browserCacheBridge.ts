import type { NativeMapBridgeClient } from './client.ts';
import { readSelectedBrowserPackageCache } from '../../outdoor/tileCache.ts';
import { readNativeOfflineDisplayPolicy } from './offlineMode.ts';

const MAX_TILE_BYTES = 4 * 1024 * 1024;
const MAX_ACTIVE_REQUESTS = 4;
const REQUEST_TIMEOUT_MS = 2000;

type CacheRequest = { requestId: string; packageId: string; url: string; urlHash: string; maxBytes?: number };

/** Handles native cache reads from the selected browser package only; it never issues a fetch request. */
export function installNativeBrowserCacheBridge(client: NativeMapBridgeClient, mapId: string): () => void {
  const active = new Map<string, { controller: AbortController; timer: ReturnType<typeof setTimeout>; packageId: string; urlHash: string }>();
  let closed = false;
  const respond = (request: CacheRequest, found: boolean, extra: Record<string, unknown> = {}) => {
    if (closed || !client.isReady) return;
    try { client.notify(mapId, 'cachedTileResponse', {
      requestId: request.requestId, packageId: request.packageId, urlHash: request.urlHash, found, ...extra,
    }); } catch { /* Host may have closed this map/session while a cache read was in progress. */ }
  };
  const onRequest = (value: unknown, event: { sessionId?: string; mapId?: string }) => {
    const request = validateRequest(value);
    if (!request || closed || event.mapId !== mapId || event.sessionId !== client.sessionId) return;
    const policy = readNativeOfflineDisplayPolicy();
    if (!policy.enabled || policy.packageId !== request.packageId || active.size >= MAX_ACTIVE_REQUESTS || active.has(request.requestId)) {
      respond(request, false); return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const pending = active.get(request.requestId);
      if (pending?.controller !== controller) return;
      active.delete(request.requestId);
      controller.abort();
      respond(request, false);
    }, REQUEST_TIMEOUT_MS);
    active.set(request.requestId, { controller, timer, packageId: request.packageId, urlHash: request.urlHash });
    void (async () => {
      try {
        if (await sha256Hex(request.url) !== request.urlHash) { respond(request, false); return; }
        const response = await readSelectedBrowserPackageCache(request.url, request.packageId, controller.signal);
        if (!response || controller.signal.aborted) { respond(request, false); return; }
        const bytes = await readBoundedResponse(response, Math.min(MAX_TILE_BYTES, request.maxBytes ?? MAX_TILE_BYTES), controller.signal);
        if (controller.signal.aborted || !bytes.length || bytes.byteLength > Math.min(MAX_TILE_BYTES, request.maxBytes ?? MAX_TILE_BYTES)) {
          respond(request, false); return;
        }
        const current = readNativeOfflineDisplayPolicy();
        if (!current.enabled || current.packageId !== request.packageId) { respond(request, false); return; }
        respond(request, true, { bytesBase64: toBase64(bytes), bodySha256: await sha256Hex(bytes) });
      } catch {
        if (!controller.signal.aborted) respond(request, false);
      } finally {
        const pending = active.get(request.requestId);
        if (pending?.controller === controller) {
          clearTimeout(pending.timer);
          active.delete(request.requestId);
        }
      }
    })();
  };
  const onCancel = (value: unknown, event: { sessionId?: string; mapId?: string }) => {
    if (closed || event.mapId !== mapId || event.sessionId !== client.sessionId || !isRecord(value)) return;
    const requestId = value.requestId;
    if (typeof requestId !== 'string') return;
    const pending = active.get(requestId);
    if (!pending || value.packageId !== pending.packageId || value.urlHash !== pending.urlHash) return;
    clearTimeout(pending.timer); active.delete(requestId); pending.controller.abort();
  };
  const unsubscribeRequest = client.subscribe(mapId, 'cachedTileRequest', onRequest);
  const unsubscribeCancel = client.subscribe(mapId, 'cachedTileCancel', onCancel);
  return () => {
    if (closed) return;
    closed = true;
    unsubscribeRequest(); unsubscribeCancel();
    for (const pending of active.values()) { clearTimeout(pending.timer); pending.controller.abort(); }
    active.clear();
  };
}

function validateRequest(value: unknown): CacheRequest | null {
  if (!isRecord(value)) return null;
  const { requestId, packageId, url, urlHash, maxBytes } = value;
  if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(requestId) ||
    typeof packageId !== 'string' || packageId.length < 1 || packageId.length > 160 ||
    typeof url !== 'string' || url.length < 1 || url.length > 8192 ||
    typeof urlHash !== 'string' || !/^[a-f0-9]{64}$/.test(urlHash) ||
    (maxBytes !== undefined && (!Number.isSafeInteger(maxBytes) || (maxBytes as number) < 1 || (maxBytes as number) > MAX_TILE_BYTES))) return null;
  try {
    const parsed = new URL(url);
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash) return null;
  } catch { return null; }
  return { requestId, packageId, url, urlHash, maxBytes: maxBytes as number | undefined };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + 0x8000)));
  return btoa(binary);
}

async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const input = bytes.slice().buffer as ArrayBuffer;
  const digest = await crypto.subtle.digest('SHA-256', input);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function readBoundedResponse(response: Response, maximum: number, signal: AbortSignal): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maximum) throw new Error('cached tile exceeds byte limit');
  const reader = response.body?.getReader();
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maximum) throw new Error('cached tile exceeds byte limit');
    return bytes;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximum) { await reader.cancel(); throw new Error('cached tile exceeds byte limit'); }
      chunks.push(value);
    }
  } finally {
    if (signal.aborted) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
