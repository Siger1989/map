import { num, text } from './patterns.ts';

type P = [number, number];
type Line = {
  id: string;
  node: number;
  anchor_x_m: number;
  anchor_z_m: number;
  record_id: string | null;
  dip_direction_deg: number | null;
  dip_angle_deg: number | null;
  apparent_dip_deg_signed: number | null;
  a: number | null;
  b: number | null;
  c: number | null;
  basis: string;
  segments: P[][];
  status: string;
  reason: string;
};
const EPS = 1e-10,
  finite = (v: any): v is number => typeof v === 'number' && Number.isFinite(v);
const val = (l: any, p: P) => l.a * p[0] + l.b * p[1] + l.c;
function terrain(nodes: any[], x: number): number | null {
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i],
      b = nodes[i + 1],
      dx = num(b.x_m) - num(a.x_m);
    if (Math.min(a.x_m, b.x_m) - EPS <= x && x <= Math.max(a.x_m, b.x_m) + EPS)
      return Math.abs(dx) <= EPS
        ? null
        : num(a.z_m) + ((x - a.x_m) / dx) * (num(b.z_m) - num(a.z_m));
  }
  return null;
}
const dedupe = (pts: P[], tol = EPS): P[] =>
  pts.filter(
    (p, i) =>
      pts.findIndex((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= tol) === i,
  );
function lineSegment(l: any, poly: P[]): P[] | null {
  const hits: P[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i],
      q = poly[(i + 1) % poly.length],
      fp = val(l, p),
      fq = val(l, q);
    if (Math.abs(fp) <= EPS) hits.push(p);
    if (fp * fq < -(EPS * EPS)) {
      const t = fp / (fp - fq);
      hits.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
    } else if (Math.abs(fp) <= EPS && Math.abs(fq) <= EPS) hits.push(q);
  }
  const pts = dedupe(hits);
  if (pts.length < 2) return null;
  let best: [P, P] | null = null,
    d = -1;
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++) {
      const dd = (pts[i][0] - pts[j][0]) ** 2 + (pts[i][1] - pts[j][1]) ** 2;
      if (dd > d) {
        d = dd;
        best = [pts[i], pts[j]];
      }
    }
  return best;
}
function clip(poly: P[], l: any, sign: number): P[] {
  if (!poly.length) return [];
  const out: P[] = [];
  let prev = poly.at(-1)!,
    pv = sign * val(l, prev),
    pin = pv >= -EPS;
  for (const cur of poly) {
    const cv = sign * val(l, cur),
      cin = cv >= -EPS;
    if (cin !== pin) {
      const den = pv - cv;
      if (Math.abs(den) > EPS) {
        const t = pv / den;
        out.push([
          prev[0] + t * (cur[0] - prev[0]),
          prev[1] + t * (cur[1] - prev[1]),
        ]);
      }
    }
    if (cin) out.push(cur);
    prev = cur;
    pv = cv;
    pin = cin;
  }
  return dedupe(out);
}
const area = (p: P[]) =>
  Math.abs(
    p.reduce(
      (s, a, i) =>
        s + a[0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * a[1],
      0,
    ),
  ) / 2;
const intersect = (a: any, b: any): P | null => {
  const d = a.a * b.b - b.a * a.b;
  if (Math.abs(d) <= EPS) return null;
  return [(a.b * b.c - a.c * b.b) / d, (b.a * a.c - a.a * b.c) / d];
};
function contact(
  interval: any,
  rec: any,
  node: any,
  axis: number,
  n: number,
): Line {
  const dd = rec?.dip_direction_deg,
    da = rec?.dip_angle_deg;
  const c: Line = {
    id: `LC${String(n).padStart(4, '0')}`,
    node: interval.start_node,
    anchor_x_m: num(node.x_m),
    anchor_z_m: num(node.z_m),
    record_id: rec?.id ?? null,
    dip_direction_deg: finite(dd) ? dd : null,
    dip_angle_deg: finite(da) ? da : null,
    apparent_dip_deg_signed: null,
    a: null,
    b: null,
    c: null,
    basis: 'following_interval_first_record_attitude',
    segments: [],
    status: 'pending',
    reason: 'missing_attitude',
  };
  if (!finite(dd) || !finite(da)) return c;
  if (dd < 0 || dd >= 360 || da < 0 || da > 90) {
    c.reason = 'invalid_attitude';
    return c;
  }
  const delta = dd === 0 && da === 0 ? 0 : (da * Math.PI) / 180,
    d = ((axis - dd) * Math.PI) / 180;
  let qx = Math.cos(delta),
    qz = -Math.sin(delta) * Math.cos(d),
    norm = Math.hypot(qx, qz);
  if (norm <= EPS) {
    c.reason = 'vertical_dip_parallel_to_strike_degenerate';
    return c;
  }
  qx /= norm;
  qz /= norm;
  c.a = qz;
  c.b = -qx;
  c.c = -(c.a * c.anchor_x_m + c.b * c.anchor_z_m);
  c.apparent_dip_deg_signed = (Math.atan2(qz, qx) * 180) / Math.PI;
  c.status = 'eligible';
  c.reason = '';
  return c;
}
export function buildLayerGeometry(
  data: Record<string, any>,
  requestedDepth = 7,
): Record<string, any> {
  const issues: any[] = [],
    result: any = {
      mode: 'apparent_dip_outcrop',
      requested_depth_m: requestedDepth,
      effective_depth_m: 0,
      contacts: [],
      regions: [],
      issues,
      eligible: false,
    };
  const nodes = data.nodes || [],
    intervals = data.intervals || [],
    records = data.records || [],
    axis = data.settings?.axis_azimuth_deg;
  if (!finite(requestedDepth) || requestedDepth <= 0) {
    issues.push({
      code: 'invalid_display_depth',
      message: '近地表显示深度必须大于0',
    });
    return result;
  }
  if (
    !finite(axis) ||
    nodes.length < 2 ||
    !intervals.length ||
    nodes.some((n: any) => !finite(n.x_m) || !finite(n.z_m))
  ) {
    issues.push({
      code: 'layer_geometry_input_missing',
      message: '缺少有效剖面方位、节点或层段，近地表层区留白',
    });
    return result;
  }
  const dx = nodes.slice(1).map((n: any, i: number) => n.x_m - nodes[i].x_m),
    direction = dx[0] > EPS ? 1 : dx[0] < -EPS ? -1 : 0;
  if (!direction || dx.some((v: number) => v * direction <= EPS)) {
    issues.push({
      code: 'nonmonotonic_projection',
      message: '测线轴向投影回折或重叠，层区留白',
    });
    result.regions = intervals.map((i: any) => ({
      interval_id: i.id,
      polygons: [],
      status: 'pending',
      reason: 'nonmonotonic_projection',
    }));
    return result;
  }
  const byId = new Map(records.map((r: any) => [r.id, r]));
  const contacts: Line[] = intervals.slice(1).map((it: any, i: number) => {
    const rec = (it.record_ids || [])
      .map((id: string) => byId.get(id))
      .find(Boolean);
    const node = nodes[it.start_node];
    return node
      ? contact(it, rec, node, axis, i + 1)
      : ({
          id: `LC${i + 1}`,
          node: it.start_node,
          anchor_x_m: 0,
          anchor_z_m: 0,
          record_id: null,
          dip_direction_deg: null,
          dip_angle_deg: null,
          apparent_dip_deg_signed: null,
          a: null,
          b: null,
          c: null,
          basis: 'following_interval_first_record_attitude',
          segments: [],
          status: 'pending',
          reason: 'invalid_internal_anchor',
        } as Line);
  });
  const lineProblem = (l: Line): string | null => {
    const i = l.node;
    if (!Number.isInteger(i) || i <= 0 || i >= nodes.length - 1)
      return 'invalid_internal_anchor';
    const before = val(l, [nodes[i - 1].x_m, nodes[i - 1].z_m]),
      after = val(l, [nodes[i + 1].x_m, nodes[i + 1].z_m]);
    if (
      Math.abs(before) <= EPS ||
      Math.abs(after) <= EPS ||
      before * after >= 0
    )
      return 'surface_tangent_or_coincident';
    let hits: P[] = [[nodes[i].x_m, nodes[i].z_m]];
    for (let j = 0; j < nodes.length - 1; j++) {
      const p: P = [nodes[j].x_m, nodes[j].z_m],
        q: P = [nodes[j + 1].x_m, nodes[j + 1].z_m],
        fp = val(l, p),
        fq = val(l, q);
      if (Math.abs(fp) <= EPS && Math.abs(fq) <= EPS)
        return 'surface_tangent_or_coincident';
      if (fp * fq < -(EPS * EPS)) {
        const t = fp / (fp - fq);
        hits.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
      } else if (Math.abs(fp) <= EPS) hits.push(p);
      else if (Math.abs(fq) <= EPS) hits.push(q);
    }
    return dedupe(hits).length > 1 ? 'surface_reintersection' : null;
  };
  for (const l of contacts) {
    if (l.status === 'eligible') {
      const p = lineProblem(l);
      if (p) {
        l.status = 'pending';
        l.reason = p;
        issues.push({
          code: p,
          message: `层界${l.id}与地形关系不明确，影响区域留白`,
        });
      }
    }
  }
  let first: number | null = null,
    zero = false;
  const valid = contacts.filter((l) => l.status === 'eligible');
  for (let i = 0; i < valid.length; i++)
    for (let j = i + 1; j < valid.length; j++) {
      const p = intersect(valid[i], valid[j]);
      if (!p) continue;
      const z = terrain(nodes, p[0]);
      if (z === null) continue;
      const dep = z - p[1];
      if (Math.abs(dep) <= EPS) zero = true;
      else if (dep > EPS && dep <= requestedDepth + EPS)
        first = first === null ? dep : Math.min(first, dep);
    }
  if (zero) {
    issues.push({
      code: 'zero_depth_topology_conflict',
      message: '层界存在零深度拓扑冲突，层区留白',
    });
    result.contacts = contacts;
    result.regions = intervals.map((i: any) => ({
      interval_id: i.id,
      polygons: [],
      status: 'pending',
      reason: 'zero_depth_topology_conflict',
    }));
    return result;
  }
  const depth = first === null ? requestedDepth : 0.8 * first;
  result.effective_depth_m = depth;
  const cells: P[][] = nodes.slice(1).map((n: any, i: number) => {
    const l = nodes[i];
    return [
      [l.x_m, l.z_m],
      [n.x_m, n.z_m],
      [n.x_m, n.z_m - depth],
      [l.x_m, l.z_m - depth],
    ];
  });
  for (const c of contacts) {
    if (c.status !== 'eligible') continue;
    const ss: P[][] = [];
    for (const cell of cells) {
      const s = lineSegment(c, cell);
      if (s && !ss.some((o) => JSON.stringify(o) === JSON.stringify(s)))
        ss.push(s);
    }
    c.segments = ss;
    c.status = ss.length ? 'drawn' : 'pending';
    c.reason = ss.length ? '' : 'outside_effective_display_domain';
  }
  const regions = intervals.map((it: any, i: number) => {
    const left = i ? contacts[i - 1] : null,
      right = i < contacts.length ? contacts[i] : null;
    const item: any = {
      interval_id: it.id,
      layer_id: it.layer_id,
      source_node_indices: Array.from(
        { length: it.end_node - it.start_node + 1 },
        (_, k) => it.start_node + k,
      ),
      polygons: [],
      status: 'drawn',
      reason: '',
    };
    if ([left, right].some((c) => c && c.status !== 'drawn')) {
      item.status = 'pending';
      item.reason = 'adjacent_contact_pending';
      return item;
    }
    const mid = (nodes[it.start_node].x_m + nodes[it.end_node].x_m) / 2,
      z = terrain(nodes, mid);
    if (z === null) {
      item.status = 'pending';
      item.reason = 'surface_midpoint_unavailable';
      return item;
    }
    const hs: any[] = [];
    for (const c of [left, right])
      if (c) {
        const v = val(c, [mid, z]);
        if (Math.abs(v) <= EPS) {
          item.status = 'pending';
          item.reason = 'boundary_touches_interval_surface_midpoint';
          return item;
        }
        hs.push([c, v > 0 ? 1 : -1]);
      }
    for (const cell of cells) {
      let p = cell;
      for (const [c, s] of hs) p = clip(p, c, s);
      if (p.length >= 3 && area(p) > EPS) item.polygons.push(p);
    }
    if (!item.polygons.length) {
      item.status = 'pending';
      item.reason = 'empty_after_halfplane_clipping';
    }
    return item;
  });
  result.contacts = contacts;
  result.regions = regions;
  result.eligible = regions.some((r: any) => r.status === 'drawn');
  return result;
}
