import type { ElevationSample } from '../journey/metrics';
import {
  elevationColor,
  type ElevationScale,
} from '../routeAnalysis/elevationColors';
import { profileProgress } from './profileProgress';
const hasElevation = (value: number | null): value is number =>
  typeof value === 'number' && Number.isFinite(value);
export function RouteElevationProfile({
  samples,
  scale,
  progress,
  compact = false,
  endpoints = false,
  selection,
  status,
}: {
  samples: ElevationSample[];
  scale: ElevationScale;
  progress?: number | null;
  compact?: boolean;
  endpoints?: boolean;
  selection?: { distance: number; elevation: number | null } | null;
  status?: string;
}) {
  const routeProgress = profileProgress(samples, progress);
  const distance = routeProgress.routeDistance;
  const width = compact ? 240 : 180, baseline = compact ? 38 : 58, height = compact ? 52 : 74;
  const x = (d: number) => 4 + (Math.max(0, Math.min(distance, Number.isFinite(d) ? d : 0)) / (distance || 1)) * (width - 8);
  const y = (h: number) =>
    baseline -
    ((h - (scale?.min ?? 0)) /
      Math.max(1, (scale?.max ?? 0) - (scale?.min ?? 0))) *
      (compact ? 26 : 44);
  const atSelection = selection && Number.isFinite(selection.distance)
    ? Math.max(0, Math.min(distance, selection.distance))
    : null;
  const selectionElevation = selection && typeof selection.elevation === 'number' && Number.isFinite(selection.elevation)
    ? selection.elevation
    : null;
  const missingStatus = selection && selectionElevation === null
    ? '所选点高程缺失'
    : routeProgress.distance !== null && routeProgress.elevation === null
      ? '当前位置高程缺失'
      : undefined;
  const profileStatus = [status, missingStatus].filter((value, index, all) =>
    value && all.indexOf(value) === index,
  ).join(' · ');
  const fillPath = (points: { distance: number; elevation: number }[]) => {
    const curve = points.map((point, index) =>
      `${index === 0 ? 'M' : 'L'}${x(point.distance)} ${y(point.elevation)}`,
    ).join(' ');
    const first = points[0], last = points.at(-1)!;
    return `${curve} L${x(last.distance)} ${baseline} L${x(first.distance)} ${baseline} Z`;
  };
  return (
    <section
      className="route-elevation-profile glass"
      aria-label="地图路线海拔剖面"
    >
      <strong>海拔剖面</strong>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`路线海拔剖面，全长 ${(distance / 1000).toFixed(1)} 公里`}
      >
        <path d={`M4 ${baseline}H${width - 4}`} stroke="#8b9699" strokeWidth="0.5" />
        {routeProgress.fillSegments.map((segment, index) => (
          <path key={`progress-fill-${index}`} d={fillPath(segment)} fill="#16833e" fillOpacity="0.22" aria-label="已行路线海拔填充" />
        ))}
        {samples.slice(1).map((b, i) => {
          const a = samples[i];
          return a.part === b.part && Number.isFinite(a.distance) &&
            Number.isFinite(b.distance) && hasElevation(a.elevation) &&
            hasElevation(b.elevation) ? (
            <path
              key={i}
              d={`M${x(a.distance)} ${y(a.elevation)}L${x(b.distance)} ${y(b.elevation)}`}
              stroke={elevationColor((a.elevation + b.elevation) / 2, scale)}
              strokeWidth="2"
              fill="none"
            />
          ) : null;
        })}
        <text x="4" y={height - 2}>
          {endpoints ? '起点 · 0' : '0'}
        </text>
        {routeProgress.distance !== null && <g aria-label={routeProgress.elevation === null ? '当前位置，高程缺失' : '当前位置'}>
          <path d={`M${x(routeProgress.distance)} ${routeProgress.elevation === null ? 12 : y(routeProgress.elevation)}V${baseline}`} stroke="#15572b" strokeWidth="0.8" strokeDasharray="2 2" />
          <circle cx={x(routeProgress.distance)} cy={routeProgress.elevation === null ? baseline : y(routeProgress.elevation)} r="3" fill={routeProgress.elevation === null ? 'white' : '#16833e'} stroke="#15572b" strokeWidth="1" />
        </g>}
        {selection && atSelection !== null && <g aria-label={selectionElevation === null ? '所选路线点，高程缺失' : '所选路线点'}>
          <path d={`M${x(atSelection)} 12V${baseline}`} stroke="#ffad55" strokeWidth="1" strokeDasharray="4 2" />
          <path d={`M${x(atSelection)} ${(selectionElevation === null ? baseline : y(selectionElevation)) - 4}l4 4-4 4-4-4z`} fill={selectionElevation === null ? 'white' : '#ffad55'} stroke="#603b13" strokeWidth="1" />
        </g>}
        <text x={width - 4} y={height - 2} textAnchor="end">
          {endpoints ? '终点 · ' : ''}{(distance / 1000).toFixed(1)} km
        </text>
        <text x="4" y="10">
          {scale
            ? `${Math.round(scale.min)}–${Math.round(scale.max)} m`
            : '暂无高程'}
        </text>
        {profileStatus && <text x={width - 4} y="10" textAnchor="end" aria-label="高程状态">{profileStatus}</text>}
      </svg>
    </section>
  );
}
