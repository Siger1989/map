import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ScreenPoint } from '../tracks/drawing';
import { selectionBox, type SelectionBox, type BoxSelectionMode } from './boxSelection';
import './boxSelection.css';

/** The rectangle previews the gesture; selected results live independently. */
export function BoxSelectOverlay({ active = true, label, count, children, onBox, onExit, onClear, mode: controlledMode, tools = true, filter }: {
  active?: boolean; label: string; count: number; children: ReactNode;
  onBox: (box: SelectionBox, mode: BoxSelectionMode) => void;
  onExit: () => void; onClear: () => void;
  mode?: BoxSelectionMode; tools?: boolean; filter?: ReactNode;
}) {
  const start = useRef<{ point: ScreenPoint; id: number } | null>(null);
  const [box, setBox] = useState<SelectionBox | null>(null);
  const [localMode, setMode] = useState<BoxSelectionMode>('add');
  const [drawing, setDrawing] = useState(!tools);
  const mode = controlledMode ?? localMode;
  const exit = useRef(onExit); exit.current = onExit;
  useEffect(() => {
    start.current = null; setBox(null);
    if (!active) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation(); exit.current();
    };
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  }, [active]);
  return <div className="map-box-selection" data-active={active} data-selection-mode={mode} aria-label={label}>
    {active && drawing && <div className="map-box-surface" onPointerDown={e => {
      if (!e.isPrimary) { start.current = null; setBox(null); return; }
      if (e.button !== 0) return;
      const r = e.currentTarget.getBoundingClientRect();
      start.current = { id: e.pointerId, point: { x: e.clientX - r.left, y: e.clientY - r.top } };
      setBox(null); e.currentTarget.setPointerCapture(e.pointerId);
    }} onPointerMove={e => {
      if (start.current?.id !== e.pointerId) return;
      const r = e.currentTarget.getBoundingClientRect();
      setBox(selectionBox(start.current.point, { x: e.clientX - r.left, y: e.clientY - r.top }));
    }} onPointerUp={e => {
      if (start.current?.id !== e.pointerId) return;
      const r = e.currentTarget.getBoundingClientRect();
      const next = selectionBox(start.current.point, { x: e.clientX - r.left, y: e.clientY - r.top });
      start.current = null; setBox(null);
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      if (next.right - next.left >= 5 && next.bottom - next.top >= 5) {
        onBox(next, mode);
        if (tools) setDrawing(false);
      }
    }} onPointerCancel={() => { start.current = null; setBox(null); }}
      onLostPointerCapture={() => { start.current = null; setBox(null); }}
    />}
    {active && box && <div className="map-box-rectangle" style={{ left: box.left, top: box.top, width: box.right - box.left, height: box.bottom - box.top }} />}
    {children}
    {active && tools && <div className="map-box-tools">
      <div className="map-box-tools-heading"><strong>{label} · 已选 {count} 项</strong>{filter}</div>
      <div className="map-box-tools-actions" role="group" aria-label="框选操作">
        <button aria-pressed={drawing} onClick={() => { setDrawing(!drawing); setBox(null); }}>{drawing ? '平移地图' : '画框'}</button>
        <button aria-pressed={mode === 'subtract'} onClick={() => setMode(mode === 'add' ? 'subtract' : 'add')}>{mode === 'add' ? '加选' : '减选'}</button>
        <button disabled={!count} onClick={onClear}>清空</button>
        <button onClick={onExit}>退出</button>
      </div>
    </div>}
  </div>;
}
