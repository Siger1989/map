import { pointOnContour, type Contour } from './contours.ts';
import type { ProfileNote } from './profileNotes';
import type { SectionSettings } from './types';
export function sliderFraction(x: number, left: number, width: number) {
  return width > 0 && Number.isFinite(x)
    ? Math.max(0, Math.min(1, (x - left) / width))
    : 0;
}
export function nearestContourFraction(
  curve: Contour,
  x: number,
  y: number,
  project: (p: Contour['points'][number]) => [number, number],
) {
  let best = Infinity,
    fraction = 0;
  for (let i = 1; i < curve.points.length; i++) {
    const a = project(curve.points[i - 1]),
      b = project(curve.points[i]),
      dx = b[0] - a[0],
      dy = b[1] - a[1];
    const t = Math.max(
      0,
      Math.min(
        1,
        ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1),
      ),
    );
    const distance = (x - a[0] - t * dx) ** 2 + (y - a[1] - t * dy) ** 2;
    if (distance < best) {
      best = distance;
      fraction =
        (curve.distances[i - 1] +
          t * (curve.distances[i] - curve.distances[i - 1])) /
        (curve.length || 1);
    }
  }
  return fraction;
}
export function moveProfileNote(
  note: ProfileNote,
  curve: Contour,
  fraction: number,
  settings: SectionSettings,
  sampledAt: number,
): ProfileNote {
  const value = Math.max(
    0,
    Math.min(1, Number.isFinite(fraction) ? fraction : 0),
  );
  return {
    ...note,
    fraction: value,
    point: pointOnContour(curve, value, settings),
    curveName: curve.name,
    source: curve.source,
    sampledAt,
  };
}
