import type { Map as MapLibreMap } from 'maplibre-gl';
import { INITIAL_GEOLOGY, type GeologyState } from '../data';
import type { WmtsMetadata } from './capabilities';
import { projectionPlan } from './projection';

export const GEOCLOUD_SOURCE = 'geology-geocloud-source';
const LAYER = 'geology-geocloud-raster';
let instance = 0;
type Pixels = { data: Uint8ClampedArray; width: number; height: number };
type PublicMetadata = Omit<WmtsMetadata, 'legendUrl'> & { hasLegend: boolean };
const errorMessage = (body: unknown, fallback: string) => body && typeof body === 'object' && 'message' in body && typeof body.message === 'string' ? body.message : fallback;

/** Authorized WMTS raster, reprojected into the terrain map's Mercator tiles. */
export class GeocloudLayer {
  private enabled = false;
  private opacity = 0.85;
  private request?: AbortController;
  private generation = 0;
  private protocol = `geocloud-${++instance}`;
  private unregister?: () => void;
  private pixels = new Map<string, Pixels>();
  private state: GeologyState = { ...INITIAL_GEOLOGY, source: 'geocloud20w' };
  constructor(private map: MapLibreMap, private onChange: (state: GeologyState) => void) {}
  private emit(patch: Partial<GeologyState>) {
    this.state = { ...this.state, ...patch };
    if (this.enabled) this.onChange(this.state);
  }
  sync(enabled: boolean, opacity: number) {
    this.opacity = opacity;
    if (this.map.getLayer(LAYER)) this.map.setPaintProperty(LAYER, 'raster-opacity', opacity);
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    if (enabled) void this.start(); else this.stop();
  }
  retry() { if (this.enabled) { this.stop(); void this.start(); } }
  isReady() { return this.enabled && this.state.status === 'ready' && Boolean(this.map.getSource(GEOCLOUD_SOURCE)) && this.map.isSourceLoaded(GEOCLOUD_SOURCE); }
  private async start() {
    const generation = ++this.generation;
    const request = this.request = new AbortController();
    this.state = { ...INITIAL_GEOLOGY, source: 'geocloud20w', status: 'loading' };
    this.emit({});
    try {
      const response = await fetch('/api/geology/geocloud?request=capabilities', { signal: request.signal });
      const body = await response.json();
      if (generation !== this.generation || !this.enabled) return;
      if (!response.ok) {
        this.emit({ status: response.status === 401 || response.status === 503 ? 'authorization' : 'error', message: errorMessage(body, '地质云连接失败') });
        return;
      }
      const metadata = body as PublicMetadata;
      const { addProtocol, removeProtocol } = await import('maplibre-gl');
      if (generation !== this.generation || !this.enabled) return;
      addProtocol(this.protocol, async (params, controller) => {
        const tile = new URL(params.url).pathname.split('/').filter(Boolean).map(Number);
        try {
          const data = await this.render(metadata, tile[0], tile[1], tile[2], AbortSignal.any([controller.signal, request.signal]));
          return { data };
        } catch (error) {
          if (!controller.signal.aborted && !request.signal.aborted) this.emit({ status: 'error', message: error instanceof Error ? error.message : '地质瓦片加载失败' });
          throw error;
        }
      });
      this.unregister = () => removeProtocol(this.protocol);
      this.map.addSource(GEOCLOUD_SOURCE, {
        type: 'raster', tiles: [`${this.protocol}://tiles/{z}/{x}/{y}`], tileSize: 256, maxzoom: 16,
        attribution: '<a href="https://geocloud.cgs.gov.cn/" target="_blank">中国地质调查局 · 地质云</a>',
      });
      this.map.addLayer({ id: LAYER, type: 'raster', source: GEOCLOUD_SOURCE,
        paint: { 'raster-opacity': this.opacity, 'raster-fade-duration': 0 } }, this.map.getLayer('hillshade') ? 'hillshade' : undefined);
      this.map.on('idle', this.ready);
      this.map.on('sourcedata', this.ready);
      this.map.on('error', this.error);
      this.emit({ serviceTitle: metadata.title, legendUrl: metadata.hasLegend ? '/api/geology/geocloud?request=legend' : undefined,
        sources: [{ name: '中国地质调查局 · 地质云（按服务授权使用）', url: 'https://geocloud.cgs.gov.cn/' }] });
    } catch (error) {
      if (generation !== this.generation || request.signal.aborted) return;
      this.emit({ status: 'error', message: error instanceof Error ? error.message : '地质云连接失败' });
    }
  }
  private ready = () => {
    if (this.enabled && this.state.status === 'loading' && this.map.getSource(GEOCLOUD_SOURCE) && this.map.isSourceLoaded(GEOCLOUD_SOURCE)) {
      this.emit({ status: 'ready' });
    }
  };
  private error = (event: unknown) => {
    if (event && typeof event === 'object' && 'sourceId' in event && event.sourceId === GEOCLOUD_SOURCE) this.emit({ status: 'error', message: '地质云瓦片加载失败，请检查授权或重试。' });
  };
  private async loadPixels(matrix: string, col: number, row: number, signal: AbortSignal): Promise<Pixels> {
    signal.throwIfAborted();
    const key = `${matrix}/${col}/${row}`, cached = this.pixels.get(key);
    if (cached) return cached;
    const params = new URLSearchParams({ request: 'tile', matrix, col: String(col), row: String(row) });
    const response = await fetch(`/api/geology/geocloud?${params}`, { signal });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(errorMessage(error, '地质瓦片加载失败'));
    }
    const bitmap = await createImageBitmap(await response.blob());
    try {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), context = canvas.getContext('2d');
      if (!context) throw new Error('当前浏览器不支持地质地图坐标转换');
      context.drawImage(bitmap, 0, 0);
      const pixels = { width: bitmap.width, height: bitmap.height, data: context.getImageData(0, 0, bitmap.width, bitmap.height).data };
      if (signal.aborted || !this.enabled) throw new DOMException('Aborted', 'AbortError');
      // Only a bounded, in-memory cache; no offline redistribution bundle.
      if (this.pixels.size >= 32) this.pixels.delete(this.pixels.keys().next().value!);
      this.pixels.set(key, pixels);
      return pixels;
    } finally { bitmap.close(); }
  }
  private async render(metadata: WmtsMetadata, z: number, x: number, y: number, signal: AbortSignal): Promise<ArrayBuffer> {
    const plan = projectionPlan(metadata, z, x, y);
    const images = new Map<string, Pixels>();
    await Promise.all(plan.tiles.map(async ({ col, row }) => {
      const pixels = await this.loadPixels(plan.matrix.id, col, row, signal);
      if (pixels.width !== plan.matrix.tileWidth || pixels.height !== plan.matrix.tileHeight) throw new Error('瓦片尺寸与服务元数据不符');
      images.set(`${col}/${row}`, pixels);
    }));
    const output = new Uint8ClampedArray(256 * 256 * 4), m = plan.matrix;
    for (let py = 0; py < 256; py++) for (let px = 0; px < 256; px++) {
      const sx = plan.xs[px], sy = plan.ys[py];
      const col = Math.floor(sx / m.tileWidth), row = Math.floor(sy / m.tileHeight), source = images.get(`${col}/${row}`);
      if (!source) continue;
      const offset = ((sy - row * m.tileHeight) * m.tileWidth + sx - col * m.tileWidth) * 4;
      output.set(source.data.subarray(offset, offset + 4), (py * 256 + px) * 4);
    }
    signal.throwIfAborted();
    const canvas = new OffscreenCanvas(256, 256), context = canvas.getContext('2d');
    if (!context) throw new Error('当前浏览器不支持地质地图坐标转换');
    context.putImageData(new ImageData(output, 256, 256), 0, 0);
    return (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer();
  }
  private stop() {
    ++this.generation;
    this.request?.abort();
    this.map.off('idle', this.ready);
    this.map.off('sourcedata', this.ready);
    this.map.off('error', this.error);
    if (this.map.getLayer(LAYER)) this.map.removeLayer(LAYER);
    if (this.map.getSource(GEOCLOUD_SOURCE)) this.map.removeSource(GEOCLOUD_SOURCE);
    this.unregister?.();
    this.unregister = undefined;
    this.pixels.clear();
  }
  dispose() { this.enabled = false; this.stop(); }
}
