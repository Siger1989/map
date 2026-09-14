import { useMemo } from 'react';
import type { ManualTrack } from '../tracks/drawing';
import { analyzeRoute } from './metrics';

export function RouteAnalysisSummary({ track }: { track: ManualTrack }) {
  const metrics = useMemo(
    () => analyzeRoute(track),
    [track.segments, track.samples],
  );
  const value = (number: number | null, unit: string) =>
    number === null ? '数据不足' : `${number.toFixed(1)} ${unit}`;
  return (
    <details className="recording-precision">
      <summary>速度与坡度分析</summary>
      <dl className="route-data-rows">
        {[
          ['最高区间速度', value(metrics.maximumSpeedKmh, 'km/h')],
          ['最大采样坡度', value(metrics.maximumSlopePercent, '%')],
          ['最陡连续50米', value(metrics.steepest50mPercent, '%')],
          [
            '连续50米≥20%',
            metrics.steepest50mPercent === null
              ? '数据不足'
              : `${metrics.steepSections}段`,
          ],
        ].map(([label, result]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{result}</dd>
          </div>
        ))}
      </dl>
      <p className="route-note">
        依据逐点时间和高程估算，暂停与缺测不连算。坡度不代表道路可通行性；没有高程的数据不会猜测陡坡。
      </p>
    </details>
  );
}
