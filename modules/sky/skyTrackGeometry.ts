import { getSkyPosition, type SkyDirection, type SkyObserver, type SkyTimeInterval } from './astronomy.ts';
import type { DeviceSkyOptics, DeviceSkyPose } from './deviceSkyCamera.ts';

type Vector = readonly [number, number, number];
export type TrackBody = 'sun' | 'moon';
export type TrackVisibility = 'visible' | 'hidden' | 'unknown';

export interface TrackSample {
  timeMs: number;
  sun: SkyDirection;
  moon: SkyDirection;
  label: boolean;
}

const rad = Math.PI / 180;
const stepMs = 5 * 60_000;
const labelIntervalMs = 2 * 60 * 60_000;
const near = 0.01;

export function sampleSkyTracks(day: SkyTimeInterval, observer: SkyObserver): TrackSample[] {
  if (!(Number.isFinite(day.startMs) && Number.isFinite(day.endMs) &&
      day.endMs > day.startMs && day.endMs - day.startMs <= 2 * 86_400_000)) return [];
  const samples: TrackSample[] = [];
  // Keep one continuous ephemeris through midnight, including a 23/25-hour DST day.
  for (let elapsed = 0; day.startMs + elapsed < day.endMs - 1; elapsed += stepMs) {
    const timeMs = day.startMs + elapsed;
    const { sun, moon } = getSkyPosition(timeMs, observer);
    samples.push({ timeMs, sun, moon, label: elapsed % labelIntervalMs === 0 });
  }
  const timeMs = day.endMs - 1;
  const { sun, moon } = getSkyPosition(timeMs, observer);
  samples.push({ timeMs, sun, moon, label: false });
  return samples;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

function direction(azimuth: number, altitude: number): Vector {
  const a = azimuth * rad;
  const h = altitude * rad;
  return [Math.cos(h) * Math.sin(a), Math.cos(h) * Math.cos(a), Math.sin(h)];
}

function dot(a: Vector, b: Vector) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function lerp(from: Vector, to: Vector, t: number): Vector {
  return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t];
}

/** Match the east/north/up camera basis and pinhole projection in skyScene.ts. */
export function makeTrackProjector(pose: DeviceSkyPose, optics: DeviceSkyOptics, width: number, height: number) {
  const forward = direction(pose.azimuth, pose.altitude);
  const levelRight = direction(pose.azimuth + 90, 0);
  const levelUp = direction(pose.azimuth, pose.altitude + 90);
  const c = Math.cos(pose.roll * rad);
  const s = Math.sin(pose.roll * rad);
  const right: Vector = [
    levelRight[0] * c + levelUp[0] * s,
    levelRight[1] * c + levelUp[1] * s,
    levelRight[2] * c + levelUp[2] * s,
  ];
  const up: Vector = [
    levelUp[0] * c - levelRight[0] * s,
    levelUp[1] * c - levelRight[1] * s,
    levelUp[2] * c - levelRight[2] * s,
  ];
  const tanHorizontal = Math.tan(optics.horizontalFov * rad / 2);
  const tanVertical = Math.tan(optics.verticalFov * rad / 2);

  function camera(point: SkyDirection): Vector {
    const ray = direction(point.azimuthDeg, point.altitudeDeg);
    return [dot(ray, right) / tanHorizontal, dot(ray, up) / tanVertical, dot(ray, forward)];
  }

  function screen(point: Vector): ScreenPoint {
    return { x: (1 + point[0] / point[2]) * width / 2, y: (1 - point[1] / point[2]) * height / 2 };
  }

  function planes([x, y, z]: Vector) {
    return [z - near, z + x, z - x, z + y, z - y];
  }

  function point(value: SkyDirection): ScreenPoint | null {
    const projected = camera(value);
    return planes(projected).every(value => value >= 0) ? screen(projected) : null;
  }

  function segment(from: SkyDirection, to: SkyDirection): [ScreenPoint, ScreenPoint] | null {
    const a = camera(from);
    const b = camera(to);
    const aPlanes = planes(a);
    const bPlanes = planes(b);
    let start = 0;
    let end = 1;
    for (let i = 0; i < aPlanes.length; i++) {
      const left = aPlanes[i];
      const right = bPlanes[i];
      if (left < 0 && right < 0) return null;
      if (left < 0) start = Math.max(start, left / (left - right));
      else if (right < 0) end = Math.min(end, left / (left - right));
      if (start >= end) return null;
    }
    return [screen(lerp(a, b, start)), screen(lerp(a, b, end))];
  }

  return { point, segment };
}

export function trackVisibility(point: SkyDirection, horizonAt: (azimuth: number) => number | null): TrackVisibility {
  const ridge = horizonAt(point.azimuthDeg);
  if (ridge === null) return 'unknown';
  return point.altitudeDeg >= ridge ? 'visible' : 'hidden';
}
