import type { ElevationSample } from '../journey/metrics';
import {
  elevationColor,
  type ElevationScale,
} from '../routeAnalysis/elevationColors';
export function RouteElevationProfile({
  samples,
  scale,
}: {
  samples: ElevationSample[];
  scale: ElevationScale;
}) {
  const distance = samples.at(-1)?.distance ?? 0;
  const x = (d: number) => 4 + (d / (distance || 1)) * 172;
  const y = (h: number) =>
    58 -
    ((h - (scale?.min ?? 0)) /
      Math.max(1, (scale?.max ?? 0) - (scale?.min ?? 0))) *
      44;
  return (
    <section
      className="route-elevation-profile glass"
      aria-label="地图路线海拔剖面"
    >
      <strong>海拔剖面</strong>
      <svg
        viewBox="0 0 180 74"
        role="img"
        aria-label={`路线海拔剖面，全长 ${(distance / 1000).toFixed(1)} 公里`}
      >
        <path d="M4 58H176" stroke="#8b9699" strokeWidth="0.5" />
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
        <text x="4" y="72">
          0
        </text>
        <text x="176" y="72" textAnchor="end">
          {(distance / 1000).toFixed(1)} km
        </text>
        <text x="4" y="10">
          {scale
            ? `${Math.round(scale.min)}–${Math.round(scale.max)} m`
            : '暂无高程'}
        </text>
      </svg>
    </section>
  );
}
