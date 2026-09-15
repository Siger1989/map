import { CompactColor } from '../controls/CompactColor';
import { useState } from 'react';
import type { RouteEditSession } from './routeEdit';
import { materializeSections } from './sections';
import type { SelectedPath } from './pathSelection';
import { TrackStyleControls } from './TrackStyleControls';
import { normalizeTrackStyle, type TrackStyle } from './style';
export function RouteEditOptions({
  session,
  onPath,
  onSection,
  onMerge,
  onStyle,
}: {
  session: RouteEditSession;
  onPath: (path: SelectedPath) => void;
  onSection: (id: string, color: string, note: string) => void;
  onMerge: () => void;
  onStyle: (style: TrackStyle) => void;
}) {
  const [confirmMerge, setConfirmMerge] = useState(false);
  const path = session.path,
    sections = materializeSections(session.track);
  const id = path && sections.edges[path.part]?.[path.from];
  const [note, setNote] = useState<string | null>(null),
    [color, setColor] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const selectedColor = path
    ? (session.track.edgeColors?.[path.part]?.[path.from] ??
      normalizeTrackStyle(session.track.style).color)
    : '';
  return (
    <div className="route-edit-options">
      {path && (
        <div className="route-path-range" aria-label="已选路段范围">
          <strong>第 {path.part + 1} 条路径</strong>
          <label>
            从
            <select
              aria-label="路段起点"
              value={path.from}
              onChange={(e) =>
                onPath({ ...path, from: Number(e.target.value) })
              }
            >
              {session.track.segments[path.part]
                .slice(0, path.to)
                .map((_, i) => (
                  <option key={i} value={i}>
                    点 {i + 1}
                  </option>
                ))}
            </select>
          </label>
          <label>
            至
            <select
              aria-label="路段终点"
              value={path.to}
              onChange={(e) => onPath({ ...path, to: Number(e.target.value) })}
            >
              {session.track.segments[path.part].map(
                (_, i) =>
                  i > path.from && (
                    <option key={i} value={i}>
                      点 {i + 1}
                    </option>
                  ),
              )}
            </select>
          </label>
        </div>
      )}
      {id && (
        <details
          key={`${id}:${path?.part}:${path?.from}:${path?.to}`}
          onToggle={(e) => {
            if (e.currentTarget.open) {
              setEditingId(id);
              setNote(sections.notes[id] ?? '');
              setColor(selectedColor);
            }
          }}
        >
          <summary>所选路段 · 颜色与备注</summary>
          <CompactColor
            key={`${path?.part}:${path?.from}:${path?.to}`}
            value={editingId === id ? (color ?? selectedColor) : selectedColor}
            onChange={setColor}
            label="路段颜色"
          />
          <label>
            备注
            <input
              aria-label="路段备注"
              maxLength={1600}
              value={
                editingId === id
                  ? (note ?? sections.notes[id] ?? '')
                  : (sections.notes[id] ?? '')
              }
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <button
            onClick={() =>
              onSection(
                id,
                color ?? selectedColor,
                note ?? sections.notes[id] ?? '',
              )
            }
          >
            应用
          </button>
        </details>
      )}
      <details>
        <summary>线条设置</summary>
        <TrackStyleControls
          style={normalizeTrackStyle(session.track.style)}
          onChange={onStyle}
        />
      </details>
      {session.mergeCandidate && (
        <div>
          <button onClick={() => setConfirmMerge(!confirmMerge)}>
            合并路线…
          </button>
          {confirmMerge && (
            <div role="alert">
              <span>
                将「{session.mergeCandidate.name}
                」并入本次编辑，保存后合为一条路线。
              </span>
              <button
                onClick={() => {
                  onMerge();
                  setConfirmMerge(false);
                }}
              >
                确认合并
              </button>
              <button onClick={() => setConfirmMerge(false)}>取消</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
