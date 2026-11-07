import { coordinate, type Coordinate } from '../navigation/types.ts';
export type DownloadArea =
  | { kind: 'region'; bounds: [number, number, number, number] }
  | { kind: 'route'; segments: Coordinate[][]; bufferKm: number }
  | { kind: 'polygon'; boundary: Coordinate[] };
export type Tile = { z: number; x: number; y: number };
export const MAX_DOWNLOAD_RESOURCES = 20000;
const mx = (lng: number, n: number) => ((lng + 180) / 360) * n;
const my = (lat: number, n: number) =>
  ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n;
export function downloadBounds(
  area: DownloadArea,
): [number, number, number, number] {
  if (area.kind === 'region') {
    const [w, s, e, n] = area.bounds;
    if (
      !area.bounds.every(Number.isFinite) ||
      w < -180 ||
      e > 180 ||
      s < -85 ||
      n > 85 ||
      w >= e ||
      s >= n
    )
      throw new Error('请选择有效地图范围，暂不支持跨日期变更线');
    return area.bounds;
  }
  if (area.kind === 'polygon') {
    const boundary = area.boundary;
    if (!Array.isArray(boundary) || boundary.length > 2000)
      throw new Error('区域边界最多支持 2000 个节点');
    if (boundary.some(point => !coordinate(point))) throw new Error('区域边界包含无效坐标');
    const points = boundary.length > 1 && boundary[0][0] === boundary.at(-1)![0] && boundary[0][1] === boundary.at(-1)![1]
      ? boundary.slice(0, -1) : boundary;
    if (points.length < 3 || points.some(point => Math.abs(point[1]) > 85))
      throw new Error('请选择至少包含 3 个有效节点的区域，纬度需在 85°以内');
    let west = 180, south = 85, east = -180, north = -85;
    for (const [lon, lat] of points) {
      west = Math.min(west, lon); east = Math.max(east, lon);
      south = Math.min(south, lat); north = Math.max(north, lat);
    }
    if (east - west > 180) throw new Error('区域跨越范围过大，暂不支持跨日期变更线');
    if (west === east || south === north) throw new Error('区域边界面积为零，请重新绘制');
    const projected = points.map(([lon, lat]) => [mx(lon, 1), my(lat, 1)] as const);
    const signedArea = projected.reduce((sum, point, index) => {
      const next = projected[(index + 1) % projected.length];
      return sum + point[0] * next[1] - next[0] * point[1];
    }, 0);
    if (!Number.isFinite(signedArea) || Math.abs(signedArea) < 1e-14)
      throw new Error('区域边界面积为零，请重新绘制');
    return [west, south, east, north];
  }
  const points = area.segments.flat();
  if (points.some((p) => Math.abs(p[1]) > 85))
    throw new Error('路线超出当前地图纬度覆盖范围');
  if (
    !points.length ||
    !points.every(coordinate) ||
    ![0.5, 1, 2, 4, 5, 10, 20].includes(area.bufferKm)
  )
    throw new Error('请选择有效路线和沿线范围');
  let w = 180,
    s = 85,
    e = -180,
    n = -85;
  for (const p of points) {
    w = Math.min(w, p[0]);
    e = Math.max(e, p[0]);
    s = Math.min(s, p[1]);
    n = Math.max(n, p[1]);
  }
  if (e - w > 180) throw new Error('暂不支持跨日期变更线，请分段下载');
  const lat = area.bufferKm / 110.5,
    lng =
      lat /
      Math.max(
        0.087,
        Math.cos((Math.max(Math.abs(s), Math.abs(n)) * Math.PI) / 180),
      );
  return [
    Math.max(-180, w - lng),
    Math.max(-85, s - lat),
    Math.min(180, e + lng),
    Math.min(85, n + lat),
  ];
}

