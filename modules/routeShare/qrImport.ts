import type { RouteQr } from './qrCodec';
import type { Transfer } from '../outdoor/exchange';
import type { ManualTrack } from '../tracks/drawing';
import { metresBetween, type Coordinate } from '../navigation/types.ts';

/** Scanning only creates a saved track. Guidance requires an explicit later action. */
export function qrTransfer(
  data: RouteQr,
  now = Date.now(),
): { transfer: Transfer; track: ManualTrack } {
  const vertices = data.segments.flat();
  let start: Coordinate | undefined;
  if (data.stops.length === 1) {
    // QR vertices are rounded to six decimals, while stop metadata retains
    // its original precision. Bind the start to the decoded vertex itself.
    start = vertices.reduce((best, point) =>
      metresBetween(point, data.stops[0].coordinates) < metresBetween(best, data.stops[0].coordinates)
        ? point : best);
    if (metresBetween(start, data.stops[0].coordinates) > 0.25)
      throw new Error('二维码起点不在线路节点上，未导入错误端点');
  }
  const track: ManualTrack = {
    id: crypto.randomUUID(),
    name:
      data.name +
      (data.tolerance
        ? `（扫码${data.tolerance > 50 ? '概括' : '简化'}·${data.tolerance}米）`
        : '（扫码）'),
    createdAt: now,
    segments: data.segments.map((line) => line.map((p) => [...p])),
    source: 'shared',
    ...(data.style ? { style: data.style } : {}),
    ...(data.edgeColors ? { edgeColors: data.edgeColors } : {}),
    ...(data.colorConditions ? { colorConditions: data.colorConditions } : {}),
    navigationMode: data.mode,
    ...(data.stops.length > 1 ? {
      sharedRoute: {
        stops: data.stops.map((s) => ({
          name: s.name,
          coordinates: [...s.coordinates] as [number, number],
        })),
        duration: data.duration ?? null,
        tolerance: data.tolerance,
      },
    } : {
      routeTerminals: { start },
    }),
  };
  return {
    track,
    transfer: {
      format: 'guanyun-backup',
      version: 1,
      tracks: [track],
      favorites: [],
      annotations: [],
    },
  };
}
