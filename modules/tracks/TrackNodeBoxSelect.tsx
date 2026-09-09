import { useRef, useState } from 'react';
import type { Coordinate } from '../navigation/types';
import type { ScreenPoint } from './drawing';
import { selectionBox, type SelectionBox } from '../collections/boxSelection';
import '../collections/boxSelection.css';

/** Select actual route vertices, including dense freehand samples, rather than entire intersecting lines. */
export function nodesInBox(points: Coordinate[], box: SelectionBox, project: (p: Coordinate) => ScreenPoint | null) {
  return [...new Map(points.filter(point => {
    const p = project(point);
    return p && p.x >= box.left && p.x <= box.right && p.y >= box.top && p.y <= box.bottom;
  }).map(p => [p.join(','), p])).values()];
}
export function TrackNodeBoxSelect({ points, project, onDelete, onCancel }: {
  points: Coordinate[]; project: (p: Coordinate) => ScreenPoint | null;
  onDelete: (points: Coordinate[]) => void; onCancel: () => void;
}) {
  const start = useRef<{ point: ScreenPoint; id: number } | null>(null);
  const [box, setBox] = useState<SelectionBox | null>(null), [selected, setSelected] = useState<Coordinate[]>([]);
  return <div className="map-box-selection" aria-label="路线点框选" onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } }}>
    <div className="map-box-surface" onPointerDown={e => {
      if (!e.isPrimary) { start.current = null; setBox(null); return; }
      if (e.button !== 0) return;
      const r = e.currentTarget.getBoundingClientRect(); start.current = { id: e.pointerId, point: { x: e.clientX - r.left, y: e.clientY - r.top } };
      setBox(null); e.currentTarget.setPointerCapture(e.pointerId);
    }} onPointerMove={e => {
      if (start.current?.id !== e.pointerId) return;
      const r = e.currentTarget.getBoundingClientRect(); setBox(selectionBox(start.current.point, { x: e.clientX - r.left, y: e.clientY - r.top }));
    }} onPointerUp={e => {
      if (start.current?.id !== e.pointerId) return;
      const r = e.currentTarget.getBoundingClientRect(), next = selectionBox(start.current.point, { x: e.clientX - r.left, y: e.clientY - r.top });
      start.current = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      if (next.right - next.left < 5 || next.bottom - next.top < 5) return;
      setBox(next); setSelected(old => [...new Map([...old, ...nodesInBox(points, next, project)].map(p => [p.join(','), p])).values()]);
    }} onPointerCancel={() => { start.current = null; setBox(null); }}>
      {box && <div className="map-box-rectangle" style={{ left: box.left, top: box.top, width: box.right - box.left, height: box.bottom - box.top }} />}
      {selected.map(point => { const p = project(point); return p && <span key={point.join(',')} className="map-box-hit" style={{ left: p.x, top: p.y }}>✓</span>; })}
    </div>
    <div className="map-box-tools"><strong>已框选 {selected.length} 个路线点</strong><small>拖动矩形，可连续加选；删除选中点及相连线段，可撤销。</small>
      <div><button onClick={onCancel}>取消</button><button onClick={() => { setSelected([]); setBox(null); }}>重选</button><button disabled={!selected.length} onClick={() => onDelete(selected)}>删除 {selected.length} 点</button></div>
    </div>
  </div>;
}
