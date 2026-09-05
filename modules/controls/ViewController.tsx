import { useRef } from 'react';
import { Move, RotateCcw } from 'lucide-react';
import type { ViewState } from '../map/types';
export function ViewController({
  view,
  onView,
  onReset,
}: {
  view: ViewState;
  onView: (pitch: number, bearing: number, animate?: boolean) => void;
  onReset: () => void;
}) {
  const drag = useRef<{
    x: number;
    y: number;
    pitch: number;
    bearing: number;
  } | null>(null);
  return (
    <section className="view-controller" aria-label="视角控制器">
      <div className="view-heading">
        <span>
          <Move size={14} />
          视角控制
        </span>
        <button
          className="icon-button"
          aria-label="重置地图视角"
          onClick={onReset}
        >
          <RotateCcw size={14} />
        </button>
      </div>
      <div
        className="view-dial"
        role="slider"
        tabIndex={0}
        aria-label="拖动调整视角，上下调整俯仰，左右旋转"
        aria-valuemin={0}
        aria-valuemax={80}
        aria-valuenow={Math.round(view.pitch)}
        aria-valuetext={`俯仰 ${Math.round(view.pitch)} 度，方位 ${Math.round(view.bearing)} 度`}
        onKeyDown={(e) => {
          if (
            [
              'ArrowUp',
              'ArrowDown',
              'ArrowLeft',
              'ArrowRight',
              'Home',
            ].includes(e.key)
          ) {
            e.preventDefault();
            onView(
              e.key === 'Home'
                ? 0
                : view.pitch +
                    (e.key === 'ArrowUp' ? -5 : e.key === 'ArrowDown' ? 5 : 0),
              e.key === 'Home'
                ? 0
                : view.bearing +
                    (e.key === 'ArrowLeft'
                      ? -10
                      : e.key === 'ArrowRight'
                        ? 10
                        : 0),
            );
          }
        }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = {
            x: e.clientX,
            y: e.clientY,
            pitch: view.pitch,
            bearing: view.bearing,
          };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (d)
            onView(
              d.pitch + (e.clientY - d.y) * 0.7,
              d.bearing + (e.clientX - d.x) * 0.8,
              false,
            );
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
      >
        <svg viewBox="0 0 132 98" aria-hidden="true">
          <ellipse
            cx="66"
            cy="51"
            rx="49"
            ry="34"
            fill="#9de8c407"
            stroke="#9de8c439"
          />
          <ellipse
            cx="66"
            cy="51"
            rx="49"
            ry={Math.max(4, 30 - view.pitch * 0.29)}
            fill="none"
            stroke="#9de8c459"
          />
          <path
            d="M17 51h98M66 17v68"
            stroke="#9de8c420"
            strokeDasharray="3 4"
          />
          <g transform={`rotate(${-view.bearing} 66 51)`}>
            <path d="M66 23 60 38 72 38Z" fill="#9de8c4" />
            <text
              x="66"
              y="15"
              textAnchor="middle"
              fill="#c9dbdf"
              fontSize="10"
            >
              N
            </text>
          </g>
          <circle cx="66" cy="51" r="4" fill="#9de8c4" />
          <text x="66" y="96" textAnchor="middle" fill="#9eb6c0" fontSize="10">
            拖动旋转与倾斜
          </text>
        </svg>
      </div>
      <div className="angle-readout">
        <label htmlFor="camera-pitch">俯仰角</label>
        <span>{Math.round(view.pitch)}°</span>
      </div>
      <input
        id="camera-pitch"
        type="range"
        min="0"
        max="80"
        value={Math.round(view.pitch)}
        onChange={(e) => onView(Number(e.target.value), view.bearing, false)}
      />
      <div className="view-shortcuts">
        {[
          { label: '俯视', angle: 0 },
          { label: '斜视', angle: 55 },
          { label: '侧视', angle: 80 },
        ].map((v) => (
          <button
            key={v.label}
            aria-pressed={Math.abs(view.pitch - v.angle) < 3}
            onClick={() => onView(v.angle, view.bearing)}
          >
            {v.label}
          </button>
        ))}
      </div>
    </section>
  );
}
