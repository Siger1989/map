import type { Coordinate } from '../navigation/types';
import type { ScreenPoint } from '../tracks/drawing';
import type { CatalogEntry } from './catalog';
export type SelectionBox = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};
export const selectionBox = (a: ScreenPoint, b: ScreenPoint): SelectionBox => ({
  left: Math.min(a.x, b.x),
  right: Math.max(a.x, b.x),
  top: Math.min(a.y, b.y),
  bottom: Math.max(a.y, b.y),
});
const inside = (p: ScreenPoint, r: SelectionBox) =>
  p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
/** Slab clipping includes edges crossing the rectangle even when both vertices lie outside. */
export function edgeIntersects(
  a: ScreenPoint,
  b: ScreenPoint,
  r: SelectionBox,
) {
  let low = 0,
    high = 1;
  for (const [origin, delta, min, max] of [
    [a.x, b.x - a.x, r.left, r.right],
    [a.y, b.y - a.y, r.top, r.bottom],
  ]) {
    if (Math.abs(delta) < 1e-10) {
      if (origin < min || origin > max) return false;
      continue;
    }
    const t1 = (min - origin) / delta,
      t2 = (max - origin) / delta;
    low = Math.max(low, Math.min(t1, t2));
    high = Math.min(high, Math.max(t1, t2));
    if (low > high) return false;
  }
  return true;
}
export function selectInBox(
  entries: CatalogEntry[],
  box: SelectionBox,
  project: (p: Coordinate) => ScreenPoint | null,
): string[] {
  const hitLine = (points: Coordinate[]) => {
    const screen = points.map(project);
    return screen.some(
      (p, i) =>
        p &&
        (inside(p, box) ||
          (i > 0 && screen[i - 1] && edgeIntersects(screen[i - 1]!, p, box))),
    );
  };
  return entries
    .filter((e) => {
      if ('annotation' in e && !e.annotation.visible) return false;
      if (e.kind === 'area' && !e.area.visible) return false;
      if (e.kind === 'section' && !e.section.settings.enabled) return false;
      if (e.kind === 'track') return e.track.segments.some(hitLine);
      if (e.kind === 'route') return hitLine(e.route.route.coordinates);
      if (e.kind === 'area') {
        if (hitLine(e.area.boundary)) return true;
        const points = e.area.boundary.map(project);
        if (points.some((p) => !p)) return false;
        const p = {
          x: (box.left + box.right) / 2,
          y: (box.top + box.bottom) / 2,
        };
        let contained = false;
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
          const a = points[i]!,
            b = points[j]!;
          if (
            a.y > p.y !== b.y > p.y &&
            p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
          )
            contained = !contained;
        }
        return contained;
      }
      const point = project(e.coordinates);
      return !!point && inside(point, box);
    })
    .map((e) => e.key);
}
