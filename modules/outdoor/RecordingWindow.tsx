import { useRef } from 'react';
import { useBackHandler } from '../controls/backNavigation';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { useRecording } from './useRecording';
import { RecordingPanel } from './RecordingPanel';
import type { Coordinate } from '../navigation/types';
import { formatDistance } from '../navigation/types';
import { trackDistance } from '../tracks/drawing';
import './recordingWindow.css';
const names = {
  idle: '未开始',
  recording: '记录中',
  paused: '已暂停',
  finished: '待保存',
};
export function RecordingWindow({
  recorder,
  open,
  onOpen,
  onSaved,
  onShow,
  onPhotos,
  points,
}: {
  recorder: ReturnType<typeof useRecording>;
  open: boolean;
  onOpen: (value: boolean) => void;
  onSaved: (id: string) => void;
  onShow: (p: Coordinate[]) => void;
  onPhotos: () => void;
  points: Coordinate[];
}) {
  const root = useRef<HTMLElement>(null);
  useBackHandler(open, root, () => onOpen(false));
  const phase = recorder.record.phase;
  return (
    <section
      ref={root}
      className={`recording-window glass${open ? ' is-open' : ''}`}
      aria-label="实走记录窗口"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.preventDefault();
          e.stopPropagation();
          onOpen(false);
        }
      }}
    >
      <button
        className="recording-window-toggle"
        aria-expanded={open}
        onClick={() => onOpen(!open)}
      >
        <i data-phase={phase} />
        <strong>
          {open ? '实走记录 · ' : ''}
          {phase === 'idle' && !open ? '开始记录' : names[phase]}
        </strong>
        {!open && phase !== 'idle' && (
          <span>
            {formatDistance(
              trackDistance(
                recorder.record.segments.map((s) =>
                  s.map((p) => p.coordinates),
                ),
              ),
            )}
          </span>
        )}
        {open ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
      </button>
      {open && (
        <div className="recording-window-scroll">
          <RecordingPanel
            recorder={recorder}
            points={points}
            onShow={onShow}
            onSavedTrack={onSaved}
            onPhotos={onPhotos}
          />
        </div>
      )}
    </section>
  );
}
