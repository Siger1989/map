import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import {
  altitudeRange,
  dimensions,
  type Annotation,
} from '../annotations/data.ts';
import { modelRotation } from '../annotations/modelGeometry.ts';
import { planeBasis } from '../section/planeMath.ts';
import type { SectionSettings } from '../section/types.ts';

export type Pose = {
  coordinates: [number, number];
  altitude: number;
  rotation: [number, number, number, number];
  size: [number, number, number];
};
export type TransformMode = 'move' | 'rotate' | 'scale';
export type Axis = 'x' | 'y' | 'z' | 'free';
const rad = Math.PI / 180;
const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));
const reflect = (v: Vector3) => new Vector3(v.x, -v.y, v.z);
/** Absolute local-map rotation, ZYX Euler order (degrees), shared by readout
 * and numeric editing. Keep full precision until formatting the readout. */
export function rotationDegrees(p: Pose): [number, number, number] {
  const e = new Euler().setFromQuaternion(
    new Quaternion().fromArray(p.rotation),
    'ZYX',
  );
  return [e.x / rad, e.y / rad, e.z / rad];
}
export function withRotationAxis(
  p: Pose,
  axis: 0 | 1 | 2,
  degrees: number,
): Pose {
  if (!Number.isFinite(degrees) || Math.abs(degrees) > 360) return p;
  const angles = rotationDegrees(p);
  angles[axis] = degrees;
  return {
    ...p,
    rotation: new Quaternion()
      .setFromEuler(
        new Euler(angles[0] * rad, angles[1] * rad, angles[2] * rad, 'ZYX'),
      )
      .toArray(),
  };
}
/** Planes return to a vertical north-facing section; models to world axes. */
export function uprightPose(p: Pose, kind: string): Pose {
  return {
    ...p,
    rotation: new Quaternion()
      .setFromEuler(new Euler(kind === 'plane' ? Math.PI / 2 : 0, 0, 0, 'ZYX'))
      .toArray(),
  };
}
export function annotationPose(a: Annotation): Pose | null {
  const range = altitudeRange(a);
  if (!range && a.kind !== 'pin') return null;
  return {
    coordinates: [...a.coordinates],
    altitude: range?.center ?? 0,
    rotation: new Quaternion().setFromEuler(modelRotation(a)).toArray(),
    size: dimensions(a),
  };
}
export function planePose(s: SectionSettings): Pose {
  const p = s.plane!;
  const b = planeBasis(p.heading, p.tilt, p.roll);
  const x = reflect(b.u),
    y = reflect(b.v),
    z = x.clone().cross(y);
  return {
    coordinates: [...p.center],
    altitude: s.altitude,
    rotation: new Quaternion()
      .setFromRotationMatrix(new Matrix4().makeBasis(x, y, z))
      .toArray(),
    size: [p.width, p.height, 1],
  };
}
export function applyAnnotationPose(a: Annotation, p: Pose): Annotation {
  const e = new Euler().setFromQuaternion(
    new Quaternion().fromArray(p.rotation),
    'ZYX',
  );
  return {
    ...a,
    coordinates: p.coordinates,
    ...(a.kind === 'pin' ? {} : { centerAltitude: p.altitude }),
    pitch: e.x / rad,
    roll: e.y / rad,
    heading: -e.z / rad,
    width: clamp(p.size[0], 0.1, 10000),
    length: clamp(p.size[1], 0.1, 10000),
    height: clamp(p.size[2], 0.1, 10000),
  };
}
export function applyPlanePose(s: SectionSettings, p: Pose): SectionSettings {
  const q = new Quaternion().fromArray(p.rotation);
  const u = reflect(new Vector3(1, 0, 0).applyQuaternion(q));
  const v = reflect(new Vector3(0, 1, 0).applyQuaternion(q));
  const n = u.clone().cross(v).normalize();
  const tilt = Math.asin(clamp(n.z, -1, 1)) / rad;
  const heading =
    Math.abs(n.z) > 0.9999999 ? s.plane!.heading : Math.atan2(n.x, -n.y) / rad;
  const base = planeBasis(heading, tilt);
  const roll = Math.atan2(u.dot(base.v), u.dot(base.u)) / rad;
  return {
    ...s,
    altitude: p.altitude,
    plane: {
      ...s.plane!,
      center: p.coordinates,
      width: clamp(p.size[0], 0.1, 200000),
      height: clamp(p.size[1], 0.1, 200000),
      heading,
      tilt,
      roll,
    },
  };
}
