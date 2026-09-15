import { useBackHandler } from '../controls/backNavigation';
import { useRef, useState } from 'react';
import { formatDistance, type Coordinate } from '../navigation/types';
import { trackDistance } from '../tracks/drawing';
import { exportGPX } from '../dataTransfer/xmlExport';
import { saveFile } from '../dataTransfer/download';
import type { useRecording } from './useRecording';
import { recordingTransfer, saveRecording } from './savedRecording';
import { RecordingPrecision } from './RecordingPrecision';
import { SamplingSettings } from './SamplingSettings';
import { TrackStyleControls } from '../tracks/TrackStyleControls';
import type { RecordingAction } from './recordingCommand';
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
  const [message, setMessage] = useState(''),
    [settings, setSettings] = useState(false),
    [discard, setDiscard] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useBackHandler(settings || discard, root, () => {
    if (!recorder.busy) {
      if (discard) setDiscard(false);
      else setSettings(false);
    }
  });
  const { record, native } = recorder,
    phase = record.phase;
  const segments = record.segments
    .filter((s) => s.length >= 2)
    .map((s) => s.map((p) => p.coordinates));
  const last = record.segments.flat().at(-1),
    count = record.segments.flat().length;
  const run = async (work: () => void | Promise<void>) => {
    setMessage('');
    try {
      await work();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '操作失败，记录保留');
    }
  };
  const act = (action: RecordingAction) =>
    void run(async () => {
      await recorder.commandAsync(action, record.id);
    });
  const save = () =>
    void run(async () => {
      const id = record.id;
      const final =
        phase === 'finished'
          ? record
          : await recorder.commandAsync('finish', id);
      const saved = saveRecording(final);
      await recorder.commandAsync('clear', id);
      onSavedTrack(saved.id);
    });
  return (
    <div ref={root} className="recording-body">
      {settings ? (
        <>
          <button onClick={() => setSettings(false)}>返回记录</button>
          <SamplingSettings settings={recorder.sampling} native={native} />
          <RecordingPrecision preferences={recorder.preferences} />
          <details>
            <summary>轨迹样式</summary>
            <TrackStyleControls
              style={recorder.appearance.style}
              onChange={recorder.appearance.update}
            />
          </details>
          <div className="recording-actions">
            <button
              disabled={!segments.length}
              onClick={() => onShow(segments.flat())}
            >
              查看全程
            </button>
            <button
              disabled={!segments.length}
              onClick={() =>
                void run(() =>
                  saveFile(
                    'Shantu-recording.gpx',
                    'application/gpx+xml',
                    exportGPX(recordingTransfer(record)),
                  ),
                )
              }
            >
              导出 GPX
            </button>
          </div>
          <small>
            {native ? '后台记录由系统通知显示状态' : '网页版仅在前台记录'}
          </small>
        </>
      ) : discard ? (
        <div role="alert">
          <strong>放弃本次未保存记录？</strong>
          <p>本次临时记录将被清除，原照片和已保存行程保留。</p>
          <div className="recording-actions">
            <button onClick={() => setDiscard(false)}>保留记录</button>
            <button
              className="danger"
              disabled={recorder.busy}
              onClick={() =>
                void run(async () => {
                  const id = record.id;
                  if (phase !== 'finished')
                    await recorder.commandAsync('finish', id);
                  await recorder.commandAsync('clear', id);
                  setDiscard(false);
                })
              }
            >
              确认放弃
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="recording-metrics">
            {phase === 'idle' ? (
              `记录频率：${{ power: '省电', standard: '标准', accuracy: '高频', custom: '自定义' }[recorder.sampling.policy.mode]}`
            ) : (
              <>
                <span>
                  {formatDistance(trackDistance(segments))} · {count}点
                </span>
                <span>
                  {last ? `GPS ±${Math.round(last.accuracy)}m` : '等待定位'}
                </span>
              </>
            )}
          </div>
          <div className="recording-actions">
            {phase === 'idle' && (
              <button
                className="primary"
                disabled={recorder.busy}
                onClick={() => act('start')}
              >
                开始记录
              </button>
            )}
            {phase === 'recording' && (
              <button
                className="primary"
                disabled={recorder.busy}
                onClick={() => act('pause')}
              >
                暂停
              </button>
            )}
            {phase === 'paused' && (
              <button
                className="primary"
                disabled={recorder.busy}
                onClick={() => act('resume')}
              >
                继续
              </button>
            )}
            {(phase === 'recording' || phase === 'paused') && (
              <button disabled={recorder.busy} onClick={() => act('finish')}>
                结束
              </button>
            )}
            {phase === 'finished' && (
              <>
                <button
                  className="primary"
                  disabled={recorder.busy || !segments.length}
                  onClick={save}
                >
                  保存到行程
                </button>
                <button
                  disabled={!segments.length}
                  onClick={() =>
                    void run(() =>
                      saveFile(
                        'Shantu-recording.gpx',
                        'application/gpx+xml',
                        exportGPX(recordingTransfer(record)),
                      ),
                    )
                  }
                >
                  导出 GPX
                </button>
              </>
            )}
            {phase !== 'idle' && (
              <button
                className="danger"
                disabled={recorder.busy}
                onClick={() => setDiscard(true)}
              >
                {phase === 'finished' ? '放弃' : '取消'}
              </button>
            )}
            {phase === 'idle' && (
              <button onClick={() => setSettings(true)}>设置</button>
            )}
          </div>
          {phase !== 'idle' && (
            <button
              className="recording-more"
              onClick={() => setSettings(true)}
            >
              设置与更多
            </button>
          )}
        </>
      )}
      {recorder.busy && <small role="status">正在处理记录…</small>}
      {(record.error || recorder.qualityNote || message) && (
        <p className="route-error" role="alert">
          {message || record.error || recorder.qualityNote}
        </p>
      )}
    </div>
  );
}
