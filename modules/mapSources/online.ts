import { XMLParser, XMLValidator } from 'fast-xml-parser';
import {
  MAX_CONFIG_BYTES,
  plainText,
  validBounds,
  type MapDraft,
} from './types.ts';

const PRIVATE_FORMAT =
  '这是专有或暂不支持的地图配置。奥维加密二维码 / .ovmap 不能直接通用导入，请向提供方索取 XYZ / WMTS 图源地址或标准栅格文件。';

/** No proxy: templates are requested directly by the map, subject to provider CORS. */
export function mapUrl(raw: string, base?: string): string {
  let value = raw
    .trim()
    .replace(/\{TileMatrix\}/gi, '{z}')
    .replace(/\{TileRow\}/gi, '{y}')
    .replace(/\{TileCol\}/gi, '{x}')
    .replace(/\{\$([xyz])\}/g, '{$1}');
  if (value.length > 8192) throw new Error('图源地址过长');
  let url: URL;
  try {
    url = new URL(value, base);
  } catch {
    throw new Error('请输入完整的 HTTPS 图源地址');
  }
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error('图源须使用 HTTPS，且不能在地址中嵌入登录用户名或密码');
  value = url.href.replace(/%7B/gi, '{').replace(/%7D/gi, '}');
  return value;
}

function integer(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max)
    throw new Error(`缩放级别须为 ${min}–${max} 的整数`);
  return n;
}

export function onlineDraft(
  input: Record<string, unknown>,
  base?: string,
): MapDraft {
  if (input.vector_tiles || input.sources || input.type === 'vector')
    throw new Error('暂不支持矢量 TileJSON / Style JSON，请使用栅格图源');
  const crs = String(input.crs ?? 'EPSG:3857').toUpperCase();
  if (!['EPSG:3857', '3857', 'WEBMERCATOR'].includes(crs))
    throw new Error(
      '在线瓦片须使用 WGS84 / Web Mercator（EPSG:3857）；暂不支持 GCJ-02、BD-09 或其他瓦片矩阵',
    );
  const raw = input.tiles ?? (input.url ? [input.url] : null);
  if (
    !Array.isArray(raw) ||
    !raw.length ||
    raw.length > 8 ||
    raw.some((v) => typeof v !== 'string')
  )
    throw new Error('配置需要 1–8 个栅格瓦片地址（tiles 或 url）');
  const scheme = String(input.scheme ?? 'xyz').toLowerCase();
  if (!['xyz', 'tms'].includes(scheme))
    throw new Error('瓦片编号须为 XYZ 或 TMS');
  let format = scheme.toUpperCase();
  const tiles = raw.map((value) => {
    const url = mapUrl(value, base);
    const parsed = new URL(url);
    const query = new Map(
      [...parsed.searchParams].map(([k, v]) => [k.toUpperCase(), v]),
    );
    if (/4326|4490|gcj|bd[-_]?0?9/i.test(query.get('TILEMATRIXSET') ?? ''))
      throw new Error(
        '此 WMTS 矩阵不是受支持的 Web Mercator，请使用 EPSG:3857 图源',
      );
    if (
      /wms/i.test(query.get('SERVICE') ?? '') &&
      !/wmts/i.test(query.get('SERVICE') ?? '')
    ) {
      if (
        !/^(EPSG:3857|EPSG:900913)$/i.test(
          query.get('CRS') ?? query.get('SRS') ?? '',
        ) ||
        !url.includes('{bbox-epsg-3857}')
      )
        throw new Error('WMS 须使用 EPSG:3857，BBOX 填 {bbox-epsg-3857}');
      if (query.get('REQUEST')?.toLowerCase() !== 'getmap')
        throw new Error('请粘贴 WMS GetMap 地址');
      format = 'WMS';
    } else {
      if (!['{z}', '{x}', '{y}'].every((token) => url.includes(token)))
        throw new Error(
          '图源地址需要 {z}/{x}/{y}，或 WMTS 的 TileMatrix / TileCol / TileRow 占位符',
        );
      if (query.get('SERVICE')?.toUpperCase() === 'WMTS') format = 'WMTS';
    }
    const unknown = url
      .match(/\{[^}]+\}/g)
      ?.filter(
        (token) =>
          !['{z}', '{x}', '{y}', '{bbox-epsg-3857}', '{ratio}'].includes(token),
      );
    if (unknown?.length)
      throw new Error(
        '地址含未支持的占位符，请把子域名、图层和瓦片矩阵集填为具体值',
      );
    return url;
  });
  const minzoom = integer(input.minzoom, 0, 0, 22);
  const maxzoom = integer(input.maxzoom, 18, 0, 22);
  if (maxzoom < minzoom) throw new Error('最大缩放级别不能小于最小级别');
  const tileSize = Number(input.tileSize ?? input.tile_size ?? 256);
  if (![256, 512].includes(tileSize))
    throw new Error('瓦片尺寸支持 256 或 512 像素');
  const bounds = validBounds(input.bounds);
  if (input.bounds !== undefined && !bounds)
    throw new Error('地图范围无效或跨越日期变更线，请拆分后导入');
  return {
    name: plainText(input.name, '自定义地图') || '自定义地图',
    kind: 'online',
    format: input.tilejson ? 'TileJSON' : format,
    attribution: plainText(input.attribution, '用户提供的图源'),
    minzoom,
    maxzoom,
    tileSize,
    scheme: scheme as 'xyz' | 'tms',
    tiles,
    ...(bounds ? { bounds } : {}),
  };
}

