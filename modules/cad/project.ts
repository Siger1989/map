import { toWgs84, fromWgs84, type ProjectCrs, type ProjectPoint } from '../coordinates/index.ts';
import type { CadDecoded, CadFeature, CadGeometry } from './types';
import { RouteBuilder, importPoint } from '../dataTransfer/routeBuilder';

export function mapCadGeometry(g: CadGeometry, transform: (p: ProjectPoint) => number[]): CadGeometry {
  const point = (p: number[]) => transform(p as [number, number]);
  if (g.type === 'Point') return { type: 'Point', coordinates: point(g.coordinates) };
  if (g.type === 'LineString') return { type: 'LineString', coordinates: g.coordinates.map(point) };
  return { type: 'Polygon', coordinates: g.coordinates.map(r => r.map(point)) };
}
export function projectCad(decoded: CadDecoded, source: ProjectCrs, active: ProjectCrs, axis: 'xy'|'yx', scale: number): CadFeature[] {
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('单位比例必须大于0');
  return decoded.features.map(feature => ({ ...feature, geometry: mapCadGeometry(feature.geometry, p => {
    const xy: [number, number] = axis === 'yx' ? [p[1] * scale, p[0] * scale] : [p[0] * scale, p[1] * scale];
    const wgs = toWgs84(p.length > 2 ? [...xy, p[2]!] : xy, source);
    // Validate the requested active project CRS too; the map API remains WGS84.
    fromWgs84(wgs, active);
    return wgs;
  }) }));
}
export function cadToTransfer(name: string, features: CadFeature[]) {
  const builder = new RouteBuilder(name);
  const point = (p: number[]) => importPoint(p[0], p[1], p[2]);
  for (const f of features) {
    const label = f.text || `${f.layer} · ${f.entityType}`;
    if (f.geometry.type === 'Point') builder.pin(label, point(f.geometry.coordinates), f.text || '');
    else if (f.geometry.type === 'LineString') builder.track(label, [f.geometry.coordinates.map(point)]);
    else {
      if (f.geometry.coordinates.length !== 1) throw new Error('带内洞的 CAD 面暂不能无损转换为区域，请保留参考图层');
      builder.area(label, f.geometry.coordinates[0].map(point));
    }
  }
  return builder.finish();
}
