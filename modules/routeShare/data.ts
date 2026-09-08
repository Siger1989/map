import type { ManualTrack } from '../tracks/drawing';
import type {
  Coordinate,
  PlannedRoute,
  RoutePlace,
  TravelMode,
} from '../navigation/types';
import { trackDistance } from '../tracks/drawing.ts';
import { exportGPX, exportKML } from '../outdoor/exchange.ts';
export type ShareRoute = {
  name: string;
  segments: Coordinate[][];
  distance: number;
  duration: number | null;
  mode: TravelMode;
  stops: RoutePlace[];
  track?: ManualTrack;
  estimated: boolean;
  approach?: boolean;
};
export function sharePlanned(
  route: PlannedRoute,
  name = '导航路线',
  approach = false,
): ShareRoute {
  return {
    name,
    segments: [route.coordinates],
    distance: route.distance,
    duration: route.duration,
    mode: route.mode,
    stops: route.stops ?? [
      { name: '起点', coordinates: route.coordinates[0] },
      { name: '终点', coordinates: route.coordinates.at(-1)! },
    ],
    estimated: !!route.geometryKind,
    approach,
  };
}
export function shareTrack(track: ManualTrack): ShareRoute {
  const points = track.segments.flat();
  if (points.length < 2) throw new Error('至少两个轨迹点才能分享路线');
  return {
    name: track.name,
    segments: track.segments,
    distance: trackDistance(track.segments),
    duration: track.sharedRoute?.duration ?? null,
    mode: track.navigationMode ?? 'pedestrian',
    stops: track.sharedRoute?.stops ?? [
      { name: '起点', coordinates: points[0] },
      { name: '终点', coordinates: points.at(-1)! },
    ],
    track,
    estimated: true,
  };
}
export function routeFileText(data: ShareRoute, format: 'gpx' | 'kml') {
  const track: ManualTrack = data.track ?? {
    id: 'share',
    name: data.name,
    segments: data.segments,
    createdAt: Date.now(),
  };
  const transfer = {
    format: 'guanyun-backup' as const,
    version: 1 as const,
    tracks: [track],
    annotations: [],
    favorites: [],
  };
  return (format === 'gpx' ? exportGPX : exportKML)(transfer);
}
/** Minimal longitude arc: a route crossing 180 degrees must not shrink to a world map. */
export function routeBounds(segments: Coordinate[][]) {
  const points = segments.flat();
  if (points.length < 2) throw new Error('路线点不足');
  const longs = points
    .map((p) => ((p[0] % 360) + 360) % 360)
    .sort((a, b) => a - b);
  let gap = -1,
    start = 0;
  for (let i = 0; i < longs.length; i++) {
    const d =
      (i === longs.length - 1 ? longs[0] + 360 : longs[i + 1]) - longs[i];
    if (d > gap) {
      gap = d;
      start = (i + 1) % longs.length;
    }
  }
  const west = longs[start] > 180 ? longs[start] - 360 : longs[start],
    east = west + 360 - gap;
  return [
    [west, Math.min(...points.map((p) => p[1]))],
    [east, Math.max(...points.map((p) => p[1]))],
  ] as [Coordinate, Coordinate];
}
export function externalLegs(data: ShareRoute) {
  return data.stops.slice(1).map((to, i) => {
    const from = data.stops[i];
    const value = (p: RoutePlace) =>
      `${p.coordinates.join(',')},${p.name.replace(/[,;]/g, ' ')}`;
    const params = new URLSearchParams({
      from: value(from),
      to: value(to),
      mode: { auto: 'car', bicycle: 'ride', pedestrian: 'walk' }[data.mode],
      coordinate: 'wgs84',
      src: 'Shantu',
      callnative: '1',
    });
    return {
      name: `${from.name} → ${to.name}`,
      url: `https://uri.amap.com/navigation?${params}`,
    };
  });
}
