import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ScreenPoint } from '../tracks/drawing';
import { selectionBox, type SelectionBox, type BoxSelectionMode } from './boxSelection';
import './boxSelection.css';

/** The rectangle previews the gesture; selected results live independently. */
export function BoxSelectOverlay({ active = true, label, count, children, onBox, onExit, onClear, mode: controlledMode, tools = true, filter, onTwoFingerMove, selectedResults, onResultAction, resumeToken = 0, onResumeActionFlow }: {
  active?: boolean; label: string; count: number; children: ReactNode;
  onBox: (box: SelectionBox, mode: BoxSelectionMode) => void;
  onExit: () => void; onClear: () => void;
  mode?: BoxSelectionMode; tools?: boolean; filter?: ReactNode;
  onTwoFingerMove?: (previous: ScreenPoint[], next: ScreenPoint[]) => void;
  selectedResults?: ReactNode; onResultAction?: (action: 'export' | 'share' | 'delete') => void;
  resumeToken?: number;
  onResumeActionFlow?: () => void;
}) {
  const start = useRef<{ point: ScreenPoint; id: number } | null>(null);
  const pointers = useRef(new Map<number, ScreenPoint>());
  const previousGesture = useRef<ScreenPoint[] | null>(null);
  const [box, setBox] = useState<SelectionBox | null>(null);
  const [localMode, setMode] = useState<BoxSelectionMode>('add');
  const [actionFlow, setActionFlow] = useState(false);
  const mode = controlledMode ?? localMode;
  const exit = useRef(onExit); exit.current = onExit;
  useEffect(() => {
    start.current = null; pointers.current.clear(); previousGesture.current = null; setBox(null); setActionFlow(false);
    if (!active) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation(); exit.current();
    };
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  }, [active]);
  useEffect(() => { setActionFlow(false); }, [resumeToken]);
  return <div className="map-box-selection" data-active={active} data-action-flow={actionFlow} data-selection-mode={mode} aria-label={label}>
    {active && !actionFlow && <div className="map-box-surface" onPointerDown={e => {
      if (e.button !== 0) return;
      const r = e.currentTarget.getBoundingClientRect();
      const point = { x: e.clientX - r.left, y: e.clientY - r.top };
      pointers.current.set(e.pointerId, point);
      if (pointers.current.size === 1) start.current = { id: e.pointerId, point };
      else {
        start.current = null; setBox(null);
        if (pointers.current.size === 2) previousGesture.current = [...pointers.current.values()];
      }
      e.currentTarget.setPointerCapture(e.pointerId);
    }} onPointerMove={e => {
      const previous = pointers.current.size > 1 ? [...pointers.current.values()] : null;
      if (pointers.current.has(e.pointerId)) {
        const r = e.currentTarget.getBoundingClientRect();
        pointers.current.set(e.pointerId, { x: e.clientX - r.left, y: e.clientY - r.top });
      }
      if (pointers.current.size > 1) {
        const next = [...pointers.current.values()];
        if (previousGesture.current && previous && next.length === 2) onTwoFingerMove?.(previousGesture.current, next);
        previousGesture.current = next;
        return;
      }
      if (start.current?.id !== e.pointerId) return;
      const r = e.currentTarget.getBoundingClientRect();
      setBox(selectionBox(start.current.point, { x: e.clientX - r.left, y: e.clientY - r.top }));
    }} onPointerUp={e => {
      pointers.current.delete(e.pointerId);
      if (start.current?.id !== e.pointerId) {
        start.current = null; setBox(null);
        previousGesture.current = pointers.current.size === 2 ? [...pointers.current.values()] : null;
        return;
      }
      const r = e.currentTarget.getBoundingClientRect();
      const next = selectionBox(start.current.point, { x: e.clientX - r.left, y: e.clientY - r.top });
      start.current = null; setBox(null);
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      if (next.right - next.left >= 5 && next.bottom - next.top >= 5) {
        onBox(next, mode);
      }
    }} onPointerCancel={e => { pointers.current.delete(e.pointerId); start.current = null; previousGesture.current = null; setBox(null); }}
      onLostPointerCapture={e => { pointers.current.delete(e.pointerId); start.current = null; previousGesture.current = null; setBox(null); }}
    />}
    {active && box && <div className="map-box-rectangle" style={{ left: box.left, top: box.top, width: box.right - box.left, height: box.bottom - box.top }} />}
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
          <button onClick={() => { setActionFlow(true); onResultAction?.('export'); }}>导出</button>
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
