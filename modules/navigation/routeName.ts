import type { RoutePlace } from './types';

const SEPARATOR = ' → ';
const MAX_ROUTE_NAME_LENGTH = 60;

function shorten(value: string, limit: number) {
  const name = value.trim();
  if (name.length <= limit) return name;
  if (limit <= 1) return name.slice(0, limit);
  return `${name.slice(0, limit - 1)}…`;
}

/** Keep both endpoint names visible while respecting the 60-character input limit. */
export function defaultRouteName(start: Pick<RoutePlace, 'name'>, end: Pick<RoutePlace, 'name'>) {
  const left = start.name.trim() || '起点';
  const right = end.name.trim() || '终点';
  const combined = `${left}${SEPARATOR}${right}`;
  if (combined.length <= MAX_ROUTE_NAME_LENGTH) return combined;

  const available = MAX_ROUTE_NAME_LENGTH - SEPARATOR.length;
  const leftLimit = Math.min(left.length, Math.ceil(available / 2));
  const rightLimit = Math.min(right.length, available - leftLimit);
  const extra = available - leftLimit - rightLimit;
  const finalLeftLimit = Math.min(left.length, leftLimit + extra);
  return `${shorten(left, finalLeftLimit)}${SEPARATOR}${shorten(right, rightLimit)}`;
}

export function routeNameOrDefault(name: string | undefined, start: RoutePlace, end: RoutePlace) {
  const cleaned = name?.trim();
  return cleaned && cleaned.length <= MAX_ROUTE_NAME_LENGTH
    ? cleaned
    : defaultRouteName(start, end);
}
