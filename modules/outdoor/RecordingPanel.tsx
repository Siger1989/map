import { useState } from 'react';
import { MapPinPlus, Images, Play, Pause, Square, Save } from 'lucide-react';
import { formatDistance, type Coordinate } from '../navigation/types';
import { trackDistance } from '../tracks/drawing';
import { exportGPX } from '../dataTransfer/xmlExport';
import { saveFile } from '../dataTransfer/download';
import type { useRecording } from './useRecording';
import { recordingTransfer, saveRecording } from './savedRecording';
import { RecordingCompactSettings } from './RecordingCompactSettings';
import './recordingConsole.css';

export function RecordingPanel({ recorder, onShow, onSavedTrack, onPhotos, onMarkCurrent, locationStatus }: {
  recorder: ReturnType<typeof useRecording>; points: Coordinate[];
  onShow: (points: Coordinate[]) => void; onSavedTrack: (id: string) => void;
  onPhotos: () => void; onMarkCurrent: () => string; locationStatus: string;
}) {
  const [message, setMessage] = useState('');
  const { record, command } = recorder;
  const segments = record.segments.filter(s => s.length > 0).map(s => s.map(p => p.coordinates));
  const count = record.segments.reduce((n, line) => n + line.length, 0);
  const status = { idle: '未开始', recording: '记录中', paused: '已暂停', finished: '待保存' }[record.phase];
  const error = record.error || recorder.appearance.error || recorder.preferences.error || recorder.sampling.error;
  const act = (work: () => void) => { try { setMessage(''); work(); } catch (error) { setMessage((error as Error).message); } };
  const save = () => act(() => { const saved = saveRecording(record); onSavedTrack(saved.id); command('clear'); setMessage('记录已保存，可在收藏中查看'); });
  return <section className="record-console" aria-label="记录控制台">
    <div className="record-console-stats"><strong>{formatDistance(trackDistance(segments))}</strong><span>{count}点 · {status}</span></div>
    <p className="record-console-status" data-error={!!error} role="status" title={error || message || locationStatus}>{error || message || recorder.qualityNote || locationStatus}</p>
    <div className="record-console-actions">
      <button className="is-primary" onClick={() => setMessage(onMarkCurrent())}><MapPinPlus size={16} />当前位置标记</button>
      <button onClick={onPhotos}><Images size={16} />照片</button>
    </div>
    <div className="record-console-actions">
      {record.phase === 'finished' ? <button className="is-primary" disabled={!segments.length} onClick={save}><Save size={15} />保存</button> : <button className="is-primary" onClick={() => command(record.phase === 'idle' ? 'start' : record.phase === 'recording' ? 'pause' : 'resume')}>{record.phase === 'recording' ? <Pause size={15} /> : <Play size={15} />}{record.phase === 'idle' ? '开始' : record.phase === 'recording' ? '暂停' : '继续'}</button>}
      {record.phase === 'finished' ? <button onClick={() => command('resume')}><Play size={13} />继续记录</button> : <button disabled={record.phase === 'idle'} onClick={() => command('finish')}><Square size={13} />结束</button>}
      <button disabled={!segments.length} onClick={() => onShow(segments.flat())}>全程</button>
      {count === 0 && record.phase !== 'idle' && record.phase !== 'recording' && <button onClick={() => command('clear')}>重置空记录</button>}
    </div>
    <RecordingCompactSettings recorder={recorder} />
    <div className="record-console-footer"><span title="精度是接受新定位点的误差门槛，不是设备定位能力保证。">{recorder.native ? '设置对新记录点生效' : '网页仅前台记录'}</span><button disabled={!segments.length} onClick={() => act(() => saveFile('Shantu-recording.gpx', 'application/gpx+xml', exportGPX(recordingTransfer(record))))}>导出GPX</button></div>
  </section>;
}
