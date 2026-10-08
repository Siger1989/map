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
  recordingEnabled = true,
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
  recordingEnabled?: boolean;
  onImport?: () => void;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const activeTab = !recordingEnabled && tab === 'record' ? 'photos' : tab;
  return (
    <div className="outdoor-panel" data-tab={activeTab}>
      {activeTab === 'journey' ? <JourneyOverview tracks={tracks} selectedId={selectedId} recordingStarted={recorder.record.phase !== 'idle'} recordingEnabled={recordingEnabled} onSelect={onSavedTrack} onShow={onShow} onRecord={() => setTab('record')} onPhotos={() => setTab('photos')} onTool={id=>id==='files'?onImport?.():setTab('routing')} /> : <>
      {activeTab !== 'record' && activeTab !== 'routing' && <nav className="route-tabs" aria-label="行程工具">
        {([...(!recordingEnabled ? [] : ['record'] as const), 'photos'] as const).map(
          (id, i) => (
            <button
              key={id}
              aria-pressed={activeTab === id}
              onClick={() => setTab(id)}
            >
              {id === 'record' ? '记录' : '照片'}
            </button>
          ),
        )}
      </nav>}
      {activeTab === 'routing' && <nav className="route-tabs" aria-label="离线路网工具"><button onClick={() => setTab('journey')}>返回行程</button></nav>}
      {recordingEnabled && activeTab === 'record' && (
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
      {activeTab === 'routing' && <OfflineRoutingPanel points={points} name={name} onShow={onShow} />}
      {activeTab === 'photos' && photos}
      {activeTab === 'return' && returnPanel}
      </>}
    </div>
  );
}
