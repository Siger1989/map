import { useState, type ReactNode } from 'react';
import type { Coordinate } from '../navigation/types';
import type { useRecording } from './useRecording';
import { RecordingPanel } from './RecordingPanel';
import { OfflineRoutingPanel } from '../offlineRouting/OfflineRoutingPanel';
import type { ManualTrack } from '../tracks/drawing';
import { JourneyOverview } from './JourneyOverview';
import './journeyOverview.css';
type Tab = 'journey' | 'record' | 'routing' | 'photos' | 'return';
/** Tab composition only. Each tool owns its transient UI and calls its module's public API. */
export function OutdoorPanel({
  recorder,
  points,
  name,
  onShow,
  photos,
  returnPanel,
  onSavedTrack,
  onTrackRemapped,
  tracks, selectedId,
  onMarkCurrent, locationStatus,
  initialTab = 'record',
  onImport,
}: {
  recorder: ReturnType<typeof useRecording>;
  points: Coordinate[];
  name: string;
  onShow: (points: Coordinate[]) => void;
  photos: ReactNode;
  returnPanel: ReactNode;
  onSavedTrack: (id: string) => void;
  onTrackRemapped: (from: string, to: string) => Promise<void>;
  tracks: ManualTrack[];
  selectedId: string | null;
  onMarkCurrent: () => string;
  locationStatus: string;
  initialTab?: 'journey' | 'record' | 'photos';
  onImport?: () => void;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  return (
    <div className="outdoor-panel" data-tab={tab}>
      {tab === 'journey' ? <JourneyOverview tracks={tracks} selectedId={selectedId} recordingStarted={recorder.record.phase !== 'idle'} onSelect={onSavedTrack} onShow={onShow} onRecord={() => setTab('record')} onPhotos={() => setTab('photos')} onTool={id=>id==='files'?onImport?.():setTab('routing')} /> : <>
      {tab !== 'record' && tab !== 'routing' && <nav className="route-tabs" aria-label="记录工具">
        {(['record', 'photos'] as const).map(
          (id, i) => (
            <button
              key={id}
              aria-pressed={tab === id}
              onClick={() => setTab(id)}
            >
              {['记录', '照片'][i]}
            </button>
          ),
        )}
      </nav>}
      {tab === 'routing' && <nav className="route-tabs" aria-label="离线路网工具"><button onClick={() => setTab('journey')}>返回行程</button></nav>}
      {tab === 'record' && (
        <RecordingPanel
          recorder={recorder}
          points={points}
          onShow={onShow}
          onSavedTrack={onSavedTrack}
          onTrackRemapped={onTrackRemapped}
          onPhotos={() => setTab('photos')}
          onMarkCurrent={onMarkCurrent}
          locationStatus={locationStatus}
        />
      )}
      {tab === 'routing' && <OfflineRoutingPanel points={points} name={name} onShow={onShow} />}
      {tab === 'photos' && photos}
      {tab === 'return' && returnPanel}
      </>}
    </div>
  );
}
