import { MeasureLines, projectMeasure, useMeasureFrame } from './MeasureLines';
import type { WatchProjection } from '../objectTransform/projection';
import { segmentMetrics, pointLabel, type MeasurePoint } from './data';
import type { SavedMeasurement } from './saved';
import './measurement.css';

export function SavedMeasurements({
  items,
  watchProjection,
  projectGround,
  onOpen,
  elevationScale,
  onPick,
}: {
  elevationScale: number;
  items: SavedMeasurement[];
  watchProjection: WatchProjection;
  projectGround: (point: MeasurePoint) => { x: number; y: number } | null;
  onOpen: (item: SavedMeasurement) => void;
  onPick?: (point: MeasurePoint) => void;
}) {
  const frame = useMeasureFrame(watchProjection);
  const project = (p: MeasurePoint) =>
    projectMeasure(p, frame, elevationScale, projectGround);
  return (
    <svg
      className="saved-measurements"
      aria-label="地图上已保存的测量"
      width="100%"
      height="100%"
    >
      {items.map((item) => {
        const screen = item.points.map(project);
        const first = screen.find((p) => p !== null);
        if (!first) return null;
        const a = screen[0] ?? first,
          b = screen[1] ?? first;
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
          compact = Math.hypot(a.x - b.x, a.y - b.y) < 80;
        const angle = segmentMetrics(
          item.points[0],
          item.points[1],
        ).inclination;
        return (
          <g key={item.id}>
            <MeasureLines points={item.points} project={project} />
            {screen.map(
              (p, i) =>
                p && (
                  <g
                    key={i}
                    className="saved-measurement-open"
                    role="button"
                    tabIndex={0}
                    aria-label={`测量 ${item.name} 的 ${pointLabel(i)} 点`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (onPick) onPick(item.points[i]);
                      else onOpen(item);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        if (onPick) onPick(item.points[i]);
                        else onOpen(item);
                      }
                    }}
                  >
                    <circle cx={p.x} cy={p.y} r="22" fill="transparent" />
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={compact ? 3 : 5}
                      fill={i ? '#3478ed' : '#ffcf45'}
                    />
                    {!compact && (
                      <text x={p.x} y={p.y - 10}>
                        {pointLabel(i)}
                      </text>
                    )}
                  </g>
                ),
            )}
            <g
              className="saved-measurement-open"
              role="button"
              tabIndex={0}
              aria-label={`查看已保存${item.name}`}
              transform={`translate(${mid.x},${mid.y})`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onOpen(item);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  onOpen(item);
                }
              }}
            >
              <circle
                r="22"
                fill="transparent"
                className="saved-measurement-hit"
              />
              {compact ? (
                <circle r="5" fill="#ffcf45" />
              ) : (
                <>
                  <rect x="-24" y="-11" width="48" height="22" rx="6" />
                  <text y="4">
                    {angle === null ? '测量' : `${angle.toFixed(1)}°`}
                  </text>
                </>
              )}
            </g>
          </g>
        );
      })}
    </svg>
  );
}
