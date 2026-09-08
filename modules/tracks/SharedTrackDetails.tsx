import type { ManualTrack } from './drawing';
import type { Coordinate } from '../navigation/types';
import { TRAVEL_MODES } from '../navigation/types';
import { JourneyPanel } from '../journey/JourneyPanel';
import type { ReactNode } from 'react';

/** Scanned routes open as geographic information; guidance is an explicit action. */
export function SharedTrackDetails({
  track,
  onBack,
  onEdit,
  onShow,
  onNavigate,
  onShare,
  error,
  photos,
}: {
  track: ManualTrack;
  onBack: () => void;
  onEdit: () => void;
  onShow: (points: Coordinate[]) => void;
  onNavigate: () => void;
  onShare: () => void;
  error: string;
  photos: ReactNode;
}) {
  const shared = track.sharedRoute!;
  return (
    <section
      className="track-panel shared-track-details"
      aria-label="扫码轨迹详情"
    >
      <div className="route-edit-actions">
        <button onClick={onBack}>‹ 轨迹列表</button>
        <button onClick={onEdit}>编辑 / 样式</button>
      </div>
      <strong>{track.name}</strong>
      <div className="route-edit-actions">
        <button onClick={() => onShow(track.segments.flat())}>查看全程</button>
        <button onClick={onNavigate}>导航</button>
        <button onClick={onShare}>分享</button>
      </div>
      <small>
        {TRAVEL_MODES.find((m) => m.id === track.navigationMode)?.label ??
          '步行'}{' '}
        · 扫码线形
        {shared.tolerance ? `已概括约 ${shared.tolerance} 米` : '保留全部节点'}
      </small>
      <details>
        <summary>
          {shared.stops[0].name} → {shared.stops.at(-1)!.name} · 点位坐标
        </summary>
        {shared.stops.map((s, i) => (
          <p key={i}>
            {i === 0
              ? '起点'
              : i === shared.stops.length - 1
                ? '终点'
                : `途经 ${i}`}
            ：{s.name}
            <br />
            {s.coordinates[1].toFixed(6)}°, {s.coordinates[0].toFixed(6)}°
          </p>
        ))}
      </details>
      {shared.tolerance > 0 && (
        <p className="route-note">
          海拔沿简化线形采样；完整精度请另导入 GPX/KML。
        </p>
      )}
      {error && (
        <p role="alert" className="route-error">
          {error}
        </p>
      )}
      {photos}
      <JourneyPanel
        segments={track.segments}
        mode={track.navigationMode}
        onLocate={(p) => onShow([p])}
      />
    </section>
  );
}
