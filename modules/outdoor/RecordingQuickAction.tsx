import { Pause, Play, Save } from 'lucide-react';
import type { useRecording } from './useRecording';

/** Direct recording control; details and annotations live in the bottom Record tab. */
export function RecordingQuickAction({ recorder, onDetails }: {
  recorder: Pick<ReturnType<typeof useRecording>, 'record' | 'command'>;
  onDetails: () => void;
}) {
  const { record, command } = recorder;
  const phase = record.phase;
  const label = phase === 'recording' ? '暂停' : phase === 'paused' ? '继续' : phase === 'finished' ? '保存' : '开始';
  const Icon = phase === 'recording' ? Pause : phase === 'finished' ? Save : Play;
  return <section className="home-recording" aria-label="轨迹记录快捷操作">
    <button className="home-recording-toggle" aria-label={`${label}轨迹记录`} title={record.error || `${label}轨迹记录`} data-recording={phase === 'recording'} onClick={() => phase === 'finished' ? onDetails() : command(phase === 'idle' ? 'start' : phase === 'recording' ? 'pause' : 'resume')}>
      <Icon size={22} fill={phase === 'finished' ? 'none' : 'currentColor'} aria-hidden="true" />
      <span>{label}</span>
    </button>
    {record.error && <button className="home-recording-error" onClick={onDetails} aria-label={`查看记录错误：${record.error}`} title={record.error}>{record.error.includes('权限') ? '未授权' : record.error.includes('超时') ? '定位超时' : '记录错误'}</button>}
  </section>;
}
