import { useCallback, useEffect, useRef, type PointerEvent } from 'react';
import type { ViewState } from '../map/types';
import {
  clampPitch,
  createCameraGestureFrame,
  orbitCamera,
  ringAngle,
  ringDelta,
  wrapBearing,
  type CameraGesturePhase,
  type CameraGesturePose,
} from './cameraGesture';

type CameraDrag = {
  pointer: number;
  kind: 'orbit' | 'bearing';
  x: number;
  y: number;
  pitch: number;
  angle: number;
  bearing: number;
};
function dragPose(
  drag: CameraDrag,
  point: { x: number; y: number },
): CameraGesturePose {
  if (drag.kind === 'orbit') {
    const next = orbitCamera(drag, point.x - drag.x, point.y - drag.y);
    return { pitch: next.pitch, bearing: next.bearing };
  }
  const angle = ringAngle(point.x - 55, point.y - 81);
  drag.bearing = wrapBearing(drag.bearing + ringDelta(drag.angle, angle));
  drag.angle = angle;
  return { pitch: drag.pitch, bearing: drag.bearing };
}

/** The model orbits/tilts around the map centre; the ring changes heading only. */
export function CameraGizmo({
  view,
  onView,
  onGestureView,
}: {
  view: ViewState;
  onView: (pitch: number, bearing: number) => void;
  onGestureView?: (
    pitch: number,
    bearing: number,
    phase: CameraGesturePhase,
  ) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const callbacks = useRef({ onView, onGestureView });
  callbacks.current = { onView, onGestureView };
  const gestureFrame = useRef<ReturnType<
    typeof createCameraGestureFrame
  > | null>(null);
  if (!gestureFrame.current) {
    gestureFrame.current = createCameraGestureFrame((pose, phase) => {
      const publish = callbacks.current.onGestureView;
      if (publish) publish(pose.pitch, pose.bearing, phase);
      else if (phase !== 'cancel')
        callbacks.current.onView(pose.pitch, pose.bearing);
    });
  }
  const drag = useRef<CameraDrag | null>(null);
  const cancel = useCallback(() => {
    const current = drag.current;
    drag.current = null;
    if (current && svg.current?.hasPointerCapture(current.pointer))
      svg.current.releasePointerCapture(current.pointer);
    gestureFrame.current?.cancel();
  }, []);
  const end = useCallback(
    (event: { pointerId: number; clientX?: number; clientY?: number }) => {
      const current = drag.current;
      if (current?.pointer !== event.pointerId) return;
      let finalPose: CameraGesturePose | undefined;
      if (Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
        const rect = svg.current!.getBoundingClientRect();
        finalPose = dragPose(current, {
          x: ((event.clientX! - rect.left) * 110) / rect.width,
          y: ((event.clientY! - rect.top) * 118) / rect.height,
        });
      }
      drag.current = null;
      if (svg.current?.hasPointerCapture(current.pointer))
        svg.current.releasePointerCapture(current.pointer);
      gestureFrame.current?.end(finalPose);
    },
    [],
  );
  const cancelPointer = useCallback((event: { pointerId: number }) => {
    const current = drag.current;
    if (current?.pointer !== event.pointerId) return;
    drag.current = null;
    if (svg.current?.hasPointerCapture(current.pointer))
      svg.current.releasePointerCapture(current.pointer);
    gestureFrame.current?.cancel();
  }, []);
  useEffect(() => {
    const visibility = () => {
      if (document.hidden) cancel();
    };
    const anotherPointer = (event: globalThis.PointerEvent) => {
      if (drag.current && event.pointerId !== drag.current.pointer) cancel();
    };
    window.addEventListener('blur', cancel);
    window.addEventListener('pointerdown', anotherPointer, true);
    window.addEventListener('pointerup', end, true);
    window.addEventListener('pointercancel', cancelPointer, true);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      cancel();
      window.removeEventListener('blur', cancel);
      window.removeEventListener('pointerdown', anotherPointer, true);
      window.removeEventListener('pointerup', end, true);
      window.removeEventListener('pointercancel', cancelPointer, true);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [cancel, end, cancelPointer]);
  const position = (e: PointerEvent) => {
    const rect = svg.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) * 110) / rect.width,
      y: ((e.clientY - rect.top) * 118) / rect.height,
    };
  };
  const begin = (kind: 'orbit' | 'bearing', e: PointerEvent<SVGGElement>) => {
    if (!e.isPrimary || e.button !== 0) return;
    e.preventDefault();
    cancel();
    const p = position(e);
    drag.current = {
      pointer: e.pointerId,
      kind,
      x: p.x,
      y: p.y,
      pitch: view.pitch,
      angle: ringAngle(p.x - 55, p.y - 81),
      bearing: view.bearing,
    };
    svg.current!.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    if (e.pointerType === 'mouse' && !(e.buttons & 1)) {
      cancel();
      return;
    }
    const p = position(e);
    gestureFrame.current?.move(dragPose(d, p));
  };
  const y = 70 - 40 * Math.sin((view.pitch * Math.PI) / 180);
  const rad = (-view.bearing * Math.PI) / 180;
  const north = { x: 55 + 46 * Math.sin(rad), y: 81 - 23 * Math.cos(rad) };
  return (
    <aside
      className="camera-gizmo"
      aria-label="地图视角：拖摇杆上下调俯仰、左右旋转，外圈控制方向"
    >
      <svg
        ref={svg}
        viewBox="0 0 110 118"
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={cancelPointer}
        onLostPointerCapture={cancelPointer}
      >
        <ellipse
          cx="55"
          cy="81"
          rx="46"
          ry="23"
          fill="var(--ui-surface, #18201f)"
          fillOpacity="0.6"
          stroke="color-mix(in srgb, var(--ui-ink, #f2f5ed) 24%, var(--ui-surface, #18201f))"
          strokeWidth="7"
        />
        <g
          className="camera-ring"
          role="slider"
          tabIndex={0}
          aria-label="旋转视角，沿圆环滑动"
          aria-valuemin={-180}
          aria-valuemax={180}
          aria-valuenow={Math.round(wrapBearing(view.bearing))}
          aria-valuetext={`${Math.round(wrapBearing(view.bearing))} 度`}
          onPointerDown={(e) => begin('bearing', e)}
          onKeyDown={(e) => {
            if (['ArrowLeft', 'ArrowRight', 'Home'].includes(e.key)) {
              e.preventDefault();
              onView(
                view.pitch,
                e.key === 'Home'
                  ? 0
                  : wrapBearing(
                      view.bearing + (e.key === 'ArrowRight' ? 5 : -5),
                    ),
              );
            }
          }}
        >
          <title>沿圆环滑动旋转；方向键左右微调，Home 朝北</title>
          <ellipse
            cx="55"
            cy="81"
            rx="46"
            ry="23"
            fill="none"
            stroke="transparent"
            strokeWidth="18"
          />
          <ellipse
            cx="55"
            cy="81"
            rx="46"
            ry="23"
            fill="none"
            stroke="color-mix(in srgb, var(--ui-accent, #d0f76b) 68%, var(--ui-surface, #18201f))"
            strokeWidth="1.5"
          />
          <circle
            cx={north.x}
            cy={north.y}
            r="7"
            fill="var(--ui-accent, #d0f76b)"
          />
          <text
            x={north.x}
            y={north.y + 3}
            fill="var(--ui-on-accent, #18201f)"
            fontSize="8"
            textAnchor="middle"
          >
            N
          </text>
        </g>
        <g
          className="camera-model"
          role="slider"
          tabIndex={0}
          aria-label="镜头角度：拖动模型，上下俯仰、左右旋转"
          aria-valuemin={0}
          aria-valuemax={80}
          aria-valuenow={Math.round(view.pitch)}
          aria-valuetext={`俯仰 ${Math.round(view.pitch)} 度，方向 ${Math.round(wrapBearing(view.bearing))} 度`}
          onPointerDown={(e) => begin('orbit', e)}
          onKeyDown={(e) => {
            if (
              [
                'ArrowUp',
                'ArrowDown',
                'ArrowLeft',
                'ArrowRight',
                'Home',
                'End',
              ].includes(e.key)
            ) {
              e.preventDefault();
              onView(
                e.key === 'Home'
                  ? 0
                  : e.key === 'End'
                    ? 80
                    : clampPitch(
                        view.pitch +
                          (e.key === 'ArrowUp'
                            ? 5
                            : e.key === 'ArrowDown'
                              ? -5
                              : 0),
                      ),
                wrapBearing(
                  view.bearing +
                    (e.key === 'ArrowRight'
                      ? 5
                      : e.key === 'ArrowLeft'
                        ? -5
                        : 0),
                ),
              );
            }
          }}
        >
          <title>
            上下拖动调俯仰，左右拖动旋转；方向键微调，Home 俯视，End 最大倾斜
          </title>
          <rect x="31" y="19" width="48" height="64" fill="transparent" />
          <path
            d={`M 55 81 L 35 ${y + 6} L 76 ${y} Z`}
            fill="var(--ui-accent, #d0f76b)"
          />
          <path
            d={`M 55 81 L 57 ${y + 18} L 76 ${y} Z`}
            fill="color-mix(in srgb, var(--ui-accent, #d0f76b) 72%, black)"
          />
          <path
            d={`M 35 ${y + 6} L 57 ${y + 18} L 76 ${y} Z`}
            fill="color-mix(in srgb, var(--ui-accent, #d0f76b) 78%, white)"
          />
          <circle cx="55" cy="81" r="3" fill="var(--ui-accent, #d0f76b)" />
        </g>
        <text
          x="55"
          y="115"
          textAnchor="middle"
          fill="var(--ui-ink, #f2f5ed)"
          fontSize="10"
          paintOrder="stroke"
          stroke="var(--ui-surface, #18201f)"
          strokeWidth="3"
        >
          俯仰 {Math.round(view.pitch)}° · 旋转
        </text>
      </svg>
    </aside>
  );
}
