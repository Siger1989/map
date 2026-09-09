import { useEffect, useRef, useState } from 'react';
import {
  LocateFixed,
  Plus,
  Save,
  Share2,
  RotateCcw,
  Undo2,
  X,
} from 'lucide-react';
import type { WatchProjection } from '../objectTransform/projection';
import type { Coordinate } from '../navigation/types';
import type { MeasurementState } from './useMeasurement';
import {
  measurementMetrics,
  pointLabel,
  MAX_POINTS,
  lengthLabel,
  type MeasurePoint,
} from './data';
import { MeasureLines, projectMeasure, useMeasureFrame } from './MeasureLines';
import { MeasurementShare } from './MeasurementShare';
import './measurement.css';

const positionLabel = (p: MeasurePoint) =>
  `${Math.abs(p.coordinates[1]).toFixed(6)}°${p.coordinates[1] < 0 ? 'S' : 'N'} ${Math.abs(p.coordinates[0]).toFixed(6)}°${p.coordinates[0] < 0 ? 'W' : 'E'}`;
export function Measurement({
  state,
  watchProjection,
  projectGround,
  onBegin,
  toCoordinate,
  groundElevation,
  elevationScale,
}: {
  elevationScale: number;
  state: MeasurementState;
  watchProjection: WatchProjection;
  onBegin: () => void;
  projectGround: (point: MeasurePoint) => { x: number; y: number } | null;
  toCoordinate: (p: { x: number; y: number }) => Coordinate | null;
  groundElevation: (p: Coordinate) => number | null;
}) {
  const [showCoordinates, setShowCoordinates] = useState(true);
  const [showSaved, setShowSaved] = useState(false),
    [sharing, setSharing] = useState<{
      points: MeasurePoint[];
      name: string;
    } | null>(null);
  const frame = useMeasureFrame(watchProjection);
  const tabs = useRef<HTMLDivElement>(null);
  useEffect(() => {
    tabs.current
      ?.querySelector(
        `[data-point="${state.slot ?? state.points.findIndex((p) => p.id === state.selected)}"]`,
      )
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [state.slot, state.selected]);
  const [preview, setPreview] = useState<{
    id: string;
    coordinates: Coordinate;
  } | null>(null);
  const root = useRef<SVGSVGElement>(null);
  const drag = useRef<{
    id: string;
    pointer: number;
    startX: number;
    startY: number;
    moved: boolean;
    coordinate: Coordinate | null;
  } | null>(null);
  const points = state.points.map((p) =>
    preview?.id === p.id
      ? { ...p, coordinates: preview.coordinates, altitude: null }
      : p,
  );
  const project = (p: MeasurePoint) =>
    projectMeasure(p, frame, elevationScale, projectGround);
  const screen = points.map(project),
    total = measurementMetrics(points);
  const segment = Math.max(
    0,
    points.findIndex((p) => p.id === state.selected) - 1,
  );
  const metrics = total.segments[segment];
  const labels = Array.from(
    {
      length: Math.max(
        2,
        points.length + (state.slot === points.length ? 1 : 0),
      ),
    },
    (_, i) => i,
  );
  return (
    <>
      <svg
        ref={root}
        className="measurement-overlay"
        aria-label="多点测量连线与水平投影"
        width="100%"
        height="100%"
      >
        <MeasureLines points={points} project={project} />
        {screen.map(
          (p, i) =>
            p && (
              <g
                key={points[i].id}
                transform={`translate(${p.x},${p.y})`}
                role="button"
                tabIndex={0}
                aria-label={`拖动测量点 ${pointLabel(i)}`}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (drag.current) {
                    drag.current = null;
                    setPreview(null);
                    return;
                  }
                  if (e.button !== 0) return;
                  onBegin();
                  state.select(points[i].id);
                  e.currentTarget.setPointerCapture(e.pointerId);
                  drag.current = {
                    id: points[i].id,
                    pointer: e.pointerId,
                    startX: e.clientX,
                    startY: e.clientY,
                    moved: false,
                    coordinate: null,
                  };
                }}
                onPointerMove={(e) => {
                  const d = drag.current,
                    bounds = root.current?.getBoundingClientRect();
                  if (!d || d.pointer !== e.pointerId || !bounds) return;
                  e.stopPropagation();
                  if (
                    !d.moved &&
                    Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 4
                  )
                    return;
                  d.moved = true;
                  const c = toCoordinate({
                    x: e.clientX - bounds.left,
                    y: e.clientY - bounds.top,
                  });
                  if (c) {
                    d.coordinate = c;
                    setPreview({ id: d.id, coordinates: c });
                  }
                }}
                onPointerUp={(e) => {
                  e.stopPropagation();
                  const d = drag.current;
                  if (d?.pointer !== e.pointerId) return;
                  drag.current = null;
                  setPreview(null);
                  if (d.moved && d.coordinate)
                    state.move(
                      d.id,
                      d.coordinate,
                      groundElevation(d.coordinate),
                    );
                }}
                onPointerCancel={() => {
                  drag.current = null;
                  setPreview(null);
                }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    state.select(points[i].id);
                  }
                  const delta: Record<string, [number, number]> = {
                    ArrowLeft: [-8, 0],
                    ArrowRight: [8, 0],
                    ArrowUp: [0, -8],
                    ArrowDown: [0, 8],
                  };
                  if (delta[e.key]) {
                    e.preventDefault();
                    onBegin();
                    const [dx, dy] = delta[e.key];
                    const c = toCoordinate({ x: p.x + dx, y: p.y + dy });
                    if (c) state.move(points[i].id, c, groundElevation(c));
                  }
                }}
              >
                <circle r="22" className="measurement-hit" />
                <circle r="8" fill={i === 0 ? '#ffcf45' : '#3478ed'} />
                <text textAnchor="middle" dy="-16">
                  {pointLabel(i)}
                </text>
              </g>
            ),
        )}
      </svg>
      <section
        className="measurement-panel"
        aria-label="连线测量"
        data-dragging={!!preview}
      >
        <header>
          <div className="measurement-tabs" ref={tabs} aria-label="测量点">
            {labels.map((i) => (
              <button
                key={i}
                data-point={i}
                aria-label={`选择测量点 ${pointLabel(i)}`}
                aria-pressed={
                  state.slot === i ||
                  (state.slot === null && state.selected === points[i]?.id)
                }
                onClick={() => state.pick(i)}
              >
                {pointLabel(i)}
              </button>
            ))}
          </div>
          <button
            aria-label="显示测量坐标"
            aria-expanded={showCoordinates}
            onClick={() => setShowCoordinates(!showCoordinates)}
          >
            <LocateFixed size={17} />
          </button>
          <button
            disabled={points.length < 2 || !state.saved.ready || state.isSaved}
            aria-label={
              state.isSaved
                ? '测量已保存'
                : state.record
                  ? '更新地图测量'
                  : '保存测量到地图'
            }
            onClick={state.saveToMap}
          >
            <Save size={16} />
          </button>
          <button
            disabled={points.length < 2}
            aria-label="分享测量剖面图"
            onClick={() =>
              setSharing({
                points: structuredClone(points),
                name: state.record?.name ?? '连线测量',
              })
            }
          >
            <Share2 size={16} />
          </button>
          <button onClick={state.close} aria-label="关闭测量">
            <X size={17} />
          </button>
        </header>
        {showCoordinates && (
          <div
            className="measurement-coordinates"
            aria-label="测量点坐标和地面海拔"
          >
            {labels.map((i) => (
              <div key={i}>
                <b>{pointLabel(i)}</b>
                <span>
                  {points[i]
                    ? positionLabel(points[i])
                    : '点地图或已有标记选择'}
                </span>
                <small>
                  {points[i]
                    ? state.reading.includes(points[i].id)
                      ? '读取中'
                      : points[i].altitude === null
                        ? '海拔暂无'
                        : `${points[i].altitude!.toFixed(1)} m`
                    : '—'}
                </small>
              </div>
            ))}
          </div>
        )}
        <div className="measurement-helper">
          <span>
            {state.slot !== null
              ? `请选择 ${pointLabel(state.slot)}：点地图空白或已有标记`
              : state.isSaved
                ? '已保存到地图 · 拖点可修改'
                : '拖点调整 · ＋继续添加 · 保存留在地图'}
          </span>
          <button
            className="measurement-add"
            disabled={points.length >= MAX_POINTS}
            aria-label="添加测量点"
            onClick={() => state.pick(points.length)}
          >
            <Plus size={15} />
            添加点
          </button>
          <button
            aria-expanded={showSaved}
            onClick={() => setShowSaved(!showSaved)}
          >
            已存 {state.saved.items.length}
          </button>
          <button
            disabled={!state.canUndo}
            onClick={state.undo}
            aria-label="撤销测量操作"
          >
            <Undo2 size={15} />
          </button>
          <button onClick={state.clear} aria-label="重新测量">
            <RotateCcw size={15} />
          </button>
        </div>
        {showSaved && (
          <div className="measurement-saved-list" aria-label="已保存测量列表">
            {state.saved.items.map((item) => (
              <div key={item.id}>
                <button
                  onClick={() => {
                    state.load(item);
                    setShowSaved(false);
                  }}
                >
                  {item.name} · {item.points.length} 点
                </button>
                <button
                  aria-label={`移除${item.name}`}
                  onClick={() => state.saved.remove(item.id)}
                >
                  <X size={15} />
                </button>
              </div>
            ))}
            {!state.saved.items.length && <p>保存后，关闭测量仍会留在地图上</p>}
            {state.saved.canRestore && (
              <button onClick={state.saved.restore}>撤销移除</button>
            )}
          </div>
        )}
        {state.saved.error && <p role="alert">{state.saved.error}</p>}
        {state.error && <p role="alert">{state.error}</p>}
      </section>
      {metrics && (
        <aside className="measurement-result" aria-label="当前线段测量结果">
          <div>
            <strong>
              {metrics.inclination === null
                ? '—'
                : `${metrics.inclination.toFixed(1)}°`}
            </strong>
            <span>与水平面夹角</span>
          </div>
          <p>
            朝向{' '}
            {metrics.bearing === null ? '—' : `${metrics.bearing.toFixed(1)}°`}{' '}
            · {pointLabel(segment)} → {pointLabel(segment + 1)}
          </p>
          <p>
            水平 {lengthLabel(metrics.horizontal)} · 高差{' '}
            {metrics.rise === null
              ? '—'
              : `${metrics.rise >= 0 ? '+' : ''}${metrics.rise.toFixed(1)} m`}
          </p>
          <svg
            className="measurement-schematic"
            viewBox="0 0 220 64"
            role="img"
            aria-label="水平参考线与垂直投影示意，非等比"
          >
            <path
              d={
                metrics.rise !== null && metrics.rise < 0
                  ? 'M15 10 H195 V46'
                  : 'M15 46 H195 V10'
              }
              fill="none"
              stroke="#a4d9ef"
              strokeDasharray="4 3"
            />
            <path
              d={
                metrics.rise !== null && metrics.rise < 0
                  ? 'M15 10 L195 46'
                  : 'M15 46 L195 10'
              }
              fill="none"
              stroke="#ffcf45"
              strokeWidth="2"
            />
            <text x="65" y="60">
              水平线
            </text>
            <text x="196" y="30">
              投影
            </text>
            <text x="1" y={metrics.rise !== null && metrics.rise < 0 ? 10 : 46}>
              {pointLabel(segment)}
            </text>
            <text
              x="196"
              y={metrics.rise !== null && metrics.rise < 0 ? 48 : 10}
            >
              {pointLabel(segment + 1)}
            </text>
            <text x="55" y="25">
              夹角{' '}
              {metrics.inclination === null
                ? '—'
                : metrics.inclination.toFixed(1) + '°'}
            </text>
          </svg>
          <small>示意非等比 · 虚线为水平线及垂直投影</small>
          {points.length > 2 && (
            <div className="measurement-segments">
              <button
                disabled={segment === 0}
                onClick={() => state.select(points[segment].id)}
              >
                上一段
              </button>
              <span>总水平 {lengthLabel(total.horizontal)}</span>
              <button
                disabled={segment >= points.length - 2}
                onClick={() => state.select(points[segment + 2].id)}
              >
                下一段
              </button>
            </div>
          )}
          {metrics.rise === null && (
            <button onClick={state.retryHeights}>
              {preview
                ? '松手后读取海拔'
                : state.reading.length
                  ? '正在读取地面海拔…'
                  : '海拔暂无 · 重试'}
            </button>
          )}
        </aside>
      )}
      {sharing && (
        <MeasurementShare
          points={sharing.points}
          name={sharing.name}
          onClose={() => setSharing(null)}
        />
      )}
    </>
  );
}
