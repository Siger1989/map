import type { WeatherData } from './data';
import { RAIN_COLOR_STOPS, rainColorGradient } from './rain.ts';
import './RainLegend.css';

const TIME_FORMAT = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  hourCycle: 'h23',
});
const HOUR_FORMAT = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  hourCycle: 'h23',
});
const RAIN_GRADIENT = rainColorGradient();
const RAIN_LEGEND_TICKS = [0.1, 0.5, 2, 10] as const;

function amount(value: number) {
  return Number(value.toFixed(value < 1 ? 2 : 1)).toString();
}

function beijingTime(time: number) {
  const parts = Object.fromEntries(TIME_FORMAT.formatToParts(time).map(({ type, value }) => [type, value])) as Record<string, string>;
  return `${parts.month}月${parts.day}日 ${parts.hour}:${parts.minute}`;
}

function beijingHour(time: number) {
  return HOUR_FORMAT.format(time);
}

function tickPosition(value: number) {
  const minimum = RAIN_COLOR_STOPS[0][0];
  const maximum = RAIN_COLOR_STOPS[RAIN_COLOR_STOPS.length - 1][0];
  return `${Math.round((Math.log(value / minimum) / Math.log(maximum / minimum)) * 1000) / 10}%`;
}

export function RainLegend({
  data,
  index,
  loading,
  error,
}: {
  data: WeatherData | null;
  index: number;
  loading: boolean;
  error: string;
}) {
  const time = data?.times[index];
  const values = data?.cells.flatMap((cell) => {
    const value = cell.hours[index]?.rain;
    return typeof value === 'number' && Number.isFinite(value) && value >= 0
      ? [value]
      : [];
  }) ?? [];
  const sampleRange = values.length
    ? `${amount(Math.min(...values))}–${amount(Math.max(...values))}`
    : '';
  const status = loading
    ? '更新中'
    : error
      ? '读取失败'
      : !data
        ? '无数据'
        : !time
          ? '无时次'
          : values.length
            ? sampleRange
            : '无样本';
  const statusDescription = sampleRange && status === sampleRange
    ? `本区预报范围 ${sampleRange} mm`
    : status;

  return (
    <details className="rain-map-legend glass" aria-label="逐小时降雨图例">
      <summary aria-label="小时雨量图例和本区预报范围">
        <div className="rain-map-legend-heading">
          <strong>雨量 mm</strong>
          <span className="rain-map-legend-range" role="status" aria-live="polite" aria-label={statusDescription} title={statusDescription}>
            {status}
          </span>
          <span className="rain-map-legend-time">{time ? beijingHour(time) : ''}</span>
          <span className="rain-map-legend-chevron" aria-hidden="true">⌄</span>
        </div>
        <div
          className="rain-map-legend-ramp"
          role="img"
          aria-label={`降雨颜色渐变，${RAIN_COLOR_STOPS[0][0]} 至 ${RAIN_COLOR_STOPS.at(-1)?.[0]} 毫米`}
          style={{ background: RAIN_GRADIENT }}
        />
        <div className="rain-map-legend-ticks" aria-hidden="true">
          {RAIN_LEGEND_TICKS.map((value) => (
            <span key={value} style={{ left: tickPosition(value) }}>
              {value === 10 ? '10+' : value}
            </span>
          ))}
        </div>
      </summary>
      <div className="rain-map-legend-details">
        {time && <p>{beijingTime(time)}（北京时间）</p>}
        {sampleRange && <p>{statusDescription}</p>}
        {error && !loading && <p role="status">{error}</p>}
        <p>Open-Meteo · 逐小时降雨预报，连续插值显示，空白为无雨或无数据；非雷达观测。</p>
      </div>
    </details>
  );
}
