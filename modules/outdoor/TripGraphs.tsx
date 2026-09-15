import { useMemo, useState } from 'react';
import type { ManualTrack } from '../tracks/drawing';
import type { TrackLinePoint } from '../tracks/linePoint';
import { metresBetween } from '../navigation/types';
import { analyzeRoute } from '../routeAnalysis/metrics';
import {
  routeElevationScale,
  elevationColor,
} from '../routeAnalysis/elevationColors';
import { useTrackElevation } from '../routeAnalysis/useTrackElevation';

export function TripGraphs({
  track,
  onPoint,
}: {
  track: ManualTrack;
  onPoint: (p: TrackLinePoint) => void;
}) {
  const [mode, setMode] = useState<'elevation' | 'speed'>('elevation');
  const elevation = useTrackElevation(track, mode === 'elevation');
  const geometry = elevation.profile ?? track;
  const speed = useMemo(() => analyzeRoute(track), [track]);
  const scale = routeElevationScale(geometry);
  const points = useMemo(() => {
    let d = 0;
    return track.segments.flatMap((line, part) =>
      line.map((p, i) => {
        if (i) d += metresBetween(line[i - 1], p);
        return {
          coordinate: p,
          part,
          distance: d,
          value: speed.speeds[part][Math.max(0, i - 1)] ?? null,
        };
      }),
    );
  }, [track, speed]);
  const heights = useMemo(() => {
    let d = 0;
    return geometry.segments.flatMap((line, part) =>
      line.map((p, i) => {
        if (i) d += metresBetween(line[i - 1], p);
        return {
          coordinate: p,
          part,
          distance: d,
          value: geometry.samples?.[part]?.[i]?.altitude ?? null,
        };
      }),
    );
  }, [geometry]);
  const series = mode === 'speed' ? points : heights;
  const values = series.flatMap((p) => (p.value === null ? [] : [p.value]));
  const min = values.length ? Math.min(...values) : 0,
    max = values.length ? Math.max(...values) : 1;
  const distance = series.at(-1)?.distance ?? 0;
  const x = (d: number) => 8 + (d / (distance || 1)) * 264;
  const y = (v: number) => 55 - ((v - min) / Math.max(1, max - min)) * 43;
  const choose = (d: number) => {
    const nearest = points.reduce(
      (best, p) =>
        Math.abs(p.distance - d) < Math.abs(best.distance - d) ? p : best,
      points[0],
    );
    if (nearest)
      onPoint({
        trackId: track.id,
        coordinate: nearest.coordinate,
        distance: nearest.distance,
      });
  };
  return (
    <section className="trip-graphs" aria-label="行程轨迹图">
      <div className="trip-graph-switch">
        <button
          aria-pressed={mode === 'elevation'}
          onClick={() => setMode('elevation')}
        >
          海拔图
        </button>
        <button
          aria-pressed={mode === 'speed'}
          onClick={() => setMode('speed')}
        >
          速度图
        </button>
        <span>
          {values.length
            ? `${min.toFixed(0)}–${max.toFixed(0)} ${mode === 'speed' ? 'km/h' : 'm'}`
            : '暂无数据'}
        </span>
      </div>
      <svg
        viewBox="0 0 280 70"
        role="img"
        aria-label={
          mode === 'speed' ? '行程速度随里程变化图' : '行程彩色海拔剖面图'
        }
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          choose(
            Math.max(
              0,
              Math.min(1, (((e.clientX - r.left) / r.width) * 280 - 8) / 264),
            ) * distance,
          );
        }}
      >
        <path d="M8 55H272" stroke="#aabcb3" />
        {series.slice(1).map((b, i) => {
          const a = series[i];
          return a.part === b.part && a.value !== null && b.value !== null ? (
            <path
              key={i}
              d={`M${x(a.distance)} ${y(a.value)}L${x(b.distance)} ${y(b.value)}`}
              stroke={
                mode === 'speed'
                  ? '#167bb0'
                  : elevationColor((a.value + b.value) / 2, scale)
              }
              strokeWidth="2"
              fill="none"
            />
          ) : null;
        })}
        <text x="8" y="68">
          0
        </text>
        <text x="272" y="68" textAnchor="end">
          {(distance / 1000).toFixed(2)} km
        </text>
      </svg>
      <small>
        {mode === 'speed'
          ? '区间速度按真实时间计算，缺测与暂停断开。'
          : elevation.estimated
            ? '含地形估算'
            : elevation.loading
              ? '读取高程中…'
              : '轨迹自带高程'}{' '}
        点图查看对应轨迹点
      </small>
      {elevation.elevationError && mode === 'elevation' && (
        <small role="status">
          {elevation.elevationError}
          <button onClick={elevation.refresh}>重试</button>
        </small>
      )}
    </section>
  );
}
