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
  const [ending,setEnding]=useState(false);
  const { record, command } = recorder;
  const segments = record.segments.filter(s => s.length > 0).map(s => s.map(p => p.coordinates));
  const count = record.segments.reduce((n, line) => n + line.length, 0);
  const status = { idle: '未开始', recording: '记录中', paused: '已暂停', finished: '待处理' }[record.phase];
  const error = record.error || recorder.appearance.error || recorder.preferences.error || recorder.sampling.error;
  const act = (work: () => void) => { try { setMessage(''); work(); } catch (error) { setMessage((error as Error).message); } };
  const finish = async (keep:boolean) => {
    try {setMessage('');const id=await recorder.finish(keep);setEnding(false);setMessage(keep?'记录已保存，可在收藏中查看':'本次记录已结束');if(id)onSavedTrack(id);}
    catch(e){setMessage((e as Error).message);}
  };
  return <section className="record-console" aria-label="记录控制台">
    <div className="record-console-stats"><strong>{formatDistance(trackDistance(segments))}</strong><span>{count}点 · {status}</span></div>
    <p className="record-console-status" data-error={!!error} role="status" title={error || message || locationStatus}>{error || message || recorder.qualityNote || locationStatus}</p>
    <div className="record-function-group record-group-control">
      {ending || record.phase==='finished' ? <>
        <small>{count ? '结束本次记录' : '尚无有效轨迹点，无法保存'}</small>
        <div className="record-console-actions">
          <button className="is-primary" disabled={!count || recorder.finishing} onClick={()=>void finish(true)}>结束并保存</button>
          <button disabled={recorder.finishing} onClick={()=>void finish(false)}>取消并结束</button>
        </div>
        <small>独立保存的照片和标记保留。</small>
        {record.phase!=='finished' && <button disabled={recorder.finishing} onClick={()=>setEnding(false)}>返回记录</button>}
      </> : <div className="record-console-actions">
        <button className="is-primary" onClick={()=>command(record.phase==='idle'?'start':record.phase==='recording'?'pause':'resume')}>
          {record.phase==='recording'?<Pause size={15}/>:<Play size={15}/>}{record.phase==='idle'?'开始记录':record.phase==='recording'?'暂停':'继续'}</button>
        <button disabled={record.phase==='idle'} onClick={()=>setEnding(true)}><Square size={15}/>结束</button>
        <button disabled={!segments.length} onClick={()=>onShow(segments.flat())}>全程</button>
      </div>}
      {recorder.finishing && <small role="status">正在结束并收尾…</small>}
    </div>
    <div className="record-function-group record-group-along"><small>沿途内容</small><div className="record-console-actions">
      <button onClick={()=>setMessage(onMarkCurrent())}><MapPinPlus size={16}/>位置标记</button>
      <button onClick={onPhotos}><Images size={16}/>照片</button>
    </div></div>
    <details className="record-function-group record-group-settings"><summary>轨迹样式与采样设置</summary>
    <RecordingCompactSettings recorder={recorder} />
    </details>
    <div className="record-console-footer"><span title="精度是接受新定位点的误差门槛，不是设备定位能力保证。">{recorder.native ? '设置对新记录点生效' : '网页仅前台记录'}</span><button disabled={!segments.length} onClick={() => act(() => saveFile('Shantu-recording.gpx', 'application/gpx+xml', exportGPX(recordingTransfer(record))))}>导出GPX</button></div>
  </section>;
}
