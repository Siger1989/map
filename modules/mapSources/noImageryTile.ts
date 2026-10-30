/** Exact provider error image observed from Tianditu's img_w service. */
const KNOWN_NO_IMAGERY_SHA256 = '4b399ee12503d2278b244fcb0f3804d0c6c8bb42391c2621a53937b97acc494a';
const MISSING_TILE_TTL_MS = 45_000;
const MAX_MISSING_TILES = 256;
const recentMissingTiles = new Map<string, number>();

export class NoImageryTileError extends Error {
  readonly code = 'no-imagery';
  readonly retryAt = 0;
  readonly retryable = false;
  constructor() {
    super('地图图源在此级别没有影像');
    this.name = 'NoImageryTileError';
  }
}

/** Provider-declared missing tiles; authorization and transport failures must never fall back. */
export function isNoImageryResponse(response: Pick<Response, 'status' | 'headers'>): boolean {
  if (response.status === 401 || response.status === 403) return false;
  return response.status === 204 || response.status === 404 || response.status === 410 ||
    (response.status === 200 && response.headers?.get?.('X-VE-Tile-Info')?.trim().toLowerCase() === 'no-tile');
}

/** Match only the known error image, avoiding heuristics that would reject snow or clouds. */
export async function isKnownNoImageryBytes(input: ArrayBuffer | Uint8Array): Promise<boolean> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength !== 4769) return false;
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return false;
  try {
    const digest = await subtle.digest('SHA-256', new Uint8Array(bytes).buffer);
    const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    return hash === KNOWN_NO_IMAGERY_SHA256;
  } catch { return false; }
}

export function parentTile(z: number, x: number, y: number) {
  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y) || z <= 0 || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z)
    throw new RangeError('Invalid parent tile coordinates');
  return { z: z - 1, x: Math.floor(x / 2), y: Math.floor(y / 2) };
}

/** Short-lived, bounded hint only; it never writes missing-child state to persistent caches. */
export function rememberMissingTile(key: string, now = Date.now()) {
  pruneMissingTiles(now);
  recentMissingTiles.delete(key);
  recentMissingTiles.set(key, now + MISSING_TILE_TTL_MS);
  while (recentMissingTiles.size > MAX_MISSING_TILES) recentMissingTiles.delete(recentMissingTiles.keys().next().value!);
}

export function isRecentlyMissingTile(key: string, now = Date.now()): boolean {
  pruneMissingTiles(now);
  return recentMissingTiles.has(key);
}

function pruneMissingTiles(now: number) {
  for (const [key, expiresAt] of recentMissingTiles) {
    if (expiresAt > now) break;
    recentMissingTiles.delete(key);
  }
}

/** Fetch the nearest available ancestor, then crop each child quadrant back to a 256px tile. */
export async function fetchWithParentFallback({
  z, x, y, minZoom = 0, signal, fetchTile, cropTile = cropRasterTile,
  tileKey,
}: {
  z: number; x: number; y: number; minZoom?: number; signal: AbortSignal;
  fetchTile: (z: number, x: number, y: number, signal: AbortSignal) => Promise<ArrayBuffer>;
  cropTile?: (bytes: ArrayBuffer, childX: number, childY: number, scale: number, signal: AbortSignal) => Promise<ArrayBuffer>;
  tileKey?: (z: number, x: number, y: number) => string;
}): Promise<ArrayBuffer> {
  if (![z, x, y, minZoom].every(Number.isInteger) || minZoom < 0 || z < minZoom || z > 30 || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z)
    throw new RangeError('Invalid fallback tile coordinates');
  let current = { z, x, y };
  let bytes: ArrayBuffer;
  while (true) {
    signal.throwIfAborted();
    try {
      const key = tileKey?.(current.z, current.x, current.y);
      if (key && isRecentlyMissingTile(key)) throw new NoImageryTileError();
      bytes = await fetchTile(current.z, current.x, current.y, signal);
      break;
    } catch (error) {
      if (!(error instanceof NoImageryTileError) || current.z <= minZoom) throw error;
      const key = tileKey?.(current.z, current.x, current.y);
      if (key) rememberMissingTile(key);
      current = parentTile(current.z, current.x, current.y);
    }
  }
  const scale = 2 ** (z - current.z);
  if (scale > 1) {
    signal.throwIfAborted();
    const childX = x - current.x * scale, childY = y - current.y * scale;
    bytes = await cropTile(bytes, childX, childY, scale, signal);
  }
  return bytes;
}

export async function cropRasterTile(parentBytes: ArrayBuffer, childX: number, childY: number, scale: number, signal: AbortSignal, outputSize?: number): Promise<ArrayBuffer> {
  signal.throwIfAborted();
  if (!Number.isInteger(scale) || scale < 2 || ![childX, childY].every(value => Number.isInteger(value) && value >= 0 && value < scale)) throw new RangeError('Invalid child tile offset');
  const bitmap = await createImageBitmap(new Blob([parentBytes]));
  try {
    signal.throwIfAborted();
    if (!bitmap.width || !bitmap.height) throw new Error('Parent tile dimensions are invalid');
    const size = outputSize ?? bitmap.width;
    if (!Number.isInteger(size) || size < 1 || size > 8192) throw new Error('Invalid output tile size');
    let canvas: OffscreenCanvas | HTMLCanvasElement;
    let context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
    let offscreen = false;
    if (typeof OffscreenCanvas === 'function') {
      canvas = new OffscreenCanvas(size, size);
      context = canvas.getContext('2d');
      offscreen = true;
    } else {
      if (typeof document === 'undefined') throw new Error('Canvas is unavailable');
      canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
      context = canvas.getContext('2d');
    }
    if (!context) throw new Error('Canvas context is unavailable');
    context.drawImage(bitmap, childX * bitmap.width / scale, childY * bitmap.height / scale, bitmap.width / scale, bitmap.height / scale, 0, 0, size, size);
    signal.throwIfAborted();
    const blob = offscreen
      ? await (canvas as OffscreenCanvas).convertToBlob({ type: 'image/png' })
      : await new Promise<Blob>((resolve, reject) => (canvas as HTMLCanvasElement).toBlob(value => value ? resolve(value) : reject(new Error('Tile crop encoding failed')), 'image/png'));
    signal.throwIfAborted();
    return blob.arrayBuffer();
  } finally { bitmap.close(); }
}
