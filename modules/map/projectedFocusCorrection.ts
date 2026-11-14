import type { Coordinate } from '../navigation/types.ts';
import { LngLat, Point } from 'maplibre-gl';

export type ProjectedPoint = { x: number; y: number };

export function projectedFocusError(actual: ProjectedPoint, desired: ProjectedPoint, tolerance = 1): ProjectedPoint | null {
  const error = { x: actual.x - desired.x, y: actual.y - desired.y };
  if (![error.x, error.y].every(Number.isFinite) || Math.hypot(error.x, error.y) <= tolerance) return null;
  return error;
}

type FocusTransform = {
  setLocationAtPoint: (location: LngLat, point: Point, elevation?: number) => void;
  center: LngLat;
};

type CorrectableMap = {
  project: (coordinate: Coordinate) => ProjectedPoint;
  isMoving: () => boolean;
  on: (type: 'movestart' | 'moveend' | 'idle', listener: () => void) => unknown;
  off: (type: 'movestart' | 'moveend' | 'idle', listener: () => void) => unknown;
  getContainer: () => { clientWidth: number; clientHeight: number };
  queryTerrainElevation: (coordinate: Coordinate) => number | null;
  jumpTo: (camera: { center: Coordinate | LngLat }) => unknown;
  _camera?: { getTransformForUpdate?: () => { clone: () => FocusTransform } };
};

type FrameDriver = {
  request: (callback: () => void) => number;
  cancel: (id: number) => void;
};

const browserFrames: FrameDriver = {
  request: callback => requestAnimationFrame(callback),
  cancel: id => cancelAnimationFrame(id),
};

/** Places a terrain point at its requested screen pixel using MapLibre's transform solver. */
export function installProjectedFocusCorrection(
  map: CorrectableMap,
  coordinate: Coordinate,
  offset: [number, number] | (() => [number, number] | null),
  frames: FrameDriver = browserFrames,
  maxCorrections = 6,
  tolerance = 1,
  settleWindowMs = 900,
): () => void {
  let active = true;
  let correctionCount = 0;
  let frameId: number | null = null;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  let applyingCorrection = false;
  let reachedIdle = false;
  const settleDeadline = Date.now() + Math.max(0, settleWindowMs);

  const cleanup = () => {
    if (!active) return;
    active = false;
    map.off('movestart', onMoveStart);
    map.off('moveend', onMoveEnd);
    map.off('idle', onIdle);
    if (frameId !== null) frames.cancel(frameId);
    frameId = null;
    if (settleTimer !== null) clearTimeout(settleTimer);
    settleTimer = null;
  };

  const correct = () => {
    frameId = null;
    if (!active) return;
    const { clientWidth, clientHeight } = map.getContainer();
    const actual = map.project(coordinate);
    const currentOffset = typeof offset === 'function' ? offset() : offset;
    if (!currentOffset) {
      cleanup();
      return;
    }
    const desired = {
      x: clientWidth / 2 + currentOffset[0],
      y: clientHeight / 2 + currentOffset[1],
    };
    const error = projectedFocusError(actual, desired, tolerance);
    const terrainElevation = map.queryTerrainElevation(coordinate);
    if (!error) {
      if (!reachedIdle) return;
      const remaining = settleDeadline - Date.now();
      if (remaining <= 0 || settleWindowMs <= 0) {
        cleanup();
        return;
      }
      if (settleTimer === null) {
        settleTimer = setTimeout(() => {
          settleTimer = null;
          if (!active) return;
          reachedIdle = !map.isMoving();
          if (reachedIdle) scheduleCorrection();
        }, remaining);
      }
      return;
    }
    if (correctionCount >= maxCorrections) {
      cleanup();
      return;
    }

    // MapLibre's transform solver accounts for the target's terrain elevation and
    // pitched projection. panBy's pixel offset is only an approximation at high pitch.
    const transform = map._camera?.getTransformForUpdate?.().clone();
    if (!transform) {
      cleanup();
      return;
    }
    transform.setLocationAtPoint(
      LngLat.convert(coordinate),
      new Point(desired.x, desired.y),
      terrainElevation ?? 0,
    );
    correctionCount += 1;
    reachedIdle = false;
    applyingCorrection = true;
    map.jumpTo({ center: transform.center });
    applyingCorrection = false;
  };

  const scheduleCorrection = () => {
    if (!active || frameId !== null) return;
    frameId = frames.request(correct);
  };
  const onMoveStart = () => {
    if (!applyingCorrection) cleanup();
  };
  const onMoveEnd = () => {
    reachedIdle = false;
    scheduleCorrection();
  };
  const onIdle = () => {
    reachedIdle = true;
    scheduleCorrection();
  };

  map.on('movestart', onMoveStart);
  map.on('moveend', onMoveEnd);
  map.on('idle', onIdle);
  if (!map.isMoving()) {
    reachedIdle = true;
    scheduleCorrection();
  }
  return cleanup;
}
