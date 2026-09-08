import { Box3, Matrix4, Vector3 } from 'three';
import { altitudeRange, type Annotation } from '../annotations/data.ts';
import { modelGeometry, modelRotation } from '../annotations/modelGeometry.ts';
import {
  clipFaceTriangle,
  coordinate,
  mercator,
} from '../section/planeMath.ts';

export function polygonContains(
  points: [number, number][],
  x: number,
  y: number,
) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i],
      b = points[j];
    if (
      a[1] > y !== b[1] > y &&
      x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}
/** Vertical rays against the actual rotated solid; concave prisms may have several intervals. */
export function modelColumn(item: Annotation) {
  const altitude = altitudeRange(item);
  if (!altitude || item.kind === 'pin') return null;
  const matrix = new Matrix4()
    .makeTranslation(0, 0, altitude.center)
    .scale(new Vector3(1, -1, 1))
    .multiply(new Matrix4().makeRotationFromEuler(modelRotation(item)));
  const inverse = matrix.clone().invert(),
    direction = new Vector3(0, 0, 1).transformDirection(inverse);
  const geometry = modelGeometry(item);
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox!.clone().applyMatrix4(matrix);
  geometry.dispose();
  const polygon = item.footprint?.map(
    ([x, y]) => [x * item.width, y * item.length] as [number, number],
  );
  const inside = (p: Vector3) => {
    if (item.kind === 'sphere')
      return p.lengthSq() <= (item.width / 2) ** 2 + 1e-7;
    if (Math.abs(p.z) > item.height / 2 + 1e-7) return false;
    if (item.kind === 'cylinder')
      return p.x ** 2 + p.y ** 2 <= (item.width / 2) ** 2 + 1e-7;
    if (item.kind === 'prism') return polygonContains(polygon!, p.x, p.y);
    return (
      Math.abs(p.x) <= item.width / 2 + 1e-7 &&
      Math.abs(p.y) <= item.length / 2 + 1e-7
    );
  };
  const intervals = (x: number, y: number): [number, number][] => {
    const origin = new Vector3(x, y, 0).applyMatrix4(inverse),
      roots: number[] = [];
    const plane = (axis: 'x' | 'y' | 'z', value: number) => {
      if (Math.abs(direction[axis]) > 1e-10)
        roots.push((value - origin[axis]) / direction[axis]);
    };
    const quadratic = (a: number, b: number, c: number) => {
      const d = b * b - 4 * a * c;
      if (a > 1e-12 && d >= 0)
        roots.push(
          (-b - Math.sqrt(d)) / (2 * a),
          (-b + Math.sqrt(d)) / (2 * a),
        );
    };
    if (item.kind === 'sphere')
      quadratic(
        direction.lengthSq(),
        2 * origin.dot(direction),
        origin.lengthSq() - (item.width / 2) ** 2,
      );
    else {
      plane('z', -item.height / 2);
      plane('z', item.height / 2);
      if (item.kind === 'cylinder')
        quadratic(
          direction.x ** 2 + direction.y ** 2,
          2 * (origin.x * direction.x + origin.y * direction.y),
          origin.x ** 2 + origin.y ** 2 - (item.width / 2) ** 2,
        );
      else if (item.kind === 'prism') {
        for (let i = 0; i < polygon!.length; i++) {
          const a = polygon![i],
            b = polygon![(i + 1) % polygon!.length],
            dx = b[0] - a[0],
            dy = b[1] - a[1];
          const divisor = dx * direction.y - dy * direction.x;
          if (Math.abs(divisor) > 1e-10)
            roots.push(
              (dy * (origin.x - a[0]) - dx * (origin.y - a[1])) / divisor,
            );
        }
      } else {
        plane('x', -item.width / 2);
        plane('x', item.width / 2);
        plane('y', -item.length / 2);
        plane('y', item.length / 2);
      }
    }
    roots.sort((a, b) => a - b);
    const unique = roots.filter(
      (v, i) => Number.isFinite(v) && (!i || Math.abs(v - roots[i - 1]) > 1e-7),
    );
    const result: [number, number][] = [];
    for (let i = 1; i < unique.length; i++)
      if (
        inside(
          origin
            .clone()
            .addScaledVector(direction, (unique[i] + unique[i - 1]) / 2),
        )
      ) {
        if (result.length && Math.abs(result.at(-1)![1] - unique[i - 1]) < 1e-6)
          result.at(-1)![1] = unique[i];
        else result.push([unique[i - 1], unique[i]]);
      }
    return result;
  };
  return { bounds, intervals };
}

