import { esc, fmt, num, text } from './patterns.ts';

export type Point = [number, number];
export type LabelBox = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  font_size: number;
};
export type Callout = {
  id: string;
  x: number;
  y: number;
  point: Point;
  box: LabelBox;
};

export function estimateTextWidth(value: string, size: number): number {
  return [...value].reduce(
    (sum, ch) => sum + size * (ch.charCodeAt(0) > 255 ? 1 : 0.58),
    0,
  );
}

export function measuredTextBox(
  id: string,
  value: string,
  x: number,
  baseline: number,
  size: number,
  anchor = 'start',
  pad = 2,
): LabelBox {
  const width = estimateTextWidth(value, size),
    left =
      anchor === 'end' ? x - width : anchor === 'middle' ? x - width / 2 : x;
  return {
    id,
    x: left - pad,
    y: baseline - size * 0.9 - pad,
    width: width + pad * 2,
    height: size * 1.25 + pad * 2,
    font_size: size,
  };
}

export function boxesOverlap(a: LabelBox, b: LabelBox): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

export function niceStep(span: number, target = 6): number {
  if (!(span > 0) || !Number.isFinite(span)) return 1;
  const raw = span / target,
    power = 10 ** Math.floor(Math.log10(raw)),
    ratio = raw / power;
  return (ratio <= 1 ? 1 : ratio <= 2 ? 2 : ratio <= 5 ? 5 : 10) * power;
}

export function ticks(min: number, max: number, target = 6): number[] {
  if (Math.abs(max - min) <= Math.max(1, Math.abs(min), Math.abs(max)) * 1e-9)
    return [Number(((min + max) / 2 || 0).toPrecision(12))];
  const step = niceStep(max - min, target);
  const first = Math.ceil((min - 1e-9) / step) * step,
    out: number[] = [];
  for (let v = first; v <= max + step * 1e-9; v += step) {
    out.push(Number(v.toPrecision(12)));
    if (out.length > 1000) throw new Error('坐标刻度数量超过安全上限');
  }
  return out;
}

export function profileAxesSvg(args: {
  minX: number;
  maxX: number;
  zBottom: number;
  zTop: number;
  margin: number;
  panelW: number;
  profileTop: number;
  profileBottom: number;
  anchor: (x: number, z: number) => Point;
}): string {
  const {
    minX,
    maxX,
    zBottom,
    zTop,
    margin,
    panelW,
    profileTop,
    profileBottom,
    anchor,
  } = args;
  const out: string[] = [];
  for (const x of ticks(minX, maxX, 8)) {
    const [sx] = anchor(x, zTop);
    out.push(
      `<line class="grid" x1="${sx}" y1="${profileTop + 4}" x2="${sx}" y2="${profileBottom - 4}"/>`,
    );
    out.push(xmlText(sx, profileBottom + 16, fmt(x, 2), 9, 'middle'));
  }
  for (const z of ticks(zBottom, zTop, 6)) {
    const [, sy] = anchor(minX, z);
    out.push(
      `<line class="grid" x1="${margin + 4}" y1="${sy}" x2="${margin + panelW - 4}" y2="${sy}"/>`,
    );
    out.push(xmlText(margin - 8, sy + 3, fmt(z, 2), 9, 'end'));
  }
  out.push(
    xmlText(
      margin + panelW / 2,
      profileBottom + 32,
      '剖面轴向距离 x (m)',
      10,
      'middle',
    ),
  );
  out.push(xmlText(margin + 8, profileTop + 15, '高程 z (m)', 9));
  return out.join('');
}

