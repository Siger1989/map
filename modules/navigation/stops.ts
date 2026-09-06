import type { RoutePlace } from './types';
export const MAX_ROUTE_STOPS = 10;
export type RouteStop = { id: string; query: string; place: RoutePlace | null };
export const stopLabel = (index: number, length: number) =>
  index === 0 ? '起点' : index === length - 1 ? '终点' : `途经点 ${index}`;
export function moveStop<T>(stops: T[], from: number, to: number): T[] {
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to < 0 ||
    from >= stops.length ||
    to >= stops.length ||
    from === to
  )
    return stops;
  const next = [...stops];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