export type ModelTerrainPatch = {
  item: Annotation;
  bounds: Box3;
  mask: Uint8Array;
  size: number;
  faces: number[];
  rim: number[];
  walls: number[];
  valid: number;
  samples: number;
  spacing: number;
};
/** Sampled height-field subtraction/contact. Missing DEM remains missing, never zero-filled. */
export function terrainPatch(
  item: Annotation,
  sample: (p: [number, number]) => number | null,
  size = 48,
): ModelTerrainPatch | null {
  const solid = modelColumn(item);
  if (!solid) return null;
  const { bounds, intervals } = solid,
    anchor = mercator(item.coordinates);
  const dx = (bounds.max.x - bounds.min.x) / size,
    dy = (bounds.max.y - bounds.min.y) / size;
  const faces: number[] = [],
    rim: number[] = [],
    walls: number[] = [],
    mask = new Uint8Array(size * size);
  const nodes: {
    p: Vector3;
    height: number | null;
    ranges: [number, number][];
    distance: number;
  }[] = [];
  let valid = 0;
  for (let y = 0; y <= size; y++)
    for (let x = 0; x <= size; x++) {
      const px = bounds.min.x + dx * x,
        py = bounds.min.y + dy * y;
      const ll = coordinate(
        anchor.x + px * anchor.unit,
        anchor.y + py * anchor.unit,
      );
      ll[0] = ((((ll[0] + 180) % 360) + 360) % 360) - 180;
      const height = sample(ll),
        ranges = intervals(px, py);
      if (height !== null) valid++;
      const distance =
        height === null || !ranges.length
          ? Infinity
          : Math.min(
              ...ranges.map(([lo, hi]) => Math.max(lo - height, height - hi)),
            );
      nodes.push({
        p: new Vector3(px, py, height ?? NaN),
        height,
        ranges,
        distance,
      });
    }
  const addTriangle = (
    target: number[],
    a: Vector3,
    b: Vector3,
    c: Vector3,
  ) => {
    for (const p of [a, b, c]) target.push(p.x, p.y, p.z);
  };
  const cut = item.terrainCut ?? item.placement === 'underground';
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const ids = [
        y * (size + 1) + x,
        y * (size + 1) + x + 1,
        (y + 1) * (size + 1) + x + 1,
        (y + 1) * (size + 1) + x,
      ];
      const cell = ids.map((i) => nodes[i]);
      if (cell.some((p) => p.height === null)) continue;
      const center = intervals(
        bounds.min.x + dx * (x + 0.5),
        bounds.min.y + dy * (y + 0.5),
      );
      const height = cell.reduce((v, n) => v + n.height!, 0) / 4;
      const remove =
        cut &&
        center.some(
          ([lo, hi]) =>
            height > lo && (item.placement === 'underground' || height <= hi),
        );
      if (remove) mask[y * size + x] = 255;
      for (const indices of [
        [0, 1, 2],
        [0, 2, 3],
      ]) {
        const tri = indices.map((i) => cell[i]);
        if (tri.every((p) => Number.isFinite(p.distance))) {
          const clipped = clipFaceTriangle(
            tri.map((n) => n.p),
            tri.map((n) => n.distance),
          );
          for (let i = 1; i < clipped.polygon.length - 1; i++)
            addTriangle(
              faces,
              clipped.polygon[0],
              clipped.polygon[i],
              clipped.polygon[i + 1],
            );
          if (clipped.rim.length === 2)
            clipped.rim.forEach((p) => rim.push(p.x, p.y, p.z + 0.05));
        }
        // In a completely buried volume its roof is also a model/rock contact face.
        if (
          item.placement === 'underground' &&
          remove &&
          tri.every((n) => n.ranges.length && n.ranges.at(-1)![1] < n.height!)
        ) {
          const p = tri.map(
            (n) => new Vector3(n.p.x, n.p.y, n.ranges.at(-1)![1]),
          );
          addTriangle(faces, p[0], p[1], p[2]);
        }
      }
    }
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      if (!mask[y * size + x]) continue;
      const col = intervals(
        bounds.min.x + dx * (x + 0.5),
        bounds.min.y + dy * (y + 0.5),
      );
      if (!col.length) continue;
      for (const [nx, ny, ax, ay, bx, by] of [
        [x, y - 1, x, y, x + 1, y],
        [x + 1, y, x + 1, y, x + 1, y + 1],
        [x, y + 1, x + 1, y + 1, x, y + 1],
        [x - 1, y, x, y + 1, x, y],
      ]) {
        if (
          nx >= 0 &&
          nx < size &&
          ny >= 0 &&
          ny < size &&
          mask[ny * size + nx]
        )
          continue;
        const a = nodes[ay * (size + 1) + ax].p,
          b = nodes[by * (size + 1) + bx].p;
        if (![a.z, b.z].every(Number.isFinite)) continue;
        const lowA = new Vector3(a.x, a.y, Math.min(a.z, col[0][0])),
          lowB = new Vector3(b.x, b.y, Math.min(b.z, col[0][0]));
        addTriangle(walls, a, b, lowB);
        addTriangle(walls, a, lowB, lowA);
        rim.push(a.x, a.y, a.z + 0.05, b.x, b.y, b.z + 0.05);
      }
    }
  return {
    item,
    bounds,
    mask,
    size,
    faces,
    rim,
    walls,
    valid,
    samples: nodes.length,
    spacing: Math.max(dx, dy),
  };
}
