import { useEffect, useRef, useState } from 'react';
import { LocateFixed, MapPin, RotateCcw, Undo2, X } from 'lucide-react';
import type { WatchProjection } from '../objectTransform/projection';
import type { Coordinate } from '../navigation/types';
import type { MeasurementState } from './useMeasurement';
import { segmentMetrics, lengthLabel, type MeasurePoint } from './data';
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
}: {
  state: MeasurementState;
  watchProjection: WatchProjection;
  onBegin: () => void;
  projectGround: (point: MeasurePoint) => { x: number; y: number } | null;
  toCoordinate: (p: { x: number; y: number }) => Coordinate | null;
  groundElevation: (p: Coordinate) => number | null;
}) {
  const [, renderFrame] = useState(0),
    [showCoordinates, setShowCoordinates] = useState(true);
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
  useEffect(
    () => watchProjection(() => renderFrame((n) => n + 1)),
    [watchProjection],
  );
  const points = state.points.map((p) =>
    preview?.id === p.id
      ? { ...p, coordinates: preview.coordinates, altitude: null }
      : p,
  );
  const screen = points.map(projectGround),
    metrics = points.length === 2 ? segmentMetrics(points[0], points[1]) : null;
  const measureBounds = root.current?.getBoundingClientRect();
  const w = measureBounds?.width ?? 390,
    h = measureBounds?.height ?? 844;
  const midpoint =
    screen.length === 2 && screen[0] && screen[1]
      ? {
          x: (screen[0].x + screen[1].x) / 2,
          y: (screen[0].y + screen[1].y) / 2,
        }
      : null;
  const labelX = Math.max(8, Math.min(w - 302, (midpoint?.x ?? w / 2) - 119));
  const resultHeight = metrics?.rise === null ? 134 : 88;
  const minimumY = showCoordinates ? 212 : 152;
  const visiblePoints = screen.filter(
    (p): p is { x: number; y: number } => !!p,
  );
  const candidates = [
    Math.min(...visiblePoints.map((p) => p.y)) - resultHeight - 32,
    Math.max(...visiblePoints.map((p) => p.y)) + 32,
  ].map((y) => Math.max(minimumY, Math.min(h - 160 - resultHeight, y)));
  const labelY =
    candidates.find((y) =>
      visiblePoints.every(
        (p) =>
          p.x < labelX - 24 ||
          p.x > labelX + 262 ||
          p.y < y - 24 ||
          p.y > y + resultHeight + 24,
      ),
    ) ?? candidates[0];
  return (
    <>
      <svg
        ref={root}
        className="measurement-overlay"
        aria-label="两点测量连线"
        width="100%"
        height="100%"
      >
        {screen[0] && screen[1] && (
          <line
            x1={screen[0].x}
            y1={screen[0].y}
            x2={screen[1].x}
            y2={screen[1].y}
          />
        )}
        {screen.map(
          (p, i) =>
            p && (
              <g
                key={points[i].id}
                transform={`translate(${p.x},${p.y})`}
                role="button"
                tabIndex={0}
                aria-label={`拖动测量点 ${i === 0 ? 'A' : 'B'}`}
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
                  {i === 0 ? 'A' : 'B'}
                </text>
              </g>
            ),
        )}
      </svg>
      <section
        className="measurement-panel"
        aria-label="两点测量"
        data-dragging={!!preview}
      >
        <header>
          <strong>两点测量</strong>
          {([0, 1] as const).map((i) => (
            <button
              key={i}
              aria-label={`选择测量点 ${i === 0 ? 'A' : 'B'}`}
              aria-pressed={state.slot === i}
              onClick={() => state.pick(i)}
            >
              {i === 0 ? 'A' : 'B'}
            </button>
          ))}
          <button
            onClick={() =>
              state.pick(points.length < 2 ? (points.length as 0 | 1) : 0)
            }
            aria-label="从地图或已有标记选两点"
          >
            <MapPin size={15} />
            选点
          </button>
          <button
            aria-expanded={showCoordinates}
            onClick={() => setShowCoordinates(!showCoordinates)}
          >
            <LocateFixed size={15} />
            坐标
          </button>
          <button onClick={state.close} aria-label="关闭测量">
            <X size={17} />
          </button>
        </header>
        {showCoordinates && (
          <div
            className="measurement-coordinates"
            aria-label="A与B坐标和地面海拔"
          >
            {([0, 1] as const).map((i) => (
              <div key={i}>
                <b>{i === 0 ? 'A' : 'B'}</b>
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
              ? `请选择 ${state.slot === 0 ? 'A' : 'B'}：点地图空白或已有标记`
              : '拖动 A/B 调整；海拔随地形自动读取'}
          </span>
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
        {state.error && <p role="alert">{state.error}</p>}
      </section>
      {metrics && (
        <aside
          className="measurement-result"
          aria-label="两点测量结果"
          style={{ left: labelX, top: labelY }}
        >
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
            · A → B
          </p>
          <p>
            水平 {lengthLabel(metrics.horizontal)} · 高差{' '}
            {metrics.rise === null
              ? '—'
              : `${metrics.rise >= 0 ? '+' : ''}${metrics.rise.toFixed(1)} m`}
          </p>
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
    </>
  );
}
