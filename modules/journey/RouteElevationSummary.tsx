import { useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts';
import {
  formatDistance,
  formatDuration,
  type Coordinate,
} from '../navigation/types';
import { elevationStats, sampleTerrain, type ElevationSample } from './metrics';
import { readProfile } from './elevationProvider';

const metres = (n: number | null) =>
  n === null ? '—' : `${Math.round(n).toLocaleString()} m`;
export function RouteElevationSummary({
  coordinates,
  distance,
  duration,
}: {
  coordinates: Coordinate[];
  distance: number;
  duration: number;
}) {
  const samples = useMemo(() => sampleTerrain([coordinates]), [coordinates]);
  const [result, setResult] = useState<{
    samples: typeof samples;
    data: ElevationSample[];
    loading: boolean;
    error: string;
  } | null>(null);
  useEffect(() => {
    const request = new AbortController();
    setResult({ samples, data: [], loading: true, error: '' });
    const timer = setTimeout(() => request.abort(), 20000);
    void readProfile(samples, request.signal)
      .then((data) => {
        if (!request.signal.aborted)
          setResult({ samples, data, loading: false, error: '' });
      })
      .catch(() => {
        if (!request.signal.aborted)
          setResult({
            samples,
            data: [],
            loading: false,
            error: '海拔暂不可用',
          });
      })
      .finally(() => clearTimeout(timer));
    request.signal.addEventListener(
      'abort',
      () =>
        setResult((old) =>
          old?.samples === samples
            ? { ...old, loading: false, error: '海拔读取未完成' }
            : old,
        ),
      { once: true },
    );
    return () => {
      clearTimeout(timer);
      request.abort();
    };
  }, [samples]);
  const data = result?.samples === samples ? result.data : [],
    stats = elevationStats(data);
  return (
    <section className="route-elevation" aria-label="当前导航方案海拔与统计">
      <div className="route-elevation-heading">
        <strong>海拔变化</strong>
        <small>起点 → 终点</small>
      </div>
      <div
        className="route-elevation-chart"
        aria-label={`起点${metres(stats.start)}，终点${metres(stats.end)}`}
      >
        {stats.available > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={data}
              margin={{ top: 8, right: 6, bottom: 0, left: 0 }}
            >
              <CartesianGrid stroke="#cad1c6" strokeDasharray="3 3" />
              <XAxis
                dataKey="distance"
                type="number"
                domain={[0, distance]}
                tick={{ fontSize: 10 }}
                tickFormatter={(n) => `${(Number(n) / 1000).toFixed(1)}`}
                height={20}
              />
              <YAxis
                domain={['dataMin - 20', 'dataMax + 20']}
                tick={{ fontSize: 10 }}
                width={39}
                tickCount={3}
                tickFormatter={(n) => String(Math.round(Number(n)))}
              />
              <Area
                dataKey="elevation"
                stroke="#1d6748"
                fill="#b5d5a4"
                fillOpacity={0.7}
                isAnimationActive={false}
                connectNulls={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <span role="status">
            {result?.loading
              ? '正在读取沿线海拔…'
              : result?.error || '暂无海拔数据'}
          </span>
        )}
      </div>
      <div className="route-elevation-ends">
        <span>起 {metres(stats.start)}</span>
        <span>终 {metres(stats.end)} · km</span>
      </div>
      <dl className="route-metric-grid">
        {[
          ['总里程', formatDistance(distance)],
          ['预计用时', formatDuration(duration)],
          ['累计爬升', metres(stats.ascent)],
          ['累计下降', metres(stats.descent)],
          ['最高海拔', metres(stats.max)],
          ['最低海拔', metres(stats.min)],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <small className="route-estimate-note">
        地形估算 · 用时仅供参考
        {data.length && !stats.complete ? ' · 部分海拔缺失' : ''}
      </small>
    </section>
  );
}
