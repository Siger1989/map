import { metresBetween, type Coordinate } from '../navigation/types.ts';
export function railFraction(y: number, top: number, height: number) {
  return Number.isFinite(y) && height > 0
    ? Math.max(0, Math.min(1, (y - top) / height))
    : 0;
}
/** Index route geometry once; pointer movement then uses a binary search. */
export function routePositionIndex(line: Coordinate[]) {
  const distances = [0];
  for (let i = 1; i < line.length; i++)
    distances.push(distances[i - 1] + metresBetween(line[i - 1], line[i]));
  const length = distances.at(-1) ?? 0;
  return (fraction: number): Coordinate | null => {
    if (!line.length) return null;
    const f = Number.isFinite(fraction)
      ? Math.max(0, Math.min(1, fraction))
      : 0;
    if (f === 0 || length === 0) return line[0];
    if (f === 1) return line.at(-1)!;
    const target = length * f;
    let low = 1,
      high = line.length - 1;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (distances[mid] < target) low = mid + 1;
      else high = mid;
    }
    const a = line[low - 1],
      b = line[low],
      t =
        (target - distances[low - 1]) /
        (distances[low] - distances[low - 1] || 1);
    const delta = ((b[0] - a[0] + 540) % 360) - 180;
    return [((a[0] + delta * t + 540) % 360) - 180, a[1] + (b[1] - a[1]) * t];
  };
}
