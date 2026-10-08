import { coordinate, type RoutePlace } from './types.ts';

const SEARCH_ENDPOINT = 'https://api.tianditu.gov.cn/v2/search';
const NATIONAL_MAP_BOUND = '73,3,136,54';
const MAX_TDT_SEARCH_RESULTS = 300;

/** Build a nationwide place-name request with detailed locality fields. */
export function buildTiandituSearchURL(query: string, key: string): string {
  const keyword = typeof query === 'string' ? query.trim().slice(0, 120) : '';
  if (!keyword) throw new Error('请输入搜索内容。');
  if (typeof key !== 'string' || !key.trim())
    throw new Error('天地图搜索尚未配置授权。');

  const url = new URL(SEARCH_ENDPOINT);
  url.searchParams.set(
    'postStr',
    JSON.stringify({
      keyWord: keyword,
      level: 12,
      mapBound: NATIONAL_MAP_BOUND,
      queryType: 7,
      start: 0,
      count: MAX_TDT_SEARCH_RESULTS,
      show: 2,
    }),
  );
  url.searchParams.set('type', 'query');
  url.searchParams.set('tk', key.trim());
  return url.toString();
}

type TiandituPoi = {
  name?: unknown;
  lonlat?: unknown;
  address?: unknown;
  province?: unknown;
  city?: unknown;
  county?: unknown;
};

function statusCode(status: unknown): number | undefined {
  const value = Array.isArray(status) ? status[0] : status;
  if (!value || typeof value !== 'object') return undefined;
  const code = (value as { infocode?: unknown }).infocode;
  return typeof code === 'number' || (typeof code === 'string' && /^\d+$/.test(code))
    ? Number(code)
    : undefined;
}

function parseLonLat(value: unknown): [number, number] | null {
  if (typeof value !== 'string') return null;
  const parts = value.split(',');
  if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) return null;
  const point = parts.map((part) => Number(part.trim()));
  if (!coordinate(point)) return null;
  return [point[0], point[1]];
}

/** Convert only point POIs. Administrative summaries and non-point results are not places. */
export function normalizeTiandituPlaces(data: unknown): RoutePlace[] {
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new Error('天地图搜索响应格式异常。');

  const response = data as {
    status?: unknown;
    resultType?: unknown;
    pois?: unknown;
    area?: unknown;
  };
  const code = statusCode(response.status);
  if (code === 3001) return [];
  if (code !== 1000) throw new Error('天地图搜索不可用，请检查服务授权或稍后重试。');

  // Search can return a single explicit administrative centre instead of POIs.
  // Do not interpret statistics, area arrays/bounds, suggestions, or routes as places.
  if (Number(response.resultType) === 3) {
    if (!response.area || typeof response.area !== 'object' || Array.isArray(response.area))
      return [];
    const area = response.area as TiandituPoi;
    const name = typeof area.name === 'string' ? area.name.trim() : '';
    const coordinates = parseLonLat(area.lonlat);
    return name && coordinates
      ? [{ name: name.slice(0, 160), coordinates, detail: '行政区中心' }]
      : [];
  }
  if (response.resultType !== undefined && Number(response.resultType) !== 1) return [];
  if (response.pois === undefined || response.pois === null) return [];
  if (!Array.isArray(response.pois)) throw new Error('天地图搜索响应格式异常。');

  const places: RoutePlace[] = [];
  const seen = new Set<string>();
  for (const item of response.pois as TiandituPoi[]) {
    if (!item || typeof item !== 'object') continue;
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    const coordinates = parseLonLat(item.lonlat);
    if (!name || !coordinates) continue;
    const signature = `${name.toLocaleLowerCase()}|${coordinates[0]}|${coordinates[1]}`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    const locality = [...new Set([item.province, item.city, item.county]
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter(Boolean))];
    let address = typeof item.address === 'string' ? item.address.trim() : '';
    // Detailed TDT addresses often repeat the province/city/county fields.
    // Remove those literal locality labels from the address, retaining the
    // street, attraction, or other more specific suffix.
    for (const part of locality) address = address.split(part).join('');
    address = address.replace(/[\s·,，、;；|/\\-]+/g, ' ').trim();
    const detail = [locality.join(' · '), address].filter(Boolean).join(' · ');
    places.push({
      name: name.slice(0, 160),
      coordinates,
      ...(detail ? { detail: detail.slice(0, 240) } : {}),
    });
    if (places.length === MAX_TDT_SEARCH_RESULTS) break;
  }
  return places;
}
