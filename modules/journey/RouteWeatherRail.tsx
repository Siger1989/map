import { useEffect, useState } from 'react';
import { formatDistance, type PlannedRoute } from '../navigation/types';
import type { PositionFix } from '../position/types';
import {
  locateProgress,
  precipitationColor,
  temperatureColor,
} from './routeProgress';
import { beijingTime, type RouteJourneyState } from './useRouteJourney';
export function RouteWeatherRail({
  route,
  journey: j,
  fix,
  onSettings,
}: {
  route: PlannedRoute;
  journey: RouteJourneyState;
  fix: PositionFix | null;
  onSettings: () => void;
}) {
  const [selected, setSelected] = useState<number | null>(null),
    progress = locateProgress(route, fix);
  useEffect(() => setSelected(null), [route]);
  const entry = selected === null ? null : j.entries[selected];
  return (
    <aside
      className="route-weather-rail glass"
      aria-label="沿路线里程的气温和雨量进度带"
    >
      <button className="rail-heading" onClick={onSettings}>
        沿途天气
      </button>
      <div className="rail-columns">
        <span>气温</span>
        <span>降水</span>
      </div>
      <span className="rail-end">起点 · 0</span>
      <div
        className="rail-colors"
        role="group"
        aria-label="点按色带查看地点天气"
      >
        {j.entries.map((stop, i) => (
          <button
            key={i}
            className="rail-stop"
            aria-label={`${formatDistance(stop.distance)}处天气${stop.weather ? `，气温${stop.weather.temperature ?? '缺测'}度，降水${stop.weather.precipitation ?? '缺测'}毫米` : '暂缺'}`}
            aria-pressed={selected === i}
            onClick={() => setSelected(selected === i ? null : i)}
          >
            <span
              style={{
                background: temperatureColor(stop.weather?.temperature ?? null),
              }}
            />
            <span
              style={{
                background: precipitationColor(
                  stop.weather?.precipitation ?? null,
                ),
              }}
            />
          </button>
        ))}
        {progress.fraction !== null && (
          <span
            className="rail-progress"
            style={{ top: `${progress.fraction * 100}%` }}
          >
            <i />
            当前位置
          </span>
        )}
      </div>
      <span className="rail-end">
        终点 · {(route.distance / 1000).toFixed(1)}km
      </span>
      <span className="rail-progress-label">{progress.label}</span>
      {j.loading ? (
        <span className="rail-status">加载预报…</span>
      ) : j.error ? (
        <button className="rail-retry" title={j.error} onClick={j.retry}>
          天气重试
        </button>
      ) : (
        <button
          className="rail-legend-toggle"
          onClick={() => setSelected(selected === null ? 0 : null)}
        >
          颜色说明
        </button>
      )}
      {entry && (
        <div className="rail-detail glass">
          <button
            className="rail-close"
            onClick={() => setSelected(null)}
            aria-label="收起色带说明"
          >
            ×
          </button>
          <strong>{formatDistance(entry.distance)}</strong>
          <span>
            预计 {j.validTime ? beijingTime(entry.arrival) : '出发时间无效'}
          </span>
          <b>
            {entry.weather
              ? `${entry.weather.temperature ?? '—'}°C · ${entry.weather.precipitation ?? '—'}mm`
              : j.forecast
                ? '超出预报范围或缺测'
                : '暂无天气数据'}
          </b>
          <small>降水为预报整点前一小时雨雪总量</small>
          <div className="rail-scale">
            {[-5, 5, 15, 25, 32, 38].map((t) => (
              <span key={t} style={{ borderColor: temperatureColor(t) }}>
                {t === -5
                  ? '＜0'
                  : t === 38
                    ? '≥35'
                    : t === 5
                      ? '0–10'
                      : t === 15
                        ? '10–20'
                        : t === 25
                          ? '20–30'
                          : '30–35'}
                °
              </span>
            ))}
          </div>
          <div className="rail-scale">
            {[0, 0.5, 2, 7, 12].map((r) => (
              <span key={r} style={{ borderColor: precipitationColor(r) }}>
                {r === 0
                  ? '＜0.1'
                  : r === 0.5
                    ? '0.1–1'
                    : r === 2
                      ? '1–4'
                      : r === 7
                        ? '4–10'
                        : '≥10'}
                mm
              </span>
            ))}
          </div>
          <small>
            灰色缺测 · 稀疏模型采样
            <br />
            点“沿途天气”调整出发时间
          </small>
        </div>
      )}
    </aside>
  );
}
export function RouteWeatherSettings({
  journey: j,
}: {
  journey: RouteJourneyState;
}) {
  return (
    <section className="route-weather-settings">
      <label className="journey-input">
        沿途天气出发时间 · 北京时间
        <input
          type="datetime-local"
          value={j.departure}
          onChange={(e) => j.setDeparture(e.target.value)}
        />
      </label>
      <p className="route-note">
        按各路段预计耗时匹配沿途预报，左侧上方为起点、下方为终点。未计实时路况或休息。
      </p>
      {!j.validTime && <p className="route-error">请填写有效时间。</p>}
      {j.error && <p className="route-error">{j.error}</p>}
      <button className="route-primary" disabled={j.loading} onClick={j.retry}>
        {j.loading ? '读取沿途预报…' : '刷新沿途天气'}
      </button>
    </section>
  );
}
