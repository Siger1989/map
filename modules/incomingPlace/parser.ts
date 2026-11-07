import type { Coordinate, RoutePlace } from '../navigation/types';
import { importCoordinate } from '../dataTransfer/coordinateSystem.ts';

export type IncomingPlaceDatum = 'WGS84' | 'GCJ-02';
export type ParsedIncomingPlace =
  | { kind: 'place'; place: RoutePlace; inputDatum: IncomingPlaceDatum; format: 'geo-uri' | 'tencent-marker' | 'google-maps' }
  | { kind: 'unsupported'; reason: string };

const MAX_TEXT = 8192;
const DECIMAL = /^-?\d+(?:\.\d+)?$/;
const GEO_QUERY_COORDINATE = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)(?:\s*\(([^()]*)\))?\s*$/;
const GEO_QUERY_COORDINATE_PREFIX = /^\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?/;
const UNSUPPORTED = '无法从分享内容确认地点。请分享 Google 地图中的单个地点，或带坐标的位置链接。';
const GOOGLE_UNSUPPORTED = '此分享没有可确认的单个地点坐标。请打开地点详情后重新分享，或分享带坐标的位置链接。';

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
  format: 'geo-uri' | 'tencent-marker' | 'google-maps' = 'geo-uri',
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

function isGoogleMapsUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return url.protocol === 'https:' && (host === 'google.com' || host === 'www.google.com' || host === 'maps.google.com') &&
    !url.username && !url.password && !url.port &&
    (/^\/maps(?:\/|$)/i.test(url.pathname) || (host === 'maps.google.com' && url.pathname === '/'));
}

function decodeGoogleName(value: string): string {
  try { return decodeURIComponent(value.replace(/\+/g, ' ')).replace(/\s+/g, ' ').trim(); }
  catch { return ''; }
}

function isGenericGoogleName(value: string): boolean {
  return /^(?:google\s*maps?|谷歌地图|google地图)$/i.test(value.trim());
}

function googleName(url: URL, sharedName?: string, beforeUrl = '', queryName = ''): string {
  const placeMatch = /^\/maps\/place\/([^/]+)/i.exec(url.pathname);
  const pathName = placeMatch ? decodeGoogleName(placeMatch[1]) : '';
  if (pathName && !parsePair(pathName, 'lat-lon') && !isGenericGoogleName(pathName)) return pathName;
  for (const candidate of [queryName, sharedName ?? '', beforeUrl]) {
    const name = candidate.replace(/^[\s:：,，;；\-]+|[\s:：,，;；\-]+$/g, '').trim();
    if (name && !isGenericGoogleName(name)) return name;
  }
  return 'Google 地点';
}

