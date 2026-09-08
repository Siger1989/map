import { simplePolygon } from '../geometry/polygon.ts';
export type Footprint = [number, number][];
export function footprintArea(points: Footprint) {
  return (
    Math.abs(
      points.reduce((sum, p, i) => {
        const q = points[(i + 1) % points.length];
        return sum + p[0] * q[1] - q[0] * p[1];
      }, 0),
    ) / 2
  );
}
export function validFootprint(v: unknown): v is Footprint {
  if (
    !Array.isArray(v) ||
    v.length < 3 ||
    v.length > 6000 ||
    !v.every(
      (p) =>
        Array.isArray(p) &&
        p.length === 2 &&
        p.every(
          (n) =>
            typeof n === 'number' &&
            Number.isFinite(n) &&
            Math.abs(n) <= 0.500001,
        ),
    )
  )
    return false;
  return footprintArea(v) > 1e-10 && simplePolygon(v);
}
