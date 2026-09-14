import { useState } from 'react';
import { formatDistance, type Coordinate } from '../navigation/types';
import { trackDistance } from '../tracks/drawing';
import { nearestOnRoute } from '../journey/routeProgress';
import { exportGPX } from '../dataTransfer/xmlExport';
import { saveFile } from '../dataTransfer/download';
import type { useRecording } from './useRecording';
import { recordingTransfer, saveRecording } from './savedRecording';
import { RecordingPrecision } from './RecordingPrecision';
import { SamplingSettings } from './SamplingSettings';
import { TrackStyleControls } from '../tracks/TrackStyleControls';

export function RecordingPanel({
  recorder,
  points,
  onShow,
  onSavedTrack,
  onPhotos,
}: {
  recorder: ReturnType<typeof useRecording>;
  points: Coordinate[];
  onShow: (points: Coordinate[]) => void;
  onSavedTrack: (id: string) => void;
  onPhotos: () => void;
}) {
  const [message, setMessage] = useState('');
  const { record, native, command } = recorder;
  const segments = record.segments
    .filter((s) => s.length >= 2)
    .map((s) => s.map((p) => p.coordinates));
  const count = record.segments.reduce((n, line) => n + line.length, 0);
  const last = record.segments.at(-1)?.at(-1) ?? record.segments.at(-2)?.at(-1);
  const deviation =
    last && points.length > 1
      ? nearestOnRoute(points, last.coordinates).offset
      : null;
  const act = (work: () => void) => {
    try {
      work();
      setMessage('操作完成');
    } catch (error) {
      setMessage((error as Error).message);
    }
  };
  const recordingData = () => recordingTransfer(record);
  return (
    <>
      <>
        <div className="trip-metrics">
          <strong>{formatDistance(trackDistance(segments))}</strong>
          <span>
            {count} 点 ·{' '}
            {
              {
                idle: '未开始',
                recording: '记录中',
                paused: '已暂停',
                finished: '待保存',
              }[record.phase]
            }
          </span>
          {record.phase === 'idle' && (
            <button
              className="recording-start"
              onClick={() => command('start')}
            >
              开始记录
            </button>
          )}
        </div>
        <section className="recording-appearance" aria-label="实走轨迹样式">
          <TrackStyleControls
            analysis
            style={recorder.appearance.style}
            onChange={recorder.appearance.update}
          />
          {recorder.appearance.error && (
            <p role="status" className="route-error">
              {recorder.appearance.error}
            </p>
          )}
        </section>
        <RecordingPrecision preferences={recorder.preferences} />
        <SamplingSettings settings={recorder.sampling} native={native} />
        <p className="route-note">
          {native
            ? '开始后显示系统记录通知，锁屏后继续定位。'
            : '网页版仅在前台记录；锁屏记录请使用安卓安装包。'}
        </p>
        {last && (
          <p className="route-note">
            最近记录点估计误差 {Math.round(last.accuracy)} m ·{' '}
            {new Date(last.time).toLocaleTimeString('zh-CN')}
          </p>
        )}
        {deviation !== null && (
          <p className={deviation > 100 ? 'route-error' : 'route-note'}>
            距所选路线 {formatDistance(deviation)}
            {deviation > 100 ? ' · 可能已偏离路线' : ''}
          </p>
        )}
        <div className="outdoor-actions">
          {record.phase !== 'idle' && (
            <>
              {record.phase === 'recording' && (
                <button onClick={() => command('pause')}>暂停</button>
              )}
              {record.phase === 'paused' && (
                <button onClick={() => command('resume')}>继续记录</button>
              )}
              {record.phase !== 'finished' && (
                <button onClick={() => command('finish')}>结束记录</button>
              )}
              {record.phase === 'finished' && (
                <button
                  disabled={!segments.length}
                  onClick={() =>
                    act(() => {
                      const saved = saveRecording(record);
                      onSavedTrack(saved.id);
                      command('clear');
                      onPhotos();
                    })
                  }
                >
                  保存到轨迹
                </button>
              )}
              <button
                disabled={!segments.length}
                onClick={() =>
                  act(() =>
                    saveFile(
                      'Shantu-recording.gpx',
                      'application/gpx+xml',
                      exportGPX(recordingData()),
                    ),
                  )
                }
              >
                导出 GPX
              </button>
              <button
                disabled={!segments.length}
                onClick={() => onShow(segments.flat())}
              >
                查看全程
              </button>
              {record.phase !== 'recording' && !segments.length && (
                <button onClick={() => command('clear')}>
                  清除无有效线段记录
                </button>
              )}
            </>
          )}
        </div>
        {(record.error || recorder.qualityNote) && (
          <p role="status" className="route-error">
            {record.error || recorder.qualityNote}
          </p>
        )}
      </>
      {message && (
        <p role="status" className="route-note">
          {message}
        </p>
      )}
    </>
  );
}
