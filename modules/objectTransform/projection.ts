import { Matrix4, Plane, Quaternion, Ray, Vector3, Vector4 } from 'three';
import { coordinate, mercator } from '../section/planeMath.ts';
import type { Pose, Axis, TransformMode } from './math.ts';
import type {
  CustomLayerInterface,
  CustomRenderMethodInput,
} from 'maplibre-gl';

export type ProjectionFrame = {
  matrix: number[];
  width: number;
  height: number;
  longitude: number;
};
export type WatchProjection = (
  listener: (frame: ProjectionFrame) => void,
) => () => void;
export class ObjectProjectionLayer implements CustomLayerInterface {
  id = 'object-transform-projection';
  type = 'custom' as const;
  renderingMode = '3d' as const;
  private report: (matrix: number[]) => void;
  constructor(report: (matrix: number[]) => void) {
    this.report = report;
  }
  render(_gl: WebGL2RenderingContext, input: CustomRenderMethodInput) {
    this.report(Array.from(input.defaultProjectionData.mainMatrix));
  }
}
export function objectProjector(frame: ProjectionFrame, pose: Pose) {
  const m = mercator(pose.coordinates),
    x = m.x + Math.round((frame.longitude - pose.coordinates[0]) / 360);
  const matrix = new Matrix4()
    .fromArray(frame.matrix)
    .multiply(
      new Matrix4()
        .makeTranslation(x, m.y, pose.altitude * m.unit)
        .scale(new Vector3(m.unit, -m.unit, m.unit)),
    );
  const inverse = matrix.clone().invert();
  const project = (v: Vector3) => {
    const p = new Vector4(v.x, v.y, v.z, 1).applyMatrix4(matrix);
    return {
      x: ((p.x / p.w + 1) * frame.width) / 2,
      y: ((1 - p.y / p.w) * frame.height) / 2,
      visible: p.w > 0 && p.z / p.w >= -1 && p.z / p.w <= 1,
    };
  };
  const ray = (p: { x: number; y: number }) => {
    const x = (p.x / frame.width) * 2 - 1,
      y = 1 - (p.y / frame.height) * 2,
      a = new Vector3(x, y, -1).applyMatrix4(inverse),
      b = new Vector3(x, y, 1).applyMatrix4(inverse);
    return new Ray(a, b.sub(a).normalize());
  };
  const center = project(new Vector3()),
    q = new Quaternion().fromArray(pose.rotation);
  const axes = [
    new Vector3(1, 0, 0),
    new Vector3(0, 1, 0),
    new Vector3(0, 0, 1),
  ].map((v) => v.applyQuaternion(q));
  const px = Math.max(
    ...axes.map((v) => {
      const p = project(v);
      return Math.hypot(p.x - center.x, p.y - center.y);
    }),
  );
  const radius = Math.min(1e7, Math.max(0.0001, 76 / Math.max(px, 1e-8)));
  return { project, ray, center, axes, radius };
}
export type Projector = ReturnType<typeof objectProjector>;
export type Screen = { x: number; y: number };
export type Handle = { mode: TransformMode; axis: Axis };
const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));
function axisDistance(p: Projector, axis: Vector3, screen: Screen) {
  const ray = p.ray(screen),
    d = axis.dot(ray.direction),
    denom = 1 - d * d;
  if (denom < 0.001) return null;
  return (axis.dot(ray.origin) - d * ray.direction.dot(ray.origin)) / denom;
}
/** Ray-based transforms use the same frozen projection as the visible handles. */
export function transformAt(
  start: Pose,
  p: Projector,
  handle: Handle,
  from: Screen,
  to: Screen,
  kind: string,
  snap = false,
): Pose {
  const out: Pose = {
    ...start,
    coordinates: [...start.coordinates],
    rotation: [...start.rotation],
    size: [...start.size],
  };
  const axis =
    handle.axis === 'free'
      ? p.ray(p.center).direction
      : p.axes[['x', 'y', 'z'].indexOf(handle.axis)];
  const a = axisDistance(p, axis, from),
    b = axisDistance(p, axis, to),
    dx = to.x - from.x,
    dy = to.y - from.y;
  const tip = p.project(axis.clone().multiplyScalar(p.radius)),
    sx = tip.x - p.center.x,
    sy = tip.y - p.center.y;
  const amount =
    a !== null && b !== null
      ? b - a
      : ((dx * sx + dy * sy) / Math.max(4, sx * sx + sy * sy)) * p.radius;
  if (handle.mode === 'move') {
    let delta = axis.clone().multiplyScalar(amount);
    if (handle.axis === 'free') {
      const normal = kind === 'pin' ? new Vector3(0, 0, 1) : axis;
      const plane = new Plane(normal, 0),
        a = p.ray(from).intersectPlane(plane, new Vector3()),
        b = p.ray(to).intersectPlane(plane, new Vector3());
      if (!a || !b) return out;
      delta = b.sub(a);
    }
    const m = mercator(start.coordinates),
      ll = coordinate(m.x + delta.x * m.unit, m.y - delta.y * m.unit);
    if (Math.abs(delta.x) > 1e-9 || Math.abs(delta.y) > 1e-9)
      out.coordinates = [
        ((((ll[0] + 180) % 360) + 360) % 360) - 180,
        clamp(ll[1], -85, 85),
      ];
    if (kind !== 'pin')
      out.altitude = clamp(start.altitude + delta.z, -12000, 30000);
  } else if (handle.mode === 'rotate' && kind !== 'pin') {
    const plane = new Plane(axis, 0),
      a = p.ray(from).intersectPlane(plane, new Vector3()),
      b = p.ray(to).intersectPlane(plane, new Vector3());
    let angle: number;
    if (a && b && Math.abs(axis.dot(p.ray(from).direction)) > 0.05)
      angle = Math.atan2(axis.dot(a.clone().cross(b)), a.dot(b));
    else angle = (dx - dy) * 0.01;
    if (snap) angle = (Math.round(angle / (Math.PI / 36)) * Math.PI) / 36;
    out.rotation = new Quaternion()
      .setFromAxisAngle(axis, angle)
      .multiply(new Quaternion().fromArray(start.rotation))
      .normalize()
      .toArray();
  } else if (handle.mode === 'scale' && kind !== 'pin') {
    const factor = Math.exp(
      clamp(
        handle.axis === 'free' ? (dx - dy) / 100 : amount / p.radius,
        -8,
        8,
      ),
    );
    out.size = start.size.map((v, i) => {
      const active =
        handle.axis === 'free' ||
        handle.axis === ['x', 'y', 'z'][i] ||
        kind === 'sphere' ||
        (kind === 'cylinder' && handle.axis !== 'z' && i < 2);
      return kind === 'plane' && i === 2
        ? 1
        : active
          ? clamp(v * factor, 0.1, kind === 'plane' ? 200000 : 10000)
          : v;
    }) as Pose['size'];
  }
  return out;
}
