import type { ElevationSample } from '../journey/metrics';
import {
  elevationColor,
  type ElevationScale,
} from '../routeAnalysis/elevationColors';
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
  const distance = samples.at(-1)?.distance ?? 0;
  const width = compact ? 240 : 180, baseline = compact ? 38 : 58, height = compact ? 52 : 74;
  const x = (d: number) => 4 + (d / (distance || 1)) * (width - 8);
  const y = (h: number) =>
    baseline -
    ((h - (scale?.min ?? 0)) /
      Math.max(1, (scale?.max ?? 0) - (scale?.min ?? 0))) *
      (compact ? 26 : 44);
  const next = progress == null ? -1 : samples.findIndex(s => s.distance >= progress);
  const before = samples[Math.max(0, next - 1)], after = samples[next];
  const altitude = progress != null && before?.elevation != null && after?.elevation != null && before.part === after.part
    ? before.elevation + (after.elevation - before.elevation) * ((progress - before.distance) / (after.distance - before.distance || 1)) : null;
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
        {samples.slice(1).map((b, i) => {
          const a = samples[i];
          return a.part === b.part &&
            a.elevation !== null &&
            b.elevation !== null ? (
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
        {altitude !== null && progress != null && <g aria-label="当前位置">
          <path d={`M${x(progress)} ${y(altitude)}V${baseline}`} stroke="#15572b" strokeWidth="0.6" strokeDasharray="2 2" />
          <circle cx={x(progress)} cy={y(altitude)} r="3" fill="#16833e" stroke="white" strokeWidth="1" />
        </g>}
        {selection && <g aria-label={selection.elevation===null?'所选路线点，高程缺失':'所选路线点'}>
          <path d={`M${x(selection.distance)} 12V${baseline}`} stroke="#146743" strokeWidth="0.8" strokeDasharray="2 2" />
          <circle cx={x(selection.distance)} cy={selection.elevation===null?baseline:y(selection.elevation)} r="3.5" fill={selection.elevation===null?'white':'#16833e'} stroke="white" strokeWidth="1.2" />
        </g>}
        <text x={width - 4} y={height - 2} textAnchor="end">
          {endpoints ? '终点 · ' : ''}{(distance / 1000).toFixed(1)} km
        </text>
        <text x="4" y="10">
          {scale
            ? `${Math.round(scale.min)}–${Math.round(scale.max)} m`
            : '暂无高程'}
        </text>
        {status && <text x={width - 4} y="10" textAnchor="end" aria-label="高程状态">{status}</text>}
      </svg>
    </section>
  );
}
