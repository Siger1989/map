import type { Coordinate } from '../navigation/types';
import type { ScreenPoint } from '../tracks/drawing';
import type { CatalogEntry } from './catalog';
import { selectInBox, updateBoxSelection } from './boxSelection';
import { BoxSelectOverlay } from './BoxSelectOverlay';

export function MapBoxSelect({ entries, project, selected, onChange, onExit }: {
  entries: CatalogEntry[]; project: (p: Coordinate) => ScreenPoint | null;
  selected: string[]; onChange: (keys: string[]) => void; onExit: () => void;
}) {
  return <BoxSelectOverlay label="地图框选" count={selected.length}
    onBox={(box, mode) => onChange(updateBoxSelection(selected, selectInBox(entries, box, project), mode, k => k))}
    onClear={() => onChange([])} onExit={onExit}>
    {entries.filter(e => selected.includes(e.key)).map(e => {
      const p = project(e.coordinates);
      return p && <span className="map-box-hit" key={e.key} style={{ left: p.x, top: p.y }}>✓</span>;
    })}
  </BoxSelectOverlay>;
}
