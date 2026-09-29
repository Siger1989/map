import type { MapSource } from '../mapSources/types.ts';
import { renderOvmapTemplate } from '../mapSources/ovmapTemplates.ts';
import { warpPlan } from '../mapSources/coordinates.ts';
import { downloadBounds, downloadTiles, MAX_DOWNLOAD_RESOURCES, type DownloadArea, type Tile } from './downloadPlan.ts';

export const MAX_IMPORTED_DOWNLOAD_BYTES = 1024 ** 3;
const REGULAR_TEMPLATE_TOKENS = new Set(['z', 'x', 'y', 'ratio', 'bbox-epsg-3857', 'quadkey', 'prefix']);
export type ImportedRoutePlan = {
  urls: string[];
  bounds: [number, number, number, number];
  count: number;
  estimatedBytes: number;
};

function regularTileUrl(templates: string[], tile: Tile, scheme: 'xyz' | 'tms', ratio = '') {
  const { z } = tile;
  const n = 2 ** z;
  const x = ((tile.x % n) + n) % n;
  const y = scheme === 'tms' ? n - tile.y - 1 : tile.y;
  const world = 40075016.68557849;
  const bbox = [
    (x / n) * world - world / 2,
    world / 2 - ((tile.y + 1) / n) * world,
    ((x + 1) / n) * world - world / 2,
    world / 2 - (tile.y / n) * world,
  ].join(',');
  let quadkey = '';
  for (let level = z; level > 0; level--) {
    quadkey += ((x >> (level - 1)) & 1) + 2 * ((tile.y >> (level - 1)) & 1);
  }
  const template = templates[(x + tile.y) % templates.length];
  return template
    .replaceAll('{z}', String(z))
    .replaceAll('{x}', String(x))
    .replaceAll('{y}', String(y))
    .replaceAll('{ratio}', ratio)
    .replaceAll('{bbox-epsg-3857}', bbox)
    .replaceAll('{quadkey}', quadkey)
    .replaceAll('{prefix}', (x % 16).toString(16) + (tile.y % 16).toString(16));
}

function validateSource(source: MapSource) {
  if (!source || source.kind !== 'online' || !source.id || !source.name)
    throw new Error('请先选择已导入的在线图源');
  if (!Number.isInteger(source.minzoom) || !Number.isInteger(source.maxzoom) || source.minzoom < 0 || source.maxzoom > 24 || source.minzoom > source.maxzoom)
    throw new Error('此图源没有可下载的缩放级别');
  if (![256, 512].includes(source.tileSize)) throw new Error('此图源瓦片尺寸暂不支持离线下载');
  if (source.ovmap) {
    const layers = source.ovmap.layers;
    if (!layers.length || !layers[0].tiles.length)
      throw new Error('组合图源缺少底图瓦片模板');
    const templates = layers.flatMap((layer) => layer.tiles);
    validateProvider(templates);
    for (const layer of layers) {
      if (!layer.tiles.length || ![256, 512].includes(layer.tileSize) || !Number.isInteger(layer.minzoom) || !Number.isInteger(layer.maxzoom) || layer.minzoom < 0 || layer.maxzoom > 24 || layer.minzoom > layer.maxzoom)
        throw new Error('组合图源包含无效瓦片图层');
    }
    return;
  }
  if (!source.tiles?.length) throw new Error('此图源没有可下载的瓦片模板');
  for (const template of source.tiles) {
    const tokens = template.match(/\{[^{}]*\}/g) ?? [];
    if (tokens.some((token) => !REGULAR_TEMPLATE_TOKENS.has(token.slice(1, -1))))
      throw new Error('此图源包含暂不支持的瓦片模板变量');
  }
  validateProvider(source.tiles);
}

