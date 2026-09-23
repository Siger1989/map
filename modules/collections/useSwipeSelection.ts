import {
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from 'react';

/** Drag exclusively from the checkbox gutter; normal list gestures remain native scrolling. */
export function useSwipeSelection(
  paint: (keys: string[], checked: boolean) => void,
) {
  const list = useRef<HTMLDivElement>(null),
    callback = useRef(paint);
  callback.current = paint;
  const stop = useRef<() => void>(() => {});
  useEffect(() => () => stop.current(), []);
  const start = (
    event: ReactPointerEvent<HTMLButtonElement>,
    checked: boolean,
  ) => {
    if (event.button !== 0 || !list.current) return;
    stop.current();
    event.preventDefault();
    const button = event.currentTarget,
      container = list.current,
      pointerId = event.pointerId;
    let y = event.clientY,
      previous = button.dataset.selectKey!,
      frame = 0,
      ended = false;
    const apply = () => {
      const bounds = container.getBoundingClientRect();
      const rows = Array.from(
        container.querySelectorAll<HTMLElement>('[data-select-key]'),
      );
      const target = rows.find((row) => {
        const r = row.getBoundingClientRect();
        return y >= r.top && y <= r.bottom;
      });
      const key = target?.dataset.selectKey;
      if (key) {
        const from = rows.findIndex(
            (row) => row.dataset.selectKey === previous,
          ),
          to = rows.indexOf(target!);
        callback.current(
          rows
            .slice(Math.max(0, Math.min(from, to)), Math.max(from, to) + 1)
            .map((row) => row.dataset.selectKey!),
          checked,
        );
        previous = key;
      }
      return bounds;
    };
    callback.current([previous], checked);
    button.setPointerCapture(pointerId);
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      e.preventDefault();
      y = e.clientY;
      apply();
    };
    let lastTime = performance.now();
    const tick = (time: number) => {
      if (ended) return;
      const b = container.getBoundingClientRect(),
        edge = Math.min(40, b.height / 4);
      const speed =
        y < b.top + edge
          ? -Math.min(1, (b.top + edge - y) / edge)
          : y > b.bottom - edge
            ? Math.min(1, (y - b.bottom + edge) / edge)
            : 0;
      if (speed) {
        container.scrollTop += speed * Math.min(32, time - lastTime) * 0.45;
        apply();
      }
      lastTime = time;
      frame = requestAnimationFrame(tick);
    };
    const finish = (e?: PointerEvent) => {
      if (e && e.pointerId !== pointerId) return;
      ended = true;
      cancelAnimationFrame(frame);
      button.removeEventListener('pointermove', move);
      button.removeEventListener('pointerup', finish);
      button.removeEventListener('pointercancel', finish);
      button.removeEventListener('lostpointercapture', finish);
      if (button.hasPointerCapture(pointerId))
        button.releasePointerCapture(pointerId);
    };
    button.addEventListener('pointermove', move, { passive: false });
    button.addEventListener('pointerup', finish);
    button.addEventListener('pointercancel', finish);
    button.addEventListener('lostpointercapture', finish);
    stop.current = finish;
    frame = requestAnimationFrame(tick);
  };
  return { list, start };
}

/** Horizontal touch gesture on a folder name; vertical list scrolling stays native. */
export function folderVisibilityGesture(dx: number, dy: number): boolean | null {
  return Math.abs(dx) >= 64 && Math.abs(dx) >= Math.abs(dy) * 1.5
    ? dx > 0
    : null;
}

export function useFolderVisibilitySwipe(
  onSwipe: (ids: string[], visible: boolean) => void,
) {
  const callback = useRef(onSwipe);
  const cleanup = useRef<() => void>(() => {});
  const suppressed = useRef<{ key: string; until: number } | null>(null);
  callback.current = onSwipe;
  useEffect(() => () => cleanup.current(), []);

  const start = (
    event: ReactPointerEvent<HTMLButtonElement>,
    ids: string[],
    key: string,
  ) => {
    if (event.pointerType === 'mouse' || !event.isPrimary || !ids.length) return;
    cleanup.current();
    const pointer = event.pointerId;
    const x = event.clientX, y = event.clientY;
    let lastX = x, lastY = y;
    const finish = (apply: boolean) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', cancel);
      if (!apply) return;
      const dx = lastX - x, dy = lastY - y;
      const visible = folderVisibilityGesture(dx, dy);
      if (visible === null) return;
      suppressed.current = { key, until: performance.now() + 500 };
      callback.current(ids, visible);
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return;
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return;
      lastX = e.clientX;
      lastY = e.clientY;
      finish(true);
    };
    const cancel = () => finish(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', cancel);
    cleanup.current = cancel;
  };
  return {
    start,
    suppressClick: (key: string) =>
      suppressed.current?.key === key &&
      performance.now() < suppressed.current.until,
  };
}
