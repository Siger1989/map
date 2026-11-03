import type { ViewState } from './types';

export type CameraSummary = { view: ViewState; center: [number, number] };

type Timer = ReturnType<typeof setTimeout>;
type CameraSummaryTimers = {
  set: (callback: () => void, delay: number) => Timer;
  clear: (timer: Timer) => void;
};

const sameCameraSummary = (a: CameraSummary, b: CameraSummary) =>
  a.view.bearing === b.view.bearing && a.view.pitch === b.view.pitch && a.view.zoom === b.view.zoom &&
  a.center[0] === b.center[0] && a.center[1] === b.center[1];

const copyCameraSummary = (value: CameraSummary): CameraSummary => ({
  view: { ...value.view },
  center: [value.center[0], value.center[1]],
});

/** Publish the first camera summary immediately, then at most once per interval with a trailing latest value. */
export function createCameraSummaryPublisher(
  publish: (value: CameraSummary) => void,
  interval = 100,
  now: () => number = () => performance.now(),
  timers: CameraSummaryTimers = {
    set: (callback, delay) => globalThis.setTimeout(callback, delay),
    clear: timer => globalThis.clearTimeout(timer),
  },
) {
  if (!Number.isFinite(interval) || interval < 0) throw new RangeError('Camera summary interval must be non-negative');

  let lastPublished: CameraSummary | null = null;
  let publishedAt = -Infinity;
  let pending: CameraSummary | null = null;
  let timer: Timer | null = null;
  let generation = 0;

  const clearTimer = () => {
    generation++;
    if (timer !== null) timers.clear(timer);
    timer = null;
  };

  const emit = (value: CameraSummary) => {
    const snapshot = copyCameraSummary(value);
    pending = null;
    lastPublished = snapshot;
    publishedAt = now();
    publish(copyCameraSummary(snapshot));
  };

  const scheduleTrailing = () => {
    if (timer !== null || pending === null) return;
    const scheduledGeneration = ++generation;
    const delay = Math.max(0, interval - (now() - publishedAt));
    timer = timers.set(() => {
      if (scheduledGeneration !== generation) return;
      timer = null;
      const value = pending;
      if (value !== null) emit(value);
    }, delay);
  };

  return {
    push(value: CameraSummary) {
      const previous = pending ?? lastPublished;
      if (previous && sameCameraSummary(previous, value)) return;
      if (!lastPublished || now() - publishedAt >= interval) {
        clearTimer();
        emit(value);
        return;
      }
      if (lastPublished && sameCameraSummary(lastPublished, value)) {
        pending = null;
        clearTimer();
        return;
      }
      pending = copyCameraSummary(value);
      scheduleTrailing();
    },
    flush(finalValue?: CameraSummary) {
      if (finalValue !== undefined) pending = copyCameraSummary(finalValue);
      clearTimer();
      const value = pending;
      if (value === null || (lastPublished && sameCameraSummary(lastPublished, value))) {
        pending = null;
        return false;
      }
      emit(value);
      return true;
    },
    /** Cancel a queued trailing callback; the publisher remains reusable for a later map generation. */
    cancel() {
      clearTimer();
      pending = null;
    },
    get queued() { return pending !== null; },
  };
}

/** Map gestures stay native; only the surrounding React controls are throttled. */
export function cameraViewPublisher(
  publish: (view: ViewState) => void,
  now: () => number = () => performance.now(),
) {
  let previous: ViewState | null = null;
  let publishedAt = -Infinity;
  return (view: ViewState, final = false) => {
    if (previous && previous.bearing === view.bearing &&
        previous.pitch === view.pitch && previous.zoom === view.zoom) return;
    const time = now();
    if (!final && time - publishedAt < 100) return;
    previous = { ...view };
    publishedAt = time;
    publish(view);
  };
}
