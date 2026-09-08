import { useEffect, useRef, type CSSProperties } from 'react';
import { MapPinPlus, Box, Cylinder, Circle, X } from 'lucide-react';
import type { MapHold } from '../map/MapLongPress';
import { KINDS, type AnnotationKind } from './data';
import './quickAdd.css';
const OPTIONS = [
  { kind: 'pin', Icon: MapPinPlus },
  { kind: 'box', Icon: Box },
  { kind: 'cylinder', Icon: Cylinder },
  { kind: 'sphere', Icon: Circle },
] as const;

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
  onAdd: (kind: AnnotationKind) => void;
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
            <button type="button" onClick={onArea}>
              <Box size={18} />
              轮廓模型
            </button>
            {OPTIONS.map(({ kind, Icon }) => (
              <button key={kind} type="button" onClick={() => onAdd(kind)}>
                <Icon size={18} />
                {KINDS[kind]}
              </button>
            ))}
          </div>
          {error && <p role="alert">{error}</p>}
        </div>
      </section>
    </div>
  );
}
