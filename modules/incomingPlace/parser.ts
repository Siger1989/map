import type { Coordinate, RoutePlace } from '../navigation/types';
import { importCoordinate } from '../dataTransfer/coordinateSystem.ts';

export type IncomingPlaceDatum = 'WGS84' | 'GCJ-02';
export type ParsedIncomingPlace =
  | { kind: 'place'; place: RoutePlace; inputDatum: IncomingPlaceDatum; format: 'geo-uri' | 'tencent-marker' }
  | { kind: 'unsupported'; reason: string };

const MAX_TEXT = 8192;
const DECIMAL = /^-?\d+(?:\.\d+)?$/;
const GEO_QUERY_COORDINATE = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)(?:\s*\(([^()]*)\))?\s*$/;
const GEO_QUERY_COORDINATE_PREFIX = /^\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?/;
const UNSUPPORTED = '暂不支持这种分享格式。请分享包含坐标的 geo 位置或腾讯地图地点标注链接。';

function parsePair(value: string, order: 'lat-lon' | 'lon-lat'): Coordinate | null {
  const values = value.trim().split(',');
  if (values.length !== 2 || !values.every(part => DECIMAL.test(part.trim()))) return null;
  const first = Number(values[0]), second = Number(values[1]);
  const lat = order === 'lat-lon' ? first : second;
  const lon = order === 'lat-lon' ? second : first;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180) return null;
  return [lon, lat];
}

function safeName(value: string | undefined, fallback: string): string {
  const cleaned = value?.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, 100) : fallback;
}

function placeResult(
  coordinate: Coordinate,
  inputDatum: IncomingPlaceDatum,
  name: string,
  detail?: string,
  format: 'geo-uri' | 'tencent-marker' = 'geo-uri',
): ParsedIncomingPlace {
  const wgs84 = inputDatum === 'GCJ-02' ? importCoordinate(coordinate, 'gcj02') : [...coordinate] as Coordinate;
  return {
    kind: 'place', inputDatum, format,
    place: {
      name: safeName(name, '收到的位置'),
      coordinates: wgs84,
      ...(detail?.trim() ? { detail: detail.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240) } : {}),
      coordinateSystem: 'WGS84',
      precision: 'unknown',
    },
  };
}

function decodeUriText(raw: string): string | null {
  try { return decodeURIComponent(raw); } catch { return null; }
}

function parseGeoUri(uri: string): ParsedIncomingPlace {
  const match = /^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,(-?\d+(?:\.\d+)?))?(?:;([^?]*))?(?:\?(.*))?$/i.exec(uri);
  if (!match) return { kind: 'unsupported', reason: UNSUPPORTED };
  const coordinate = parsePair(`${match[1]},${match[2]}`, 'lat-lon');
  if (!coordinate) return { kind: 'unsupported', reason: '分享中的坐标无效或超出山兔地图支持范围。' };
  const params = (match[4] ?? '').split(';').filter(Boolean);
  let crs: string | undefined, uncertainty: string | undefined;
  for (const param of params) {
    const [key, ...rest] = param.split('=');
    const value = rest.join('=');
    if (key.toLowerCase() === 'crs' && crs === undefined) crs = value.toLowerCase();
    else if (key.toLowerCase() === 'u' && uncertainty === undefined && DECIMAL.test(value) && Number(value) >= 0) uncertainty = value;
    else return { kind: 'unsupported', reason: UNSUPPORTED };
  }
  if (crs !== undefined && crs !== 'wgs84') return { kind: 'unsupported', reason: '此 geo 链接使用了山兔暂不支持的坐标参考系。' };
  void uncertainty;
  let label = '';
  let destination = coordinate;
  if (match[5]) {
    const query = new URLSearchParams(match[5]);
    if (query.getAll('q').length > 1 || [...query.keys()].some(key => key !== 'q'))
      return { kind: 'unsupported', reason: UNSUPPORTED };
    if (query.has('q')) {
      const q = query.get('q')?.trim() ?? '';
      const qCoordinate = GEO_QUERY_COORDINATE.exec(q);
      if (qCoordinate) {
        const parsed = parsePair(`${qCoordinate[1]},${qCoordinate[2]}`, 'lat-lon');
        if (!parsed) return { kind: 'unsupported', reason: '分享中的查询坐标无效或超出山兔地图支持范围。' };
        destination = parsed;
        label = qCoordinate[3] ?? '';
      } else if (GEO_QUERY_COORDINATE_PREFIX.test(q)) {
        return { kind: 'unsupported', reason: '分享中的查询坐标格式无效或存在歧义。' };
      } else {
        // geo:0,0?q=place is a search request, not a coordinate share. Without
        // a geocoder we must not present its conventional 0,0 search origin as
        // the user's destination.
        if (coordinate[0] === 0 && coordinate[1] === 0)
          return { kind: 'unsupported', reason: '分享只包含地点名称或地址，没有可直接导入的坐标。' };
        label = q;
      }
    }
  }
  return placeResult(destination, 'WGS84', label, undefined, 'geo-uri');
}

