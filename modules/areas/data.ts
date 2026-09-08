import {
  coordinate,
  metresBetween,
  type Coordinate,
} from '../navigation/types.ts';
import {
  validAttributes,
  type AnnotationAttribute,
} from '../annotations/attributes.ts';
import { MARKER_ICONS, type MarkerIconId } from '../annotations/icons.ts';
export const AREA_STORAGE = 'shantu.areas.v1';
export const MAX_AREAS = 40;
export type MapArea = {
  id: string;
  name: string;
  note: string;
  color: string;
  visible: boolean;
  boundary: Coordinate[];
  icon?: MarkerIconId;
  attributes?: AnnotationAttribute[];
  createdAt: number;
};
const same = (a: Coordinate, b: Coordinate) => a[0] === b[0] && a[1] === b[1];
const lngDelta = (n: number) => ((((n + 180) % 360) + 360) % 360) - 180;
export function areaMetrics(boundary: Coordinate[]) {
  let sum = 0,
    perimeter = 0;
  for (let i = 1; i < boundary.length; i++) {
    const a = boundary[i - 1],
      b = boundary[i];
    sum +=
      ((lngDelta(b[0] - a[0]) * Math.PI) / 180) *
      (2 + Math.sin((a[1] * Math.PI) / 180) + Math.sin((b[1] * Math.PI) / 180));
    perimeter += metresBetween(a, b);
  }
  return { area: (Math.abs(sum) * 6371008.8 ** 2) / 2, perimeter };
}
export function closeBoundary(points: Coordinate[]): Coordinate[] {
  if (
    !points.every((p) => coordinate(p) && Math.abs(p[1]) <= 85) ||
    points.length > 6001
  )
    throw new Error('区域坐标无效或超过 6000 个边界点');
  const ring = points
    .filter((p, i) => !i || !same(p, points[i - 1]))
    .map((p) => [...p] as Coordinate);
  if (ring.length > 1 && same(ring[0], ring.at(-1)!)) ring.pop();
  if (ring.length < 3) throw new Error('至少需要三个不同的边界点才能闭合');
  ring.push([...ring[0]]);
  if (areaMetrics(ring).area < 0.01)
    throw new Error('边界点不能全部在同一直线上');
  const xy = ring.map(([lng, lat]) => [lngDelta(lng - ring[0][0]), lat]);
  const cross = (a: number[], b: number[], c: number[]) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const edges = xy
    .slice(1)
    .map((b, i) => ({
      a: xy[i],
      b,
      i,
      min: Math.min(xy[i][0], b[0]),
      max: Math.max(xy[i][0], b[0]),
    }))
    .sort((a, b) => a.min - b.min);
  for (let i = 0; i < edges.length; i++)
    for (let j = i + 1; j < edges.length && edges[j].min <= edges[i].max; j++) {
      const a = edges[i],
        b = edges[j];
      if (Math.abs(a.i - b.i) === 1 || Math.abs(a.i - b.i) === edges.length - 1)
        continue;
      if (
        Math.max(a.a[1], a.b[1]) < Math.min(b.a[1], b.b[1]) ||
        Math.max(b.a[1], b.b[1]) < Math.min(a.a[1], a.b[1])
      )
        continue;
      if (
        cross(a.a, a.b, b.a) * cross(a.a, a.b, b.b) <= 0 &&
        cross(b.a, b.b, a.a) * cross(b.a, b.b, a.b) <= 0
      )
        throw new Error('边界相交或重叠，请撤销或调整后闭合');
    }
  return ring;
}
export function moveAreaPoint(
  area: MapArea,
  index: number,
  target: Coordinate,
): MapArea {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= area.boundary.length - 1
  )
    throw new Error('边界点不存在');
  const points = area.boundary
    .slice(0, -1)
    .map((p, i) => (i === index ? target : p));
  return { ...area, boundary: closeBoundary(points) };
}
export function parseAreas(raw: string | null): MapArea[] {
  if (raw === null) return [];
  const v = JSON.parse(raw);
  if (
    !Array.isArray(v) ||
    v.length > MAX_AREAS ||
    !v.every(
      (a) =>
        a &&
        typeof a.id === 'string' &&
        a.id.length > 0 &&
        a.id.length <= 100 &&
        typeof a.name === 'string' &&
        a.name.length <= 60 &&
        typeof a.note === 'string' &&
        a.note.length <= 500 &&
        /^#[0-9a-f]{6}$/i.test(a.color) &&
        typeof a.visible === 'boolean' &&
        Number.isFinite(a.createdAt) &&
        (a.attributes === undefined || validAttributes(a.attributes)) &&
        Array.isArray(a.boundary) &&
        a.boundary.length >= 4 &&
        same(a.boundary[0], a.boundary.at(-1)) &&
        closeBoundary(a.boundary).length === a.boundary.length,
    ) ||
    new Set(v.map((a) => a.id)).size !== v.length
  )
    throw new Error('区域存档无效，原数据已保留');
  if (
    !v.every((a) => a.icon === undefined || Object.hasOwn(MARKER_ICONS, a.icon))
  )
    throw new Error('区域图标无效，原数据已保留');
  return v;
}
