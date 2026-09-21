import { useState } from 'react';
import { ChevronDown, ChevronUp, Circle, Settings2 } from 'lucide-react';
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
  const [collapsed, setCollapsed] = useState(false);
  return (
    <nav
      className="recording-chip recording-quick glass"
      aria-label="轨迹记录快捷操作"
    >
      <header className="home-recording-header">
        <strong>
          <Circle
            size={12}
            fill={phase === 'recording' ? 'currentColor' : 'none'}
          />
          实走记录 ·{' '}
          {phase === 'idle'
            ? '未开始'
            : phase === 'recording'
              ? '记录中'
              : phase === 'paused'
                ? '已暂停'
                : '待保存'}
        </strong>
        <button onClick={onDetails} aria-label="记录设置与详情">
          <Settings2 size={16} />
        </button>
        <button
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? '展开记录窗口' : '收起记录窗口'}
          aria-expanded={!collapsed}
        >
          {collapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </header>
      {!collapsed && (
        <div className="home-recording-actions">
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
          <button onClick={onDetails}>
            {phase === 'idle'
              ? '设置'
              : `${record.segments.reduce((count, line) => count + line.length, 0)}点 · 详情`}
          </button>
        </div>
      )}
    </nav>
  );
}
