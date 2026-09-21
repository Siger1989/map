import { useState, type ReactNode } from 'react';
import type { Coordinate } from '../navigation/types';
import type { useRecording } from './useRecording';
import type { useOffline } from './useOffline';
import { RecordingPanel } from './RecordingPanel';
import { OfflinePanel } from './OfflinePanel';
import { TransferPanel } from '../dataTransfer/TransferPanel';
import type { ManualTrack } from '../tracks/drawing';
import { JourneyOverview } from './JourneyOverview';
import './journeyOverview.css';
type Tab = 'journey' | 'record' | 'files' | 'offline' | 'photos' | 'return';
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
  tracks, selectedId,
  onMarkCurrent, locationStatus,
  initialTab = 'record',
}: {
  recorder: ReturnType<typeof useRecording>;
  offline: ReturnType<typeof useOffline>;
  points: Coordinate[];
  name: string;
  onShow: (points: Coordinate[]) => void;
  onOpenMap: () => void;
  photos: ReactNode;
  returnPanel: ReactNode;
  onSavedTrack: (id: string) => void;
  tracks: ManualTrack[];
  selectedId: string | null;
  onMarkCurrent: () => string;
  locationStatus: string;
  initialTab?: 'journey' | 'record' | 'photos';
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  return (
    <div className="outdoor-panel">
      {tab === 'journey' ? <JourneyOverview tracks={tracks} selectedId={selectedId} recordingStarted={recorder.record.phase !== 'idle'} onSelect={onSavedTrack} onShow={onShow} onRecord={() => setTab('record')} onPhotos={() => setTab('photos')} onTool={setTab} /> : <>
      {tab !== 'record' && <nav className="route-tabs" aria-label="记录工具">
        {(['record', 'files', 'offline', 'photos', 'return'] as const).map(
          (id, i) => (
            <button
              key={id}
              aria-pressed={tab === id}
              onClick={() => setTab(id)}
            >
              {['记录', '数据', '离线', '照片', '返航'][i]}
            </button>
          ),
        )}
      </nav>}
      {tab === 'record' && (
        <RecordingPanel
          recorder={recorder}
          points={points}
          onShow={onShow}
          onSavedTrack={onSavedTrack}
          onPhotos={() => setTab('photos')}
          onMarkCurrent={onMarkCurrent}
          locationStatus={locationStatus}
        />
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
      {tab === 'record' && <nav className="record-console-tools" aria-label="记录工具">
        {(['files', 'offline', 'photos', 'return'] as const).map((id, i) => <button key={id} onClick={() => setTab(id)}>{['数据', '离线', '照片', '返航'][i]}</button>)}
      </nav>}
      </>}
    </div>
  );
}
