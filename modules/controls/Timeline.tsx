import { Pause, Play } from 'lucide-react';
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
}: {
  data: WeatherData | null;
  index: number;
  playing: boolean;
  onIndex: (index: number) => void;
  onPlaying: (playing: boolean) => void;
  rainVisible: boolean;
}) {
  const times = data?.times ?? [],
    hour = times[index];
  return (
    <section className="timeline glass" aria-label="逐小时天气时间轴">
      <div className="timeline-top">
        <div className="timeline-title">
          <span className="eyebrow">天气预报</span>
          <strong>
            {hour
              ? formatTime(hour, { month: '2-digit', day: '2-digit' })
              : '等待天气数据'}
          </strong>
          <span className="timezone">北京时间</span>
        </div>
        {rainVisible && (
          <div className="rain-legend">
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
      </div>
      <div className="timeline-bottom">
        <button
          className="play-button"
          aria-label={playing ? '暂停天气时间轴' : '播放天气时间轴'}
          disabled={!times.length}
          onClick={() => onPlaying(!playing)}
        >
          {playing ? (
            <Pause size={20} fill="currentColor" />
          ) : (
            <Play size={20} fill="currentColor" />
          )}
        </button>
        <div className="time-track">
          <input
            aria-label="选择天气预报时刻"
            type="range"
            min="0"
            max={Math.max(0, times.length - 1)}
            step="1"
            value={index}
            disabled={!times.length}
            onChange={(event) => {
              onPlaying(false);
              onIndex(Number(event.target.value));
            }}
          />
          <div className="time-labels">
            {[0, 6, 12, 18, 24].map((i) => (
              <button
                disabled={!times[i]}
                key={i}
                onClick={() => {
                  onPlaying(false);
                  onIndex(i);
                }}
              >
                {times[i] ? formatTime(times[i]) : '—'}
                <small>{i === 0 ? '起始时刻' : `+${i} 小时`}</small>
              </button>
            ))}
          </div>
        </div>
        <button
          className="now-button"
          disabled={!times.length}
          onClick={() => {
            onPlaying(false);
            onIndex(0);
          }}
        >
          回到当前
        </button>
      </div>
      <p className="timeline-note">
        云雨随预报时刻变化；卫星影像保持其拍摄日期。
        <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">
          天气数据 Open-Meteo · CC BY 4.0
        </a>
      </p>
    </section>
  );
}
