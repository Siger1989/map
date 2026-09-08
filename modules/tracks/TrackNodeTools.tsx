import { useState } from 'react';
import type { ManualTracksState } from './useManualTracks';
import type { TrackNode } from './editing';
import { equalCoordinate } from './editing';
import { keepsOriginalPoints } from './provenance';
import { pathOf, pointAt } from '../guidance/geometry';

export function TrackNodeTools({
  tracks,
  node,
  onNode,
  onBranch,
}: {
  tracks: ManualTracksState;
  node: TrackNode | null;
  onNode: (node: TrackNode | null) => void;
  onBranch: () => void;
}) {
  const [joining, setJoining] = useState(false),
    [target, setTarget] = useState(''),
    [index, setIndex] = useState(0);
  const track = tracks.saved.find((t) => t.id === tracks.selectedId);
  if (!track || keepsOriginalPoints(track)) return null;
  const selected = node?.trackId === track.id ? node : null;
  const other = tracks.saved.find((t) => t.id === target);
  const nodes = other
    ? [...new Map(other.segments.flat().map((p) => [p.join(','), p])).values()]
    : [];
  const candidates = tracks.saved.filter((t) => !keepsOriginalPoints(t));
  return (
    <div className="track-node-controls">
      <div className="track-node-actions">
        <button
          aria-label="添加中间节点"
          title="在所选节点后一段添加中点，可拖动调整"
          onClick={() => {
            const line =
              track.segments.find(
                (l) =>
                  selected &&
                  l.some((p) => equalCoordinate(p, selected.coordinate)),
              ) ?? track.segments[0];
            const i = selected
              ? Math.max(
                  0,
                  line.findIndex((p) =>
                    equalCoordinate(p, selected.coordinate),
                  ),
                )
              : 0;
            const at = Math.min(i, line.length - 2),
              path = pathOf([line[at], line[at + 1]]),
              point = pointAt(path, path.length / 2);
            if (tracks.insertNode(track.id, point))
              onNode({ trackId: track.id, coordinate: point });
          }}
        >
          ＋ 节点
        </button>
        <button
          aria-label="删除选中节点"
          disabled={!selected}
          onClick={() => {
            if (selected && tracks.removeNode(selected)) onNode(null);
          }}
        >
          − 节点
        </button>
        <button
          disabled={!selected}
          onClick={() => {
            if (selected && tracks.branchFrom(selected)) {
              onNode(null);
              onBranch();
            }
          }}
        >
          拉分叉
        </button>
        <button
          disabled={!selected}
          aria-expanded={joining}
          onClick={() => setJoining(!joining)}
        >
          连接
        </button>
      </div>
      {joining && selected && (
        <div className="track-node-join">
          <label>
            连接到路线
            <select
              value={target}
              onChange={(e) => {
                setTarget(e.target.value);
                setIndex(0);
              }}
            >
              <option value="">选择路线</option>
              {candidates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            连接节点
            <select
              value={index}
              disabled={!other}
              onChange={(e) => setIndex(Number(e.target.value))}
            >
              {nodes.map((p, i) => (
                <option key={i} value={i}>
                  {i + 1} · {p[1].toFixed(5)}, {p[0].toFixed(5)}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={!other || !nodes[index]}
            onClick={() => {
              if (
                other &&
                nodes[index] &&
                tracks.connectNodes(selected, {
                  trackId: other.id,
                  coordinate: nodes[index],
                })
              ) {
                onNode(null);
                setJoining(false);
              }
            }}
          >
            连接为一条（保留原线）
          </button>
          <small>节点间新增直线；重合节点直接相接。</small>
        </div>
      )}
    </div>
  );
}
