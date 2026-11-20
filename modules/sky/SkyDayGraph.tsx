import { useMemo } from 'react';
import {
  getSkyPosition,
  type SkyObserver,
  type SkyTimeInterval,
  type SolarVisibility,
} from './astronomy';

const width = 320,
  left = 12,
  span = width - 2 * left,
  height = 62;
const row = (alt: number) => 31 - alt * 0.27;
function SunGlyph() {
  return (
    <g stroke="#ffd071" strokeWidth="1.6" strokeLinecap="round">
      <circle r="4" fill="#ffbb4d" stroke="none" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
        <path key={angle} d="M0 -6 V-8" transform={`rotate(${angle})`} />
      ))}
    </g>
  );
}
function MoonGlyph({
  fraction,
  waxing,
}: {
  fraction: number;
  waxing: boolean;
}) {
  const radius = 6;
  const side = waxing ? 1 : 0;
  const edge = (2 * fraction - 1) * radius;
  return (
    <g>
      <circle r={radius} fill="#465673" stroke="#d1e4ff" strokeWidth="0.8" />
      <path
        fill="#deebff"
        d={`M0,-6 A6,6 0 0,${side} 0,6 A${Math.max(0.001, Math.abs(edge))},6 0 0,${edge >= 0 ? side : 1 - side} 0,-6 Z`}
      />
    </g>
  );
}

export function SkyDayGraph({
  day,
  observer,
  time,
  onTime,
  visibility,
}: {
  day: SkyTimeInterval;
  observer: SkyObserver;
  time: number;
  onTime(t: number): void;
  visibility: SolarVisibility | null;
}) {
  const points = useMemo(
    () =>
      Array.from({ length: 97 }, (_, index) => {
        const sky = getSkyPosition(
          day.startMs + ((day.endMs - day.startMs) * index) / 96,
          observer,
        );
        return {
          x: left + (index * span) / 96,
          sun: row(sky.sun.altitudeDeg),
          moon: row(sky.moon.altitudeDeg),
          fraction: sky.moonIlluminatedFraction,
        };
      }),
    [day, observer],
  );
  const at = (t: number) =>
    left + ((t - day.startMs) / (day.endMs - day.startMs)) * span;
  const line = (key: 'sun' | 'moon') =>
    points
      .map((p, i) => (i ? 'L' : 'M') + p.x.toFixed(1) + ',' + p[key].toFixed(1))
      .join(' ');
  const sun = points.reduce((a, b) => (a.sun < b.sun ? a : b));
  const moon = points.reduce((a, b) => (a.moon < b.moon ? a : b));
  const select = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const portion = Math.min(
      1,
      Math.max(
        0,
        (((event.clientX - rect.left) * width) / rect.width - left) / span,
      ),
    );
    onTime(
      Math.min(
        day.endMs - 1,
        Math.round(day.startMs + portion * (day.endMs - day.startMs)),
      ),
    );
  };
  return (
    <svg
      className="sky-day-graph"
      role="img"
      aria-label="当天太阳和月亮的高度曲线，金色为太阳，浅蓝为月亮"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        select(event);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          select(event);
      }}
    >
      <rect width={width} height={height} rx="6" fill="#202e44" />
      <path
        d={`M0 31H${width}`}
        stroke="#8894aa"
        strokeWidth=".6"
        strokeDasharray="3 4"
      />
      <path
        d={line('moon')}
        fill="none"
        stroke="#c1d5ff"
        strokeWidth="1.5"
        strokeDasharray="3 2.7"
      />
      <path d={line('sun')} fill="none" stroke="#ffc66d" strokeWidth="1.8" />
      {visibility?.events.map((e) => {
        const x = at(e.timeMs),
          i = Math.min(96, Math.max(0, Math.round(((x - left) * 96) / span)));
        return (
          <g key={e.timeMs}>
            <line
              x1={x}
              x2={x}
              y1={points[i].sun}
              y2={height}
              stroke="#e6ac50"
              strokeDasharray="2 3"
            />
            <circle cx={x} cy={points[i].sun} r="3" fill="#ffd681" />
          </g>
        );
      })}
      <line
        x1={at(time)}
        x2={at(time)}
        y1="0"
        y2={height}
        stroke="#fff"
        strokeOpacity=".85"
      />
      <g transform={`translate(${sun.x},${sun.sun})`}>
        <SunGlyph />
      </g>
      <g transform={`translate(${moon.x},${moon.moon})`}>
        <MoonGlyph
          fraction={moon.fraction}
          waxing={points[96].fraction >= points[0].fraction}
        />
      </g>
    </svg>
  );
}
