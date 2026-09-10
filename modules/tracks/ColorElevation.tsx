import { useMemo, useState } from 'react';
import type { ManualTrack } from './drawing';
import {
  routeColorSections,
  sectionElevation,
  groupColorSections,
} from './colorSections';
import { elevationStats, type ElevationSample } from '../journey/metrics';
import { formatDistance, type Coordinate } from '../navigation/types';
import './colorElevation.css';
type Geometry = Pick<
  ManualTrack,
  'segments' | 'style' | 'edgeColors' | 'colorConditions'
>;
const metres = (v: number | null) => (v === null ? '—' : `${Math.round(v)} m`);

export function ColorElevation({
  track,
  lines,
  samples,
  onCondition,
}: {
  track: Geometry;
  lines?: Coordinate[][];
  samples: ElevationSample[];
  onCondition?: (color: string, value: string) => boolean;
}) {
  const sections = useMemo(
    () => routeColorSections(track, lines),
    [track, lines],
  );
  const [selected, setSelected] = useState<string | null>(null),
    [error, setError] = useState('');
  const stats = elevationStats(samples),
    total = sections.at(-1)?.end || 1;
  const low = stats.min ?? 0,
    range = Math.max(10, (stats.max ?? 0) - low);
  const x = (d: number) => 42 + (d / total) * 296,
    y = (h: number) => 116 - ((h - low) / range) * 94;
  const rows = sections.map((s) => ({
    ...s,
    samples: sectionElevation(samples, s),
  }));
  const groups = groupColorSections(sections);
  return (
    <section className="color-elevation" aria-label="分色路段与海拔">
      <header>
        <strong>分色路段 · 海拔</strong>
        <small>同色合为一项 · 点色块查看</small>
      </header>
      <svg viewBox="0 0 350 149" role="img" aria-label="按路线颜色区分的高度图">
        {[0, 0.5, 1].map((n) => (
          <g key={n}>
            <path
              d={`M42 ${y(low + range * n)}H338`}
              stroke="#cad1c6"
              strokeDasharray="3 3"
            />
            <text x="38" y={y(low + range * n) + 3} textAnchor="end">
              {Math.round(low + range * n)}
            </text>
          </g>
        ))}
        {rows.map((row, i) => {
          const runs: ElevationSample[][] = [];
          let current: ElevationSample[] = [];
          for (const p of row.samples) {
            if (p.elevation === null) {
              if (current.length) runs.push(current);
              current = [];
            } else current.push(p);
          }
          if (current.length) runs.push(current);
          return (
            <g
              key={i}
              opacity={
                selected === null || selected === row.color.toLowerCase()
                  ? 1
                  : 0.25
              }
            >
              <rect
                x={x(row.start)}
                y={121}
                width={Math.max(0.2, x(row.end) - x(row.start))}
                height={5}
                fill={row.color}
              />
              {runs.map((run, j) => {
                const path = run
                  .map(
                    (p, k) =>
                      `${k ? 'L' : 'M'}${x(p.distance)},${y(p.elevation!)}`,
                  )
                  .join(' ');
                return (
                  <g key={j}>
                    <path
                      d={`${path} L${x(run.at(-1)!.distance)},116 L${x(run[0].distance)},116 Z`}
                      fill={row.color}
                      fillOpacity="0.25"
                    />
                    <path
                      d={path}
                      fill="none"
                      stroke={row.color}
                      strokeWidth="2.5"
                    />
                  </g>
                );
              })}
            </g>
          );
        })}
        <text x="42" y="144">
          0 km
        </text>
        <text x="338" y="144" textAnchor="end">
          {(total / 1000).toFixed(2)} km
        </text>
      </svg>
      {!stats.available && <p>海拔尚不可用；颜色条显示沿线范围。</p>}
      <div className="color-section-list">
        {groups.map((row, i) => {
          const points = row.sections.flatMap((s) =>
            sectionElevation(samples, s),
          );
          const h = elevationStats(points);
          return (
            <article key={row.color}>
              <button
                aria-label={`查看第 ${i + 1} 段海拔`}
                aria-pressed={selected === row.color}
                onClick={() =>
                  setSelected(selected === row.color ? null : row.color)
                }
              >
                <i style={{ background: row.color }} />
                <strong>第 {i + 1} 段</strong>
                <span>{formatDistance(row.length)}</span>
              </button>
              <small>
                同色累计 · 海拔 {metres(h.min)}～{metres(h.max)}
                {points.some((s) => s.elevation === null) ? '（部分缺测）' : ''}
              </small>
              <label>
                路况
                {onCondition ? (
                  <input
                    aria-label={`第 ${i + 1} 段路况`}
                    key={row.condition}
                    defaultValue={row.condition}
                    placeholder="未录入，如土路、碎石路"
                    maxLength={1600}
                    onBlur={(e) => {
                      if (e.target.value === row.condition) return;
                      if (onCondition(row.color, e.target.value)) setError('');
                      else setError('路况未保存，请检查存储后重试');
                    }}
                  />
                ) : (
                  <span>{row.condition || '未录入'}</span>
                )}
              </label>
            </article>
          );
        })}
      </div>
      <p>
        海拔为地形采样估算；缺测处断开。
        {onCondition ? '同色路段共用路况记录。' : ''}
      </p>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
