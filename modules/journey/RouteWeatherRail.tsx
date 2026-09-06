import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import {
  formatDistance,
  type Coordinate,
  type PlannedRoute,
} from '../navigation/types';
import type { PositionFix } from '../position/types';
import {
  locateProgress,
  precipitationColor,
  temperatureColor,
  secondsAlong,
} from './routeProgress';
import { railFraction, routePositionIndex } from './scrub';
import { matchForecast } from './weatherProvider';
import {
  beijingInput,
  beijingTime,
  type RouteJourneyState,
} from './useRouteJourney';
export function RouteWeatherRail({
  route,
  journey: j,
  fix,
  onSettings,
  onPreview,
}: {
  route: PlannedRoute;
  journey: RouteJourneyState;
  fix: PositionFix | null;
  onSettings: () => void;
  onPreview: (coordinates: Coordinate | null) => void;
}) {
  const [selected, setSelected] = useState<number | null>(null),
    [legend, setLegend] = useState(false);
  const callback = useRef(onPreview);
  callback.current = onPreview;
  const pending = useRef<{ fraction: number; frame: number } | null>(null),
    pointer = useRef<number | null>(null);
  const positionAt = useMemo(
    () => routePositionIndex(route.coordinates),
    [route],
  );
  const progress = locateProgress(route, fix),
    fraction = selected ?? progress.fraction ?? 0;
  useEffect(() => {
    setSelected(null);
    setLegend(false);
    return () => {
      if (pending.current) cancelAnimationFrame(pending.current.frame);
      pending.current = null;
      pointer.current = null;
      callback.current(null);
    };
  }, [route]);
  const select = (value: number) => {
    const f = Math.max(0, Math.min(1, value));
    setSelected(f);
    callback.current(positionAt(f));
  };
  const fromPointer = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect(),
      f = railFraction(e.clientY, r.top, r.height);
    if (pending.current) {
      pending.current.fraction = f;
      return;
    }
    pending.current = {
      fraction: f,
      frame: requestAnimationFrame(() => {
        const current = pending.current;
        pending.current = null;
        if (current) select(current.fraction);
      }),
    };
  };
  const release = (e: PointerEvent<HTMLDivElement>) => {
    if (pointer.current !== e.pointerId) return;
    if (pending.current) {
      cancelAnimationFrame(pending.current.frame);
      pending.current = null;
    }
    const r = e.currentTarget.getBoundingClientRect();
    select(railFraction(e.clientY, r.top, r.height));
    pointer.current = null;
  };
  const nearest = Math.min(
    j.entries.length - 1,
    Math.round(fraction * (j.entries.length - 1)),
  );
  const arrival =
    new Date(j.departure + '+08:00').getTime() +
    secondsAlong(route, route.distance * fraction) * 1000;
  const weather = j.forecast
    ? matchForecast(j.forecast.points[nearest], arrival)
    : null;
  const gradient = (kind: 'temperature' | 'precipitation') => {
    const color =
      kind === 'temperature' ? temperatureColor : precipitationColor;
    const entries = j.entries.map(
      (s, i) =>
        `${color(s.weather?.[kind] ?? null)} ${(i / Math.max(1, j.entries.length - 1)) * 100}%`,
    );
    return entries.length > 1
      ? `linear-gradient(to bottom, ${entries.join(',')})`
      : '#64747d';
  };
  return (
    <aside
      className="route-weather-rail"
      aria-label="沿路线里程的气温和雨量进度带"
    >
      <button
        className="rail-heading glass"
        onClick={onSettings}
        aria-label="沿途天气设置"
      >
        沿途
      </button>
      <span className="rail-end">起点</span>
      <div
        className="rail-colors"
        role="slider"
        tabIndex={0}
        aria-orientation="vertical"
        aria-label="拖动浏览行程"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Number((fraction * 100).toFixed(1))}
        aria-valuetext={`${selected === null && progress.fraction !== null ? '当前位置' : '预览'} ${formatDistance(route.distance * fraction)}，全程 ${formatDistance(route.distance)}`}
        onPointerDown={(e) => {
          if (!e.isPrimary || e.button !== 0) return;
          e.preventDefault();
          pointer.current = e.pointerId;
          e.currentTarget.setPointerCapture(e.pointerId);
          fromPointer(e);
        }}
        onPointerMove={(e) => {
          if (pointer.current === e.pointerId) fromPointer(e);
        }}
        onPointerUp={release}
        onPointerCancel={() => {
          pointer.current = null;
          if (pending.current) cancelAnimationFrame(pending.current.frame);
          pending.current = null;
        }}
        onLostPointerCapture={() => {
          pointer.current = null;
        }}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 0.1 : 0.01;
          if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
            e.preventDefault();
            select(
              e.key === 'Home'
                ? 0
                : e.key === 'End'
                  ? 1
                  : fraction + (e.key === 'ArrowDown' ? step : -step),
            );
          }
        }}
      >
        <div className="rail-tracks">
          <span style={{ background: gradient('temperature') }} />
          <span style={{ background: gradient('precipitation') }} />
        </div>
        <div className="rail-ticks" aria-hidden="true">
          {Array.from({ length: 21 }, (_, i) => (
            <i key={i} style={{ top: `${i * 5}%` }} data-major={i % 5 === 0} />
          ))}
        </div>
        {progress.fraction !== null && (
          <span
            className="rail-gps"
            title="真实定位进度"
            style={{ top: `${progress.fraction * 100}%` }}
          />
        )}
        <span
          className="rail-thumb"
          data-preview={selected !== null || progress.fraction === null}
          style={{ top: `${fraction * 100}%` }}
        />
      </div>
      <span className="rail-end">{(route.distance / 1000).toFixed(1)}km</span>
      <button
        className="rail-legend-toggle glass"
        aria-label="行程色带说明"
        onClick={() => setLegend((v) => !v)}
      >
        图例
      </button>
      {(selected !== null || legend) && (
        <div className="rail-detail glass">
          <button
            className="rail-close"
            aria-label="关闭行程预览"
            onClick={() => {
              setSelected(null);
              setLegend(false);
              callback.current(null);
            }}
          >
            ×
          </button>
          <strong>
            {selected === null
              ? '沿途天气'
              : `预览 ${formatDistance(route.distance * fraction)}`}
          </strong>
          {selected !== null && (
            <>
              <span>
                {(fraction * 100).toFixed(1)}% · 预计{' '}
                {j.validTime ? beijingTime(arrival) : '时间无效'}
              </span>
              <b>
                {weather
                  ? `${weather.temperature ?? '—'}°C · ${weather.precipitation ?? '—'} mm · ${weather.wind ?? '—'} m/s`
                  : '预报暂缺或超出时段'}
              </b>
              <small>附近采样点预报 · 时雨雪总量</small>
            </>
          )}
          <small>定位：{progress.label}</small>
          {j.loading && <small>读取预报…</small>}
          {j.error && (
            <button className="rail-retry" onClick={j.retry}>
              天气重试
            </button>
          )}
          {j.forecast?.stale && (
            <small>旧预报 {beijingTime(j.forecast.fetchedAt)}</small>
          )}
          {legend && (
            <>
              <small>
                左：气温 ·
                右：时雨雪量。拖色带浏览全程；白色滑块为预览，绿色点为定位。
              </small>
              <div className="rail-scale">
                {[-5, 5, 15, 25, 32, 38].map((t) => (
                  <span key={t} style={{ borderColor: temperatureColor(t) }}>
                    {t}°
                  </span>
                ))}
              </div>
              <div className="rail-scale">
                {[0, 0.5, 2, 7, 12].map((r) => (
                  <span key={r} style={{ borderColor: precipitationColor(r) }}>
                    {r}mm
                  </span>
                ))}
              </div>
              <small>灰色为缺测。渐变用于浏览，不增加预报采样精度。</small>
            </>
          )}
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
      {j.forecast && (
        <>
          <p className="route-note">
            {j.forecast.stale ? '离线 / 旧预报快照' : '预报更新'} ·{' '}
            {beijingTime(j.forecast.fetchedAt)}
          </p>
          <div className="departure-options" aria-label="出发时间天气比较">
            {j.alternatives.map((option) => (
              <button
                key={option.offset}
                disabled={!j.validTime}
                onClick={() => j.setDeparture(beijingInput(option.time))}
              >
                {option.offset === 0
                  ? '当前时间'
                  : option.offset < 0
                    ? '提前 2 小时'
                    : '推迟 2 小时'}
                {option.complete
                  ? ` · 最大时雨量 ${option.rain} mm · 风 ${option.wind} m/s`
                  : ' · 超出预报范围或缺测'}
              </button>
            ))}
          </div>
          <p className="route-note">
            比较沿途采样点的最大时雨量与风速，不能代表整条路线的全部天气。
          </p>
        </>
      )}
      {!j.validTime && <p className="route-error">请填写有效时间。</p>}
      {j.error && <p className="route-error">{j.error}</p>}
      <button className="route-primary" disabled={j.loading} onClick={j.retry}>
        {j.loading ? '读取沿途预报…' : '刷新沿途天气'}
      </button>
    </section>
  );
}
