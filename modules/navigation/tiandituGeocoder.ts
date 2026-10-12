import { coordinate, type RoutePlace } from './types.ts';
import { PlaceSearchError } from './placeSearchTransport.ts';

const ENDPOINT = 'https://api.tianditu.gov.cn/geocoder';
export function isAddressLike(query: string) {
  return /\d+\s*(?:\u53f7|\u53f7\u697c|\u5ba4)|(?:\u8def|\u8857|\u5df7|\u5df7\u5f04|\u53f7)\s*\d+|\b\d+[A-Za-z]?\s+(?:[A-Za-z0-9.'-]+\s+){0,5}(?:st\.?|street|rd\.?|road|ave\.?|avenue|blvd\.?|boulevard|drive|dr\.?|lane|ln\.?|court|ct\.?|way)\b/i.test(query);
}

export function buildTiandituGeocoderURL(address: string, key: string) {
  const url = new URL(ENDPOINT);
  url.searchParams.set('ds', JSON.stringify({ keyWord: address.trim().slice(0, 160) }));
  url.searchParams.set('tk', key.trim());
  return url.toString();
}

export function normalizeTiandituGeocode(data: unknown, query: string): RoutePlace[] {
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new PlaceSearchError('format', '天地图地址搜索返回的数据格式无法识别。');
  const response = data as { status?: unknown; location?: { lon?: unknown; lat?: unknown; level?: unknown } };
  if (typeof response.status !== 'string' && typeof response.status !== 'number')
    throw new PlaceSearchError('format', '天地图地址服务返回了无法识别的数据。');
  const status = String(response.status);
  if (status === '101') throw new PlaceSearchError('noresult', '没有找到匹配地址。');
  if (status !== '0') throw new PlaceSearchError('service', '天地图地址搜索服务暂不可用。');
  const lonValue = response.location?.lon;
  const latValue = response.location?.lat;
  if ((typeof lonValue !== 'string' && typeof lonValue !== 'number') || String(lonValue).trim() === ''
    || (typeof latValue !== 'string' && typeof latValue !== 'number') || String(latValue).trim() === '')
    throw new PlaceSearchError('format', '天地图地址服务未返回有效坐标。');
  const lon = Number(lonValue);
  const lat = Number(latValue);
  if (!coordinate([lon, lat])) throw new PlaceSearchError('format', '天地图地址搜索未返回有效坐标。');
  const level = typeof response.location?.level === 'string' ? response.location.level.trim() : '';
  return [{
    name: query.slice(0, 160),
    coordinates: [lon, lat],
    detail: level ? `天地图匹配级别：${level}` : '天地图地址匹配，服务未注明匹配级别。',
    source: 'tianditu',
    precision: level === '门址' ? 'address'
      : ['道路', '街道'].includes(level) ? 'street'
        : ['乡镇', '区县', '城区'].includes(level) ? 'locality'
          : ['市', '省'].includes(level) ? 'region' : 'unknown',
  }];
}
