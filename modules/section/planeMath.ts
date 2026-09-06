import * as THREE from 'three';
import type { SectionSettings } from './types';

const CIRCUMFERENCE = 40075016.68557849;
export function mercator(center: [number, number]) {
  const lat = (Math.max(-85, Math.min(85, center[1])) * Math.PI) / 180;
  return {
    x: (center[0] + 180) / 360,
    y: (1 - Math.log(Math.tan(Math.PI / 4 + lat / 2)) / Math.PI) / 2,
    unit: 1 / (CIRCUMFERENCE * Math.cos(lat)),
  };
}
export function coordinate(x: number, y: number): [number, number] {
  return [
    x * 360 - 180,
    (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI,
  ];
}
/** Local axes: east, south, up, in metres at the plane's anchor latitude. */
export function planeBasis(heading: number, tilt: number, roll = 0) {
  const h = (heading * Math.PI) / 180,
    t = (tilt * Math.PI) / 180;
  const u = new THREE.Vector3(Math.cos(h), Math.sin(h), 0);
  const v = new THREE.Vector3(
    -Math.sin(h) * Math.sin(t),
    Math.cos(h) * Math.sin(t),
    Math.cos(t),
  );
  const n = u.clone().cross(v).normalize();
  u.applyAxisAngle(n, (roll * Math.PI) / 180);
  v.applyAxisAngle(n, (roll * Math.PI) / 180);
  return { u, v, n };
}
export function localMatrix(settings: SectionSettings) {
  const m = mercator(settings.plane!.center);
  return new THREE.Matrix4()
    .makeTranslation(m.x, m.y, settings.altitude * m.unit)
    .scale(new THREE.Vector3(m.unit, m.unit, m.unit));
}
export function planePoint(settings: SectionSettings, u: number, v: number) {
  const basis = planeBasis(
    settings.plane!.heading,
    settings.plane!.tilt,
    settings.plane!.roll,
  );
  return basis.u.multiplyScalar(u).addScaledVector(basis.v, v);
}
export function removedByPlane(
  p: THREE.Vector3,
  settings: SectionSettings,
  side: number,
) {
  const { u, v, n } = planeBasis(
    settings.plane!.heading,
    settings.plane!.tilt,
    settings.plane!.roll,
  );
  return (
    Math.abs(p.dot(u)) <= settings.plane!.width / 2 &&
    Math.abs(p.dot(v)) <= settings.plane!.height / 2 &&
    p.dot(n) * side > 0
  );
}
/** Clip one sampled face triangle against terrain solid z <= height(x,y). */
export function clipFaceTriangle(points: THREE.Vector3[], distances: number[]) {
  if (!distances.every(Number.isFinite)) return { polygon: [], rim: [] };
  const polygon: THREE.Vector3[] = [],
    rim: THREE.Vector3[] = [];
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3,
      inside = distances[i] <= 0,
      next = distances[j] <= 0;
    if (inside) polygon.push(points[i]);
    if (inside !== next) {
      const p = points[i]
        .clone()
        .lerp(points[j], distances[i] / (distances[i] - distances[j]));
      polygon.push(p);
      rim.push(p);
    }
  }
  return { polygon, rim };
}