function validateProvider(templates: string[]) {
  for (const template of templates) {
    const normalized = template.replace(/\{[^{}]*\}/g, '0');
    let parsed: URL;
    try { parsed = new URL(normalized); } catch { throw new Error('图源模板无法生成有效瓦片地址'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || /[{}]/.test(template.replace(/\{[^{}]*\}/g, '')))
      throw new Error('图源模板无法生成有效瓦片地址');
    const host = parsed.hostname.toLowerCase();
    if (host === 'tianditu.gov.cn' || host.endsWith('.tianditu.gov.cn') || host === 'tianditu.com' || host.endsWith('.tianditu.com'))
      throw new Error('天地图离线下载已暂停，以保护服务额度；已有天地图离线包仍可查看或删除');
    if (host === 'tile.openstreetmap.org' || host.endsWith('.tile.openstreetmap.org'))
      throw new Error('该公共地图服务不支持批量下载，请选择其他已导入图源');
  }
}

function intersectsBounds(tile: Tile, bounds?: MapSource['bounds']) {
  if (!bounds) return true;
  const n = 2 ** tile.z;
  const west = tile.x / n * 360 - 180;
  const east = (tile.x + 1) / n * 360 - 180;
  const north = Math.atan(Math.sinh(Math.PI * (1 - 2 * tile.y / n))) * 180 / Math.PI;
  const south = Math.atan(Math.sinh(Math.PI * (1 - 2 * (tile.y + 1) / n))) * 180 / Math.PI;
  return east >= bounds[0] && west <= bounds[2] && north >= bounds[1] && south <= bounds[3];
}

/** Build requests for a route corridor only. This is pure planning and never starts network work. */
export function planImportedRouteDownload(
  area: Extract<DownloadArea, { kind: 'route' }>,
  source: MapSource,
  zoom: number,
): ImportedRoutePlan {
  if (area?.kind !== 'route' || !Array.isArray(area.segments) || !area.segments.length || area.segments.some((segment) => !Array.isArray(segment) || segment.length < 2))
    throw new Error('请先选择包含有效路段的路线');
  validateSource(source);
  if (!Number.isInteger(zoom) || zoom < source.minzoom || zoom > source.maxzoom)
    throw new Error('请选择此图源支持的最高级别');

  const bounds = downloadBounds(area);
  const outputTiles = downloadTiles(area, zoom, MAX_DOWNLOAD_RESOURCES, false, source.minzoom);
  const dependencies = new Map<number, Map<string, Tile>>();
  for (const tile of outputTiles) {
    if (!intersectsBounds(tile, source.bounds)) continue;
    const plan = source.datum && source.datum !== 'wgs84'
      ? warpPlan(tile.z, tile.x, tile.y, source.tileSize, source.datum)
      : { left: tile.x, top: tile.y, width: 1, height: 1 };
    for (let row = 0; row < plan.height; row++) for (let col = 0; col < plan.width; col++) {
      const n = 2 ** tile.z;
      const x = ((plan.left + col) % n + n) % n;
      const y = plan.top + row;
      if (y < 0 || y >= n) continue;
      const dependency = { z: tile.z, x, y };
      if (!intersectsBounds(dependency, source.bounds)) continue;
      const level = dependencies.get(tile.z) ?? new Map<string, Tile>();
      level.set(`${x}/${y}`, dependency);
      dependencies.set(tile.z, level);
    }
  }
  const sizes = new Map<string, number>();
  for (const level of dependencies.values()) for (const tile of level.values()) {
    const layers = source.ovmap
      ? source.ovmap.layers.filter((layer) => tile.z >= layer.minzoom && tile.z <= layer.maxzoom)
      : tile.z >= source.minzoom && tile.z <= source.maxzoom
        ? [{ tiles: source.tiles!, tileSize: source.tileSize, minzoom: source.minzoom, maxzoom: source.maxzoom }]
        : [];
    for (const layer of layers) {
      const estimate = Math.ceil(layer.tileSize * layer.tileSize * 0.4);
      const urls = source.ovmap
        ? [renderOvmapTemplate(layer.tiles[(tile.x + tile.y) % layer.tiles.length], tile.z, tile.x, tile.y).replaceAll('{', '%7B').replaceAll('}', '%7D')]
        : [''].concat(layer.tiles[(tile.x + tile.y) % layer.tiles.length].includes('{ratio}') ? ['@2x'] : [])
          .map((ratio) => regularTileUrl(layer.tiles, tile, source.scheme === 'tms' ? 'tms' : 'xyz', ratio));
      for (const url of urls) {
        sizes.set(url, Math.max(sizes.get(url) ?? 0, estimate));
        if (sizes.size > MAX_DOWNLOAD_RESOURCES)
          throw new Error('路线图源瓦片超过 2 万项，请降低清晰度或缩小沿线范围');
      }
    }
  }
  const urls = [...sizes.keys()];
  const estimatedBytes = urls.reduce((total, url) => total + sizes.get(url)!, 0);
  if (estimatedBytes > MAX_IMPORTED_DOWNLOAD_BYTES)
    throw new Error('预计超过 1 GB，请降低清晰度或缩小沿线范围');
  if (!urls.length) throw new Error('所选级别没有可下载的路线瓦片');
  return { urls, bounds, count: urls.length, estimatedBytes };
}
