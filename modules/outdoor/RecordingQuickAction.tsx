import type { useRecording } from './useRecording';
import './sampling.css';

export function RecordingQuickAction({
  recorder,
  onDetails,
}: {
  recorder: Pick<ReturnType<typeof useRecording>, 'record' | 'command'>;
  onDetails: () => void;
}) {
  const { record, command } = recorder;
  const phase = record.phase;
  return (
    <nav
      className="recording-chip recording-quick glass"
      aria-label="轨迹记录快捷操作"
    >
      {phase === 'finished' ? (
        <button onClick={onDetails}>保存本次记录</button>
      ) : (
        <button
          onClick={() =>
            command(
              phase === 'idle'
                ? 'start'
                : phase === 'recording'
                  ? 'pause'
                  : 'resume',
            )
          }
        >
          {phase === 'idle'
            ? '开始记录'
            : phase === 'recording'
              ? '暂停记录'
              : '继续记录'}
        </button>
      )}
      <button onClick={onDetails} aria-label="记录设置与详情">
        {phase === 'idle'
          ? '设置'
          : `${record.segments.reduce((count, line) => count + line.length, 0)}点 · 详情`}
      </button>
    </nav>
  );
}
