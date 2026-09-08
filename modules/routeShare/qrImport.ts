import type { RouteQr } from './qrCodec';
import { qrDistance } from './qrCodec.ts';
import type { Transfer } from '../outdoor/exchange';
import type { RouteFavorite } from '../navigation/favorites';
import { joinSegments } from '../tracks/snapping.ts';
import { pathOf, project } from '../guidance/geometry.ts';
export function qrTransfer(
  data: RouteQr,
  now = Date.now(),
): { transfer: Transfer; favorite: RouteFavorite | null } {
  const name =
      data.name +
      (data.tolerance
        ? `（扫码${data.tolerance > 50 ? '概括' : '简化'}·${data.tolerance}米）`
        : '（扫码）'),
    id = crypto.randomUUID();
  const lines = joinSegments(data.segments),
    transfer: Transfer = {
      format: 'guanyun-backup',
      version: 1,
      tracks: [],
      favorites: [],
      annotations: [],
    };
  if (lines.length === 1 && pathOf(lines[0]).length >= 20) {
    const path = pathOf(lines[0]);
    let floor = 0;
    const snapped = data.stops.map((s, i) => {
      if (i === 0) return lines[0][0];
      if (i === data.stops.length - 1) return lines[0].at(-1)!;
      const p = project(path, s.coordinates, floor);
      floor = p.distance;
      return p.point;
    });
    const favorite: RouteFavorite = {
      id,
      name,
      savedAt: now,
      start: data.stops[0],
      end: data.stops.at(-1)!,
      route: {
        geometryKind: 'track',
        mode: data.mode,
        coordinates: lines[0],
        distance: qrDistance(data),
        duration:
          data.duration ??
          qrDistance(data) /
            ({ auto: 40000, bicycle: 15000, pedestrian: 4000 }[data.mode] /
              3600),
        steps: [],
        stops: data.stops,
        snapped,
        createdAt: now,
      },
    };
    transfer.favorites.push(favorite);
    return { transfer, favorite };
  }
  transfer.tracks.push({
    id,
    name,
    createdAt: now,
    segments: data.segments,
    source: 'shared',
    navigationMode: data.mode,
  });
  return { transfer, favorite: null };
}
