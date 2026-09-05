import { altitudeRange, type Annotation } from '../annotations/data.ts';
type XY = [number, number];
type XYZ = [number, number, number];
function rotate([x, y, z]: XYZ, item: Annotation): XYZ {
  const p = (item.pitch * Math.PI) / 180,
    r = (item.roll * Math.PI) / 180,
    h = (-item.heading * Math.PI) / 180;
  const y1 = y * Math.cos(p) - z * Math.sin(p),
    z1 = y * Math.sin(p) + z * Math.cos(p);
  const x2 = x * Math.cos(r) + z1 * Math.sin(r),
    z2 = -x * Math.sin(r) + z1 * Math.cos(r);
  return [
    x2 * Math.cos(h) - y1 * Math.sin(h),
    x2 * Math.sin(h) + y1 * Math.cos(h),
    z2,
  ];
}
function hull(points: XY[]): XY[] {
  const sorted = [
    ...new Map(
      points.map((p) => [p.map((n) => n.toFixed(8)).join(','), p]),
    ).values(),
  ].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length < 3) return [];
  const cross = (a: XY, b: XY, c: XY) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const chain = (values: XY[]) => {
    const result: XY[] = [];
    for (const point of values) {
      while (
        result.length >= 2 &&
        cross(result.at(-2)!, result.at(-1)!, point) <= 1e-10
      )
        result.pop();
      result.push(point);
    }
    return result.slice(0, -1);
  };
  const result = [...chain(sorted), ...chain(sorted.slice().reverse())];
  return result.length >= 3 ? result : [];
}
/** Real-metre horizontal intersection, with the same ZYX rotations as AnnotationLayer. */
export function modelSection(item: Annotation, altitude: number): XY[] {
  const range = altitudeRange(item);
  if (
    !item.visible ||
    item.kind === 'pin' ||
    !range ||
    altitude < range.bottom ||
    altitude > range.top
  )
    return [];
  const cut = altitude - range.center;
  if (item.kind === 'sphere') {
    const radius = Math.sqrt(Math.max(0, (item.width / 2) ** 2 - cut ** 2));
    return radius > 1e-8
      ? Array.from(
          { length: 64 },
          (_, i) =>
            [
              radius * Math.cos((i * Math.PI) / 32),
              radius * Math.sin((i * Math.PI) / 32),
            ] as XY,
        )
      : [];
  }
  const vertices: XYZ[] = [],
    edges: [number, number][] = [];
  if (item.kind === 'box') {
    for (let i = 0; i < 8; i++)
      vertices.push([
        ((i & 1 ? 1 : -1) * item.width) / 2,
        ((i & 2 ? 1 : -1) * item.length) / 2,
        ((i & 4 ? 1 : -1) * item.height) / 2,
      ]);
    for (let i = 0; i < 8; i++)
      for (const bit of [1, 2, 4]) if (!(i & bit)) edges.push([i, i | bit]);
  } else {
    for (let i = 0; i < 64; i++) {
      const angle = (i * Math.PI) / 32;
      for (const sign of [-1, 1])
        vertices.push([
          (item.width / 2) * Math.cos(angle),
          (item.width / 2) * Math.sin(angle),
          (sign * item.height) / 2,
        ]);
      edges.push(
        [i * 2, i * 2 + 1],
        [i * 2, ((i + 1) % 64) * 2],
        [i * 2 + 1, ((i + 1) % 64) * 2 + 1],
      );
    }
  }
  const world = vertices.map((v) => rotate(v, item)),
    crossings: XY[] = [];
  for (const [i, j] of edges) {
    const a = world[i],
      b = world[j],
      da = a[2] - cut,
      db = b[2] - cut;
    if (Math.abs(da) < 1e-8) crossings.push([a[0], a[1]]);
    if (Math.abs(db) < 1e-8) crossings.push([b[0], b[1]]);
    if (da * db < 0) {
      const t = da / (da - db);
      crossings.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return hull(crossings);
}
