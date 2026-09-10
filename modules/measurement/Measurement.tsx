import { useEffect, useRef, useState } from 'react';
import {
  LocateFixed,
  MoreHorizontal,
  Plus,
  Save,
  Share2,
  RotateCcw,
  Trash2,
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
  type MeasurePoint,
} from './data';
import { MeasureLines, projectMeasure, useMeasureFrame } from './MeasureLines';
import { MeasurementShare } from './MeasurementShare';
import { ProjectionChart } from './ProjectionChart';
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
  const [showCoordinates, setShowCoordinates] = useState(false);
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
      <div className="measurement-workspace" data-dragging={!!preview}>
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
                  onClick={() =>
                    points[i] ? state.select(points[i].id) : state.pick(i)
                  }
                >
                  {pointLabel(i)}
                </button>
              ))}
            </div>
            <button
              aria-label="更多测量选项"
              aria-expanded={showSaved}
              onClick={() => setShowSaved(!showSaved)}
            >
              <MoreHorizontal size={16} />
            </button>
            <button aria-label="关闭测量" onClick={state.close}>
              <X size={16} />
            </button>
          </header>
          <div className="measurement-scroll">
            {showSaved ? (
              <div className="measurement-options">
                <div className="measurement-option-row">
                  <button
                    disabled={!state.selected}
                    onClick={() => {
                      const index = points.findIndex(
                        (p) => p.id === state.selected,
                      );
                      if (index >= 0) state.pick(index);
                      setShowSaved(false);
                    }}
                  >
                    重选此点
                  </button>
                  <button
                    aria-label="显示测量坐标"
                    aria-pressed={showCoordinates}
                    onClick={() => {
                      setShowCoordinates(!showCoordinates);
                      setShowSaved(false);
                    }}
                  >
                    <LocateFixed size={14} />
                    坐标
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
                    <Share2 size={14} />
                    分享
                  </button>
                </div>
                <div
                  className="measurement-saved-list"
                  aria-label="已保存测量列表"
                >
                  <button
                    aria-label="重新测量"
                    onClick={() => {
                      state.clear();
                      setShowSaved(false);
                    }}
                  >
                    <RotateCcw size={14} />
                    新建测量
                  </button>
                  {state.saved.items.map((item) => (
                    <div key={item.id}>
                      <button
                        onClick={() => {
                          state.load(item);
                          setShowSaved(false);
                        }}
                      >
                        {item.name} · {item.points.length}点
                      </button>
                      <button
                        aria-label={`移除${item.name}`}
                        onClick={() => state.saved.remove(item.id)}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                  {state.saved.canRestore && (
                    <button onClick={state.saved.restore}>撤销移除</button>
                  )}
                </div>
              </div>
            ) : (
              <>
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
                            : '点地图或标记选择'}
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
                {state.record && points.length < 2 && (
                  <p className="measurement-hint">
                    不足两点 · 保存后移除地图连线
                  </p>
                )}
              </>
            )}
            {state.saved.error && <p role="alert">{state.saved.error}</p>}
            {state.error && <p role="alert">{state.error}</p>}
          </div>
          <footer className="measurement-actions">
            <button
              disabled={points.length >= MAX_POINTS}
              aria-label="添加测量点"
              onClick={() => state.pick(points.length)}
            >
              <Plus size={14} />
              添加
            </button>
            <button
              disabled={
                !state.selected || !points.some((p) => p.id === state.selected)
              }
              aria-label="删除所选测量点"
              onClick={state.removeSelected}
            >
              <Trash2 size={14} />
              删除
            </button>
            <button
              disabled={!state.canUndo}
              aria-label="撤销测量操作"
              onClick={state.undo}
            >
              <Undo2 size={14} />
              撤销
            </button>
            <button
              disabled={
                (points.length < 2 && !state.record) ||
                !state.saved.ready ||
                state.isSaved
              }
              aria-label={
                state.isSaved
                  ? '测量已保存'
                  : state.record
                    ? points.length < 2
                      ? '移除地图测量'
                      : '更新地图测量'
                    : '保存测量到地图和收藏夹'
              }
              onClick={state.saveToMap}
            >
              <Save size={14} />
              {state.isSaved ? '已存' : '保存'}
            </button>
          </footer>
        </section>
        <ProjectionChart
          metrics={metrics}
          segment={segment}
          total={points.length > 2 ? total.horizontal : null}
          saved={state.isSaved}
          hint={
            state.slot !== null
              ? `选 ${pointLabel(state.slot)} · 点地图或已有标记`
              : null
          }
          reading={!!preview || state.reading.length > 0}
          onRetry={state.retryHeights}
        />
      </div>
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
