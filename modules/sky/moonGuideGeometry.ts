import { getSkyPosition, type SkyDirection, type SkyObserver, type SkyTimeInterval } from './astronomy.ts';
import type { DeviceSkyOptics, DeviceSkyPose } from './deviceSkyCamera.ts';
import { makeTrackProjector, type ScreenPoint } from './skyTrackGeometry.ts';
import { terrainHorizonAt, type TerrainHorizon } from './terrainHorizon.ts';

export interface MoonGuide {
  state: 'visible' | 'outside' | 'below' | 'blocked' | 'unknown' | 'unaligned';
  message: string;
  point: ScreenPoint | null;
}

interface GuideOptions {
  moon: SkyDirection;
  pose: DeviceSkyPose | null;
  optics: DeviceSkyOptics | null;
  terrain: TerrainHorizon | null;
  width: number;
  height: number;
}

type MoonVisibility = 'clear' | 'below' | 'blocked' | 'unknown';

function moonVisibility(moon: SkyDirection, terrain: TerrainHorizon | null, flatReference: boolean): MoonVisibility {
  const ridge = terrain ? terrainHorizonAt(terrain, moon.azimuthDeg) : flatReference ? 0 : null;
  if (ridge === null) return moon.altitudeDeg < 0 ? 'below' : 'unknown';
  if (moon.altitudeDeg >= ridge) return 'clear';
  return moon.altitudeDeg < 0 ? 'below' : 'blocked';
}

export function getMoonGuide({ moon, pose, optics, terrain, width, height }: GuideOptions): MoonGuide {
  const visibility = moonVisibility(moon, terrain, false);
  if (visibility === 'below') return { state: 'below', message: '月亮在地平线下', point: null };
  if (visibility === 'blocked') return { state: 'blocked', message: '月亮在山脊后', point: null };

  if (!pose || !optics || width <= 0 || height <= 0) {
    return { state: 'unaligned', message: visibility === 'unknown'
      ? '月亮已升起，遮挡与镜头对齐待确认'
      : '月亮已升起，等待镜头对齐', point: null };
  }

  const point = makeTrackProjector(pose, optics, width, height).point(moon);
  const yaw = ((moon.azimuthDeg - pose.azimuth + 540) % 360) - 180;
  const rad = Math.PI / 180;
  const target = moon.altitudeDeg * rad;
  const camera = pose.altitude * rad;
  const roll = pose.roll * rad;
  const sideways = Math.cos(target) * Math.sin(yaw * rad);
  const upward = Math.sin(target) * Math.cos(camera) - Math.cos(target) * Math.cos(yaw * rad) * Math.sin(camera);
  const horizontal = (sideways * Math.cos(roll) + upward * Math.sin(roll)) / Math.tan(optics.horizontalFov * rad / 2);
  const vertical = (upward * Math.cos(roll) - sideways * Math.sin(roll)) / Math.tan(optics.verticalFov * rad / 2);
  const direction = Math.abs(yaw) > 150 && Math.abs(moon.altitudeDeg) < 60
    ? '转身'
    : Math.abs(horizontal) >= Math.abs(vertical)
      ? (horizontal < 0 ? '向左转' : '向右转')
      : (vertical > 0 ? '抬头' : '向下看');

  if (visibility === 'unknown') {
    return {
      state: 'unknown',
      message: point ? '月亮方向在画面内，遮挡未知' : `${direction}找月亮，遮挡未知`,
      point: null,
    };
  }
  if (point) return { state: 'visible', message: '月亮在画面内', point };
  return { state: 'outside', message: `${direction}找月亮`, point: null };
}

type Preview =
  | { status: 'found'; timeMs: number; moon: SkyDirection; flatReference: boolean; relation: 'current' | 'next' | 'earlier' }
  | { status: 'none' | 'unknown' };

export function findMoonPreview(day: SkyTimeInterval, observer: SkyObserver, terrain: TerrainHorizon | null, timeMs: number): Preview {
  const { startMs, endMs } = day;
  if (!(Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs &&
      endMs - startMs <= 2 * 86_400_000 && Number.isFinite(timeMs))) return { status: 'unknown' };
  const selected = Math.max(startMs, Math.min(endMs - 1, timeMs));
  const flatReference = terrain === null;
  const cadence = 60_000;
  let unknown = false;

  function sample(timestamp: number) {
    const moon = getSkyPosition(timestamp, observer).moon;
    const visibility = moonVisibility(moon, terrain, flatReference);
    unknown ||= visibility === 'unknown';
    return { moon, visibility };
  }

  function seek(sign: 1 | -1, end: number): Preview | null {
    let previous = selected;
    while (previous !== end) {
      const timestamp = sign > 0 ? Math.min(end, previous + cadence) : Math.max(end, previous - cadence);
      let current = sample(timestamp);
      if (current.visibility === 'clear') {
        // Tighten the observed state transition to avoid skipping a whole minute.
        let hiddenTime = previous;
        let clearTime = timestamp;
        while (Math.abs(clearTime - hiddenTime) > 1000) {
          const mid = Math.floor((clearTime + hiddenTime) / 2);
          const candidate = sample(mid);
          if (candidate.visibility === 'clear') {
            clearTime = mid;
            current = candidate;
          } else {
            hiddenTime = mid;
          }
        }
        return { status: 'found', timeMs: clearTime, moon: current.moon, flatReference, relation: sign > 0 ? 'next' : 'earlier' };
      }
      previous = timestamp;
    }
    return null;
  }

  const current = sample(selected);
  if (current.visibility === 'clear') {
    return { status: 'found', timeMs: selected, moon: current.moon, flatReference, relation: 'current' };
  }
  return seek(1, endMs - 1) ?? seek(-1, startMs) ?? { status: unknown ? 'unknown' : 'none' };
}
