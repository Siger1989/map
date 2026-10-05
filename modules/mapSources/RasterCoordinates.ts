import type { AddProtocolAction, Map as LibreMap, RasterTileSource } from 'maplibre-gl';
import { warpPlan, type RasterDatum, type WarpPlan } from './coordinates';
import { SharedTileFetch } from './sharedTileFetch.ts';
import { fetchDirectRasterTile } from './tileTransport.ts';
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
  private stages = {
    pipeline: { active: 0, limit: 4, waiting: new Set<() => void>() },
    worker: { active: 0, limit: 2, waiting: new Set<() => void>() },
  };
  private idleWorkers: Worker[] = [];
  private inputTiles = new SharedTileFetch(4, 96);
  private stats = { started: 0, completed: 0, cancelled: 0, failed: 0, outputHits: 0 };
  private timings: Record<string, { count: number; totalMs: number; maxMs: number }> = {};
  private closed = false;
  constructor(private map: LibreMap, private localProtocol: AddProtocolAction, private mapScheme = 'shantu-map') {}

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
      this.inputTiles.clear();
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

  private recordTime(stage: string, started: number) {
    const ms = performance.now() - started;
    const entry = this.timings[stage] ??= { count: 0, totalMs: 0, maxMs: 0 };
    entry.count++; entry.totalMs += ms; entry.maxMs = Math.max(entry.maxMs, ms);
  }

  /** Bounded aggregate diagnostics; never exposes provider URLs or credentials. */
  snapshot() {
    return {
      ...this.stats, input: this.inputTiles.snapshot(),
      output: { entries: this.cache.size, bytes: this.cacheBytes },
      stages: Object.fromEntries(Object.entries(this.timings).map(([name, value]) => [name, {
        count: value.count, totalMs: Math.round(value.totalMs), maxMs: Math.round(value.maxMs),
      }])),
    };
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
    if (url.startsWith(`${this.mapScheme}://`)) {
      const abort = new AbortController(), cancel = () => abort.abort(signal.reason);
      signal.addEventListener('abort', cancel, { once: true });
      const request = { url, type: 'arrayBuffer' as const };
      try { signal.throwIfAborted(); return new Response((await this.localProtocol(request, abort)).data as ArrayBuffer); }
      finally { signal.removeEventListener('abort', cancel); }
    }
    signal.throwIfAborted();
    return fetchDirectRasterTile(url, signal);
  };

  private async slot(signal: AbortSignal, stageName: keyof typeof this.stages = 'pipeline') {
    const stage = this.stages[stageName];
    if (stage.waiting.size >= 96) throw Error('坐标校正队列已满，请稍后重试');
    while (stage.active >= stage.limit) {
      signal.throwIfAborted();
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => { stage.waiting.delete(wake); signal.removeEventListener('abort', cancel); };
        const wake = () => { cleanup(); resolve(); };
        const cancel = () => { cleanup(); reject(signal.reason); };
        stage.waiting.add(wake); signal.addEventListener('abort', cancel, { once: true });
      });
    }
    signal.throwIfAborted();
    stage.active++;
  }

  private release(stageName: keyof typeof this.stages) {
    const stage = this.stages[stageName];
    stage.active--;
    for (const wake of [...stage.waiting]) wake();
  }

  private async coalesceZoom(signal: AbortSignal) {
    // An animated zoom crosses several tile levels in a few frames. Give those
    // short-lived requests time to be cancelled before they occupy network slots.
    if (!this.map.isZooming?.()) return;
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const cancel = () => { clearTimeout(timer); signal.removeEventListener('abort', cancel); reject(signal.reason); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, 90);
      signal.addEventListener('abort', cancel, { once: true });
    });
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
    if (cached) { this.stats.outputHits++; this.cache.delete(params.url); this.cache.set(params.url, cached); return { data: cached.slice(0) }; }
    this.stats.started++;
    const started = performance.now();
    const abort = new AbortController(), cancel = () => abort.abort(new DOMException('图源已切换或请求已取消', 'AbortError'));
    requestAbort.signal.addEventListener('abort', cancel, { once: true });
    binding.abort.signal.addEventListener('abort', cancel, { once: true });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let acquired = false;
    let workerAcquired = false;
    try {
      await this.coalesceZoom(abort.signal);
      await this.slot(abort.signal); acquired = true;
      this.recordTime('pipelineQueue', started);
      timeout = setTimeout(() => abort.abort(new DOMException('坐标校正图源请求超时', 'TimeoutError')), 20000);
      const z = Number(match[2]), x = Number(match[3]), y = Number(match[4]);
      if (!Number.isInteger(z) || z < 0 || z > 24 || x >= 2**z || y >= 2**z) throw Error('无效瓦片坐标');
      const plan = warpPlan(z, x, y, binding.source.tileSize, binding.datum);
      const inputs: { key: string; url: string }[] = [];
      for (let row = 0; row < plan.height; row++) for (let col = 0; col < plan.width; col++) {
        const url = rasterTileUrl(binding.tiles, z, plan.left + col, plan.top + row, binding.scheme);
        inputs.push({ key: `${binding.id}\u0000${url}`, url });
      }
      // The scheduler caps all source-tile requests across this map instance and
      // reuses completed neighbours as well as requests still in flight.
      let tiles: ArrayBuffer[];
      const downloadStart = performance.now();
      try {
        tiles = await Promise.all(inputs.map(({ key, url }) => this.inputTiles.request(key, abort.signal, async signal => {
          const response = await this.fetch(url, signal);
          if (!response.ok) throw Error(`图源瓦片请求失败 (${response.status})`);
          return response.arrayBuffer();
        })));
      } catch (error) {
        abort.abort(error);
        throw error;
      } finally {
        this.recordTime('inputWait', downloadStart);
      }
      const workerStart = performance.now();
      await this.slot(abort.signal, 'worker'); workerAcquired = true;
      this.recordTime('workerQueue', workerStart);
      const warpStart = performance.now();
      let bytes: ArrayBuffer;
      try { bytes = await this.warp(plan, tiles, abort.signal); }
      catch (error) {
        if (!abort.signal.aborted) this.inputTiles.forget(inputs.map(input => input.key));
        throw error;
      } finally { this.recordTime('warp', warpStart); }
      abort.signal.throwIfAborted();
      this.cacheBytes -= this.cache.get(params.url)?.byteLength ?? 0;
      this.cache.set(params.url, bytes); this.cacheBytes += bytes.byteLength;
      while (this.cache.size > 48 || this.cacheBytes > 16*1024*1024) {
        const first = this.cache.keys().next().value!; this.cacheBytes -= this.cache.get(first)!.byteLength; this.cache.delete(first);
      }
      this.stats.completed++;
      return { data: bytes.slice(0) };
    } catch (error) {
      if (requestAbort.signal.aborted || binding.abort.signal.aborted) this.stats.cancelled++;
      else this.stats.failed++;
      throw error;
    } finally {
      this.recordTime('total', started);
      if (timeout !== undefined) clearTimeout(timeout);
      requestAbort.signal.removeEventListener('abort', cancel); binding.abort.signal.removeEventListener('abort', cancel);
      if (workerAcquired) this.release('worker');
      if (acquired) this.release('pipeline');
    }
  };
  dispose() {
    this.closed = true;
    for (const binding of this.bindings.values()) binding.abort.abort();
    this.bindings.clear(); this.cache.clear(); this.cacheBytes = 0;
    this.inputTiles.clear();
    for (const worker of this.idleWorkers) worker.terminate(); this.idleWorkers = [];
  }
}
