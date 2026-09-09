import { useEffect, useRef, useState } from 'react';
import {
  objectProjector,
  type ProjectionFrame,
  type WatchProjection,
} from '../objectTransform/projection';
import { pointPose, type MeasurePoint } from './data';

export function useMeasureFrame(watch: WatchProjection) {
  const frame = useRef<ProjectionFrame | null>(null);
  const [, redraw] = useState(0);
  useEffect(
    () =>
      watch((value) => {
        frame.current = value;
        redraw((n) => n + 1);
      }),
    [watch],
  );
  return frame.current;
}

/** B projected onto A's elevation, not an arbitrary screen-horizontal line. */
export function horizontalFoot(
  a: MeasurePoint,
  b: MeasurePoint,
): MeasurePoint | null {
  return a.altitude === null || b.altitude === null
    ? null
    : { ...b, altitude: a.altitude, heightSource: 'terrain' };
}
export function projectMeasure(
  point: MeasurePoint,
  frame: ProjectionFrame | null,
  scale: number,
  ground: (p: MeasurePoint) => { x: number; y: number } | null,
) {
  const pose = pointPose(point);
  if (!frame || !pose) return ground(point);
  const p = objectProjector(frame, {
    ...pose,
    altitude: pose.altitude * scale,
  }).center;
  return p.visible && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null;
}
export function MeasureLines({
  points,
  project,
}: {
  points: MeasurePoint[];
  project: (p: MeasurePoint) => { x: number; y: number } | null;
}) {
  return (
    <>
      {points.slice(1).map((point, i) => {
        const a = project(points[i]),
          b = project(point),
          foot = horizontalFoot(points[i], point);
        const c = foot && project(foot);
        if (!a || !b) return null;
        return (
          <g className="measurement-lines" key={point.id}>
            {c && (
              <>
                <line
                  className="measurement-horizontal"
                  x1={a.x}
                  y1={a.y}
                  x2={c.x}
                  y2={c.y}
                />
                <line
                  className="measurement-projection"
                  x1={b.x}
                  y1={b.y}
                  x2={c.x}
                  y2={c.y}
                />
              </>
            )}
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
          </g>
        );
      })}
    </>
  );
}
