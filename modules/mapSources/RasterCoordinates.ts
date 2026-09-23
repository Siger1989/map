import type { AddProtocolAction, Map as LibreMap, RasterTileSource } from 'maplibre-gl';
import { cachedMapFetch } from '../outdoor/tileCache';
import { warpPlan, type RasterDatum, type WarpPlan } from './coordinates';
import workerUrl from './rasterWarp.worker.ts?worker&url';

let instance = 0;
type Binding = { id: number; source: RasterTileSource; tiles: string[]; scheme: 'xyz' | 'tms'; datum: RasterDatum; abort: AbortController };
export function rasterTileUrl(templates: string[], z: number, x: number, y: number, scheme: 'xyz' | 'tms') {
  const n = 2 ** z, world = 40075016.68557849;
  x = ((x % n) + n) % n;
  const bbox = [x/n*world-world/2, world/2-(y+1)/n*world, (x+1)/n*world-world/2, world/2-y/n*world].join(',');
  let quadkey = ''; for (let i = z; i > 0; i--) quadkey += ((x >> (i-1)) & 1) + 2 * ((y >> (i-1)) & 1);
  return templates[(x + y) % templates.length].replaceAll('{z}', String(z)).replaceAll('{x}', String(x))
    .replaceAll('{y}', String(scheme === 'tms' ? n-y-1 : y)).replaceAll('{ratio}', '')
    .replaceAll('{bbox-epsg-3857}', bbox).replaceAll('{quadkey}', quadkey)
    .replaceAll('{prefix}', (x%16).toString(16)+(y%16).toString(16));
}

/** Correct only selected raster sources; terrain, camera, stored tracks and markers stay WGS84. */
export class RasterCoordinates {
  readonly scheme = `shantu-crs-${++instance}`;
  private serial = 0;
  private bindings = new Map<RasterTileSource, Binding>();
  private cache = new Map<string, ArrayBuffer>();
  private cacheBytes = 0;
  private active = 0;
  private waiting = new Set<() => void>();
  private idleWorkers: Worker[] = [];
  private closed = false;
  constructor(private map: LibreMap, private localProtocol: AddProtocolAction) {}

  sync(ids: string[], datum: RasterDatum) {
    const active = new Set(ids.map(id => this.map.getSource(id)).filter(s => s?.type === 'raster'));
    for (const [source, binding] of this.bindings) {
      if (active.has(source) && binding.datum === datum) continue;
      this.bindings.delete(source);
      binding.abort.abort();
      if (this.map.getSource(source.id) === source) {
        source.scheme = binding.scheme;
        source.setTiles(binding.tiles);
      }
      this.cache.clear(); this.cacheBytes = 0;
    }
    if (datum === 'wgs84' || this.closed) return;
    for (const raw of active) {
      const source = raw as RasterTileSource;
      if (this.bindings.has(source) || !source.tiles?.length) continue;
      const binding: Binding = { id: ++this.serial, source, tiles: [...source.tiles], scheme: source.scheme === 'tms' ? 'tms' : 'xyz', datum, abort: new AbortController() };
      this.bindings.set(source, binding);
      source.scheme = 'xyz';
      source.setTiles([`${this.scheme}://${binding.id}/{z}/{x}/{y}`]);
    }
  }

  fetch = async (url: string, signal: AbortSignal): Promise<Response> => {
    if (url.startsWith(`${this.scheme}://`)) {
      const abort = new AbortController(), cancel = () => abort.abort(signal.reason);
      signal.addEventListener('abort', cancel, { once: true });
      try {
        signal.throwIfAborted();
        const result = await this.protocol({ url, type: 'arrayBuffer' }, abort);
        return new Response(result.data as ArrayBuffer, { headers: { 'Content-Type': 'image/png' } });
      } finally { signal.removeEventListener('abort', cancel); }
    }
    if (url.startsWith('shantu-map://')) {
      const abort = new AbortController(), cancel = () => abort.abort(signal.reason);
      signal.addEventListener('abort', cancel, { once: true });
      try { signal.throwIfAborted(); return new Response((await this.localProtocol({ url, type: 'arrayBuffer' }, abort)).data as ArrayBuffer); }
      finally { signal.removeEventListener('abort', cancel); }
    }
    return cachedMapFetch(url, signal);
  };

