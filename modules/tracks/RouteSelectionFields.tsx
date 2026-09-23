import { useState } from 'react';
import type { ManualTrack } from './drawing';
import type { Coordinate } from '../navigation/types';
import { selectedEdges, type PointDetail } from './selectionDetails';
import { normalizeTrackStyle } from './style';
import { displayedPointColor, displayedEdgeColors } from './displayColors';
import { trackEdgeKey } from './alternatives';
import { equalCoordinate } from './editing';

/** Local edits target this selection, with one explicit apply/undo step. */
export function RouteSelectionFields({ track, points, onApply, onMarker, onSetEnd }: {
  track: ManualTrack; points: Coordinate[]; onApply: (detail: PointDetail) => void; onMarker:()=>void; onSetEnd:()=>void;
}) {
  const edges = selectedEdges(track.segments, points), point = points.length === 1 ? track.pointDetails?.[points[0].join(',')] : undefined;
  const edgeColors = displayedEdgeColors(track);
  const colors = edges.map(({a,b}) => edgeColors.get(trackEdgeKey(a,b)) ?? normalizeTrackStyle(track.style).color);
  const notes = edges.map(({segment, edge}) => track.edgeNotes?.[segment]?.[edge] ?? '');
  const [color, setColor] = useState(points.length === 1 ? displayedPointColor(track,points[0]) : colors[0] ?? normalizeTrackStyle(track.style).color);
  const [note, setNote] = useState(point?.note ?? (new Set(notes).size === 1 ? notes[0] : '') ?? '');
  const [patch, setPatch] = useState<PointDetail>({});
  const label = points.length === 1 ? '选中点' : `相连${edges.length}段`;
  return <div className="route-selection-fields" aria-label={`${label}属性`}>
    <label title={`${label}颜色`}><input aria-label={`${label}颜色`} type="color" value={color} onChange={e => {setColor(e.target.value);setPatch(p => ({...p,color:e.target.value}));}} /></label>
    <input aria-label={`${label}备注`} placeholder={new Set(notes).size > 1 ? '多种备注，输入统一修改' : `${label}备注`} maxLength={1600} value={note} onChange={e => {setNote(e.target.value);setPatch(p => ({...p,note:e.target.value}));}} />
    <button disabled={!Object.keys(patch).length || points.length > 1 && !edges.length} onClick={() => {onApply(patch); setPatch({});}}>应用</button>
    {points.length === 1 && <button className="route-add-point-marker" onClick={onMarker}>加标记</button>}
    {points.length === 1 && <button className="route-set-endpoint" aria-pressed={!!track.routeTerminals?.end && equalCoordinate(points[0],track.routeTerminals.end)} onClick={onSetEnd}>设终点</button>}
  </div>;
}
