import { useEffect, useRef, type CSSProperties } from 'react';
import { MapPinPlus, Box, Cylinder, Circle, X } from 'lucide-react';
import type { MapHold } from '../map/MapLongPress';
import type { AnnotationChoice } from './data';
import { AnnotationTypeOptions } from './AnnotationTypeOptions';
import './quickAdd.css';
/** A local map action, with no navigation into the full annotation editor. */
export function QuickAdd({
  at,
  error,
  onAdd,
  onArea,
  onClose,
}: {
  at: MapHold;
  error: string;
  onAdd: (kind: AnnotationChoice) => void;
  onArea: () => void;
  onClose: () => void;
}) {
  const root = useRef<HTMLDivElement>(null),
    closeButton = useRef<HTMLButtonElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    closeButton.current?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target))
        close.current();
    };
    const dismiss = () => close.current();
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('resize', dismiss);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('resize', dismiss);
    };
  }, []);
  return (
    <div
      ref={root}
      className="quick-add"
      style={
        {
          '--press-x': `${at.point.x}px`,
          '--press-y': `${at.point.y}px`,
        } as CSSProperties
      }
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <span className="quick-add-anchor" aria-hidden="true" />
      <section className="quick-add-card glass" aria-label="在这里添加标记">
        <header>
          <strong>在这里添加</strong>
          <button
            ref={closeButton}
            type="button"
            aria-label="取消添加标记"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <div className="quick-add-content">
          <p>
            {at.coordinate[1].toFixed(5)}°, {at.coordinate[0].toFixed(5)}°
          </p>
          <div className="quick-add-options">
            <button type="button" onClick={onArea}>
              ▱ 划区域
            </button>
            <AnnotationTypeOptions onAdd={onAdd} onOutline={onArea} />
          </div>
          {error && <p role="alert">{error}</p>}
        </div>
      </section>
    </div>
  );
}