function parseTencentMarker(urlText: string): ParsedIncomingPlace {
  let url: URL;
  try { url = new URL(urlText); } catch { return { kind: 'unsupported', reason: UNSUPPORTED }; }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'apis.map.qq.com' || url.pathname !== '/uri/v1/marker' || url.username || url.password)
    return { kind: 'unsupported', reason: UNSUPPORTED };
  const typeValues = url.searchParams.getAll('coord_type');
  if (typeValues.length > 1) return { kind: 'unsupported', reason: UNSUPPORTED };
  const coordType = typeValues[0] ?? '2';
  if (coordType !== '1' && coordType !== '2') return { kind: 'unsupported', reason: '腾讯地图链接声明了不支持的坐标类型。' };
  const markers = url.searchParams.getAll('marker');
  if (markers.length !== 1 || !markers[0]) return { kind: 'unsupported', reason: UNSUPPORTED };
  const sets = markers[0].split('I');
  if (sets.length !== 1) return { kind: 'unsupported', reason: '暂不支持包含多个地点的腾讯地图分享，请单独分享一个地点。' };
  const attributes = new Map<string, string>();
  for (const field of sets[0].split(';')) {
    if (!field) continue;
    const separator = field.indexOf(':');
    if (separator <= 0) continue;
    const key = field.slice(0, separator).trim().toLowerCase();
    if (!['coord', 'title', 'addr'].includes(key)) continue;
    if (attributes.has(key)) return { kind: 'unsupported', reason: '腾讯地图分享重复声明了地点字段。' };
    attributes.set(key, field.slice(separator + 1).trim());
  }
  const coordinateText = attributes.get('coord');
  if (!coordinateText) return { kind: 'unsupported', reason: UNSUPPORTED };
  const coordinate = parsePair(coordinateText, 'lat-lon');
  if (!coordinate) return { kind: 'unsupported', reason: '腾讯地图分享中的坐标无效或超出山兔地图支持范围。' };
  const datum: IncomingPlaceDatum = coordType === '1' ? 'WGS84' : 'GCJ-02';
  return placeResult(coordinate, datum, attributes.get('title') ?? '', attributes.get('addr'), 'tencent-marker');
}

/** Strictly parses coordinate-bearing location shares; arbitrary URLs and place names are never geocoded. */
export function parseIncomingPlace(input: unknown): ParsedIncomingPlace {
  if (typeof input !== 'string' || input.length === 0 || input.length > MAX_TEXT)
    return { kind: 'unsupported', reason: UNSUPPORTED };
  const text = input.trim();
  const trimSharePunctuation = (value: string) => {
    let result = value.replace(/[，。；;]+$/g, '');
    while (result.endsWith(')')) {
      const opens = [...result].filter(char => char === '(').length;
      const closes = [...result].filter(char => char === ')').length;
      if (closes <= opens) break;
      result = result.slice(0, -1);
    }
    return result;
  };
  const geoMatchResults = [...text.matchAll(/geo:[^\s<>"']+/ig)];
  const geoMatches = geoMatchResults.map(match => trimSharePunctuation(match[0]));
  const tencentMatches = [...text.matchAll(/https:\/\/apis\.map\.qq\.com\/uri\/v1\/marker(?:\?[^\s<>"']*)?/ig)].map(match => match[0].replace(/[),，。；]+$/g, ''));
  if (geoMatches.length + tencentMatches.length !== 1) return { kind: 'unsupported', reason: UNSUPPORTED };
  if (geoMatches.length === 1) {
    const match = geoMatchResults[0]!;
    const tail = text.slice(match.index! + match[0].length);
    if (tail.trim() && !/^[\s，。；;)]*$/.test(tail)) return { kind: 'unsupported', reason: UNSUPPORTED };
    const decoded = decodeUriText(geoMatches[0]);
    return decoded ? parseGeoUri(decoded) : { kind: 'unsupported', reason: UNSUPPORTED };
  }
  return parseTencentMarker(tencentMatches[0]);
}
