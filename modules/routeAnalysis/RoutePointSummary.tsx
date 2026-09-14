import { useMemo } from 'react';
import type { ManualTrack } from '../tracks/drawing';
import type { TrackLinePoint } from '../tracks/linePoint';
import { formatDistance } from '../navigation/types';
import { useTrackElevation } from './useTrackElevation';
import { analyzeRoute } from './metrics';
import { routePointMetrics } from './pointMetrics';
import './routePoint.css';

export function RoutePointSummary({
  track,
  point,
}: {
  track: ManualTrack;
  point: TrackLinePoint;
}) {
  const elevation = useTrackElevation(track, true),
    profile = elevation.profile ?? track;
  const originalAnalysis = useMemo(() => analyzeRoute(track), [track]);
  const profileAnalysis = useMemo(() => analyzeRoute(profile), [profile]);
  const data = useMemo(
    () =>
      routePointMetrics(
        track,
        point,
        profile,
        profileAnalysis,
        originalAnalysis,
      ),
    [track, point, profile, profileAnalysis, originalAnalysis],
  );
  if (!data) return null;
  const grade =
    data.slopePercent === null
      ? '数据不足'
      : `${data.slopePercent > 0 ? '+' : ''}${data.slopePercent.toFixed(1)}%（${data.slopeDegrees!.toFixed(1)}°）`;
  const source =
    data.elevationSource === 'terrain'
      ? '地形估算'
      : data.elevationSource === 'interpolated'
        ? '轨迹高程插值'
        : data.elevationSource === 'original'
          ? '轨迹自带高程'
          : elevation.loading
            ? '读取高程中…'
            : '暂无高程';
  return (
    <section className="route-point-summary" aria-label="所选点数据">
      <div className="route-point-values">
        <span>
          海拔{' '}
          <b>
            {data.elevation === null ? '—' : `${Math.round(data.elevation)} m`}
          </b>
        </span>
        <span>
          路段坡度 <b>{grade}</b>
        </span>
      </div>
      <details>
        <summary>
          {data.pointIndex === null
            ? '沿线选点'
            : `第 ${data.part + 1} 段 · 第 ${data.pointIndex + 1} 点`}{' '}
          · {formatDistance(data.distance)} · 点数据
        </summary>
        <dl>
          <dt>经纬度</dt>
          <dd>
            {data.coordinate[0].toFixed(6)}，{data.coordinate[1].toFixed(6)}
          </dd>
          <dt>区间速度</dt>
          <dd>
            {data.speedKmh === null
              ? '无有效记录时间'
              : `${data.speedKmh.toFixed(1)} km/h`}
          </dd>
          <dt>{data.timeInterpolated ? '时间插值' : '记录时间'}</dt>
          <dd>
            {data.timestamp === null
              ? '未记录'
              : new Date(data.timestamp).toLocaleString()}
          </dd>
        </dl>
        <p>
          {source}；坡度按路线前进方向，附近有效路段估算
          {elevation.estimated ? '，包含地形估算高程' : ''}。
        </p>
        {elevation.elevationError && (
          <p role="status">{elevation.elevationError}</p>
        )}
      </details>
    </section>
  );
}
