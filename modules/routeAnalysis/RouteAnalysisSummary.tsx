import { useMemo, useState } from 'react';
import type { ManualTrack } from '../tracks/drawing';
import { analyzeRoute } from './metrics';
import { useTrackElevation } from './useTrackElevation';

export function RouteAnalysisSummary({ track }: { track: ManualTrack }) {
  const [open, setOpen] = useState(false);
  const elevation = useTrackElevation(track, open);
  const data = elevation.data ?? track;
  const metrics = useMemo(
    () => analyzeRoute(data),
    [data.segments, data.samples],
  );
  const value = (number: number | null, unit: string) =>
    number === null ? '数据不足' : `${number.toFixed(1)} ${unit}`;
  return (
    <details className="recording-precision" onToggle={e => setOpen(e.currentTarget.open)}>
      <summary>速度与坡度分析</summary>
      <p role="status">{elevation.loading ? '正在读取路线地形高程…' : elevation.estimated ? '坡度包含地形估算高程' : '优先使用轨迹自带高程'}</p>
      {elevation.elevationError && <p role="alert">{elevation.elevationError}</p>}
      <button onClick={elevation.refresh} disabled={elevation.loading}>重新读取地形高程</button>
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
