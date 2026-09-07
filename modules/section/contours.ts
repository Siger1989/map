import { Matrix4, Vector3 } from 'three';
import { altitudeRange, type Annotation } from '../annotations/data.ts';
import { modelGeometry, modelRotation } from '../annotations/modelGeometry.ts';
import {
  coordinate,
  localMatrix,
  mercator,
  planeBasis,
  planePoint,
} from './planeMath.ts';
import type { SectionSettings } from './types.ts';

export type Segment = [Vector3, Vector3];
export type ProfilePoint = {
  u: number;
  v: number;
  local: [number, number, number];
  coordinates: [number, number];
  altitude: number;
};
export type Contour = {
  id: string;
  name: string;
  source: 'terrain' | 'model';
  points: ProfilePoint[];
  distances: number[];
  length: number;
  min: number;
  max: number;
  closed: boolean;
};
export type SectionProfileData = {
  settings: SectionSettings;
  curves: Contour[];
  createdAt: number;
  valid: number;
  samples: number;
  spacing: number;
  phase: 'loading' | 'ready' | 'partial' | 'error';
};

/** Triangle/plane crossing, including an edge exactly on the plane. Coplanar faces
 * have no unique intersection curve; their boundary is supplied by adjacent faces. */
export function triangleCrossing(
  points: Vector3[],
  distances: number[],
  epsilon = 1e-7,
): Segment | null {
  if (
    !distances.every(Number.isFinite) ||
    distances.every((d) => Math.abs(d) <= epsilon)
  )
    return null;
  const hits: Vector3[] = [];
  const add = (p: Vector3) => {
    if (!hits.some((h) => h.distanceToSquared(p) <= epsilon ** 2)) hits.push(p);
  };
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3,
      a = distances[i],
      b = distances[j];
    if (Math.abs(a) <= epsilon) add(points[i].clone());
    if ((a < -epsilon && b > epsilon) || (a > epsilon && b < -epsilon))
      add(points[i].clone().lerp(points[j], a / (a - b)));
  }
  return hits.length === 2 && hits[0].distanceTo(hits[1]) > epsilon
    ? [hits[0], hits[1]]
    : null;
}
export function clipSegment(
  segment: Segment,
  settings: SectionSettings,
): Segment | null {
  const p = settings.plane!,
    { u, v } = planeBasis(p.heading, p.tilt, p.roll);
  let lo = 0,
    hi = 1;
  for (const [axis, half] of [
    [u, p.width / 2],
    [v, p.height / 2],
  ] as const) {
    const a = segment[0].dot(axis),
      d = segment[1].dot(axis) - a;
    if (Math.abs(d) < 1e-12) {
      if (Math.abs(a) > half + 1e-7) return null;
    } else {
      const t0 = (-half - a) / d,
        t1 = (half - a) / d;
      lo = Math.max(lo, Math.min(t0, t1));
      hi = Math.min(hi, Math.max(t0, t1));
      if (hi <= lo) return null;
    }
  }
  return [
    segment[0].clone().lerp(segment[1], lo),
    segment[0].clone().lerp(segment[1], hi),
  ];
}
/** Stitch only coincident endpoints, never bridge missing terrain or separate solids. */
export function stitchSegments(
  segments: Segment[],
  epsilon = 0.0001,
): Vector3[][] {
  const vertices: Vector3[] = [],
    links: number[][] = [],
    edges: [number, number][] = [];
  const cells = new Map<string, number[]>(),
    seen = new Set<string>();
  const vertex = (p: Vector3) => {
    const cell = [p.x, p.y, p.z].map((v) => Math.floor(v / epsilon));
    for (let x = -1; x <= 1; x++)
      for (let y = -1; y <= 1; y++)
        for (let z = -1; z <= 1; z++) {
          for (const i of cells.get(
            `${cell[0] + x},${cell[1] + y},${cell[2] + z}`,
          ) ?? [])
            if (vertices[i].distanceTo(p) < epsilon) return i;
        }
    const id = vertices.length,
      key = cell.join(',');
    vertices.push(p);
    links.push([]);
    cells.set(key, [...(cells.get(key) ?? []), id]);
    return id;
  };
  for (const [p, q] of segments) {
    const a = vertex(p),
      b = vertex(q),
      key = `${Math.min(a, b)}:${Math.max(a, b)}`;
    if (a === b || seen.has(key)) continue;
    seen.add(key);
    links[a].push(edges.length);
    links[b].push(edges.length);
    edges.push([a, b]);
  }
  const used = new Set<number>(),
    paths: Vector3[][] = [];
  const walk = (start: number, edge: number) => {
    const path = [vertices[start]];
    let at = start,
      next: number | undefined = edge;
    while (next !== undefined && !used.has(next)) {
      used.add(next);
      const pair = edges[next];
      at = pair[0] === at ? pair[1] : pair[0];
      path.push(vertices[at]);
      if (at === start || links[at].length !== 2) break;
      next = links[at].find((e) => !used.has(e));
    }
    if (path.length > 1) paths.push(path);
  };
  links.forEach((list, i) => {
    if (list.length !== 2)
      list.forEach((e) => {
        if (!used.has(e)) walk(i, e);
      });
  });
  edges.forEach(([a], e) => {
    if (!used.has(e)) walk(a, e);
  });
  return paths;
}
export function profilePoint(
  p: Vector3,
  settings: SectionSettings,
): ProfilePoint {
  const m = mercator(settings.plane!.center),
    { u, v } = planeBasis(
      settings.plane!.heading,
      settings.plane!.tilt,
      settings.plane!.roll,
    );
  const ll = coordinate(m.x + p.x * m.unit, m.y + p.y * m.unit);
  ll[0] = ((((ll[0] + 180) % 360) + 360) % 360) - 180;
  return {
    local: p.toArray(),
    u: p.dot(u),
    v: p.dot(v),
    coordinates: ll,
    altitude: ((settings.altitude + p.z) * m.unit) / mercator(ll).unit,
  };
}
export function contours(
  segments: Segment[],
  settings: SectionSettings,
  source: Contour['source'],
  name: string,
  id: string,
): Contour[] {
  return stitchSegments(
    segments,
    Math.max(
      0.00001,
      Math.max(settings.plane!.width, settings.plane!.height) * 1e-8,
    ),
  ).map((path, index) => {
    const points = path.map((p) => profilePoint(p, settings)),
      distances = [0];
    for (let i = 1; i < path.length; i++)
      distances.push(distances[i - 1] + path[i].distanceTo(path[i - 1]));
    return {
      id: `${id}:${index}`,
      name: `${name} · ${index + 1}`,
      source,
      points,
      distances,
      length: distances.at(-1)!,
      min: Math.min(...points.map((p) => p.altitude)),
      max: Math.max(...points.map((p) => p.altitude)),
      closed: path[0].distanceTo(path.at(-1)!) < 0.001,
    };
  });
}
export function pointOnContour(
  curve: Contour,
  fraction: number,
  settings: SectionSettings,
) {
  const distance = Math.max(0, Math.min(1, fraction)) * curve.length;
  const index = Math.max(
    1,
    curve.distances.findIndex((d) => d >= distance),
  );
  const i = Math.min(index, curve.points.length - 1),
    a = curve.distances[i - 1],
    b = curve.distances[i];
  const point = new Vector3()
    .fromArray(curve.points[i - 1].local)
    .lerp(
      new Vector3().fromArray(curve.points[i].local),
      b > a ? (distance - a) / (b - a) : 0,
    );
  return { ...profilePoint(point, settings), distance };
}
export function modelSegments(
  item: Annotation,
  settings: SectionSettings,
): Segment[] {
  const altitude = altitudeRange(item);
  if (!item.visible || item.kind === 'pin' || !altitude) return [];
  const m = mercator(item.coordinates),
    anchor = mercator(settings.plane!.center);
  // Choose the nearest wrapped world copy at the antimeridian.
  const x = m.x + Math.round(anchor.x - m.x);
  const matrix = localMatrix(settings)
    .invert()
    .multiply(
      new Matrix4()
        .makeTranslation(x, m.y, altitude.center * m.unit)
        .scale(new Vector3(m.unit, -m.unit, m.unit)),
    )
    .multiply(new Matrix4().makeRotationFromEuler(modelRotation(item)));
  const radius =
    (Math.hypot(item.width, item.length, item.height) * m.unit) / anchor.unit;
  const centre = new Vector3().applyMatrix4(matrix),
    b = planeBasis(
      settings.plane!.heading,
      settings.plane!.tilt,
      settings.plane!.roll,
    );
  if (
    Math.abs(centre.dot(b.n)) > radius ||
    Math.abs(centre.dot(b.u)) > settings.plane!.width / 2 + radius ||
    Math.abs(centre.dot(b.v)) > settings.plane!.height / 2 + radius
  )
    return [];
  const geometry = modelGeometry(item),
    position = geometry.getAttribute('position'),
    index = geometry.index;
  const segments: Segment[] = [];
  for (let i = 0; i < (index?.count ?? position.count); i += 3) {
    const points = [0, 1, 2].map((j) =>
      new Vector3()
        .fromBufferAttribute(position, index ? index.getX(i + j) : i + j)
        .applyMatrix4(matrix),
    );
    const segment = triangleCrossing(
      points,
      points.map((p) => p.dot(b.n)),
    );
    const clipped = segment && clipSegment(segment, settings);
    if (clipped) segments.push(clipped);
  }
  geometry.dispose();
  return segments;
}
export function sampleSection(
  settings: SectionSettings,
  items: Annotation[],
  elevation: (ll: [number, number]) => number | null,
): SectionProfileData {
  const cols = 80,
    rows = 40,
    p = settings.plane!,
    m = mercator(p.center);
  const vertices: Vector3[] = [],
    distances: number[] = [],
    heights = new Map<string, number | null>();
  let valid = 0;
  for (let y = 0; y <= rows; y++)
    for (let x = 0; x <= cols; x++) {
      const vertex = planePoint(
        settings,
        (x / cols - 0.5) * p.width,
        (y / rows - 0.5) * p.height,
      );
      const ll = coordinate(m.x + vertex.x * m.unit, m.y + vertex.y * m.unit);
      ll[0] = ((((ll[0] + 180) % 360) + 360) % 360) - 180;
      const key = ll.map((n) => n.toFixed(8)).join(',');
      if (!heights.has(key))
        heights.set(key, Math.abs(ll[1]) <= 85 ? elevation(ll) : null);
      const height = heights.get(key),
        ratio = mercator(ll).unit / m.unit;
      vertices.push(vertex);
      distances.push(
        height === null || height === undefined || !Number.isFinite(height)
          ? NaN
          : settings.altitude + vertex.z - height * ratio,
      );
      if (Number.isFinite(distances.at(-1))) valid++;
    }
  const segments: Segment[] = [];
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const a = y * (cols + 1) + x,
        b = a + 1,
        c = a + cols + 1,
        d = c + 1;
      for (const indices of [
        [a, b, c],
        [b, d, c],
      ]) {
        const s = triangleCrossing(
          indices.map((i) => vertices[i]),
          indices.map((i) => distances[i]),
        );
        if (s) segments.push(s);
      }
    }
  const curves = contours(segments, settings, 'terrain', '地形', 'terrain');
  for (const item of items)
    curves.push(
      ...contours(
        modelSegments(item, settings),
        settings,
        'model',
        item.name || '模型',
        item.id,
      ),
    );
  return {
    settings,
    curves,
    createdAt: Date.now(),
    valid,
    samples: vertices.length,
    spacing: Math.max(p.width / cols, p.height / rows),
    phase: valid === vertices.length ? 'ready' : 'partial',
  };
}
