import { useMemo } from 'react';
import type { SkyObserver, SkyTimeInterval, SolarVisibilityEvent } from './astronomy';
import type { DeviceSkyOptics, DeviceSkyPose } from './deviceSkyCamera';
import {
  makeTrackProjector, sampleSkyTracks, trackVisibility,
  type ScreenPoint, type TrackBody, type TrackVisibility,
} from './skyTrackGeometry';
import { terrainHorizonAt, type TerrainHorizon } from './terrainHorizon';

interface Props {
  pose: DeviceSkyPose;
  optics: DeviceSkyOptics;
  day: SkyTimeInterval;
  observer: SkyObserver;
  terrain: TerrainHorizon | null;
  events: SolarVisibilityEvent[];
  /** Indicates that the supplied events came from the level reference horizon. */
  flatReference?: boolean;
  timeZone: string;
  width: number;
  height: number;
}

const bodies = ['sun', 'moon'] as const;
const stateOrder = ['unknown', 'hidden', 'visible'] as const;
const color = { sun: '#ffcd71', moon: '#c2ddff' };
const shadow = '#101a25';
const coordinate = ({ x, y }: ScreenPoint) => `${x.toFixed(1)} ${y.toFixed(1)}`;

interface Label extends ScreenPoint {
  key: string;
  text: string;
  width: number;
  body: TrackBody;
  priority: boolean;
  visibility?: TrackVisibility;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function intersects(a: Rect, b: Rect) {
  return a.x <= b.x + b.width && a.x + a.width >= b.x &&
    a.y <= b.y + b.height && a.y + a.height >= b.y;
}

function placeLabel(label: Label, frame: Rect, occupied: Rect[]): Rect | undefined {
  const offsets = label.priority
    ? [[12, -13], [-label.width - 12, -13], [-label.width / 2, -35], [-label.width / 2, 15],
      [12, -38], [-label.width - 12, -38], [12, 17], [-label.width - 12, 17]]
    : [[7, -19], [-label.width - 7, -19], [7, 5], [-label.width - 7, 5]];

  for (const [dx, dy] of offsets) {
    const x = Math.max(frame.x, Math.min(frame.x + frame.width - label.width, label.x + dx));
    const nativeY = label.y + dy;
    const y = label.priority ? Math.max(frame.y, Math.min(frame.y + frame.height - 23, nativeY)) : nativeY;
    const rect = { x, y, width: label.width, height: label.priority ? 23 : 16 };
    if (y < frame.y || y + rect.height > frame.y + frame.height) continue;
    if (occupied.some(item => intersects(item, rect))) continue;
    occupied.push(rect);
    return rect;
  }
  return undefined;
}

function EventMarker({ x, y, kind }: ScreenPoint & { kind: SolarVisibilityEvent['kind'] }) {
  const arrow = kind === 'rise' ? 'M-3 -1L0 -4l3 3M0-4v6' : 'M-3 -3L0 0l3-3M0-6v6';
  return <g transform={`translate(${x},${y})`}>
    <circle r="9" fill={shadow} stroke={color.sun} strokeWidth="1.5"/>
    <path d={`M-5 4H5 ${arrow}`} fill="none" stroke={color.sun} strokeWidth="1.4"
      strokeLinecap="round" strokeLinejoin="round"/>
  </g>;
}

export function SkyTracks({
  pose, optics, day, observer, terrain, events, flatReference, timeZone, width, height,
}: Props) {
  const { startMs, endMs } = day;
  const { latitude, longitude, elevationM } = observer;
  const samples = useMemo(() => sampleSkyTracks(
    { startMs, endMs }, { latitude, longitude, elevationM },
  ), [startMs, endMs, latitude, longitude, elevationM]);
  const clock = useMemo(() => new Intl.DateTimeFormat('zh-CN', {
    timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }), [timeZone]);
  const eventOnFlat = flatReference ?? !terrain;
  const tracks = useMemo(() => {
    function horizonAt(azimuth: number) {
      return terrain ? terrainHorizonAt(terrain, azimuth) : 0;
    }
    return bodies.map(body => {
      const points = samples.map(sample => ({
        direction: sample[body],
        visibility: trackVisibility(sample[body], horizonAt),
        text: sample.label ? clock.format(sample.timeMs) : '',
        timeMs: sample.timeMs,
      }));
      return { body, points };
    });
  }, [samples, terrain, clock]);

  const markers = useMemo(() => events.flatMap(event => {
    if (event.timeMs < startMs || event.timeMs >= endMs) return [];
    const altitudeDeg = eventOnFlat || !terrain ? 0 : terrainHorizonAt(terrain, event.azimuthDeg);
    if (altitudeDeg === null) return [];
    const qualifier = eventOnFlat ? '平地' : '山脊';
    const action = event.kind === 'rise' ? '日出' : '日落';
    return [{
      key: `${event.kind}-${event.timeMs}`, kind: event.kind,
      direction: { azimuthDeg: event.azimuthDeg, altitudeDeg },
      text: `${qualifier}${action} ${clock.format(event.timeMs)}`,
    }];
  }), [events, terrain, eventOnFlat, clock, startMs, endMs]);

  if (width <= 0 || height <= 0) return null;
  const project = makeTrackProjector(pose, optics, width, height);
  const paths = tracks.map(({ body, points }) => {
    const segments: Record<TrackVisibility, string[]> = { visible: [], hidden: [], unknown: [] };
    const lastEnd: Partial<Record<TrackVisibility, ScreenPoint>> = {};
    let priorVisibility: TrackVisibility | null = null;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      const ends = project.segment(a.direction, b.direction);
      if (!ends) {
        priorVisibility = null;
        continue;
      }
      const visibility = a.visibility === b.visibility ? a.visibility :
        a.visibility === 'unknown' || b.visibility === 'unknown' ? 'unknown' : 'hidden';
      const [start, end] = ends;
      const previous = lastEnd[visibility];
      const join = priorVisibility === visibility && previous &&
        Math.abs(previous.x - start.x) < 0.01 && Math.abs(previous.y - start.y) < 0.01;
      segments[visibility].push(`${join ? '' : `M${coordinate(start)}`}L${coordinate(end)}`);
      priorVisibility = visibility;
      lastEnd[visibility] = end;
    }
    return { body, segments };
  });

