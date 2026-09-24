import { useState } from 'react';
import type { Coordinate } from '../navigation/types';
import type { ScreenPoint } from '../tracks/drawing';
import { CATALOG_TYPES, type CatalogEntry } from './catalog';
import { selectInBox, updateBoxSelection } from './boxSelection';
import { BoxSelectOverlay } from './BoxSelectOverlay';

export function MapBoxSelect({ entries, project, selected, onChange, onExit, onTwoFingerMove, onTwoFingerEnd, onResultAction, resumeToken, onResumeActionFlow }: {
  entries: CatalogEntry[]; project: (p: Coordinate) => ScreenPoint | null;
  selected: string[]; onChange: (keys: string[]) => void; onExit: () => void;
  onTwoFingerMove?: (previous: ScreenPoint[], next: ScreenPoint[]) => void;
  onTwoFingerEnd?: () => void;
  onResultAction?: (action: 'export' | 'share' | 'delete', keys: string[]) => void;
  resumeToken?: number;
  onResumeActionFlow?: () => void;
}) {
  const [kind, setKind] = useState<keyof typeof CATALOG_TYPES>('all');
  return <BoxSelectOverlay label="地图框选" count={selected.length}
    filter={<select aria-label="框选对象类型" value={kind} onChange={event => {
      const next = event.target.value as keyof typeof CATALOG_TYPES;
      setKind(next);
      if (next !== 'all') onChange(selected.filter(key => entries.some(entry => entry.key === key && entry.kind === next)));
    }}>{Object.entries(CATALOG_TYPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>}
    onBox={(box, mode) => {
      const hit = selectInBox(entries, box, project, kind);
      onChange(updateBoxSelection(selected, hit, mode, k => k));
    }}
    onClear={() => onChange([])} onExit={onExit} onTwoFingerMove={onTwoFingerMove} onTwoFingerEnd={onTwoFingerEnd} resumeToken={resumeToken} onResumeActionFlow={onResumeActionFlow}
    selectedResults={entries.filter(e => selected.includes(e.key)).map(e => <span className="map-box-selected-result" key={e.key}>{e.name}</span>)}
    onResultAction={action => onResultAction?.(action, selected)}>
    {entries.filter(e => selected.includes(e.key)).map(e => {
      const p = project(e.coordinates);
      return p && <span className="map-box-hit" key={e.key} style={{ left: p.x, top: p.y }}>✓</span>;
    })}
  </BoxSelectOverlay>;
}
