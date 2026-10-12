import { coordinate, type Coordinate, type RoutePlace } from './types.ts';
import { PlaceSearchError, searchErrorMessage } from './placeSearchTransport.ts';

const ENDPOINT = 'https://photon.komoot.io';
const LIMIT = 20;
export type PhotonOptions = { city?: string; nationwide?: boolean };
export type PhotonResult = { places: RoutePlace[]; suggestions: { label: string; query: string; city?: string }[] };

function addressParts(query: string) {
  const match = query.match(/^\s*(\d+[A-Za-z]?)\s+(.+)$/);
  if (!match) return null;
  const street = match[2].trim();
  if (!/(?:\bstreet\b|\bst\.?\b|\broad\b|\brd\.?\b|\bavenue\b|\bave\.?\b|\blane\b|\bdrive\b|路|街|巷|道)$/i.test(street)) return null;
  return { house: match[1], street };
}

export function buildPhotonSearchURL(query: string, near: Coordinate | null, options: PhotonOptions = {}) {
  const city = options.nationwide ? undefined : options.city?.trim().slice(0, 100);
  const address = city ? addressParts(query) : null;
  const url = new URL(`${ENDPOINT}${address ? '/structured' : '/api/'}`);
  url.searchParams.set('limit', String(LIMIT));
  if (address) {
    url.searchParams.set('city', city!);
    url.searchParams.set('street', address.street);
    url.searchParams.set('housenumber', address.house);
  } else {
    url.searchParams.set('q', [query, city].filter(Boolean).join(' ').slice(0, 120));
    url.searchParams.set('lang', 'default');
    if (near && !city && options.nationwide !== true) {
      url.searchParams.set('lat', String(near[1]));
      url.searchParams.set('lon', String(near[0]));
      url.searchParams.set('zoom', '12');
      url.searchParams.set('location_bias_scale', '0.1');
    }
  }
  return url.toString();
}

function text(value: unknown) { return typeof value === 'string' ? value.trim() : ''; }
const key = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/[\s,，.。]/g, '');

export function normalizePhoton(data: unknown, query: string, preferredCity?: string): PhotonResult {
  if (!data || typeof data !== 'object' || !Array.isArray((data as { features?: unknown }).features))
    throw new PlaceSearchError('format', searchErrorMessage('format'));
  const result: RoutePlace[] = [];
  const suggestions: PhotonResult['suggestions'] = [];
  for (const feature of (data as { features: unknown[] }).features) {
    if (!feature || typeof feature !== 'object') continue;
    const item = feature as { geometry?: { coordinates?: unknown }; properties?: Record<string, unknown> };
    const coords = item.geometry?.coordinates;
    const p = item.properties;
    if (!coordinate(coords) || !p) continue;
    const name = text(p.name);
    const street = text(p.street);
    const house = text(p.housenumber);
    const label = text(p.label);
    const address = [street, house].filter(Boolean).join(' ');
    const display = name || label || address;
    if (!display) continue;
    const detail = [...new Set([p.country, p.state, p.city, p.district, address]
      .filter((v): v is string => typeof v === 'string' && Boolean(v.trim()))
      .map((v) => v.trim()))].join(' · ');
    const type = text(p.type).toLowerCase();
    const precision: RoutePlace['precision'] = house || ['house', 'address'].includes(type)
      ? 'address'
      : type === 'street' ? 'street'
        : ['city', 'district', 'county'].includes(type) ? 'locality'
          : ['state', 'country'].includes(type) ? 'region'
            : name ? 'poi' : 'unknown';
    result.push({
      name: display.slice(0, 160),
      coordinates: [coords[0] as number, coords[1] as number],
      ...(detail ? { detail: detail.slice(0, 240) } : {}),
      source: 'photon',
      precision,
      coordinateSystem: 'WGS84',
    });
    if (preferredCity && text(p.name) && ['city', 'district', 'county', 'state'].includes(type)) {
      suggestions.push({ label: `${text(p.name)}（按行政区搜索）`, query, city: text(p.name) });
    }
  }
  const cityKey = key(preferredCity ?? '');
  result.sort((a, b) => {
    const aMatch = cityKey && key(a.detail?.split(' · ').slice(0, 3).join(' ') ?? '').includes(cityKey) ? 0 : 1;
    const bMatch = cityKey && key(b.detail?.split(' · ').slice(0, 3).join(' ') ?? '').includes(cityKey) ? 0 : 1;
    return aMatch - bMatch;
  });
  return { places: result.slice(0, LIMIT), suggestions: [...new Map(suggestions.map((s) => [s.city, s])).values()].slice(0, 5) };
}
