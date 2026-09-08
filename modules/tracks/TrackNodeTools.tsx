import type { ManualTracksState } from './useManualTracks';
import { DRAFT_ID, equalCoordinate, type TrackNode } from './editing';
import { keepsOriginalPoints } from './provenance';
import { pathOf, pointAt } from '../guidance/geometry';

/** Selecting a node exposes its actions directly, for saved routes and drafts. */
export function TrackNodeTools({
  tracks,
  node,
  onNode,
  onBranch,
  connecting,
  onConnect,
  onDone,
}: {
  tracks: ManualTracksState;
  node: TrackNode;
  onNode: (node: TrackNode | null) => void;
  onBranch: () => void;
  connecting: boolean;
  onConnect: () => void;
  onDone: () => void;
}) {
  const draft = node.trackId === DRAFT_ID;
  const saved = tracks.saved.find((t) => t.id === node.trackId);
  if (!draft && (!saved || keepsOriginalPoints(saved))) return null;
  const segments = draft ? tracks.draft : saved!.segments;
  const line = segments.find(
    (l) => l.length >= 2 && l.some((p) => equalCoordinate(p, node.coordinate)),
  );
  return (
    <div className="track-node-toolbar glass" aria-label="节点操作">
      <div
        className="track-node-actions"
        role="toolbar"
        aria-label="直接操作选中节点"
      >
        <button
          aria-label="添加中间节点"
          title="在选中节点旁添加中间点"
          disabled={!line || connecting}
          onClick={() => {
            if (!line) return;
            const at = Math.min(
              line.findIndex((p) => equalCoordinate(p, node.coordinate)),
              line.length - 2,
            );
            const path = pathOf([line[at], line[at + 1]]),
              point = pointAt(path, path.length / 2);
            if (tracks.insertNode(node.trackId, point))
              onNode({ trackId: node.trackId, coordinate: point });
          }}
        >
          ＋
        </button>
        <button
          aria-label="删除选中节点"
          title="删除节点，前后两点直接连接"
          disabled={connecting}
          onClick={() => {
            if (tracks.removeNode(node)) onNode(null);
          }}
        >
          −
        </button>
        <button
          aria-label="从选中节点拉分叉"
          disabled={connecting}
          onClick={() => {
            if (tracks.branchFrom(node)) {
              onNode(null);
              onBranch();
            }
          }}
        >
          分叉
        </button>
        <button
          aria-label={connecting ? '取消节点连接' : '连接另一个节点'}
          aria-pressed={connecting}
          onClick={onConnect}
        >
          {connecting ? '取消' : '连接'}
        </button>
        <button
          aria-label="撤销节点操作"
          disabled={
            connecting ||
            (draft ? !tracks.canUndo : tracks.nodeUndoId !== node.trackId)
          }
          onClick={() => {
            if (draft) tracks.undo();
            else tracks.undoNodeMove();
            onNode(null);
          }}
        >
          撤销
        </button>
        <button
          aria-label={draft ? '保存草稿并完成节点编辑' : '完成节点编辑'}
          onClick={onDone}
        >
          完成
        </button>
      </div>
      {connecting && <p role="status">点地图上另一个节点，直接连接</p>}
      {tracks.error && <p role="alert">{tracks.error}</p>}
    </div>
  );
}
