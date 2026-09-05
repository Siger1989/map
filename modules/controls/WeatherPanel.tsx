import { CloudSun, Droplets, RefreshCw, Wind } from 'lucide-react';
import {
  describeWeather,
  nearestCell,
  type WeatherData,
} from '../weather/data';
import type { Point } from '../map/types';
export function WeatherPanel({
  data,
  index,
  point,
  loading,
  error,
  onRefresh,
}: {
  data: WeatherData | null;
  index: number;
  point: Point;
  loading: boolean;
  error: string;
  onRefresh: () => void;
}) {
  const cell = nearestCell(data, point.lng, point.lat),
    hour = cell?.hours[index];
  const show = (n: number | null | undefined, digits = 0) =>
    n == null ? '—' : n.toFixed(digits);
  return (
    <section className="weather-card glass" aria-label="所选地点的模型天气">
      <div className="weather-heading">
        <span className="eyebrow">所选地点 · 模型预报</span>
        <button
          className="icon-button"
          aria-label="刷新天气数据"
          disabled={loading}
          onClick={onRefresh}
        >
          <RefreshCw size={15} className={loading ? 'spin' : ''} />
        </button>
      </div>
      <div className="weather-main">
        <div>
          <strong>
            {show(hour?.temperature)}
            <small>°C</small>
          </strong>
          <p>
            {loading
              ? '正在更新天气…'
              : error
                ? '天气暂不可用'
                : hour
                  ? describeWeather(hour.code)
                  : '当前点不在天气采样区域'}
          </p>
        </div>
        <CloudSun size={43} strokeWidth={1.2} />
      </div>
      <div className="weather-metrics">
        <div>
          <Droplets size={15} />
          <span>小时雨量</span>
          <strong>
            {show(hour?.rain, 1)} <small>mm</small>
          </strong>
        </div>
        <div>
          <Wind size={15} />
          <span>近地风速</span>
          <strong>
            {show(hour?.wind, 1)} <small>m/s</small>
          </strong>
        </div>
      </div>
      <div className="cloud-fractions">
        <span>
          低云 <b>{show(hour?.low)}%</b>
        </span>
        <span>
          中云 <b>{show(hour?.mid)}%</b>
        </span>
        <span>
          高云 <b>{show(hour?.high)}%</b>
        </span>
      </div>
      <p className="weather-footnote" role="status">
        {error ||
          (data
            ? '区域 25 点采样 · 附近模型网格值'
            : '正在从 Open-Meteo 获取数据')}
      </p>
    </section>
  );
}