function parseGoogleMaps(urlText: string, sharedName?: string, beforeUrl = ''): ParsedIncomingPlace {
  let url: URL;
  try { url = new URL(urlText); } catch { return { kind: 'unsupported', reason: GOOGLE_UNSUPPORTED }; }
  if (!isGoogleMapsUrl(url) || url.hash) return { kind: 'unsupported', reason: GOOGLE_UNSUPPORTED };

  const coordinates: Coordinate[] = [];
  let queryName = '';
  const addLatLon = (lat: string, lon: string): boolean => {
    const coordinate = parsePair(`${lat},${lon}`, 'lat-lon');
    if (!coordinate) return false;
    coordinates.push(coordinate);
    return true;
  };

  // Read the selected place's data field, never unrelated tracking parameters
  // or the viewport/route's camera coordinates.
  const placePath = /^\/maps\/place\/([^/]+)/i.exec(url.pathname);
  if (/^\/maps\/(?:dir|@)/i.test(url.pathname)) return { kind: 'unsupported', reason: GOOGLE_UNSUPPORTED };
  const dataFields = url.pathname.split('/').filter(part => part.startsWith('data=')).map(part => part.slice(5));
  dataFields.push(...url.searchParams.getAll('data'));
  if (dataFields.length > 1 || (dataFields.length && !placePath)) return { kind: 'unsupported', reason: GOOGLE_UNSUPPORTED };
  let data = '';
  try { data = dataFields.length ? decodeURIComponent(dataFields[0]!) : ''; }
  catch { return { kind: 'unsupported', reason: GOOGLE_UNSUPPORTED }; }
  const latTokens = [...data.matchAll(/!3d([^!&]+)/g)].map(match => match[1]);
  const lonTokens = [...data.matchAll(/!4d([^!&]+)/g)].map(match => match[1]);
  if (latTokens.length || lonTokens.length) {
    const pair = /!3d([^!&]+)!4d([^!&]+)/.exec(data);
    if (latTokens.length !== 1 || lonTokens.length !== 1 || !pair || !addLatLon(pair[1]!, pair[2]!))
      return { kind: 'unsupported', reason: GOOGLE_UNSUPPORTED };
  }

  const pathName = placePath ? decodeGoogleName(placePath[1]!) : '';
  const pathCoordinate = GEO_QUERY_COORDINATE.exec(pathName);
  if (pathCoordinate && !addLatLon(pathCoordinate[1]!, pathCoordinate[2]!))
    return { kind: 'unsupported', reason: 'Google 地图分享中的坐标无效或超出山兔地图支持范围。' };

  const isSearchPath = /^\/maps\/search\/?$/i.test(url.pathname);
  const isMapsPath = /^\/maps\/?$/i.test(url.pathname) || (url.hostname === 'maps.google.com' && url.pathname === '/');
  if (url.searchParams.has('q') && url.searchParams.has('query'))
    return { kind: 'unsupported', reason: GOOGLE_UNSUPPORTED };
  const coordinateParams = isSearchPath ? url.searchParams.getAll('query') : isMapsPath ? url.searchParams.getAll('q') : [];
  if (coordinateParams.length > 1) return { kind: 'unsupported', reason: GOOGLE_UNSUPPORTED };
  if (coordinateParams.length === 1) {
    const value = coordinateParams[0]!.trim();
    const match = GEO_QUERY_COORDINATE.exec(value);
    if (match) {
      if (!addLatLon(match[1]!, match[2]!))
        return { kind: 'unsupported', reason: 'Google 地图分享中的坐标无效或超出山兔地图支持范围。' };
      queryName = match[3] ?? '';
    } else if (GEO_QUERY_COORDINATE_PREFIX.test(value)) {
      return { kind: 'unsupported', reason: GOOGLE_UNSUPPORTED };
    }
  }
  if (!coordinates.length) return { kind: 'unsupported', reason: GOOGLE_UNSUPPORTED };
  if (coordinates.some(coordinate => coordinate[0] !== coordinates[0]![0] || coordinate[1] !== coordinates[0]![1]))
    return { kind: 'unsupported', reason: 'Google 地图分享包含互相冲突的地点坐标。' };
  return placeResult(coordinates[0]!, 'WGS84', googleName(url, sharedName, beforeUrl, queryName), undefined, 'google-maps');
}

/** Strictly parses coordinate-bearing location shares; arbitrary URLs and place names are never geocoded. */
export function parseIncomingPlace(input: unknown, sharedName?: string): ParsedIncomingPlace {
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
  const googleMatches = [...text.matchAll(/https:\/\/[^\s<>"']+/ig)].map(match => ({
    url: trimSharePunctuation(match[0]), index: match.index!,
  })).filter(match => {
    try { return isGoogleMapsUrl(new URL(match.url)); } catch { return false; }
  });
  const shortGoogleLinks = [...text.matchAll(/https:\/\/[^\s<>"']+/ig)].some(match => {
    try {
      const url = new URL(match[0].replace(/[),，。；]+$/g, ''));
      return url.protocol === 'https:' && ['maps.app.goo.gl', 'goo.gl'].includes(url.hostname.toLowerCase());
    } catch { return false; }
  });
  if (shortGoogleLinks && !googleMatches.length)
    return { kind: 'unsupported', reason: '这是 Google 地图短链接，需先联网展开为完整地点链接后才能导入。' };
  const httpsLinks = [...text.matchAll(/https?:\/\/[^\s<>"']+/ig)];
  if (googleMatches.length && httpsLinks.length !== 1) return { kind: 'unsupported', reason: UNSUPPORTED };
  if (geoMatches.length + tencentMatches.length + googleMatches.length !== 1) return { kind: 'unsupported', reason: UNSUPPORTED };
  if (geoMatches.length === 1) {
    const match = geoMatchResults[0]!;
    const tail = text.slice(match.index! + match[0].length);
    if (tail.trim() && !/^[\s，。；;)]*$/.test(tail)) return { kind: 'unsupported', reason: UNSUPPORTED };
    const decoded = decodeUriText(geoMatches[0]);
    return decoded ? parseGeoUri(decoded) : { kind: 'unsupported', reason: UNSUPPORTED };
  }
  if (tencentMatches.length === 1) return parseTencentMarker(tencentMatches[0]);
  const google = googleMatches[0]!;
  const prefix = text.slice(0, google.index).split(/\r?\n/).map(line => line.trim()).filter(Boolean).at(-1) ?? '';
  return parseGoogleMaps(google.url, sharedName, prefix);
}
