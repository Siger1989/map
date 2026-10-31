import { useEffect, useRef } from 'react';
import type { ScreenPoint } from './drawing';
export type MagnifierSubscription = (() => void) & { update?: (point: ScreenPoint) => void };
export type MagnifierObserver = (
  target: HTMLCanvasElement,
  point: ScreenPoint,
) => MagnifierSubscription;
export function PointMagnifier({
  point,
  width,
  height,
  observe,
}: {
  point: ScreenPoint;
  width: number;
  height: number;
  observe: MagnifierObserver;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef(observe);
  const subscription = useRef<MagnifierSubscription | null>(null);
  const activeObserver = useRef(observe);
  const latestPoint = useRef(point);
  const observedPoint = useRef(point);
  latest.current = observe;
  latestPoint.current = point;
  useEffect(() => {
    if (!canvas.current) return;
    activeObserver.current = latest.current;
    subscription.current = latest.current(canvas.current, latestPoint.current);
    observedPoint.current = latestPoint.current;
    return () => {
      subscription.current?.();
      subscription.current = null;
    };
  }, []);
  useEffect(() => {
    const current = subscription.current;
    if (!current || !canvas.current) return;
    const pointChanged = observedPoint.current.x !== point.x || observedPoint.current.y !== point.y;
    const observerChanged = activeObserver.current !== latest.current;
    if (!pointChanged && !observerChanged) return;
    if (current.update) {
      // Native captures outlive inline wrapper callbacks; the owning drawing
      // component still disposes the subscription on real unmount.
      activeObserver.current = latest.current;
      if (pointChanged) current.update(point);
    }
    else {
      current();
      subscription.current = latest.current(canvas.current, point);
      activeObserver.current = latest.current;
    }
    observedPoint.current = point;
  }, [point.x, point.y, observe]);
  const left = Math.max(
    8,
    Math.min(
      width - 104,
      point.x + 26 + 96 <= width - 8 ? point.x + 26 : point.x - 122,
    ),
  );
  const top = Math.max(
    8,
    Math.min(height - 128, point.y > 125 ? point.y - 118 : point.y + 25),
  );
  return (
    <div
      className="point-magnifier"
      style={{ left, top }}
      aria-label="三倍地图放大镜，中心准星为确认位置"
    >
      <canvas ref={canvas} width="192" height="192" />
      <svg viewBox="0 0 96 96" aria-hidden="true">
        <path
          d="M 48 28 V 43 M 48 53 V 68 M 28 48 H 43 M 53 48 H 68"
          stroke="#10212b"
          strokeWidth="4"
        />
        <path
          d="M 48 28 V 43 M 48 53 V 68 M 28 48 H 43 M 53 48 H 68"
          stroke="#ffffff"
          strokeWidth="1.5"
        />
        <circle cx="48" cy="48" r="2" fill="#ff725f" />
      </svg>
      <span>3× · 松手定点</span>
    </div>
  );
}
