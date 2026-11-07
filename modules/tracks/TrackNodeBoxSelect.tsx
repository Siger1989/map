import type { Coordinate } from '../navigation/types';
import type { ScreenPoint } from './drawing';
import { updateBoxSelection, type SelectionBox, type BoxSelectionMode } from '../collections/boxSelection';
import { BoxSelectOverlay } from '../collections/BoxSelectOverlay';
import { nodesInBox } from './trackNodeBoxSelection';
export function TrackNodeBoxSelect({ active, mode, points, selected, pointSize, project, onChange, onExit, onTwoFingerMove, onTwoFingerEnd }: {
  active: boolean; points: Coordinate[]; selected: Coordinate[];
  mode: BoxSelectionMode;
  pointSize: number;
  project: (p: Coordinate) => ScreenPoint | null;
  onChange: (points: Coordinate[]) => void; onExit: () => void;
  onTwoFingerMove?: (previous: ScreenPoint[], next: ScreenPoint[]) => void;
  onTwoFingerEnd?: () => void;
}) {
  return <BoxSelectOverlay active={active} mode={mode} tools={false} allowNarrowBox label="路线点框选" count={selected.length}
    onTwoFingerMove={onTwoFingerMove} onTwoFingerEnd={onTwoFingerEnd}
    onBox={(box, mode) => onChange(updateBoxSelection(selected, nodesInBox(points, box, project, Math.max(6, (pointSize + 2) / 2)), mode, p => p.join(',')))}
    onClear={() => onChange([])} onExit={onExit}>
    {selected.map(point => { const p = project(point); return p && <span key={point.join(',')} className="map-box-hit route-node-hit" style={{ left: p.x, top: p.y, width: pointSize + 2, height: pointSize + 2 }} />; })}
  </BoxSelectOverlay>;
}
