import { zlibSync, unzlibSync, strToU8, strFromU8 } from 'fflate';
import {
  coordinate,
  type Coordinate,
  type TravelMode,
} from '../navigation/types.ts';
import type { ShareRoute } from './data';
import { lineLength } from '../journey/metrics.ts';
export const ROUTE_QR_PREFIX = 'shantu-route:1:';
export const QR_BUDGET = 2100;
const PRECISION = 1e6,
  MAX_RAW = 64000;
const TOLERANCES = [
  0, 2, 5, 10, 20, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 50000, 500000,
] as const;
export type RouteQr = {
  name: string;
  mode: TravelMode;
  segments: Coordinate[][];
  stops: ShareRoute['stops'];
  tolerance: number;
  duration: number | null;
};
function segmentDistance(p: Coordinate, a: Coordinate, b: Coordinate) {
  const wrap = (v: number) => ((v + 540) % 360) - 180,
    scale = Math.cos((p[1] * Math.PI) / 180),
    dx = wrap(b[0] - a[0]) * scale,
    dy = b[1] - a[1],
    px = wrap(p[0] - a[0]) * scale,
    py = p[1] - a[1];
  const t = Math.max(
    0,
    Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy || 1)),
  );
  return Math.hypot(px - dx * t, py - dy * t) * 111320;
}
/** RDP preserves endpoints. Original coordinates are never mutated or used to replace the full image/file. */
function simplify(line: Coordinate[], tolerance: number) {
  if (!tolerance || line.length < 3) return line;
  const keep = new Set([0, line.length - 1]),
    stack = [[0, line.length - 1]];
  let work = 0;
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let distance = tolerance,
      index = -1;
    for (let i = a + 1; i < b; i++) {
      work++;
      const d = segmentDistance(line[i], line[a], line[b]);
      if (d > distance) {
        distance = d;
        index = i;
      }
    }
    if (index !== -1) {
      if (work > 2000000) index = Math.floor((a + b) / 2);
      keep.add(index);
      stack.push([a, index], [index, b]);
    }
  }
  return [...keep].sort((a, b) => a - b).map((i) => line[i]);
}
function deltas(line: Coordinate[]) {
  let x = 0,
    y = 0;
  return line.map((p) => {
    const nx = Math.round(p[0] * PRECISION),
      ny = Math.round(p[1] * PRECISION),
      d = [nx - x, ny - y];
    x = nx;
    y = ny;
    return d;
  });
}
function encode(value: RouteQr) {
  const raw = strToU8(
    JSON.stringify({
      n: value.name,
      m: value.mode,
      s: value.segments.map(deltas),
      p: value.stops.map((p) => [p.name, ...p.coordinates]),
      t: value.tolerance,
      d: value.duration,
    }),
  );
  if (raw.length > MAX_RAW) return '';
  const packed = zlibSync(raw, { level: 9 });
  let binary = '';
  for (const b of packed) binary += String.fromCharCode(b);
  return (
    ROUTE_QR_PREFIX +
    raw.length.toString(36) +
    ':' +
    btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  );
}
export function makeRouteQr(data: ShareRoute) {
  // Pin each saved waypoint's nearest original vertex before simplifying the spans.
  const protectedSegments = data.segments.flatMap((line) => {
    const pins = new Set([0, line.length - 1]);
    // Preserve the route's major extent, especially closed loops whose endpoints coincide.
    for (const axis of [0, 1]) {
      let low = 0,
        high = 0;
      line.forEach((p, i) => {
        if (p[axis] < line[low][axis]) low = i;
        if (p[axis] > line[high][axis]) high = i;
      });
      pins.add(low);
      pins.add(high);
    }
    for (const stop of data.stops) {
      let at = 0,
        d = Infinity;
      line.forEach((p, i) => {
        const v = Math.hypot(
          p[0] - stop.coordinates[0],
          p[1] - stop.coordinates[1],
        );
        if (v < d) {
          d = v;
          at = i;
        }
      });
      pins.add(at);
    }
    const indices = [...pins].sort((a, b) => a - b);
    return [{ line, indices }];
  });
  for (const tolerance of TOLERANCES) {
    const segments = protectedSegments.map(({ line, indices }) =>
      indices.slice(1).flatMap((b, i) => {
        const values = simplify(line.slice(indices[i], b + 1), tolerance);
        return i ? values.slice(1) : values;
      }),
    );
    const value: RouteQr = {
      name: data.name.slice(0, 80),
      mode: data.mode,
      segments,
      stops: data.stops.map((p) => ({
        name: p.name.slice(0, 40),
        coordinates: p.coordinates,
      })),
      tolerance,
      duration: data.duration,
    };
    if (segments.reduce((n, s) => n + s.length, 0) > 6000) continue;
    const text = encode(value);
    if (text && text.length <= QR_BUDGET) return { text, value };
  }
  throw new Error(
    '路线分段或途经点信息超出单码容量，概括后仍无法容纳；图片可分享，请另附GPX/KML或分段分享。',
  );
}
export function readRouteQr(text: string): RouteQr {
  if (!text.startsWith(ROUTE_QR_PREFIX) || text.length > QR_BUDGET)
    throw new Error('不是受支持的山兔路线二维码');
  try {
    const [size, encoded, ...extra] = text
      .slice(ROUTE_QR_PREFIX.length)
      .split(':');
    const length = parseInt(size, 36);
    if (
      extra.length ||
      !Number.isInteger(length) ||
      length < 2 ||
      length > MAX_RAW ||
      !encoded ||
      !/^[A-Za-z0-9_-]+$/.test(encoded)
    )
      throw 0;
    const packed = Uint8Array.from(
      atob(encoded.replace(/-/g, '+').replace(/_/g, '/')),
      (c) => c.charCodeAt(0),
    );
    const raw = unzlibSync(packed, { out: new Uint8Array(length) }),
      v = JSON.parse(strFromU8(raw));
    if (
      typeof v.n !== 'string' ||
      v.n.length > 80 ||
      !['auto', 'bicycle', 'pedestrian'].includes(v.m) ||
      !TOLERANCES.includes(v.t) ||
      (v.d !== null && (!Number.isFinite(v.d) || v.d < 0)) ||
      !Array.isArray(v.s) ||
      !v.s.length ||
      v.s.length > 100 ||
      !Array.isArray(v.p) ||
      v.p.length < 2 ||
      v.p.length > 12
    )
      throw 0;
    let count = 0;
    const segments: Coordinate[][] = v.s.map((s: unknown) => {
      if (!Array.isArray(s) || s.length < 2 || (count += s.length) > 6000)
        throw 0;
      let x = 0,
        y = 0;
      return s.map((p) => {
        if (
          !Array.isArray(p) ||
          p.length !== 2 ||
          !p.every(
            (n) => Number.isSafeInteger(n) && Math.abs(n) <= 360 * PRECISION,
          )
        )
          throw 0;
        x += p[0];
        y += p[1];
        const point: Coordinate = [x / PRECISION, y / PRECISION];
        if (!coordinate(point)) throw 0;
        return point;
      });
    });
    const stops = v.p.map((p: unknown) => {
      if (
        !Array.isArray(p) ||
        p.length !== 3 ||
        typeof p[0] !== 'string' ||
        p[0].length > 40 ||
        !coordinate(p.slice(1))
      )
        throw 0;
      return { name: p[0], coordinates: p.slice(1) as Coordinate };
    });
    return {
      name: v.n,
      mode: v.m,
      segments,
      stops,
      tolerance: v.t,
      duration: v.d,
    };
  } catch {
    throw new Error('路线二维码已损坏、超限或格式不受支持');
  }
}
export const qrAccuracy = (value: RouteQr) =>
  value.tolerance
    ? `${value.tolerance > 50 ? '概括路线：弯道可能变为直线' : '二维码线形已简化'}，简化阈值${value.tolerance}米；扫码线形不代表精确通行路径，请用GPX/KML保留完整精度。`
    : '二维码保留全部线形点，坐标精度约0.2米；不包含原轨迹时间和实测海拔。';
export const qrDistance = (value: RouteQr) =>
  value.segments.reduce((n, s) => n + lineLength(s), 0);
