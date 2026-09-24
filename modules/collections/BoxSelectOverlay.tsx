import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ScreenPoint } from '../tracks/drawing';
import { selectionBox, type SelectionBox, type BoxSelectionMode } from './boxSelection';
import './boxSelection.css';

/** The rectangle previews the gesture; selected results live independently. */
export function BoxSelectOverlay({ active = true, label, count, children, onBox, onExit, onClear, mode: controlledMode, tools = true, filter, onTwoFingerMove, onTwoFingerEnd, selectedResults, onResultAction, resumeToken = 0, onResumeActionFlow }: {
  active?: boolean; label: string; count: number; children: ReactNode;
  onBox: (box: SelectionBox, mode: BoxSelectionMode) => void;
  onExit: () => void; onClear: () => void;
  mode?: BoxSelectionMode; tools?: boolean; filter?: ReactNode;
  onTwoFingerMove?: (previous: ScreenPoint[], next: ScreenPoint[]) => void;
  onTwoFingerEnd?: () => void;
  selectedResults?: ReactNode; onResultAction?: (action: 'export' | 'share' | 'delete') => void;
  resumeToken?: number;
  onResumeActionFlow?: () => void;
}) {
  const start = useRef<{ point: ScreenPoint; id: number } | null>(null);
  const overlay = useRef<HTMLDivElement | null>(null);
  const surface = useRef<HTMLDivElement | null>(null);
  const surfaceBounds = useRef<DOMRect | null>(null);
  const rectangle = useRef<HTMLDivElement | null>(null);
  const pointers = useRef(new Map<number, ScreenPoint>());
  const previousGesture = useRef<ScreenPoint[] | null>(null);
  const twoFingerActive = useRef(false);
  const gestureFrame = useRef(0);
  const pendingGesture = useRef<{ previous: ScreenPoint[]; next: ScreenPoint[] } | null>(null);
  const [localMode, setMode] = useState<BoxSelectionMode>('add');
  const [actionFlow, setActionFlow] = useState(false);
  const mode = controlledMode ?? localMode;
  const exit = useRef(onExit); exit.current = onExit;
  const finishTwoFinger = () => {
    if (!twoFingerActive.current) return;
    twoFingerActive.current = false;
    if (overlay.current) overlay.current.dataset.gestureActive = 'false';
    onTwoFingerEnd?.();
  };
  useEffect(() => {
    finishTwoFinger();
    start.current = null; pointers.current.clear(); previousGesture.current = null;
    pendingGesture.current = null;
    if (gestureFrame.current) cancelAnimationFrame(gestureFrame.current);
    gestureFrame.current = 0;
    surfaceBounds.current = null;
    drawRectangle(null);
    setActionFlow(false);
    if (!active) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation(); exit.current();
    };
    const refreshBounds = () => {
      if (pointers.current.size && surface.current)
        surfaceBounds.current = surface.current.getBoundingClientRect();
    };
    window.addEventListener('keydown', escape, true);
    window.addEventListener('resize', refreshBounds);
    return () => {
      finishTwoFinger();
      window.removeEventListener('keydown', escape, true);
      window.removeEventListener('resize', refreshBounds);
      start.current = null;
      pointers.current.clear();
      previousGesture.current = null;
      pendingGesture.current = null;
      if (gestureFrame.current) cancelAnimationFrame(gestureFrame.current);
      gestureFrame.current = 0;
    };
  }, [active]);
  useEffect(() => { setActionFlow(false); }, [resumeToken]);
  const flushGesture = () => {
    gestureFrame.current = 0;
    const pending = pendingGesture.current;
    pendingGesture.current = null;
    if (!pending) return;
    previousGesture.current = pending.next;
    onTwoFingerMove?.(pending.previous, pending.next);
  };
  const drawRectangle = (next: SelectionBox | null) => {
    const element = rectangle.current;
    if (!element) return;
    if (!next) {
      element.style.display = 'none';
      return;
    }
    element.style.display = 'block';
    element.style.left = `${next.left}px`;
    element.style.top = `${next.top}px`;
    element.style.width = `${next.right - next.left}px`;
    element.style.height = `${next.bottom - next.top}px`;
  };
  const pointInSurface = (event: React.PointerEvent, refresh = false) => {
    if ((refresh || !surfaceBounds.current) && surface.current)
      surfaceBounds.current = surface.current.getBoundingClientRect();
    const bounds = surfaceBounds.current;
    return bounds ? { x: event.clientX - bounds.left, y: event.clientY - bounds.top } : null;
  };
  return <div ref={overlay} className="map-box-selection" data-active={active} data-action-flow={actionFlow} data-gesture-active={twoFingerActive.current ? 'true' : 'false'} data-selection-mode={mode} aria-label={label}>
    {active && !actionFlow && <div ref={surface} className="map-box-surface" onPointerDown={e => {
      if (e.button !== 0) return;
      const point = pointInSurface(e, true)!;
      pointers.current.set(e.pointerId, point);
      if (pointers.current.size === 1) start.current = { id: e.pointerId, point };
      else {
        start.current = null; drawRectangle(null);
        if (pointers.current.size === 2) {
          twoFingerActive.current = true;
          if (overlay.current) overlay.current.dataset.gestureActive = 'true';
          previousGesture.current = [...pointers.current.values()];
        }
      }
      e.currentTarget.setPointerCapture(e.pointerId);
    }} onPointerMove={e => {
      const previous = pointers.current.size > 1 ? [...pointers.current.values()] : null;
      if (pointers.current.has(e.pointerId)) {
        const point = pointInSurface(e);
        if (point) pointers.current.set(e.pointerId, point);
      }
      if (pointers.current.size > 1) {
        const next = [...pointers.current.values()];
        if (previousGesture.current && previous && next.length === 2) {
          pendingGesture.current = { previous: previousGesture.current, next };
          if (!gestureFrame.current) gestureFrame.current = requestAnimationFrame(flushGesture);
        }
        return;
      }
      if (start.current?.id !== e.pointerId) return;
      const point = pointInSurface(e);
      if (point) drawRectangle(selectionBox(start.current.point, point));
    }} onPointerUp={e => {
      if (gestureFrame.current) {
        cancelAnimationFrame(gestureFrame.current);
        flushGesture();
      }
      pointers.current.delete(e.pointerId);
      if (start.current?.id !== e.pointerId) {
        start.current = null; surfaceBounds.current = null; drawRectangle(null);
        if (pointers.current.size < 2) finishTwoFinger();
        previousGesture.current = pointers.current.size === 2 ? [...pointers.current.values()] : null;
        return;
      }
      const point = pointInSurface(e) ?? start.current.point;
      const next = selectionBox(start.current.point, point);
      start.current = null; surfaceBounds.current = null; drawRectangle(null);
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      if (next.right - next.left >= 5 && next.bottom - next.top >= 5) {
        onBox(next, mode);
      }
    }} onPointerCancel={e => { pointers.current.delete(e.pointerId); start.current = null; surfaceBounds.current = null; previousGesture.current = null; pendingGesture.current = null; if (gestureFrame.current) cancelAnimationFrame(gestureFrame.current); gestureFrame.current = 0; drawRectangle(null); finishTwoFinger(); }}
      onLostPointerCapture={e => { pointers.current.delete(e.pointerId); start.current = null; surfaceBounds.current = null; previousGesture.current = null; pendingGesture.current = null; if (gestureFrame.current) cancelAnimationFrame(gestureFrame.current); gestureFrame.current = 0; drawRectangle(null); finishTwoFinger(); }}
    />}
    {active && !actionFlow && <div ref={rectangle} className="map-box-rectangle" style={{ display: 'none' }} />}
    {children}
    {active && tools && !actionFlow && <div className="map-box-tools">
      <div className="map-box-tools-heading"><strong>{label} · 已选 {count} 项</strong>{filter}</div>
      <div className="map-box-tools-actions" role="group" aria-label="框选操作">
        <button aria-pressed={mode === 'add'} onClick={() => setMode('add')}>加选</button>
        <button aria-pressed={mode === 'subtract'} onClick={() => setMode('subtract')}>减选</button>
        <button disabled={!count} onClick={onClear}>清空</button>
        <button onClick={onExit}>退出</button>
      </div>
      {!!count && <>
        <div className="map-box-selected-results" aria-label="已选结果">{selectedResults}</div>
        <div className="map-box-result-actions" role="group" aria-label="框选结果操作">
          <button onClick={() => { setActionFlow(true); onResultAction?.('share'); }}>分享</button>
          <button className="is-danger" onClick={() => { setActionFlow(true); onResultAction?.('delete'); }}>删除</button>
        </div>
      </>}
    </div>}
    {active && tools && actionFlow && <div className="map-box-action-flow" role="group" aria-label="框选结果操作中">
      <button onClick={() => { setActionFlow(false); onResumeActionFlow?.(); }}>返回框选</button>
      <button onClick={onExit}>退出框选</button>
    </div>}
  </div>;
}
