import { metresBetween, type Coordinate, type RoutePlace } from './types.ts';

export const TDT_NATIONWIDE = '73,3,136,54';
export function sortPlaces(places: RoutePlace[], near: Coordinate | null, city?: string) {
  const cityKey = city?.normalize('NFKC').toLocaleLowerCase();
  return places.map((place, index) => ({
    place, index,
    distance: near ? metresBetween(near, place.coordinates) : 0,
    localityMatch: cityKey && place.detail?.normalize('NFKC').toLocaleLowerCase().includes(cityKey) ? 0 : 1,
  })).sort((a, b) => a.localityMatch - b.localityMatch || a.distance - b.distance || a.index - b.index)
    .map(({ place }) => place);
}


export function mapBound(near: Coordinate | null, nationwide: boolean) {
  if (!near || nationwide || near[0] < 73 || near[0] > 136 || near[1] < 3 || near[1] > 54) return TDT_NATIONWIDE;
  const latStep = 0.5;
  const lonStep = Math.min(3, latStep / Math.max(0.25, Math.cos(near[1] * Math.PI / 180)));
  const west = Math.max(73, near[0] - lonStep);
  const east = Math.min(136, near[0] + lonStep);
  const south = Math.max(3, near[1] - latStep);
  const north = Math.min(54, near[1] + latStep);
  return [west, south, east, north].map((value) => value.toFixed(4)).join(',');
}

export function queryCity(query: string) {
  const provinceCity = query.match(/^[\p{Script=Han}]{2,12}(?:\u7701|\u81ea\u6cbb\u533a)([\p{Script=Han}]{2,12}(?:\u81ea\u6cbb\u5dde|\u5e02|\u5dde|\u53bf|\u76df|\u65d7))/u);
  if (provinceCity) return provinceCity[1];
  const city = query.match(/^([\p{Script=Han}]{2,12}(?:\u81ea\u6cbb\u5dde|\u5e02|\u5dde|\u53bf|\u76df|\u65d7))/u);
  if (city && !/(?:\u8d85\u5e02|\u57ce\u5e02)$/.test(city[1])) return city[1];
  return query.match(/^([\p{Script=Han}]{2,12}(?:\u7701|\u81ea\u6cbb\u533a))/u)?.[1];
}
export function nearChina(near: Coordinate | null) {
  return Boolean(near && near[0] >= 73 && near[0] <= 136 && near[1] >= 3 && near[1] <= 54);
}

export function credentialScope(token: string) {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i++) hash = Math.imul(hash ^ token.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(36);
}



export function mergeSuggestions<T extends { label: string; city?: string }>(...groups: T[][]): T[] {
  return [...new Map(groups.flat().map((item) => [`${item.label}|${item.city ?? ''}`, item])).values()];
}
