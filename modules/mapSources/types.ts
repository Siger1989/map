/** User maps are local to this browser/device; existing trip stores are independent. */
export type Bounds = [number, number, number, number];
export type OvmapTileLayer = {
  tiles: string[];
  tileSize: number;
  minzoom: number;
  maxzoom: number;
  /** A 512-pixel provider tile covers a 2x2 group of Ovi tiles. */
  subdivide?: boolean;
};
export type MapSource = {
  id: string;
  name: string;
  kind: 'online' | 'mbtiles' | 'image';
  format: string;
  attribution: string;
  bounds?: Bounds;
  minzoom: number;
  maxzoom: number;
  tileSize: number;
  tiles?: string[];
  scheme?: 'xyz' | 'tms';
  bytes: number;
  detail?: string;
  datum?: 'wgs84' | 'gcj02' | 'bd09';
  ovmap?: {
    layers: OvmapTileLayer[];
    missingOverlayIds?: number[];
    sourceId?: number;
    coordType?: number;
    declaredTileSize?: number;
    overlayIds?: number[];
    overlayFlags?: number[];
  };
};
export type MapDraft = Omit<MapSource, 'id' | 'bytes'>;
export type StoredMap = MapSource & { blob?: Blob };
export const MAX_FILE_BYTES = 64 * 1024 * 1024;
export const MAX_STORAGE_BYTES = 256 * 1024 * 1024;
export const MAX_MAPS = 100;
export const MAX_CONFIG_BYTES = 1024 * 1024;
export const SOURCE_ID = 'shantu-user-map';

/** Validate persisted user-map metadata and its optional local binary payload. */
export function validateStoredMap(value: unknown): StoredMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('图源记录无效');
  const map = value as Record<string, unknown>;
  if (typeof map.id !== 'string' || !map.id || map.id.length > 250 || typeof map.name !== 'string' || !map.name.trim() || map.name.length > 240 ||
      !['online','mbtiles','image'].includes(String(map.kind)) || typeof map.format !== 'string' || !map.format || map.format.length > 80 ||
      typeof map.attribution !== 'string' || map.attribution.length > 1000 || !Number.isInteger(map.minzoom) || Number(map.minzoom)<0 || Number(map.minzoom)>24 ||
      !Number.isInteger(map.maxzoom) || Number(map.maxzoom)<Number(map.minzoom) || Number(map.maxzoom)>24 || ![256,512,1024,2048].includes(Number(map.tileSize)) ||
      typeof map.bytes !== 'number' || !Number.isSafeInteger(map.bytes) || map.bytes < 0 ||
      (map.scheme !== undefined && !['xyz','tms'].includes(String(map.scheme))) ||
      (map.datum !== undefined && !['wgs84','gcj02','bd09'].includes(String(map.datum))) ||
      (map.bounds !== undefined && !validBounds(map.bounds)) ||
      (map.tiles !== undefined && (!Array.isArray(map.tiles) || map.tiles.length < 1 || map.tiles.length > 8 || map.tiles.some((v)=>typeof v!=='string'||v.length>8192||!/^https?:\/\//i.test(v)))) ||
      (map.blob !== undefined && (!(map.blob instanceof Blob) || map.blob.size > MAX_FILE_BYTES)) ||
      (map.detail !== undefined && (typeof map.detail !== 'string' || map.detail.length > 2000))) throw new Error('图源记录含无效配置');
  if (map.kind === 'online' && (!Array.isArray(map.tiles) || !map.tiles.length)) throw new Error('在线图源缺少瓦片地址');
  if (map.blob instanceof Blob && map.bytes < map.blob.size) throw new Error('图源容量信息小于本地文件');
  if (map.kind !== 'online' && map.blob !== undefined && !(map.blob instanceof Blob)) throw new Error('离线图源缺少本地文件');
  if (map.ovmap !== undefined) {
    const ovmap=map.ovmap as Record<string,unknown>;
    if(!ovmap||typeof ovmap!=='object'||Array.isArray(ovmap)||!Array.isArray(ovmap.layers)||ovmap.layers.length<1||ovmap.layers.length>8) throw new Error('OVMAP 图源结构无效');
    for(const layer of ovmap.layers){
      if(!layer||typeof layer!=='object'||Array.isArray(layer)) throw new Error('OVMAP 图层无效');
      const item=layer as Record<string,unknown>;
      if(!Array.isArray(item.tiles)||item.tiles.length<1||item.tiles.length>8||item.tiles.some((url)=>typeof url!=='string'||!/^https?:\/\//i.test(url))||![256,512].includes(Number(item.tileSize))||!Number.isInteger(item.minzoom)||!Number.isInteger(item.maxzoom)||Number(item.minzoom)<0||Number(item.maxzoom)>24||Number(item.maxzoom)<Number(item.minzoom)) throw new Error('OVMAP 图层参数无效');
    }
    for(const key of ['missingOverlayIds','overlayIds','overlayFlags']){const list=ovmap[key];if(list!==undefined&&(!Array.isArray(list)||list.some((n)=>!Number.isInteger(n)||Number(n)<0)))throw new Error('OVMAP 编号列表无效');}
  }
  return value as StoredMap;
}

export function validBounds(value: unknown): Bounds | undefined {
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    !value.every(Number.isFinite)
  )
    return;
  const [w, s, e, n] = value as number[];
  if (
    w >= e ||
    s >= n ||
    w < -180 ||
    e > 180 ||
    s < -85.051129 ||
    n > 85.051129
  )
    return;
  return [w, s, e, n];
}

export function plainText(value: unknown, fallback = ''): string {
  return typeof value === 'string'
    ? value
        .replace(/<[^>]*>/g, '')
        .replace(/[\u0000-\u001f]/g, '')
        .trim()
        .slice(0, 240)
    : fallback;
}
