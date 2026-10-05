import type { Map as LibreMap, AddProtocolAction } from 'maplibre-gl';
import { readMap } from './storage';
import { OfflineClient } from './offlineClient';
import { SOURCE_ID, type MapSource } from './types';
import { ovmapSourceIds, ovmapTileSize, renderOvmapLayerTile } from './ovmapTiles';
import { TileTransportError } from './tileTransport';

const EMPTY = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg==',
  ),
  (c) => c.charCodeAt(0),
);

/** Owns only one raster layer. Never replaces the style or any trip overlays. */
export class MapSourceLayer {
  private current = '';
  private generation = 0;
  private selected: MapSource | null = null;
  private client?: OfflineClient;
  private imageUrl?: string;
  private opening: Promise<unknown> = Promise.resolve();
  private onlineAbort = new AbortController();
  private partialOverlay = false;
  private sourceIds: string[] = [];
  constructor(
    private map: LibreMap,
    private status: (text: string) => void,
    private readonly scheme = 'shantu-map',
  ) {}
  protocol: AddProtocolAction = async (params, abort) => {
    const escapedScheme = this.scheme.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`^${escapedScheme}://([^/]+)/(?:layer/(\\d+)/)?(\\d+)/(\\d+)/(\\d+)$`).exec(
      params.url,
    );
    const client = this.client;
    if (!match || match[1] !== this.current)
      throw new DOMException('图源已切换', 'AbortError');
    if (this.selected?.ovmap) {
      const layerIndex = match[2] === undefined ? 0 : Number(match[2]);
      const layer = this.selected.ovmap.layers[layerIndex];
      if (!layer) throw new DOMException('图源图层已切换', 'AbortError');
      const controller = new AbortController();
      const lifetime = this.onlineAbort.signal;
      const cancel = () => controller.abort();
      abort.signal.addEventListener('abort', cancel, { once: true });
      lifetime.addEventListener('abort', cancel, { once: true });
      const timeout = setTimeout(cancel, 20000);
      try {
        abort.signal.throwIfAborted(); lifetime.throwIfAborted();
        const data = await renderOvmapLayerTile(layer, Number(match[3]), Number(match[4]), Number(match[5]), controller.signal);
        if (layerIndex === 0 && !lifetime.aborted) this.status(this.partialOverlay ? '底图已加载，部分叠加注记暂未加载' : '图源影像已加载');
        return { data };
      } catch (error) {
        if (!controller.signal.aborted && !lifetime.aborted) {
          const detail = error instanceof TileTransportError ? error.message : '部分图源影像暂未加载，可重试或切换图源';
          if (layerIndex > 0) {
            this.partialOverlay = true;
            this.status('底图已加载，部分叠加注记暂未加载');
          } else this.status(detail);
        }
        throw error;
      } finally {
        clearTimeout(timeout);
        abort.signal.removeEventListener('abort', cancel);
        lifetime.removeEventListener('abort', cancel);
      }
    }
    if (!client) throw new DOMException('图源已切换', 'AbortError');
    await this.opening;
    const bytes = await client.request<Uint8Array | undefined>(
      {
        op: 'tile',
        z: Number(match[3]),
        x: Number(match[4]),
        y: Number(match[5]),
      },
      abort.signal,
    );
    return { data: (bytes ?? EMPTY).slice().buffer };
  };
  async select(source: MapSource | null) {
    const id = source?.id ?? '';
    if (this.selected === source) return;
    this.clear();
    this.selected = source;
    this.current = id;
    const generation = this.generation;
    if (!source) {
      this.status('');
      return;
    }
    this.status('正在加载地图…');
    try {
      const before = this.map.getLayer('elevation-colors')
        ? 'elevation-colors'
        : this.map.getLayer('hillshade')
          ? 'hillshade'
          : undefined;
      if (source.kind === 'image') {
        this.sourceIds = [SOURCE_ID];
        const record = await readMap(id);
        if (generation !== this.generation) return;
        if (!record?.blob || !source.bounds)
          throw new Error('离线影像已丢失，请重新导入');
        this.imageUrl = URL.createObjectURL(record.blob);
        const [w, s, e, n] = source.bounds;
        this.map.addSource(SOURCE_ID, {
          type: 'image',
          url: this.imageUrl,
          coordinates: [
            [w, n],
            [e, n],
            [e, s],
            [w, s],
          ],
        });
      } else if (source.ovmap?.layers.length) {
        this.sourceIds = ovmapSourceIds(source);
        source.ovmap.layers.forEach((layer, index) => {
          const sourceId = this.sourceIds[index];
          const layerPath = index === 0 ? '' : `layer/${index}/`;
          const tiles = [`${this.scheme}://${id}/${layerPath}{z}/{x}/{y}`];
          const attribution = index === 0 ? source.attribution.replace(
            /[<>&"']/g,
            (c) =>
              ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c]!,
          ) : '';
          this.map.addSource(sourceId, {
            type: 'raster',
            tiles,
            scheme: 'xyz',
            tileSize: ovmapTileSize(layer),
            minzoom: layer.minzoom,
            maxzoom: layer.maxzoom,
            bounds: source.bounds,
            attribution,
          });
          this.map.addLayer({
            id: sourceId,
            type: 'raster',
            source: sourceId,
            paint: { 'raster-fade-duration': 0 },
          }, before);
        });
      } else {
        this.sourceIds = [SOURCE_ID];
        if (source.kind === 'mbtiles') {
          const client = new OfflineClient();
          this.client = client;
          this.opening = (async () => {
            const record = await readMap(id);
            if (generation !== this.generation)
              throw new DOMException('已取消', 'AbortError');
            if (!record?.blob) throw new Error('离线瓦片已丢失，请重新导入');
            return client.request({
              op: 'open',
              bytes: await record.blob.arrayBuffer(),
            });
          })();
          await this.opening;
          if (generation !== this.generation) return;
        }
        this.map.addSource(SOURCE_ID, {
          type: 'raster',
          tiles:
            source.kind === 'mbtiles' || source.ovmap
              ? [`${this.scheme}://${id}/{z}/{x}/{y}`]
              : source.tiles,
          scheme: source.kind === 'online' ? source.scheme : 'xyz',
          tileSize: source.tileSize,
          minzoom: source.minzoom,
          maxzoom: source.maxzoom,
          bounds: source.bounds,
          attribution: source.attribution.replace(
            /[<>&"']/g,
            (c) =>
              ({
                '<': '&lt;',
                '>': '&gt;',
                '&': '&amp;',
                '"': '&quot;',
                "'": '&#39;',
              })[c]!,
          ),
        });
      }
      if (source.kind === 'image' || !source.ovmap?.layers.length)
        this.map.addLayer(
          {
            id: SOURCE_ID,
            type: 'raster',
            source: SOURCE_ID,
            paint: { 'raster-fade-duration': 0 },
          },
          before,
        );
      this.status(
        source.kind === 'online'
          ? '已选择在线图源 · 显示范围由提供方决定'
          : '离线地图已加载',
      );
    } catch (error) {
      if (generation === this.generation) {
        this.removeSources();
        this.status(
          error instanceof Error && error.name === 'AbortError'
            ? '加载已取消，请重新选择'
            : '地图加载失败，请重试或重新导入',
        );
      }
    }
  }
  clear() {
    this.partialOverlay = false;
    this.onlineAbort.abort();
    this.onlineAbort = new AbortController();
    this.generation++;
    this.current = '';
    this.selected = null;
    this.client?.close();
    this.client = undefined;
    this.removeSources();
    if (this.imageUrl) URL.revokeObjectURL(this.imageUrl);
    this.imageUrl = undefined;
  }
  private removeSources() {
    for (const id of [...this.sourceIds].reverse()) {
      if (this.map.getLayer(id)) this.map.removeLayer(id);
      if (this.map.getSource(id)) this.map.removeSource(id);
    }
    this.sourceIds = [];
  }
}
