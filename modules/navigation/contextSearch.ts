import { metresBetween, type Coordinate, type RoutePlace } from './types.ts';

export const CONTEXT_RADIUS_METERS = 5_000;
const anchorSuffix = /(?:湖|公园|站|机场|景区|广场|医院|学校|大学|博物馆|体育馆|车站|码头|景点|公园|动物园|植物园|寺|山)$/u;

export type ContextSearchQuery = { target: string; anchor: string };

/** Keep ordinary multiword names intact; only recognize a narrow Chinese nearby form. */
export function parseContextSearchQuery(query: string): ContextSearchQuery | null {
  const match = query.trim().match(/^([\p{Script=Han}]{2,})\s+([\p{Script=Han}]{2,})$/u);
  if (!match || !anchorSuffix.test(match[2]) || /(?:省|自治区|市|州|县|盟|旗)$/u.test(match[1])) return null;
  return { target: match[1], anchor: match[2] };
}

export function isContextAnchorName(name: string) {
  return anchorSuffix.test(name.trim());
}

/** A short second Chinese token can be an anchor prefix while the user is typing. */
export function parseContextAnchorPrefix(query: string): ContextSearchQuery | null {
  const match = query.trim().match(/^([\p{Script=Han}]{3,})\s+([\p{Script=Han}]{2,})$/u);
  if (!match || anchorSuffix.test(match[2]) || /(?:省|自治区|市|州|县|盟|旗)$/u.test(match[1])) return null;
  return { target: match[1], anchor: match[2] };
}

export function isContextAnchorCompletion(query: string) {
  return /^([\p{Script=Han}]{2,})\s+([\p{Script=Han}])$/u.test(query.trim());
}

export function boundedMapSearch(center: Coordinate, radiusMeters = CONTEXT_RADIUS_METERS) {
  const latStep = radiusMeters / 111_320;
  const lonStep = radiusMeters / (111_320 * Math.max(0.25, Math.cos(center[1] * Math.PI / 180)));
  return [center[0] - lonStep, center[1] - latStep, center[0] + lonStep, center[1] + latStep]
    .map((value) => value.toFixed(5)).join(',');
}

export function withinContextRadius(places: RoutePlace[], center: Coordinate, radiusMeters = CONTEXT_RADIUS_METERS) {
  return places.filter((place) => metresBetween(center, place.coordinates) <= radiusMeters);
}

const normalized = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/[\s,，.。]/g, '');

export function exactContextAnchors(places: RoutePlace[], anchor: string) {
  const key = normalized(anchor);
  return places.filter((place) => normalized(place.name) === key);
}

function localityParts(place: RoutePlace) {
  return place.detail?.split('·').map((part) => part.trim()).filter(Boolean) ?? [];
}

export function contextPlaceMatchesCity(place: RoutePlace, city?: string) {
  if (!city?.trim()) return true;
  const key = normalized(city);
  const administrativeName = (value: string) => value.replace(/(?:省|市|州|县|盟|旗)$/u, '');
  return localityParts(place).some((part) => {
    const actual = normalized(part);
    return actual === key || (administrativeName(key).length >= 2 &&
      administrativeName(actual) === administrativeName(key));
  });
}

export function contextAnchorCity(place: RoutePlace) {
  const locality = localityParts(place);
  return locality.find((part) => /(?:市|州|县|盟|旗)$/u.test(part));
}

export function contextAnchorSuggestions(places: RoutePlace[], target: string): { label: string; query: string; city?: string }[] {
  const seen = new Set<string>();
  return places.slice(0, 8).flatMap((place) => {
    const city = contextAnchorCity(place);
    const key = `${normalized(place.name)}|${city ?? ''}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ label: `${place.name}附近`, query: `${target} ${place.name}`, ...(city ? { city } : {}) }];
  });
}

export function contextAnchorPrefixSuggestions(places: RoutePlace[], target: string, prefix: string) {
  const prefixKey = normalized(prefix);
  const matching = places.filter((place) => normalized(place.name).includes(prefixKey) && isContextAnchorName(place.name));
  const seen = new Set<string>();
  return matching.slice(0, 20).flatMap((place) => {
    const city = contextAnchorCity(place);
    const key = `${normalized(place.name)}|${city ?? ''}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ label: `${place.name}附近`, query: `${target} ${place.name}`, ...(city ? { city } : {}) }];
  }).slice(0, 8);
}
