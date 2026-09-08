import type { WeatherData } from './data';
import { TEMPERATURE_COLORS } from './temperature';
import './temperature.css';
export function TemperatureLegend({
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
  return (
    <details className="temperature-legend glass" aria-label="气温色标">
      <summary aria-label="气温图例和数据说明">
        <span className="temperature-title">
          <strong>气温 · ℃</strong>
          <span>
            {loading
              ? '更新中'
              : error
                ? '读取失败'
                : time
                  ? new Date(time).toLocaleString('zh-CN', {
                      month: 'numeric',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : '暂无数据'}{' '}
            ⓘ
          </span>
        </span>
        <div
          className="temperature-ramp"
          style={{
            background: `linear-gradient(90deg,${TEMPERATURE_COLORS.map((v) => v[1]).join(',')})`,
          }}
        />
        <div className="temperature-ticks">
          <span>≤−30</span>
          <span>10</span>
          <span>≥50</span>
        </div>
      </summary>
      {error && <p role="status">{error}</p>}
      <p>Open-Meteo · 2米气温预报。当前区域网格数据，空白处无数据。</p>
    </details>
  );
}
