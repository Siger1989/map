import { CloudSun, Mountain } from 'lucide-react';
import type { Point } from '../map/types';
import {
  describeWeather,
  nearestCell,
  type WeatherData,
} from '../weather/data';

export function WeatherSummary({
  data,
  index,
  point,
  loading,
  error,
  active,
  onOpen,
}: {
  data: WeatherData | null;
  index: number;
  point: Point;
  loading: boolean;
  error: string;
  active: boolean;
  onOpen: () => void;
}) {
  const hour = nearestCell(data, point.lng, point.lat)?.hours[index];
  const temperature =
    hour?.temperature == null ? '—' : Math.round(hour.temperature);
  const elevation =
    point.elevation == null
      ? '—'
      : Math.round(point.elevation).toLocaleString();
  const description = loading
    ? '更新中'
    : error
      ? '天气暂不可用'
      : hour
        ? describeWeather(hour.code)
        : '暂无预报';
  return (
    <button
      className="weather-summary glass"
      onClick={onOpen}
      data-panel-toggle="weather"
      aria-expanded={active}
      aria-controls={active ? 'map-control-panel' : undefined}
      aria-label={`地点天气：${temperature}度，${description}；海拔 ${elevation} 米。点击查看详情`}
      title={`${description} · 所选点 ${point.lat.toFixed(3)}°N，${point.lng.toFixed(3)}°E`}
    >
      <CloudSun size={17} className="summary-icon" />
      <strong>{temperature}°</strong>
      <span className="summary-altitude">
        <Mountain size={12} />
        {elevation}
        <small>m</small>
      </span>
    </button>
  );
}
