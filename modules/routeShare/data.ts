import type { ManualTrack } from '../tracks/drawing';
import type {
  Coordinate,
  PlannedRoute,
  RoutePlace,
  TravelMode,
} from '../navigation/types';
import { trackDistance, resolvedRouteTerminals } from '../tracks/drawing.ts';
import { exportGPX, exportKML } from '../outdoor/exchange.ts';
import type { Annotation } from '../annotations/data';
export type ShareRoute = {
  routingSource?: PlannedRoute['routingSource'];
  name: string;
  segments: Coordinate[][];
  distance: number;
  duration: number | null;
  mode: TravelMode;
  stops: RoutePlace[];
  track?: ManualTrack;
  sourceTracks?: ManualTrack[];
  markers?: Annotation[];
  estimated: boolean;
  approach?: boolean;
};
export function sharePlanned(
  route: PlannedRoute,
  name = '导航路线',
  approach = false,
): ShareRoute {
  return {
    routingSource: route.routingSource,
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
export function shareTrack(
  track: ManualTrack,
  annotations: Annotation[] = [],
  tracks: ManualTrack[] = [],
): ShareRoute {
  const points = track.segments.flat();
  if (points.length < 2) throw new Error('至少两个轨迹点才能分享路线');
  const [start, end] = resolvedRouteTerminals(track);
  const oldStops = track.sharedRoute?.stops;
  const same = (a: Coordinate, b: Coordinate) => a[0] === b[0] && a[1] === b[1];
  const first = start ?? points[0];
  const stops: RoutePlace[] = [{
    name: oldStops?.[0] && same(oldStops[0].coordinates, first) ? oldStops[0].name : '起点',
    coordinates: first,
  }];
  // A branch may have several valid tips. Until its end is chosen, only the
  // start is exported as a stop; the complete geometry remains in every file.
  if (end) {
    if (oldStops && oldStops.length > 2 &&
        same(oldStops[0].coordinates, first) && same(oldStops.at(-1)!.coordinates, end))
      stops.push(...oldStops.slice(1, -1));
    const oldEnd = oldStops?.at(-1);
    stops.push({
      name: oldEnd && same(oldEnd.coordinates, end) ? oldEnd.name : '终点',
      coordinates: end,
    });
  }
  return {
    name: track.name,
    segments: track.segments,
    distance: trackDistance(track.segments),
    duration: track.sharedRoute?.duration ?? null,
    mode: track.navigationMode ?? 'pedestrian',
    stops,
    track,
    sourceTracks: tracks.filter((t) => track.sourceTrackIds?.includes(t.id)),
    markers: annotations.filter(
      (a) =>
        a.trackAnchor &&
        [track.id, ...(track.sourceTrackIds ?? [])].includes(
          a.trackAnchor.trackId,
        ),
    ),
    estimated: true,
  };
}
/** Only confirmed stops receive start/end badges in a shared image. */
export function shareImageTerminals(data: ShareRoute) {
  const first = data.stops[0];
  const last = data.stops.length > 1 ? data.stops.at(-1) : undefined;
  return [
    ...(first ? [{ name: first.name, point: first.coordinates, label: '起点', color: '#087747' }] : []),
    ...(last ? [{ name: last.name, point: last.coordinates, label: '终点', color: '#ce3c45' }] : []),
  ];
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
    annotations: data.markers ?? [],
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
