import type { Contour, ProfilePoint } from './contours';
import { noteColor, type ProfileNote } from './profileNotes';
import { useRef } from 'react';
import type { SectionSettings } from './types';
import { useContourPointDrag, type PointActions } from './useContourPointDrag';
import { nearestContourFraction } from './notePosition';
import { chartFrame } from './chartFrame';
import { scaleLabel } from './scale';
export function ProfileChart({
  curves,
  curveId,
  point,
  notes,
  onAdd,
  canAdd,
  settings,
  sampledAt,
  actions,
  onRemove,
  canRemove,
  onScale,
  onEdit,
}: {
  curves: Contour[];
  curveId: string;
  point: ProfilePoint | null;
  notes: ProfileNote[];
  onAdd: () => void;
  canAdd: boolean;
  settings: SectionSettings;
  sampledAt: number;
  actions: PointActions;
  onRemove: () => void;
  canRemove: boolean;
  onScale: () => void;
  onEdit: () => void;
}) {
  const f = chartFrame(
    curves,
    300,
    140,
    notes.map((n) => n.point),
    9,
    settings.scale?.interval ?? 'auto',
  );
  const unit = settings.scale?.unit ?? 'm';
  const chart = useRef<HTMLDivElement>(null),
    curve = curves.find((c) => c.id === curveId)!;
  const bind = useContourPointDrag(
    curve,
    settings,
    sampledAt,
    (x, y) => {
      const r = chart.current!.getBoundingClientRect();
      return nearestContourFraction(
        curve,
        ((x - r.left) / r.width) * 300,
        ((y - r.top) / r.height) * 140,
        (p) => [f.x(p), f.y(p)],
      );
    },
    actions,
  );
  return (
    <div className="section-chart-box">
      <div className="section-chart-toolbar">
        <button className="section-scale-link" onClick={onScale}>
          比例尺设置
        </button>
        <small>{notes.length} 点</small>
        <div className="section-point-tools">
          <button
            className="section-point-data"
            aria-label="编辑选中测点的数据"
            disabled={!canRemove}
            onClick={onEdit}
          >
            数据
          </button>
          <button
            aria-label="删除选中的交线测点"
            title="删除选中的点"
            disabled={!canRemove}
            onClick={onRemove}
          >
            －
          </button>
          <button
            aria-label="添加交线测点"
            title="增加彩色拖动点"
            disabled={!canAdd}
            onClick={onAdd}
          >
            ＋
          </button>
        </div>
      </div>
      <div className="section-chart-plot" ref={chart}>
        <svg
          className="section-chart"
          viewBox="0 0 300 140"
          role="img"
          aria-label={`交界轮廓图，横轴U纵轴V为剖面内距离，单位${unit === 'm' ? '米' : '千米'}`}
        >
          <rect
            x=".5"
            y=".5"
            width="299"
            height="139"
            rx="5"
            fill="#102532"
            stroke="#52756e"
          />
          {f.uTicks.ticks.map((u) => (
            <g key={`u${u}`}>
              <line
                x1={f.x({ u })}
                x2={f.x({ u })}
                y1={f.top}
                y2={f.bottom}
                stroke="#52756e55"
              />
              <text x={f.x({ u })} y={f.bottom + 12} textAnchor="middle">
                {scaleLabel(u, unit)}
              </text>
            </g>
          ))}
          {f.vTicks.ticks.map((v) => (
            <g key={`v${v}`}>
              <line
                y1={f.y({ v })}
                y2={f.y({ v })}
                x1={f.left}
                x2={f.right}
                stroke="#52756e55"
              />
              <text x={f.left - 5} y={f.y({ v }) + 3} textAnchor="end">
                {scaleLabel(v, unit)}
              </text>
            </g>
          ))}
          {curves.map((c) => (
            <polyline
              key={c.id}
              points={c.points.map((p) => `${f.x(p)},${f.y(p)}`).join(' ')}
              fill="none"
              stroke={c.id === curveId ? '#ffb85f' : '#5e8f83'}
              strokeWidth={c.id === curveId ? 2 : 1}
            />
          ))}
          {notes.map((n, i) => (
            <g key={n.id} className="section-chart-note">
              <title>
                {n.name} · 海拔 {n.point.altitude.toFixed(2)} m
              </title>
              <circle
                cx={f.x(n.point)}
                cy={f.y(n.point)}
                r="5"
                fill={noteColor(n, i)}
                stroke="#442657"
              />
              <text x={f.x(n.point) + 7} y={f.y(n.point) - 5}>
                {i + 1}
              </text>
            </g>
          ))}
          {point && (
            <circle
              cx={f.x(point)}
              cy={f.y(point)}
              r="3"
              fill="white"
              stroke="#ffb85f"
            />
          )}
          <text x="5" y="12">
            V / {unit}
          </text>
          <text x="266" y="136">
            U / {unit}
          </text>
          <g
            className="section-scale-bar"
            aria-label={`比例尺 ${scaleLabel(f.bar, unit)} ${unit}`}
          >
            <path
              d={`M ${f.right - f.bar * f.scale} 10 v 4 H ${f.right} v -4`}
              fill="none"
              stroke="#d9f6ed"
              strokeWidth="1"
            />
            <text x={f.right - (f.bar * f.scale) / 2} y="9" textAnchor="middle">
              {scaleLabel(f.bar, unit)} {unit}
            </text>
          </g>
        </svg>
        {notes.map(
          (n) =>
            n.curveName === curve.name &&
            n.source === curve.source && (
              <button
                key={n.id}
                className="section-chart-point-handle"
                aria-label={`交线上拖动测点 ${n.name}`}
                title={`${n.name} · 点按选择，拖动调整，双击编辑`}
                style={{
                  left: `${(f.x(n.point) / 300) * 100}%`,
                  top: `${(f.y(n.point) / 140) * 100}%`,
                }}
                {...bind(n)}
              />
            ),
        )}
      </div>
    </div>
  );
}
