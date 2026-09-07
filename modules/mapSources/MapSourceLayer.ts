import type { Map as LibreMap, AddProtocolAction } from 'maplibre-gl';
import { readMap } from './storage';
import { OfflineClient } from './offlineClient';
import { SOURCE_ID, type MapSource } from './types';

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
  constructor(
    private map: LibreMap,
    private status: (text: string) => void,
  ) {}
  protocol: AddProtocolAction = async (params, abort) => {
    const match = /^shantu-map:\/\/([a-z0-9-]+)\/(\d+)\/(\d+)\/(\d+)$/.exec(
      params.url,
    );
    const client = this.client;
    if (!match || match[1] !== this.current || !client)
      throw new DOMException('图源已切换', 'AbortError');
    await this.opening;
    const bytes = await client.request<Uint8Array | undefined>(
      {
        op: 'tile',
        z: Number(match[2]),
        x: Number(match[3]),
        y: Number(match[4]),
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
      } else {
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
            source.kind === 'mbtiles'
              ? [`shantu-map://${id}/{z}/{x}/{y}`]
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
      if (generation === this.generation)
        this.status(
          error instanceof Error && error.name === 'AbortError'
            ? '加载已取消，请重新选择'
            : '地图加载失败，请重试或重新导入',
        );
    }
  }
  clear() {
    this.generation++;
    this.current = '';
    this.selected = null;
    this.client?.close();
    this.client = undefined;
    if (this.map.getLayer(SOURCE_ID)) this.map.removeLayer(SOURCE_ID);
    if (this.map.getSource(SOURCE_ID)) this.map.removeSource(SOURCE_ID);
    if (this.imageUrl) URL.revokeObjectURL(this.imageUrl);
    this.imageUrl = undefined;
  }
}
