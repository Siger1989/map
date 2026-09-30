import {
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';

/** Drag from a dedicated action gutter; names retain native list scrolling. */
export function useSwipeSelection(
  paint: (keys: string[], checked: boolean) => void,
  options?: {
    keyAttribute?: string;
    list?: RefObject<HTMLDivElement | null>;
    onEnd?: (completed: boolean) => void;
  },
) {
  const ownList = useRef<HTMLDivElement>(null),
    callback = useRef(paint);
  const list = options?.list ?? ownList;
  const keyAttribute = options?.keyAttribute ?? 'data-select-key';
  const onEnd = useRef(options?.onEnd);
  onEnd.current = options?.onEnd;
  callback.current = paint;
  const stop = useRef<() => void>(() => {});
  useEffect(() => () => stop.current(), []);
  const start = (
    event: ReactPointerEvent<HTMLButtonElement>,
    checked: boolean,
  ) => {
    if (event.button !== 0 || !event.isPrimary || event.currentTarget.disabled || !list.current) return;
    stop.current();
    event.preventDefault();
    const button = event.currentTarget,
      container = list.current,
      pointerId = event.pointerId;
    let y = event.clientY,
      previous = button.getAttribute(keyAttribute)!,
      frame = 0,
      ended = false;
    const apply = () => {
      const bounds = container.getBoundingClientRect();
      const rows = Array.from(
        container.querySelectorAll<HTMLButtonElement>(`[${keyAttribute}]`),
      ).filter((row) => !row.disabled);
      const target = rows.find((row) => {
        const r = row.getBoundingClientRect();
        return y >= r.top && y <= r.bottom;
      });
      const key = target?.getAttribute(keyAttribute);
      if (key) {
        const from = rows.findIndex(
            (row) => row.getAttribute(keyAttribute) === previous,
          ),
          to = rows.indexOf(target!);
        callback.current(
          rows
            .slice(Math.max(0, Math.min(from, to)), Math.max(from, to) + 1)
            .map((row) => row.getAttribute(keyAttribute)!),
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
      if (ended) return;
      ended = true;
      cancelAnimationFrame(frame);
      button.removeEventListener('pointermove', move);
      button.removeEventListener('pointerup', finish);
      button.removeEventListener('pointercancel', finish);
      button.removeEventListener('lostpointercapture', finish);
      window.removeEventListener('blur', blur);
      if (button.hasPointerCapture(pointerId))
        button.releasePointerCapture(pointerId);
      onEnd.current?.(e?.type === 'pointerup');
    };
    const blur = () => finish();
    button.addEventListener('pointermove', move, { passive: false });
    button.addEventListener('pointerup', finish);
    button.addEventListener('pointercancel', finish);
    button.addEventListener('lostpointercapture', finish);
    window.addEventListener('blur', blur);
    stop.current = finish;
    frame = requestAnimationFrame(tick);
  };
  return { list, start, cancel: () => stop.current() };
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
