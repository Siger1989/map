import {
  useEffect,
  useRef,
  type PointerEvent,
  type KeyboardEvent,
} from 'react';
import { moveProfileNote } from './notePosition';
import type { Contour } from './contours';
import type { ProfileNote } from './profileNotes';
import type { SectionSettings } from './types';
export type PointActions = {
  disabled?: boolean;
  onSelect: (note: ProfileNote) => void;
  onEdit: (note: ProfileNote) => void;
  onPreview: (note: ProfileNote) => void;
  onCommit: (note: ProfileNote) => void;
  onCancel: () => void;
};
export function useContourPointDrag(
  curve: Contour,
  settings: SectionSettings,
  sampledAt: number,
  locate: (x: number, y: number) => number,
  actions: PointActions,
) {
  const current = useRef({ curve, settings, sampledAt, locate, actions });
  current.current = { curve, settings, sampledAt, locate, actions };
  const drag = useRef<{
    pointer: number;
    target: HTMLElement;
    note: ProfileNote;
    x: number;
    y: number;
    pending: ProfileNote | null;
  } | null>(null);
  const clear = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.target.hasPointerCapture(d.pointer))
      d.target.releasePointerCapture(d.pointer);
    return d;
  };
  const cancel = () => {
    if (clear()) current.current.actions.onCancel();
  };
  useEffect(() => {
    const visibility = () => {
      if (document.hidden) cancel();
    };
    window.addEventListener('blur', cancel);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      cancel();
      window.removeEventListener('blur', cancel);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  useEffect(() => cancel, [curve.id, settings]);
  const move = (note: ProfileNote, fraction: number) => {
    const c = current.current;
    return moveProfileNote(note, c.curve, fraction, c.settings, c.sampledAt);
  };
  return (note: ProfileNote) => ({
    disabled: actions.disabled,
    onPointerDown: (e: PointerEvent<HTMLButtonElement>) => {
      if (!e.isPrimary || e.button !== 0 || drag.current) {
        cancel();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.focus();
      drag.current = {
        pointer: e.pointerId,
        target: e.currentTarget,
        note,
        x: e.clientX,
        y: e.clientY,
        pending: null,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
      current.current.actions.onSelect(note);
    },
    onPointerMove: (e: PointerEvent<HTMLButtonElement>) => {
      const d = drag.current;
      if (!d || d.pointer !== e.pointerId) return;
      if (!d.pending && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 3)
        return;
      d.pending = move(d.note, current.current.locate(e.clientX, e.clientY));
      current.current.actions.onPreview(d.pending);
    },
    onPointerUp: (e: PointerEvent<HTMLButtonElement>) => {
      if (drag.current?.pointer !== e.pointerId) return;
      const d = clear()!;
      if (d.pending)
        current.current.actions.onCommit(
          move(d.note, current.current.locate(e.clientX, e.clientY)),
        );
      else current.current.actions.onSelect(d.note);
    },
    onDoubleClick: (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      current.current.actions.onEdit(note);
    },
    onPointerCancel: cancel,
    onLostPointerCapture: cancel,
    onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        cancel();
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        current.current.actions.onEdit(note);
        return;
      }
      if (
        ![
          'ArrowLeft',
          'ArrowRight',
          'ArrowUp',
          'ArrowDown',
          'Home',
          'End',
        ].includes(e.key)
      )
        return;
      e.preventDefault();
      const f = note.fraction ?? note.point.distance / (curve.length || 1),
        step = e.shiftKey ? 0.1 : 0.01;
      current.current.actions.onCommit(
        move(
          note,
          e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? 1
              : f + (['ArrowRight', 'ArrowUp'].includes(e.key) ? step : -step),
        ),
      );
    },
  });
}