function addPolygonTiles(
  boundary: Coordinate[], n: number, add: (y: number, a: number, b: number) => void,
  limit: number, currentTileCount: number,
) {
  const ring = boundary.length > 1 && boundary[0][0] === boundary.at(-1)![0] && boundary[0][1] === boundary.at(-1)![1]
    ? boundary.slice(0, -1) : boundary;
  const points = ring.map(([lon, lat]) => [mx(lon, n), my(lat, n)] as const);
  const minY = Math.max(0, Math.floor(Math.min(...points.map(point => point[1]))));
  const maxY = Math.min(n - 1, Math.floor(Math.max(...points.map(point => point[1]))));
  const rows = new Map<number, [number, number][]>();
  const addRow = (y: number, left: number, right: number) => {
    if (y < 0 || y >= n) return;
    const a = Math.max(0, Math.floor(Math.min(left, right)));
    const b = Math.min(n - 1, Math.floor(Math.max(left, right)));
    if (a > b) return;
    const ranges = rows.get(y) ?? [];
    ranges.push([a, b]);
    rows.set(y, ranges);
    if (rows.size + currentTileCount > limit + 2000) throw new Error('区域缓存超过请求项预算，请降低清晰度或缩小范围');
  };
  let operations = 0;
  // Fill interior tile rows using even-odd scanline intersections.
  for (let y = minY; y <= maxY; y++) {
    const scanY = y + 0.5;
    const intersections: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      if ((a[1] <= scanY && b[1] > scanY) || (b[1] <= scanY && a[1] > scanY))
        intersections.push(a[0] + (scanY - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
      if (++operations > 2_000_000) throw new Error('区域边界在此级别计算量过大，请降低清晰度或缩小范围');
    }
    intersections.sort((a, b) => a - b);
    for (let i = 0; i + 1 < intersections.length; i += 2) addRow(y, intersections[i], intersections[i + 1]);
  }
  // Rasterize each edge at exact grid crossings. Midpoints between crossings
  // cover traversed cells; crossing points include every corner-touch cell.
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const tEvents = new Set<number>([0, 1]);
    const crossings = (start: number, delta: number) => {
      if (Math.abs(delta) < 1e-12) return;
      const low = Math.min(start, start + delta), high = Math.max(start, start + delta);
      for (let grid = Math.floor(low) + 1; grid <= Math.floor(high); grid++) {
        const t = (grid - start) / delta;
        if (t > 0 && t < 1) tEvents.add(t);
        if (++operations > 2_000_000) throw new Error('区域边界在此级别计算量过大，请降低清晰度或缩小范围');
      }
    };
    crossings(a[0], dx);
    crossings(a[1], dy);
    const events = [...tEvents].sort((left, right) => left - right);
    const addPoint = (x: number, y: number) => {
      const onX = Math.abs(x - Math.round(x)) < 1e-8;
      const onY = Math.abs(y - Math.round(y)) < 1e-8;
      const col = onX ? Math.round(x) : Math.floor(x);
      const row = onY ? Math.round(y) : Math.floor(y);
      addRow(row, col, col);
      if (onX) addRow(row, col - 1, col - 1);
      if (onY) {
        addRow(row - 1, col, col);
        if (onX) addRow(row - 1, col - 1, col - 1);
      }
    };
    for (const t of events) addPoint(a[0] + dx * t, a[1] + dy * t);
    for (let event = 0; event + 1 < events.length; event++) {
      const t = (events[event] + events[event + 1]) / 2;
      addPoint(a[0] + dx * t, a[1] + dy * t);
    }
  }
  for (const [y, ranges] of rows) {
    ranges.sort((a, b) => a[0] - b[0]);
    let end = -1;
    for (const [a, b] of ranges) {
      add(y, Math.max(a, end + 1), b);
      end = Math.max(end, b);
    }
  }
}
/** Union buffered segments, including disconnected branches; never join gaps with phantom roads. */
export function downloadTiles(
  area: DownloadArea,
  zoom: number,
  limit = MAX_DOWNLOAD_RESOURCES,
  detailCorridor = false,
  minZoom = 0,
): Tile[] {
  downloadBounds(area);
  if (!Number.isInteger(zoom) || zoom < 0 || zoom > 24 || !Number.isInteger(minZoom) || minZoom < 0 || minZoom > zoom)
    throw new Error('无效下载清晰度');
  const tiles: Tile[] = [];
  for (let z = minZoom; z <= zoom; z++) {
    const bufferKm = area.kind === 'route' ? detailCorridor && z > 14 ? Math.min(area.bufferKm, z > 16 ? 0.25 : 1) : area.bufferKm : 0;
    const n = 2 ** z,
      rows = new Map<number, [number, number][]>();
    const add = (y: number, a: number, b: number) => {
      if (y < 0 || y >= n) return;
      const lo = Math.max(0, Math.floor(a)),
        hi = Math.min(n - 1, Math.floor(b));
      if (lo <= hi) {
        const row = rows.get(y) ?? [];
        row.push([lo, hi]);
        rows.set(y, row);
      }
    };
    if (area.kind === 'region') {
      const [w, s, e, north] = area.bounds,
        x0 = Math.max(0, Math.floor(mx(w, n))),
        x1 = Math.min(n - 1, Math.floor(mx(e, n)));
      const y0 = Math.max(0, Math.floor(my(north, n))),
        y1 = Math.min(n - 1, Math.floor(my(s, n)));
      if ((x1 - x0 + 1) * (y1 - y0 + 1) + tiles.length > limit)
        throw new Error('范围或清晰度过大，请降低清晰度或缩小范围');
      for (let y = y0; y <= y1; y++) add(y, x0, x1);
    } else if (area.kind === 'polygon') {
      addPolygonTiles(area.boundary, n, add, limit, tiles.length);
    } else {
      let operations = 0;
      for (const line of area.segments)
        for (let i = 0; i < line.length; i++) {
          const a = line[Math.max(0, i - 1)],
            b = line[i],
            ax = mx(a[0], n),
            ay = my(a[1], n),
            bx = mx(b[0], n),
            by = my(b[1], n);
          const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
          const radius =
            bufferKm /
              ((40075 / n) *
                Math.max(
                  0.087,
                  Math.cos(
                    (Math.min(
                      85,
                      Math.max(Math.abs(a[1]), Math.abs(b[1])) +
                        bufferKm / 110.5,
                    ) *
                      Math.PI) /
                      180,
                  ),
                )) +
            1;
          for (let k = 0; k <= steps; k++) {
            const x = ax + ((bx - ax) * k) / steps,
              y = ay + ((by - ay) * k) / steps;
            for (
              let row = Math.max(0, Math.floor(y - radius));
              row <= Math.min(n - 1, Math.floor(y + radius));
              row++
            ) {
              if (++operations > 2000000)
                throw new Error(`当前路线范围在此级别计算量过大；路线两侧各 ${area.bufferKm} km 范围保持不变，请降低级别或分段缓存`);
              const dy = Math.max(0, Math.abs(row + 0.5 - y) - 0.5),
                dx = Math.sqrt(Math.max(0, radius * radius - dy * dy));
              add(row, x - dx, x + dx);
            }
          }
        }
    }
    for (const [y, parts] of rows) {
      parts.sort((a, b) => a[0] - b[0]);
      let end = -1;
      for (const [a, b] of parts) {
        for (let x = Math.max(a, end + 1); x <= b; x++) {
          tiles.push({ z, x, y });
          if (tiles.length > limit)
            throw new Error(area.kind === 'route'
              ? `路线缓存超过请求项预算；两侧各 ${area.bufferKm} km 范围保持不变，请降低级别或分段缓存`
              : '范围或清晰度过大，请降低清晰度或缩小范围');
        }
        end = Math.max(end, b);
      }
    }
  }
  return tiles;
}
