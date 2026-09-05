import { useRef, type PointerEvent } from 'react';
import type { ViewState } from '../map/types';
import { clampPitch, ringAngle, ringDelta, wrapBearing } from './cameraGesture';

/** The model pivots at its feet; the ellipse controls heading, not map position. */
export function CameraGizmo({
  view,
  onView,
}: {
  view: ViewState;
  onView: (pitch: number, bearing: number) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{
    pointer: number;
    kind: 'pitch' | 'bearing';
    y: number;
    pitch: number;
    angle: number;
    bearing: number;
  } | null>(null);
  const position = (e: PointerEvent) => {
    const rect = svg.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) * 110) / rect.width,
      y: ((e.clientY - rect.top) * 118) / rect.height,
    };
  };
  const begin = (kind: 'pitch' | 'bearing', e: PointerEvent<SVGGElement>) => {
    if (!e.isPrimary || e.button !== 0 || drag.current) return;
    e.preventDefault();
    const p = position(e);
    drag.current = {
      pointer: e.pointerId,
      kind,
      y: p.y,
      pitch: view.pitch,
      angle: ringAngle(p.x - 55, p.y - 81),
      bearing: view.bearing,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent<SVGGElement>) => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    const p = position(e);
    if (d.kind === 'pitch')
      onView(clampPitch(d.pitch + (d.y - p.y) * 1.35), d.bearing);
    else {
      const next = ringAngle(p.x - 55, p.y - 81);
      d.bearing = wrapBearing(d.bearing + ringDelta(d.angle, next));
      d.angle = next;
      onView(d.pitch, d.bearing);
    }
  };
  const end = (event: PointerEvent<SVGGElement>) => {
    if (drag.current?.pointer === event.pointerId) drag.current = null;
  };
  const y = 70 - 40 * Math.sin((view.pitch * Math.PI) / 180);
  const rad = (-view.bearing * Math.PI) / 180;
  const north = { x: 55 + 46 * Math.sin(rad), y: 81 - 23 * Math.cos(rad) };
  return (
    <aside
      className="camera-gizmo"
      aria-label="地图视角：拖绿色模型调俯仰，沿圆环滑动调旋转"
    >
      <svg ref={svg} viewBox="0 0 110 118">
        <ellipse
          cx="55"
          cy="81"
          rx="46"
          ry="23"
          fill="#10212b99"
          stroke="#183d47"
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
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onLostPointerCapture={end}
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
            stroke="#a3d6ce"
            strokeWidth="1.5"
          />
          <circle cx={north.x} cy={north.y} r="7" fill="#a5efc8" />
          <text
            x={north.x}
            y={north.y + 3}
            fill="#163b31"
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
          aria-label="俯仰角度，上下拖动绿色模型"
          aria-valuemin={0}
          aria-valuemax={80}
          aria-valuenow={Math.round(view.pitch)}
          aria-valuetext={`${Math.round(view.pitch)} 度`}
          onPointerDown={(e) => begin('pitch', e)}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onLostPointerCapture={end}
          onKeyDown={(e) => {
            if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
              e.preventDefault();
              onView(
                e.key === 'Home'
                  ? 0
                  : e.key === 'End'
                    ? 80
                    : clampPitch(view.pitch + (e.key === 'ArrowUp' ? 5 : -5)),
                view.bearing,
              );
            }
          }}
        >
          <title>上下拖动调俯仰；底部固定，方向键上下微调</title>
          <rect x="31" y="19" width="48" height="64" fill="transparent" />
          <path
            d={`M 55 81 L 35 ${y + 6} L 76 ${y} Z`}
            fill="#44ce8b"
            stroke="#c5ffe0"
            strokeWidth="1.4"
          />
          <path
            d={`M 55 81 L 57 ${y + 18} L 76 ${y} Z`}
            fill="#1c9e68"
            stroke="#a7f5cc"
            strokeWidth="1.1"
          />
          <path
            d={`M 35 ${y + 6} L 57 ${y + 18} L 76 ${y} Z`}
            fill="#a0f5bc"
            stroke="#d1ffe0"
            strokeWidth="1.1"
          />
          <circle cx="55" cy="81" r="3" fill="#b3ffd8" />
        </g>
        <text
          x="55"
          y="115"
          textAnchor="middle"
          fill="#e3f6ee"
          fontSize="10"
          paintOrder="stroke"
          stroke="#10212b"
          strokeWidth="3"
        >
          俯仰 {Math.round(view.pitch)}° · 旋转
        </text>
      </svg>
    </aside>
  );
}
