import { Pause, Play, RotateCcw } from 'lucide-react';
import { rainColor, type WeatherData } from '../weather/data';
export const formatTime = (
  time: number,
  options: Intl.DateTimeFormatOptions = {},
) =>
  new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    ...options,
  }).format(time);

export function Timeline({
  data,
  index,
  playing,
  onIndex,
  onPlaying,
  rainVisible,
  expanded = false,
}: {
  data: WeatherData | null;
  index: number;
  playing: boolean;
  onIndex: (index: number) => void;
  onPlaying: (playing: boolean) => void;
  rainVisible: boolean;
  expanded?: boolean;
}) {
  const times = data?.times ?? [],
    hour = times[index];
  const select = (next: number) => {
    onPlaying(false);
    onIndex(next);
  };
  return (
    <section className="timeline" aria-label="逐小时天气时间轴">
      <div className="timeline-top">
        <div className="timeline-title">
          <strong>
            {hour
              ? formatTime(hour, { month: '2-digit', day: '2-digit' })
              : '等待天气数据'}
          </strong>
          <span>北京时间</span>
        </div>
        <button
          className="now-button"
          disabled={!times.length}
          onClick={() => select(0)}
        >
          <RotateCcw size={13} />
          当前
        </button>
      </div>
      <div className="timeline-bottom">
        <button
          className="play-button"
          aria-label={playing ? '暂停天气时间轴' : '播放天气时间轴'}
          aria-pressed={playing}
          disabled={!times.length}
          onClick={() => onPlaying(!playing)}
        >
          {playing ? (
            <Pause size={17} fill="currentColor" />
          ) : (
            <Play size={17} fill="currentColor" />
          )}
        </button>
        <div className="time-track">
          <input
            aria-label="选择天气预报时刻"
            aria-valuetext={
              hour
                ? formatTime(hour, { month: '2-digit', day: '2-digit' })
                : '暂无数据'
            }
            type="range"
            min="0"
            max={Math.max(0, times.length - 1)}
            step="1"
            value={index}
            disabled={!times.length}
            onChange={(event) => select(Number(event.target.value))}
          />
          <div className="time-labels">
            {[0, 6, 12, 18, 24].map((i) => (
              <button
                disabled={!times[i]}
                key={i}
                aria-label={
                  times[i]
                    ? `${i === 0 ? '起始' : `之后 ${i} 小时`}，${formatTime(times[i])}`
                    : '暂无数据'
                }
                onClick={() => select(i)}
              >
                {i === 0 ? '起始' : `+${i}h`}
              </button>
            ))}
          </div>
        </div>
      </div>
      {expanded && rainVisible && (
        <div className="rain-legend" aria-label="小时雨量颜色参考">
          <span>小时雨量</span>
          {[0, 1, 4, 10].map((n) => (
            <span key={n}>
              <i style={{ background: rainColor(n + 0.1) }} />
              {n === 10 ? '10+' : n}
            </span>
          ))}
          <span>mm</span>
        </div>
      )}
    </section>
  );
}
