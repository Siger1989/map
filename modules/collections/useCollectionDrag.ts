import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type RefObject,
} from 'react';

/** Handle-only pointer dragging works on touch screens while the list body remains scrollable. */
export function useCollectionDrag(
  root: RefObject<HTMLElement | null>,
  onDrop: (from: string, to: string) => void,
) {
  const [dragging, setDragging] = useState<string | null>(null),
    [target, setTarget] = useState<string | null>(null);
  const callback = useRef(onDrop);
  callback.current = onDrop;
  const active = useRef<{
    from: string;
    pointer: number;
    x: number;
    y: number;
    startX: number;
    startY: number;
    moved: boolean;
    target: string | null;
    frame: number;
  } | null>(null);
  const cancel = () => {
    if (active.current) cancelAnimationFrame(active.current.frame);
    active.current = null;
    setDragging(null);
    setTarget(null);
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && active.current) {
        e.preventDefault();
        e.stopPropagation();
        cancel();
      }
    };
    window.addEventListener('keydown', key, true);
    window.addEventListener('blur', cancel);
    const extraTouch = (e: globalThis.PointerEvent) => {
      if (active.current && e.pointerType === 'touch' && !e.isPrimary) cancel();
    };
    window.addEventListener('pointerdown', extraTouch, true);
    return () => {
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('pointerdown', extraTouch, true);
      if (active.current) cancelAnimationFrame(active.current.frame);
    };
  }, []);
  const hit = () => {
    const d = active.current;
    if (!d?.moved) return;
    const el = document
      .elementsFromPoint(d.x, d.y)
      .find(
        (el) =>
          el instanceof HTMLElement &&
          el.closest('[data-collection-target]') &&
          root.current?.contains(el),
      ) as HTMLElement | undefined;
    d.target =
      el?.closest<HTMLElement>('[data-collection-target]')?.dataset
        .collectionTarget ?? null;
    setTarget(d.target);
  };
  const finish = (e: PointerEvent<HTMLButtonElement>, aborted = false) => {
    const d = active.current;
    if (!d || e.pointerId !== d.pointer) return;
    hit();
    cancel();
    if (!aborted && d.moved && d.target && d.from !== d.target)
      callback.current(d.from, d.target);
  };
  const handle = (from: string) => ({
    onPointerDown: (e: PointerEvent<HTMLButtonElement>) => {
      if (!e.isPrimary || e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      active.current = {
        from,
        pointer: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        startX: e.clientX,
        startY: e.clientY,
        moved: false,
        target: null,
        frame: 0,
      };
      const scroll = () => {
        const d = active.current;
        if (!d) return;
        if (d.moved)
          root.current
            ?.querySelectorAll<HTMLElement>('[data-collection-scroll]')
            .forEach((el) => {
              const r = el.getBoundingClientRect();
              if (
                d.x < r.left ||
                d.x > r.right ||
                d.y < r.top ||
                d.y > r.bottom
              )
                return;
              if (el.dataset.collectionScroll === 'x')
                el.scrollLeft +=
                  d.x < r.left + 28 ? -6 : d.x > r.right - 28 ? 6 : 0;
              else
                el.scrollTop +=
                  d.y < r.top + 28 ? -6 : d.y > r.bottom - 28 ? 6 : 0;
            });
        hit();
        d.frame = requestAnimationFrame(scroll);
      };
      active.current.frame = requestAnimationFrame(scroll);
    },
    onPointerMove: (e: PointerEvent<HTMLButtonElement>) => {
      const d = active.current;
      if (!d || d.pointer !== e.pointerId) return;
      d.x = e.clientX;
      d.y = e.clientY;
      if (!d.moved && Math.hypot(d.x - d.startX, d.y - d.startY) >= 6) {
        d.moved = true;
        setDragging(from);
      }
      hit();
    },
    onPointerUp: (e: PointerEvent<HTMLButtonElement>) => finish(e),
    onPointerCancel: (e: PointerEvent<HTMLButtonElement>) => finish(e, true),
    onLostPointerCapture: (e: PointerEvent<HTMLButtonElement>) =>
      finish(e, true),
    onClick: (e: React.MouseEvent<HTMLButtonElement>) => e.preventDefault(),
  });
  return { dragging, target, handle };
}
