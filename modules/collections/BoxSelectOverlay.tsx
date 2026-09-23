import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ScreenPoint } from '../tracks/drawing';
import { selectionBox, type SelectionBox, type BoxSelectionMode } from './boxSelection';
import './boxSelection.css';

/** The rectangle previews the gesture; selected results live independently. */
export function BoxSelectOverlay({ active = true, label, count, children, onBox, onExit, onClear, mode: controlledMode, tools = true }: {
  active?: boolean; label: string; count: number; children: ReactNode;
  onBox: (box: SelectionBox, mode: BoxSelectionMode) => void;
  onExit: () => void; onClear: () => void;
  mode?: BoxSelectionMode; tools?: boolean;
}) {
  const start = useRef<{ point: ScreenPoint; id: number } | null>(null);
  const [box, setBox] = useState<SelectionBox | null>(null);
  const [localMode, setMode] = useState<BoxSelectionMode>('add');
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
    {active && <div className="map-box-surface" onPointerDown={e => {
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
      if (next.right - next.left >= 5 && next.bottom - next.top >= 5) onBox(next, mode);
    }} onPointerCancel={() => { start.current = null; setBox(null); }}
      onLostPointerCapture={() => { start.current = null; setBox(null); }}
    />}
    {active && box && <div className="map-box-rectangle" style={{ left: box.left, top: box.top, width: box.right - box.left, height: box.bottom - box.top }} />}
    {children}
    {active && tools && <div className="map-box-tools">
      <strong>{label} · 已选 {count} 项</strong>
      <small>{mode === 'add' ? '拖框连续追加；重叠不会取消已选。' : '拖框只减去框内已选项，不删除内容。'}</small>
      <div role="group" aria-label="框选方式">
        <button aria-pressed={mode === 'add'} onClick={() => setMode('add')}>加选</button>
        <button aria-pressed={mode === 'subtract'} onClick={() => setMode('subtract')}>反选（减选）</button>
      </div>
      <div><button disabled={!count} onClick={onClear}>清空选择</button><button onClick={onExit}>退出框选</button></div>
      <small>退出保留已选，返回上级操作。</small>
    </div>}
  </div>;
}
