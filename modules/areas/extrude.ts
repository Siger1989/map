import { coordinate, mercator } from '../section/planeMath.ts';
import { closeBoundary, type MapArea } from './data.ts';
import type { Footprint } from '../annotations/footprint';
export function outlineModel(area: MapArea, height: number) {
  const boundary = closeBoundary(area.boundary).slice(0, -1);
  if (!Number.isFinite(height) || height < 0.1 || height > 10000)
    throw new Error('拉伸高度应为 0.1–10000 米');
  const anchor = mercator(boundary[0]);
  const xy = boundary.map((p) => {
    const m = mercator(p);
    const dx = ((((m.x - anchor.x + 0.5) % 1) + 1) % 1) - 0.5;
    return [anchor.x + dx, m.y];
  });
  const min = xy.reduce(
    (a, p) => [Math.min(a[0], p[0]), Math.min(a[1], p[1])],
    [Infinity, Infinity],
  );
  const max = xy.reduce(
    (a, p) => [Math.max(a[0], p[0]), Math.max(a[1], p[1])],
    [-Infinity, -Infinity],
  );
  const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2];
  const coordinates = coordinate(center[0], center[1]);
  coordinates[0] = ((((coordinates[0] + 180) % 360) + 360) % 360) - 180;
  const unit = mercator(coordinates).unit,
    width = (max[0] - min[0]) / unit,
    length = (max[1] - min[1]) / unit;
  if (width < 0.1 || length < 0.1 || width > 10000 || length > 10000)
    throw new Error('模型轮廓宽、长应为 0.1 米至 10 公里，请放大地图调整轮廓');
  const footprint: Footprint = xy.map((p) => [
    (p[0] - center[0]) / (max[0] - min[0]),
    -(p[1] - center[1]) / (max[1] - min[1]),
  ]);
  return {
    coordinates,
    width,
    length,
    height,
    footprint,
    color: area.color,
    name: area.name.slice(0, 55) + ' 模型',
    attributes: area.attributes,
  };
}
