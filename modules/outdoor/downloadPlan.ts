import { coordinate, type Coordinate } from '../navigation/types.ts';
export type DownloadArea =
  | { kind: 'region'; bounds: [number, number, number, number] }
  | { kind: 'route'; segments: Coordinate[][]; bufferKm: number };
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
  const points = area.segments.flat();
  if (points.some((p) => Math.abs(p[1]) > 85))
    throw new Error('路线超出当前地图纬度覆盖范围');
  if (
    !points.length ||
    !points.every(coordinate) ||
    ![5, 10, 20].includes(area.bufferKm)
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
/** Union buffered segments, including disconnected branches; never join gaps with phantom roads. */
export function downloadTiles(
  area: DownloadArea,
  zoom: number,
  limit = MAX_DOWNLOAD_RESOURCES,
): Tile[] {
  downloadBounds(area);
  if (!Number.isInteger(zoom) || zoom < 1 || zoom > 18)
    throw new Error('无效下载清晰度');
  const tiles: Tile[] = [];
  for (let z = 0; z <= zoom; z++) {
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
            area.bufferKm /
              ((40075 / n) *
                Math.max(
                  0.087,
                  Math.cos(
                    (Math.min(
                      85,
                      Math.max(Math.abs(a[1]), Math.abs(b[1])) +
                        area.bufferKm / 110.5,
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
                throw new Error('路线范围过大，请降低清晰度或分段下载');
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
            throw new Error('范围或清晰度过大，请降低清晰度或缩小范围');
        }
        end = Math.max(end, b);
      }
    }
  }
  return tiles;
}
