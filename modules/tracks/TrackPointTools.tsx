import type { TrackLinePoint } from './linePoint';
import { formatDistance } from '../navigation/types';
export function TrackPointTools({
  point,
  draft,
  onAdd,
  onDetails,
  onClose,
  error,
  onInsert,
}: {
  point: TrackLinePoint;
  draft: boolean;
  onAdd: () => void;
  onDetails: () => void;
  onClose: () => void;
  error: string;
  onInsert?: () => void;
}) {
  return (
    <div className="track-point-tools glass" aria-label="轨迹线段选点">
      <div>
        <strong>沿线 {formatDistance(point.distance)}</strong>
        <button onClick={onClose} aria-label="取消沿线选点">
          ×
        </button>
      </div>
      <small>临时选点 · 不改变轨迹</small>
      <div>
        {onInsert && (
          <button aria-label="在此添加中间节点" onClick={onInsert}>
            ＋ 节点
          </button>
        )}
        <button className="track-point-add" onClick={onAdd}>
          {draft ? '保存轨迹并添加标记' : '添加行程标记'}
        </button>
        <button onClick={onDetails}>详情</button>
      </div>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
