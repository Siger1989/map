import { metresBetween, type Coordinate, type RoutePlace } from './types.ts';

function normalized(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}]/gu, '');
}

/** Prefer the requested place itself over nearby businesses containing its name. */
export function orderSearchResults(places: RoutePlace[], query: string, near: Coordinate | null) {
  const term = normalized(query.trim());
  return places.map((place, index) => ({
    place, index,
    exact: Boolean(term) && normalized(place.name) === term ? 0 : 1,
    distance: near ? metresBetween(near, place.coordinates) : 0,
  })).sort((a, b) => a.exact - b.exact || a.distance - b.distance || a.index - b.index)
    .map(({ place }) => place);
}