export function layerIdCallouts(args: {
  materialRows: any[];
  nodes: any[];
  profileAnchor: (x: number, z: number) => Point;
  profileTop: number;
  panelW: number;
  margin: number;
}): { svg: string; boxes: LabelBox[]; ids: string[] } {
  const { materialRows, nodes, profileAnchor, profileTop, panelW, margin } =
    args;
  const boxes: LabelBox[] = [],
    ids: string[] = [],
    out: string[] = [];
  const anchors = materialRows.map(({ interval, region }) => {
    const polys = (region?.polygons || []) as number[][][];
    const candidate = polys
      .map((poly) => polygonCentroid(poly as Point[]))
      .filter(Boolean)
      .sort((a: any, b: any) => b.area - a.area)[0] as
      | { point: Point; area: number }
      | undefined;
    const start = nodes[interval.start_node],
      end = nodes[interval.end_node];
    const point =
      candidate?.point ||
      ([
        (num(start?.x_m) + num(end?.x_m)) / 2,
        (num(start?.z_m) + num(end?.z_m)) / 2,
      ] as Point);
    return {
      id: text(interval.layer_id) || text(interval.id),
      point: profileAnchor(point[0], point[1]),
    };
  });
  for (const [i, item] of anchors.entries()) {
    const row = i % 2,
      col = Math.floor(i / 2),
      count = Math.ceil(anchors.length / 2);
    const x = margin + 14 + ((col + 0.5) * (panelW - 28)) / Math.max(1, count),
      y = profileTop + 17 + row * 18;
    out.push(
      `<path class="leader" d="M${x},${y + 2}L${item.point[0]},${item.point[1]}"/>`,
    );
    out.push(
      `<text class="tag" x="${x}" y="${y}" text-anchor="middle" font-size="10" font-weight="bold">${esc(item.id)}</text>`,
    );
    boxes.push(measuredTextBox(item.id, item.id, x, y, 10, 'middle'));
    ids.push(item.id);
  }
  return { svg: out.join(''), boxes, ids };
}

export function layoutCallouts(
  items: { id: string; point: Point }[],
  bounds: { left: number; top: number; right: number; bottom: number },
  occupied: LabelBox[] = [],
  size = 11,
): Callout[] {
  const boxes = [...occupied],
    out: Callout[] = [];
  const candidates = [
    [10, -10],
    [10, 18],
    [-10, -10],
    [-10, 18],
    [0, -24],
    [0, 30],
    [28, -10],
    [28, 18],
    [-28, -10],
    [-28, 18],
    [0, -42],
    [0, 48],
    [48, -10],
    [48, 18],
    [-48, -10],
    [-48, 18],
    [0, -62],
    [0, 68],
    [78, -10],
    [78, 18],
    [-78, -10],
    [-78, 18],
    [0, -86],
    [0, 92],
  ];
  for (const item of items) {
    const width = estimateTextWidth(item.id, size) + 8,
      height = size * 1.4;
    let chosen: Callout | null = null;
    for (const [dx, dy] of candidates) {
      const x = dx < 0 ? item.point[0] + dx - width : item.point[0] + dx;
      const baseline = item.point[1] + dy;
      const box: LabelBox = {
        id: item.id,
        x: x - 3,
        y: baseline - size,
        width: width,
        height: height,
        font_size: size,
      };
      if (
        box.x < bounds.left ||
        box.x + box.width > bounds.right ||
        box.y < bounds.top ||
        box.y + box.height > bounds.bottom
      )
        continue;
      if (boxes.some((other) => boxesOverlap(box, other))) continue;
      chosen = { id: item.id, x, y: baseline, point: item.point, box };
      break;
    }
    if (chosen) {
      boxes.push(chosen.box);
      out.push(chosen);
    }
  }
  return out;
}

export function path(points: Point[], close = false): string {
  return (
    points
      .map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(2)},${p[1].toFixed(2)}`)
      .join('') + (close ? 'Z' : '')
  );
}

export function polygonCentroid(
  poly: Point[],
): { point: Point; area: number } | null {
  if (poly.length < 3) return null;
  let crossSum = 0,
    x = 0,
    y = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i],
      q = poly[(i + 1) % poly.length],
      cross = p[0] * q[1] - q[0] * p[1];
    crossSum += cross;
    x += (p[0] + q[0]) * cross;
    y += (p[1] + q[1]) * cross;
  }
  return Math.abs(crossSum) > 1e-12
    ? {
        point: [x / (3 * crossSum), y / (3 * crossSum)],
        area: Math.abs(crossSum) / 2,
      }
    : null;
}

export function xmlText(
  x: number,
  y: number,
  value: unknown,
  size = 10,
  anchor = 'start',
  weight = 'normal',
): string {
  return `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" font-size="${size}" text-anchor="${anchor}" font-weight="${weight}">${esc(value)}</text>`;
}

export function wrap(value: string, max = 72): string[] {
  const lines: string[] = [];
  for (const para of value.split(/\r?\n/)) {
    let line = '';
    for (const ch of para) {
      if (line && line.length >= max) {
        lines.push(line);
        line = '';
      }
      line += ch;
    }
    lines.push(line);
  }
  return lines;
}

export function hasLocatedPosition(s: any): boolean {
  return (
    (s?.location_status === 'explicit_offset' ||
      s?.location_status === 'located') &&
    Number.isFinite(s.position?.x_m) &&
    Number.isFinite(s.position?.z_m)
  );
}
