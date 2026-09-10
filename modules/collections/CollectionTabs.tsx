import { useEffect, useRef, useState, type PointerEvent } from 'react';
import {
  COLLECTION_TABS,
  completeTabOrder,
  moveCollectionTab,
  type CollectionTab,
} from './tabOrder';

type Props = {
  order?: CollectionTab[];
  selected: string;
  regions: boolean;
  disabled?: boolean;
  onSelect: (key: CollectionTab) => void;
  onReorder: (order: CollectionTab[]) => boolean;
};
type Gesture = {
  pointer: number;
  key: CollectionTab;
  x: number;
  y: number;
  lastX: number;
  mouse: boolean;
  moved: boolean;
  dragging: boolean;
  order: CollectionTab[];
};
/** Touch pans immediately; stationary long press enters reorder. Capture stays on the stable nav. */
export function CollectionTabs(props: Props) {
  const nav = useRef<HTMLElement>(null),
    gesture = useRef<Gesture | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [preview, setPreview] = useState<CollectionTab[] | null>(null),
    [dragged, setDragged] = useState<CollectionTab | null>(null);
  const order = completeTabOrder(props.order);
  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const cancel = () => {
    clearTimer();
    const g = gesture.current;
    gesture.current = null;
    if (g && nav.current?.hasPointerCapture(g.pointer))
      nav.current.releasePointerCapture(g.pointer);
    setPreview(null);
    setDragged(null);
  };
  useEffect(() => {
    window.addEventListener('blur', cancel);
    return () => {
      clearTimer();
      window.removeEventListener('blur', cancel);
    };
  }, []);
  const startDrag = () => {
    const g = gesture.current;
    if (!g) return;
    clearTimer();
    g.dragging = true;
    g.moved = true;
    setDragged(g.key);
    setPreview(g.order);
  };
  const move = (e: PointerEvent<HTMLElement>) => {
    const g = gesture.current,
      el = nav.current;
    if (!g || !el || g.pointer !== e.pointerId) return;
    const distance = Math.hypot(e.clientX - g.x, e.clientY - g.y);
    if (!g.dragging && distance > 7) {
      clearTimer();
      g.moved = true;
      if (g.mouse) startDrag();
    }
    if (!g.dragging) {
      if (g.moved) el.scrollLeft += g.lastX - e.clientX;
    } else {
      const bounds = el.getBoundingClientRect();
      if (e.clientX < bounds.left + 24) el.scrollLeft -= 16;
      else if (e.clientX > bounds.right - 24) el.scrollLeft += 16;
      const buttons = [
        ...el.querySelectorAll<HTMLButtonElement>('[data-collection-tab]'),
      ];
      let index = 0,
        nearest = Infinity;
      buttons.forEach((b, i) => {
        const r = b.getBoundingClientRect(),
          d = Math.abs(e.clientX - (r.left + r.right) / 2);
        if (d < nearest) {
          nearest = d;
          index = i;
        }
      });
      g.order = moveCollectionTab(g.order, g.key, index);
      setPreview(g.order);
    }
    g.lastX = e.clientX;
  };
  return (
    <nav
      ref={nav}
      className="workbench-tags collection-sortable-tabs"
      aria-label="收藏分类"
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        if (props.disabled || e.button !== 0) return;
        if (gesture.current) {
          cancel();
          return;
        }
        if (!e.isPrimary) return;
        const key = (e.target as Element).closest<HTMLElement>(
          '[data-collection-tab]',
        )?.dataset.collectionTab as CollectionTab | undefined;
        if (!key) return;
        gesture.current = {
          pointer: e.pointerId,
          key,
          x: e.clientX,
          y: e.clientY,
          lastX: e.clientX,
          mouse: e.pointerType === 'mouse',
          moved: false,
          dragging: false,
          order,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
        timer.current = setTimeout(startDrag, 450);
      }}
      onPointerMove={move}
      onPointerUp={(e) => {
        const g = gesture.current;
        if (!g || g.pointer !== e.pointerId) return;
        const changed = g.order.join() !== order.join();
        cancel();
        if (g.dragging && changed) props.onReorder(g.order);
        else if (!g.moved) props.onSelect(g.key);
      }}
      onPointerCancel={cancel}
      onLostPointerCapture={() => {
        if (gesture.current) cancel();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') cancel();
      }}
    >
      {(preview ?? order).map((key, index) => (
        <button
          key={key}
          type="button"
          data-collection-tab={key}
          disabled={props.disabled}
          className={dragged === key ? 'collection-tab-dragging' : undefined}
          aria-pressed={
            key === 'regions' ? props.regions : props.selected === key
          }
          title={`${COLLECTION_TABS[key]}：长按拖动排序，或按 Alt + 左右方向键`}
          onClick={(e) => {
            if (e.detail === 0) props.onSelect(key);
          }}
          onKeyDown={(e) => {
            if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
              e.preventDefault();
              props.onReorder(
                moveCollectionTab(
                  order,
                  key,
                  index + (e.key === 'ArrowLeft' ? -1 : 1),
                ),
              );
            }
          }}
        >
          {COLLECTION_TABS[key]}
        </button>
      ))}
    </nav>
  );
}
