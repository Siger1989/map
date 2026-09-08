type XY = readonly [number, number];
const cross = (a: XY, b: XY, c: XY) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
/** Open, simple ring. Reject crossings/touches and adjacent doubled-back edges. */
export function simplePolygon(points: XY[]) {
  const n = points.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    const a = points[(i + n - 1) % n],
      b = points[i],
      c = points[(i + 1) % n];
    if (b[0] === c[0] && b[1] === c[1]) return false;
    if (
      cross(a, b, c) === 0 &&
      (a[0] - b[0]) * (c[0] - b[0]) + (a[1] - b[1]) * (c[1] - b[1]) > 0
    )
      return false;
  }
  const edges = points
    .map((a, i) => {
      const b = points[(i + 1) % n];
      return { a, b, i, min: Math.min(a[0], b[0]), max: Math.max(a[0], b[0]) };
    })
    .sort((a, b) => a.min - b.min);
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n && edges[j].min <= edges[i].max; j++) {
      const a = edges[i],
        b = edges[j];
      if (Math.abs(a.i - b.i) === 1 || Math.abs(a.i - b.i) === n - 1) continue;
      if (
        Math.max(a.a[1], a.b[1]) < Math.min(b.a[1], b.b[1]) ||
        Math.max(b.a[1], b.b[1]) < Math.min(a.a[1], a.b[1])
      )
        continue;
      if (
        cross(a.a, a.b, b.a) * cross(a.a, a.b, b.b) <= 0 &&
        cross(b.a, b.b, a.a) * cross(b.a, b.b, a.b) <= 0
      )
        return false;
    }
  return true;
}
