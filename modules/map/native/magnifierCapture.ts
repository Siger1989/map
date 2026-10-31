import type { ScreenPoint } from '../../tracks/drawing.ts';

/** Keeps native PixelCopy plus bridge/JPEG work single-flight and rate limited. */
export function createMagnifierCapturePump<TFrame>(
  capture: (signal: AbortSignal) => Promise<TFrame>,
  draw: (frame: TFrame, point: ScreenPoint) => void,
  minimumIntervalMs = 125,
  onError: (error: unknown) => void = () => {},
  retryIntervalMs = 750,
) {
  let disposed = false;
  let inFlight = false;
  let dirty = false;
  let latestPoint: ScreenPoint | null = null;
  let lastStartedAt = Number.NEGATIVE_INFINITY;
  let retryAfterAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let abort: AbortController | null = null;

  const schedule = () => {
    if (disposed || inFlight || !dirty || timer !== null) return;
    const now = Date.now();
    const wait = Math.max(0, minimumIntervalMs - (now - lastStartedAt), retryAfterAt - now);
    if (wait > 0) {
      timer = setTimeout(() => {
        timer = null;
        schedule();
      }, wait);
      return;
    }
    dirty = false;
    inFlight = true;
    lastStartedAt = Date.now();
    const controller = new AbortController();
    abort = controller;
    void capture(controller.signal).then((frame) => {
      const point = latestPoint;
      retryAfterAt = 0;
      if (!disposed && point) draw(frame, point);
    }).catch((error: unknown) => {
      if (!disposed && (error as Error)?.name !== 'AbortError') {
        try { onError(error); } catch { /* Capture retries must not depend on UI reporting. */ }
        dirty = true;
        retryAfterAt = Date.now() + Math.max(0, retryIntervalMs);
      }
    }).finally(() => {
      if (abort === controller) abort = null;
      inFlight = false;
      schedule();
    });
  };

  return {
    update(point: ScreenPoint) {
      if (disposed || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
      latestPoint = { ...point };
      dirty = true;
      schedule();
    },
    dispose() {
      disposed = true;
      dirty = false;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      abort?.abort();
      abort = null;
    },
  };
}
