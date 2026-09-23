import type { Coordinate } from '../navigation/types';
import type { ScreenPoint } from './drawing';
import { updateBoxSelection, type SelectionBox, type BoxSelectionMode } from '../collections/boxSelection';
import { BoxSelectOverlay } from '../collections/BoxSelectOverlay';

/** Select actual vertices, including dense freehand samples, not intersecting lines. */
export function nodesInBox(points: Coordinate[], box: SelectionBox, project: (p: Coordinate) => ScreenPoint | null) {
  return [...new Map(points.filter(point => {
    const p = project(point);
    return p && p.x >= box.left && p.x <= box.right && p.y >= box.top && p.y <= box.bottom;
  }).map(p => [p.join(','), p])).values()];
}
export function TrackNodeBoxSelect({ active, mode, points, selected, pointSize, project, onChange, onExit }: {
  active: boolean; points: Coordinate[]; selected: Coordinate[];
  mode: BoxSelectionMode;
  pointSize: number;
  project: (p: Coordinate) => ScreenPoint | null;
  onChange: (points: Coordinate[]) => void; onExit: () => void;
}) {
  return <BoxSelectOverlay active={active} mode={mode} tools={false} label="路线点框选" count={selected.length}
    onBox={(box, mode) => onChange(updateBoxSelection(selected, nodesInBox(points, box, project), mode, p => p.join(',')))}
    onClear={() => onChange([])} onExit={onExit}>
    {selected.map(point => { const p = project(point); return p && <span key={point.join(',')} className="map-box-hit route-node-hit" style={{ left: p.x, top: p.y, width: pointSize + 2, height: pointSize + 2 }} />; })}
  </BoxSelectOverlay>;
}