  private async slot(signal: AbortSignal) {
    if (this.waiting.size >= 96) throw Error('坐标校正队列已满，请稍后重试');
    while (this.active >= 2) {
      signal.throwIfAborted();
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => { this.waiting.delete(wake); signal.removeEventListener('abort', cancel); };
        const wake = () => { cleanup(); resolve(); };
        const cancel = () => { cleanup(); reject(signal.reason); };
        this.waiting.add(wake); signal.addEventListener('abort', cancel, { once: true });
      });
    }
    signal.throwIfAborted();
    this.active++;
  }

  private warp(plan: WarpPlan, tiles: ArrayBuffer[], signal: AbortSignal): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const worker = this.idleWorkers.pop() ?? new Worker(new URL(workerUrl, window.location.href), { type: 'module' });
      const finish = (reusable: boolean) => {
        signal.removeEventListener('abort', cancel); worker.onmessage = null; worker.onerror = null;
        if (reusable && !this.closed) this.idleWorkers.push(worker); else worker.terminate();
      };
      const cancel = () => { finish(false); reject(signal.reason); };
      if (signal.aborted) { cancel(); return; }
      signal.addEventListener('abort', cancel, { once: true });
      worker.onerror = () => { finish(false); reject(Error('坐标校正模块不可用，请恢复 WGS84')); };
      worker.onmessage = ({ data }) => { finish(true); if (data.error) reject(Error(data.error)); else resolve(data.bytes); };
      worker.postMessage({ plan, tiles }, tiles);
    });
  }

  protocol: AddProtocolAction = async (params, requestAbort) => {
    const match = new RegExp(`^${this.scheme}://(\\d+)/(\\d+)/(\\d+)/(\\d+)$`).exec(params.url);
    const binding = [...this.bindings.values()].find(b => b.id === Number(match?.[1]));
    if (!match || !binding || this.closed) throw new DOMException('图源已切换', 'AbortError');
    requestAbort.signal.throwIfAborted();
    const cached = this.cache.get(params.url);
    if (cached) { this.cache.delete(params.url); this.cache.set(params.url, cached); return { data: cached.slice(0) }; }
    const abort = new AbortController(), cancel = () => abort.abort(new DOMException('图源已切换或请求已取消', 'AbortError'));
    requestAbort.signal.addEventListener('abort', cancel, { once: true });
    binding.abort.signal.addEventListener('abort', cancel, { once: true });
    const timeout = setTimeout(() => abort.abort(new DOMException('坐标校正图源请求超时', 'TimeoutError')), 20000);
    let acquired = false;
    try {
      await this.slot(abort.signal); acquired = true;
      const z = Number(match[2]), x = Number(match[3]), y = Number(match[4]);
      if (!Number.isInteger(z) || z < 0 || z > 22 || x >= 2**z || y >= 2**z) throw Error('无效瓦片坐标');
      const plan = warpPlan(z, x, y, binding.source.tileSize, binding.datum);
      const tiles: ArrayBuffer[] = [];
      // Bounded input fan-out, and the same offline/native fetch path as the map.
      for (let row = 0; row < plan.height; row++) for (let col = 0; col < plan.width; col++) {
        const response = await this.fetch(rasterTileUrl(binding.tiles, z, plan.left+col, plan.top+row, binding.scheme), abort.signal);
        if (!response.ok) throw Error(`图源瓦片请求失败 (${response.status})`);
        tiles.push(await response.arrayBuffer());
      }
      const bytes = await this.warp(plan, tiles, abort.signal);
      abort.signal.throwIfAborted();
      this.cache.set(params.url, bytes); this.cacheBytes += bytes.byteLength;
      while (this.cache.size > 48 || this.cacheBytes > 16*1024*1024) {
        const first = this.cache.keys().next().value!; this.cacheBytes -= this.cache.get(first)!.byteLength; this.cache.delete(first);
      }
      return { data: bytes.slice(0) };
    } finally {
      clearTimeout(timeout); requestAbort.signal.removeEventListener('abort', cancel); binding.abort.signal.removeEventListener('abort', cancel);
      if (acquired) { this.active--; for (const wake of [...this.waiting]) wake(); }
    }
  };
  dispose() {
    this.closed = true;
    for (const binding of this.bindings.values()) binding.abort.abort();
    this.bindings.clear(); this.cache.clear(); this.cacheBytes = 0;
    for (const worker of this.idleWorkers) worker.terminate(); this.idleWorkers = [];
  }
}
