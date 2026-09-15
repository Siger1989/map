import type { ManualTrack } from '../tracks/drawing';
import { tripStats } from './tripData';
import { formatDistance } from '../navigation/types';
import { useState, type ReactNode } from 'react';
import type { Coordinate } from '../navigation/types';
import type { useRecording } from './useRecording';
import type { useOffline } from './useOffline';
import { RecordingPanel } from './RecordingPanel';
import { OfflinePanel } from './OfflinePanel';
import { TransferPanel } from '../dataTransfer/TransferPanel';
type Tab = 'record' | 'files' | 'offline' | 'photos' | 'return';
/** Tab composition only. Each tool owns its transient UI and calls its module's public API. */
export function OutdoorPanel({
  recorder,
  offline,
  points,
  name,
  onShow,
  onOpenMap,
  photos,
  returnPanel,
  onSavedTrack,
  initialTab = 'record',
  onRecord,
  trips,
  onTrip,
}: {
  trips: ManualTrack[];
  onTrip: (id: string) => void;
  recorder: ReturnType<typeof useRecording>;
  offline: ReturnType<typeof useOffline>;
  points: Coordinate[];
  name: string;
  onShow: (points: Coordinate[]) => void;
  onOpenMap: () => void;
  photos: ReactNode;
  returnPanel: ReactNode;
  onSavedTrack: (id: string) => void;
  initialTab?: 'record' | 'photos';
  onRecord: () => void;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  return (
    <div className="outdoor-panel">
      <nav className="route-tabs" aria-label="行程工具">
        {(['record', 'files', 'offline', 'photos', 'return'] as const).map(
          (id, i) => (
            <button
              key={id}
              aria-pressed={tab === id}
              onClick={() => setTab(id)}
            >
              {['实走记录', '数据', '离线', '照片', '返航'][i]}
            </button>
          ),
        )}
      </nav>
      {tab === 'record' && (
        <div className="trip-history">
          <button className="route-primary" onClick={onRecord}>
            打开记录窗口
          </button>
          {trips.map((t) => (
            <button
              className="trip-list-row"
              key={t.id}
              onClick={() => onTrip(t.id)}
            >
              <strong>{t.name}</strong>
              <small>
                {formatDistance(tripStats(t).distance)} ·{' '}
                {new Date(t.createdAt).toLocaleDateString()}
              </small>
            </button>
          ))}
          {!trips.length && <small>暂无已保存行程</small>}
        </div>
      )}
      {tab === 'files' && <TransferPanel />}
      {tab === 'offline' && (
        <OfflinePanel
          offline={offline}
          points={points}
          name={name}
          onShow={onShow}
          onOpenMap={onOpenMap}
        />
      )}
      {tab === 'photos' && photos}
      {tab === 'return' && returnPanel}
    </div>
  );
}
