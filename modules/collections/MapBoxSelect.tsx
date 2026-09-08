import { useRef, useState } from 'react';
import type { Coordinate } from '../navigation/types';
import type { ScreenPoint } from '../tracks/drawing';
import type { CatalogEntry } from './catalog';
import { selectionBox, selectInBox, type SelectionBox } from './boxSelection';
import './boxSelection.css';
export function MapBoxSelect({
  entries,
  project,
  onDone,
  onCancel,
}: {
  entries: CatalogEntry[];
  project: (p: Coordinate) => ScreenPoint | null;
  onDone: (keys: string[]) => void;
  onCancel: () => void;
}) {
  const start = useRef<ScreenPoint | null>(null),
    [box, setBox] = useState<SelectionBox | null>(null),
    [keys, setKeys] = useState<string[]>([]);
  return (
    <div className="map-box-selection" aria-label="地图框选">
      <div
        className="map-box-surface"
        onPointerDown={(e) => {
          if (e.button !== 0 || !e.isPrimary) return;
          const r = e.currentTarget.getBoundingClientRect();
          start.current = { x: e.clientX - r.left, y: e.clientY - r.top };
          setBox(null);
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!start.current || !e.isPrimary) return;
          const r = e.currentTarget.getBoundingClientRect();
          setBox(
            selectionBox(start.current, {
              x: e.clientX - r.left,
              y: e.clientY - r.top,
            }),
          );
        }}
        onPointerUp={(e) => {
          if (!start.current || !e.isPrimary) return;
          const r = e.currentTarget.getBoundingClientRect(),
            next = selectionBox(start.current, {
              x: e.clientX - r.left,
              y: e.clientY - r.top,
            });
          start.current = null;
          if (e.currentTarget.hasPointerCapture(e.pointerId))
            e.currentTarget.releasePointerCapture(e.pointerId);
          if (next.right - next.left < 5 || next.bottom - next.top < 5) return;
          setBox(next);
          setKeys((old) => [
            ...new Set([...old, ...selectInBox(entries, next, project)]),
          ]);
        }}
        onPointerCancel={() => {
          start.current = null;
          setBox(null);
        }}
      >
        {box && (
          <div
            className="map-box-rectangle"
            style={{
              left: box.left,
              top: box.top,
              width: box.right - box.left,
              height: box.bottom - box.top,
            }}
          />
        )}
        {entries
          .filter((e) => keys.includes(e.key))
          .map((e) => {
            const p = project(e.coordinates);
            return (
              p && (
                <span
                  className="map-box-hit"
                  key={e.key}
                  style={{ left: p.x, top: p.y }}
                >
                  ✓
                </span>
              )
            );
          })}
      </div>
      <div className="map-box-tools">
        <strong>框选已保存对象 · {keys.length} 项</strong>
        <small>拖动矩形，可连续加选；相交路线整条选中</small>
        <div>
          <button onClick={onCancel}>取消</button>
          <button
            onClick={() => {
              setKeys([]);
              setBox(null);
            }}
          >
            清空
          </button>
          <button disabled={!keys.length} onClick={() => onDone(keys)}>
            整理 / 导出
          </button>
        </div>
      </div>
    </div>
  );
}