/** JSON/TileJSON and MOBAC customMapSource XML; capabilities are not tile templates. */
export function parseMapConfig(text: string, base?: string): MapDraft[] {
  if (new TextEncoder().encode(text).length > MAX_CONFIG_BYTES)
    throw new Error('图源配置不能超过 1 MB');
  const content = text.trim();
  if (!content) throw new Error('请先粘贴图源地址或配置');
  if (/^https:\/\//i.test(content)) return [onlineDraft({ url: content })];
  let data: unknown;
  if (content.startsWith('<')) {
    if (
      /<!DOCTYPE|<!ENTITY/i.test(content) ||
      XMLValidator.validate(content) !== true
    )
      throw new Error('XML 配置无效或包含不支持的实体定义');
    const xml = new XMLParser({
      ignoreAttributes: false,
      parseTagValue: false,
    }).parse(content);
    const maps = xml.customMapSource
      ? [xml.customMapSource]
      : xml.customMapSources?.customMapSource;
    if (!maps)
      throw new Error(
        'XML 支持 MOBAC customMapSource；WMS / WMTS 请使用包含图层与瓦片矩阵集的完整瓦片地址',
      );
    const list = Array.isArray(maps) ? maps : [maps];
    if (list.length > 20) throw new Error('一次最多导入 20 个图源');
    return list.map((m: Record<string, unknown>) => {
      if (m.tileUpdate || m.script) throw new Error('不执行图源配置中的脚本');
      return onlineDraft(
        {
          name: m.name,
          url: m.url,
          minzoom: m.minZoom,
          maxzoom: m.maxZoom,
          tileSize: m.tileSize,
          scheme:
            m.tileType === 'tms' || m.invertYCoordinate === 'true'
              ? 'tms'
              : 'xyz',
          crs: m.crs,
        },
        base,
      );
    });
  }
  try {
    data = JSON.parse(content);
  } catch {
    throw new Error(PRIVATE_FORMAT);
  }
  const list = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && 'maps' in data
      ? (data as { maps: unknown }).maps
      : [data];
  if (!Array.isArray(list) || !list.length || list.length > 20)
    throw new Error('一次支持 1–20 个图源');
  return list.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      throw new Error('图源配置必须是对象');
    return onlineDraft(item as Record<string, unknown>, base);
  });
}

export async function resolveMapInput(
  text: string,
  signal: AbortSignal,
): Promise<MapDraft[]> {
  const value = text.trim();
  // A QR link without template tokens may point to TileJSON. Only one explicit URL is fetched.
  if (/^https:\/\//i.test(value) && !/[{}]/.test(value)) {
    const url = mapUrl(value);
    const response = await fetch(url, {
      signal,
      credentials: 'omit',
      redirect: 'error',
    });
    if (!response.ok) throw new Error(`图源配置请求失败（${response.status}）`);
    if (Number(response.headers.get('content-length')) > MAX_CONFIG_BYTES)
      throw new Error('图源配置不能超过 1 MB');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('无法读取图源配置');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const item = await reader.read();
        if (item.done) break;
        size += item.value.length;
        if (size > MAX_CONFIG_BYTES) throw new Error('图源配置不能超过 1 MB');
        chunks.push(item.value);
      }
    } finally {
      await reader.cancel();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return parseMapConfig(new TextDecoder().decode(bytes), url);
  }
  return parseMapConfig(value);
}
