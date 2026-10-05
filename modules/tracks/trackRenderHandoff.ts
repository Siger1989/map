import type { Map as MapLibreMap } from 'maplibre-gl';
import type { Coordinate } from '../navigation/types';
import { DRAFT_ID } from './editing.ts';
import type { TrackOverlay } from './TrackLayer';

export type TrackRenderReceipt = {
  trackId: string;
  segments: Coordinate[][];
};

export type TrackRenderHandoffResult = 'rendered' | 'cancelled' | 'timeout';

type HandoffMap = Pick<MapLibreMap, 'on' | 'off' | 'getSource' | 'isSourceLoaded'>;

type TimerHost = {
  setTimeout: typeof globalThis.setTimeout;
  clearTimeout: typeof globalThis.clearTimeout;
};

export type TrackRenderHandoffOptions = {
  timeoutMs?: number;
  timers?: TimerHost;
};

const MANUAL_TRACKS_SOURCE = 'manual-tracks';
const DEFAULT_TIMEOUT_MS = 2000;

/**
 * Wait until a specific, already-synchronized track overlay has reached the
 * manual-tracks GeoJSON worker and a render occurs. Camera movement/removal
 * cancels the handoff so callers can clear any temporary screen-space line.
 */
export function waitForTrackRender(
  map: HandoffMap,
  readOverlay: () => TrackOverlay | null,
  receipt: TrackRenderReceipt,
  onDone: (result: TrackRenderHandoffResult) => void,
  options: TrackRenderHandoffOptions = {},
): () => void {
  const timers = options.timers ?? globalThis;
  let finished = false;
  let timeout: ReturnType<typeof globalThis.setTimeout> | null = null;

  const detach = () => {
    map.off('render', onRender);
    map.off('movestart', onCancel);
    map.off('resize', onCancel);
    map.off('remove', onCancel);
    if (timeout !== null) {
      timers.clearTimeout(timeout);
      timeout = null;
    }
  };
  const finish = (result: TrackRenderHandoffResult, notify: boolean) => {
    if (finished) return;
    finished = true;
    detach();
    if (notify) onDone(result);
  };
  const onRender = () => {
    if (finished) return;
    const overlay = readOverlay();
    const segments = receipt.trackId === DRAFT_ID
      ? overlay?.draft
      : overlay?.saved.find((track) => track.id === receipt.trackId)?.segments;
    if (
      segments !== receipt.segments ||
      !map.getSource(MANUAL_TRACKS_SOURCE) ||
      !map.isSourceLoaded(MANUAL_TRACKS_SOURCE)
    )
      return;
    finish('rendered', true);
  };
  const onCancel = () => finish('cancelled', true);

  map.on('render', onRender);
  map.on('movestart', onCancel);
  map.on('resize', onCancel);
  map.on('remove', onCancel);
  timeout = timers.setTimeout(
    () => finish('timeout', true),
    Math.max(0, options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  );

  return () => finish('cancelled', false);
}
