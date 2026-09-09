import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
type Target = {
  id: string;
  position: 'inside' | 'before' | 'after';
  name: string;
};
type Drag = {
  ids: string[];
  label: string;
  x: number;
  y: number;
  target: Target | null;
};
/** Short swipes scroll normally; a stationary hold starts an explicit, cancellable drag. */
export function useWorkbenchLongPress(
  list: RefObject<HTMLDivElement | null>,
  onDrop: (ids: string[], target: Target) => void,
) {
  const [drag, setDrag] = useState<Drag | null>(null),
    callback = useRef(onDrop),
    cancel = useRef<() => void>(() => {}),
    suppressUntil = useRef(0);
  callback.current = onDrop;
  useEffect(() => () => cancel.current(), []);
  const start = (
    e: ReactPointerEvent<HTMLButtonElement>,
    ids: string[],
    label: string,
  ) => {
    if (e.button !== 0 || !e.isPrimary || !ids.length) return;
    cancel.current();
    const button = e.currentTarget,
      pointer = e.pointerId,
      x0 = e.clientX,
      y0 = e.clientY;
    let x = x0,
      y = y0,
      started = false,
      ended = false,
      frame = 0,
      hoverId = '',
      hoverAt = 0,
      last = performance.now(),
      target: Target | null = null;
    const hit = () => {
      const container = list.current,
        bounds = container?.getBoundingClientRect();
      if (
        !container ||
        !bounds ||
        x < bounds.left ||
        x > bounds.right ||
        y < bounds.top ||
        y > bounds.bottom
      ) {
        target = null;
        return;
      }
      const el = document
        .elementsFromPoint(x, y)
        .map((el) => el.closest<HTMLElement>('[data-workbench-drop]'))
        .find((el) => el && container.contains(el));
      if (!el) {
        target = null;
        return;
      }
      const rect = el.getBoundingClientRect(),
        fraction = (y - rect.top) / rect.height;
      target = {
        id: el.dataset.workbenchDrop!,
        name: el.dataset.dropName!,
        position:
          el.dataset.dropFolder === 'true' && fraction > 0.22 && fraction < 0.78
            ? 'inside'
            : fraction < 0.5
              ? 'before'
              : 'after',
      };
      if (ids.includes(target.id)) {
        target = null;
        return;
      }
      if (target.position === 'inside' && el.dataset.dropOpen === 'false') {
        if (hoverId !== target.id) {
          hoverId = target.id;
          hoverAt = performance.now();
        } else if (performance.now() - hoverAt > 700) {
          el.querySelector<HTMLButtonElement>('.workbench-item-open')?.click();
          hoverAt = Infinity;
        }
      } else hoverId = '';
    };
    const tick = (time: number) => {
      if (ended || !started) return;
      const container = list.current,
        b = container?.getBoundingClientRect();
      if (
        container &&
        b &&
        x >= b.left &&
        x <= b.right &&
        y >= b.top &&
        y <= b.bottom
      ) {
        const speed = y < b.top + 32 ? -1 : y > b.bottom - 32 ? 1 : 0;
        container.scrollTop += speed * Math.min(32, time - last) * 0.45;
      }
      last = time;
      hit();
      setDrag({ ids, label, x, y, target });
      frame = requestAnimationFrame(tick);
    };
    const finish = (save = false) => {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', abort);
      window.removeEventListener('blur', abort);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('pointerdown', second, true);
      document.removeEventListener('touchmove', touch);
      if (button.hasPointerCapture(pointer))
        button.releasePointerCapture(pointer);
      if (started) {
        suppressUntil.current = performance.now() + 350;
        setDrag(null);
        if (save && target) callback.current(ids, target);
      }
    };
    const move = (event: PointerEvent) => {
      if (event.pointerId !== pointer) return;
      x = event.clientX;
      y = event.clientY;
      if (!started && Math.hypot(x - x0, y - y0) > 8) finish();
      else if (started) {
        event.preventDefault();
        hit();
      }
    };
    const up = (event: PointerEvent) => {
      if (event.pointerId === pointer) {
        hit();
        finish(true);
      }
    };
    const abort = () => finish();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        finish();
      }
    };
    const second = (event: PointerEvent) => {
      if (event.pointerId !== pointer) finish();
    };
    const touch = (event: TouchEvent) => {
      if (started) event.preventDefault();
    };
    const timer = setTimeout(() => {
      if (ended) return;
      started = true;
      button.setPointerCapture(pointer);
      hit();
      setDrag({ ids, label, x, y, target });
      frame = requestAnimationFrame(tick);
    }, 450);
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', abort);
    window.addEventListener('blur', abort);
    window.addEventListener('keydown', key, true);
    window.addEventListener('pointerdown', second, true);
    document.addEventListener('touchmove', touch, { passive: false });
    cancel.current = abort;
  };
  return {
    drag,
    start,
    suppressClick: () => performance.now() < suppressUntil.current,
  };
}