  const frame = { x: 9, y: Math.min(height * 0.15, 100), width: width - 18, height: height * 0.65 };
  const projectedMarkers = markers.flatMap(marker => {
    const point = project.point(marker.direction);
    return point ? [{ ...marker, ...point }] : [];
  });
  const occupied: Rect[] = projectedMarkers.map(({ x, y }) => ({ x: x - 8, y: y - 8, width: 16, height: 16 }));
  const labels: Label[] = projectedMarkers.map(marker => ({
    ...marker, body: 'sun', priority: true, width: 99,
  }));
  for (const { body, points } of tracks) {
    for (const sample of points) {
      if (!sample.text) continue;
      const point = project.point(sample.direction);
      if (point) labels.push({
        ...point, key: `${body}-${sample.timeMs}`, text: sample.text, body, priority: false, width: 40,
        visibility: sample.visibility,
      });
    }
  }

  return <svg aria-hidden="true" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{
    position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none',
  }}>
    {paths.flatMap(({ body, segments }) => stateOrder.map(visibility => {
      const path = segments[visibility].join('');
      if (!path) return null;
      return <g key={`${body}-${visibility}`} fill="none" strokeLinecap="round" strokeLinejoin="round"
        strokeDasharray={visibility === 'visible' ? undefined : visibility === 'hidden' ? '3 6' : '1 5'}
        opacity={visibility === 'hidden' ? .55 : visibility === 'unknown' ? .68 : .96}>
        <path d={path} stroke={shadow} strokeWidth="3.5"/>
        <path d={path} stroke={color[body]} strokeWidth="1.7"/>
      </g>;
    }))}
    {labels.sort((a, b) => Number(a.visibility === 'hidden') - Number(b.visibility === 'hidden')).map(label => {
      const rect = placeLabel(label, frame, occupied);
      if (!rect) return null;
      return <g key={label.key} opacity={label.visibility === 'hidden' ? .64 : 1}>
        {label.priority ? <>
          <path d={`M${label.x} ${label.y}L${Math.max(rect.x, Math.min(rect.x + rect.width, label.x))} ${rect.y + rect.height / 2}`}
            stroke={color[label.body]} strokeWidth=".8"/>
          <rect x={rect.x} y={rect.y} width={rect.width} height={rect.height} rx="4"
            fill={shadow} fillOpacity=".94" stroke={color[label.body]} strokeOpacity=".6"/>
        </> : <circle cx={label.x} cy={label.y} r="2" fill={color[label.body]} stroke={shadow}/>}
        <text x={rect.x + rect.width / 2} y={rect.y + (label.priority ? 15 : 11)}
          textAnchor="middle" fontSize={label.priority ? "11" : "11.5"} fontWeight="600"
          paintOrder="stroke" stroke={shadow} strokeWidth={label.priority ? 0 : 3}
          fill={color[label.body]}>{label.text}</text>
      </g>;
    })}
    {projectedMarkers.map(({ key, x, y, kind }) => <EventMarker key={key} x={x} y={y} kind={kind}/>)}
  </svg>;
}
