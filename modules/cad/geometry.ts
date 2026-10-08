import type { CadFeature, CadGeometry } from './types';

export type Vec3 = [number, number, number];
export type Matrix4 = [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];

export const IDENTITY: Matrix4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function multiply(a: Matrix4, b: Matrix4): Matrix4 {
  const out = new Array<number>(16).fill(0);
  for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) {
    for (let k = 0; k < 4; k++) out[row * 4 + col] += a[row * 4 + k] * b[k * 4 + col];
  }
  return out as Matrix4;
}

export function transformPoint(m: Matrix4, p: Vec3): Vec3 {
  return [m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3], m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7], m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11]];
}

export function insertMatrix(base: Vec3, origin: Vec3, scale: Vec3, rotation: number): Matrix4 {
  const cos = Math.cos(rotation), sin = Math.sin(rotation);
  const local: Matrix4 = [cos * scale[0], -sin * scale[1], 0, 0, sin * scale[0], cos * scale[1], 0, 0, 0, 0, scale[2], 0, 0, 0, 0, 1];
  const toOrigin: Matrix4 = [1, 0, 0, origin[0], 0, 1, 0, origin[1], 0, 0, 1, origin[2], 0, 0, 0, 1];
  const fromBase: Matrix4 = [1, 0, 0, -base[0], 0, 1, 0, -base[1], 0, 0, 1, -base[2], 0, 0, 0, 1];
  return multiply(multiply(toOrigin, local), fromBase);
}

export function finitePoint(p: Partial<Vec3> & { x?: number; y?: number; z?: number }): Vec3 | undefined {
  const x = p.x ?? p[0], y = p.y ?? p[1], z = p.z ?? p[2] ?? 0;
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) ? [x!, y!, z!] : undefined;
}

export function lineFeature(id: string, layer: string, points: Vec3[], entityType: string, props?: Record<string, unknown>): CadFeature | undefined {
  const valid = points.filter((p) => p.every(Number.isFinite));
  if (valid.length < 2) return undefined;
  return { id, layer, entityType, geometry: { type: 'LineString', coordinates: valid }, ...(props ? { properties: props } : {}) };
}

export function polygonFeature(id: string, layer: string, points: Vec3[], entityType: string, props?: Record<string, unknown>): CadFeature | undefined {
  if (points.length < 3) return undefined;
  const ring = points.map((p) => [...p]);
  if (ring.length && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1] || ring[0][2] !== ring[ring.length - 1][2])) ring.push([...ring[0]]);
  return { id, layer, entityType, geometry: { type: 'Polygon', coordinates: [ring] }, ...(props ? { properties: props } : {}) };
}

export function featureWithColor(feature: CadFeature | undefined, color?: string): CadFeature | undefined {
  if (feature && color) feature.color = color;
  return feature;
}

export function asGeometry(feature: CadFeature): CadGeometry { return feature.geometry; }

/** Discretizes an AutoCAD bulge segment. The approximation is capped at 64 edges. */
export function appendBulgeSegment(out: Vec3[], start: Vec3, end: Vec3, bulge: number): void {
  if (!Number.isFinite(bulge) || Math.abs(bulge) < 1e-10) { out.push(end); return; }
  const dx = end[0] - start[0], dy = end[1] - start[1];
  const chord = Math.hypot(dx, dy);
  if (chord === 0) return;
  const sweep = 4 * Math.atan(bulge);
  const radius = chord * (1 + bulge * bulge) / (4 * Math.abs(bulge));
  const offset = chord * (1 - bulge * bulge) / (4 * bulge);
  const cx = (start[0] + end[0]) / 2 - dy / chord * offset;
  const cy = (start[1] + end[1]) / 2 + dx / chord * offset;
  const startAngle = Math.atan2(start[1] - cy, start[0] - cx);
  const steps = Math.min(64, Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 16))));
  for (let i = 1; i <= steps; i++) {
    if (i === steps) { out.push(end); continue; }
    const a = startAngle + sweep * i / steps;
    out.push([cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, start[2] + (end[2] - start[2]) * i / steps]);
  }
}

export function sampleArc(center: Vec3, radius: number, start: number, end: number, fullCircle = false): Vec3[] {
  let sweep = end - start;
  if (fullCircle) sweep = Math.PI * 2;
  else while (sweep <= 0) sweep += Math.PI * 2;
  const count = Math.min(128, Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 24))));
  const out: Vec3[] = [];
  for (let i = 0; i <= count; i++) {
    const a = start + sweep * i / count;
    out.push([center[0] + Math.cos(a) * radius, center[1] + Math.sin(a) * radius, center[2]]);
  }
  return out;
}

export function mapPoints(points: Vec3[], m: Matrix4): Vec3[] { return points.map((point) => transformPoint(m, point)); }
