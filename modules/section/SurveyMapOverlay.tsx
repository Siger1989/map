import { useEffect, useRef, useState } from 'react';
import type { Coordinate } from '../navigation/types';
import {
  objectProjector,
  type ProjectionFrame,
  type WatchProjection,
} from '../objectTransform/projection';
import {
  surveyCoordinate,
  surveyHeight,
  surveyRange,
  surveyStations,
} from './surveyLine';
import type { SectionObject } from './sectionObjects';
import type { SurveySectionState } from './useSurveySection';
import './survey.css';

export function SurveyMapOverlay({
  items,
  state,
  watch,
  projectGround,
  toCoordinate,
  scale,
  onOpen,
}: {
  items: SectionObject[];
  state: SurveySectionState;
  watch: WatchProjection;
  scale: number;
  projectGround: (p: Coordinate) => { x: number; y: number } | null;
  toCoordinate: (p: { x: number; y: number }) => Coordinate | null;
  onOpen: (object: SectionObject) => void;
}) {
  const [frame, setFrame] = useState<ProjectionFrame | null>(null);
  useEffect(() => watch(setFrame), [watch]);
  const drag = useRef<{
    pointer: number;
    id: string;
    point: Coordinate | null;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const project = (p: Coordinate, h: number | null) => {
    if (!frame || h === null) return projectGround(p);
    const screen = objectProjector(frame, {
      coordinates: p,
      altitude: h * scale,
      rotation: [0, 0, 0, 1],
      size: [1, 1, 1],
    }).center;
    return screen.visible &&
      Number.isFinite(screen.x) &&
      Number.isFinite(screen.y)
      ? screen
      : null;
  };
  const shown = items
    .filter((s) => s.settings.survey && s.settings.enabled)
    .map((s) => (state.active && state.object?.id === s.id ? state.object : s));
  const first = state.first && project(state.first, null);
  return (
    <svg
      className="survey-map-overlay"
      width="100%"
      height="100%"
      aria-label="地图上的勘探线"
    >
      {first && (
        <g>
          <circle cx={first.x} cy={first.y} r="6" fill="#e16b24" />
          <text x={first.x} y={first.y - 12}>
            A
          </text>
        </g>
      )}
      {shown.map((object) => {
        const line = object.settings.survey!,
          data = object.settings.surveyTerrain,
          range = surveyRange(line),
          active = state.active && state.object?.id === object.id;
        let d = '',
          pen = false;
        const count = data?.columns ?? 65;
        for (let i = 0; i < count; i++) {
          const distance =
              range.start + ((range.end - range.start) * i) / (count - 1),
            h = data ? surveyHeight(data, distance) : null;
          const p =
            data && h === null
              ? null
              : project(surveyCoordinate(line, distance), h);
          if (!p) {
            pen = false;
            continue;
          }
          d += `${pen ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)} `;
          pen = true;
        }
        const finite =
            data?.heights.filter((h): h is number => h !== null) ?? [],
          floor = finite.length
            ? Math.min(...finite) -
              Math.max(20, (range.end - range.start) * 0.05)
            : null;
        const roof = finite.length
          ? Math.max(...finite) + Math.max(10, (range.end - range.start) * 0.01)
          : null;
        const corners =
          active && floor !== null && roof !== null
            ? [
                [range.start, floor],
                [range.end, floor],
                [range.end, roof],
                [range.start, roof],
              ].map(([s, h]) => project(surveyCoordinate(line, s), h))
            : [];
        return (
          <g key={object.id}>
            {corners.length === 4 && corners.every((p) => p !== null) && (
              <polygon
                points={corners.map((p) => `${p!.x},${p!.y}`).join(' ')}
                fill={object.settings.color}
                fillOpacity=".08"
                stroke={object.settings.color}
                strokeOpacity=".4"
                strokeWidth="1"
              />
            )}
            <path
              d={d}
              fill="none"
              stroke={object.settings.color}
              strokeWidth={active ? 3 : 2}
              className="survey-visible-line"
            />
            {!state.picking && (
              <path
                d={d}
                fill="none"
                stroke="transparent"
                strokeWidth="16"
                className="survey-hit-line"
                role="button"
                tabIndex={0}
                aria-label={`编辑勘探线 ${object.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpen(object);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onOpen(object);
                }}
              />
            )}
            {surveyStations(line).map((s) => {
              const p = project(
                surveyCoordinate(line, s.distance),
                data ? surveyHeight(data, s.distance) : null,
              );
              if (!p) return null;
              return (
                <g
                  key={s.id}
                  style={state.picking ? { pointerEvents: 'none' } : undefined}
                  className={
                    active && !state.picking
                      ? 'survey-map-handle'
                      : 'survey-map-label'
                  }
                  role="button"
                  tabIndex={state.picking ? -1 : 0}
                  aria-label={`${object.name} ${s.label} 沿线点`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!active) onOpen(object);
                    state.select(s.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      if (!active) onOpen(object);
                      state.select(s.id);
                    }
                  }}
                  onPointerDown={(e) => {
                    if (!active || state.picking || e.button !== 0) return;
                    e.stopPropagation();
                    state.select(s.id);
                    drag.current = {
                      pointer: e.pointerId,
                      id: s.id,
                      point: null,
                      startX: e.clientX,
                      startY: e.clientY,
                      moved: false,
                    };
                    e.currentTarget.setPointerCapture(e.pointerId);
                  }}
                  onPointerMove={(e) => {
                    const g = drag.current;
                    if (!g || g.pointer !== e.pointerId) return;
                    e.stopPropagation();
                    if (
                      Math.hypot(e.clientX - g.startX, e.clientY - g.startY) <
                        5 &&
                      !g.moved
                    )
                      return;
                    g.moved = true;
                    const rect =
                      e.currentTarget.ownerSVGElement!.getBoundingClientRect();
                    const point = toCoordinate({
                      x: e.clientX - rect.left,
                      y: e.clientY - rect.top,
                    });
                    if (point) {
                      g.point = point;
                      state.editPoint(g.id, point, false);
                    }
                  }}
                  onPointerUp={(e) => {
                    const g = drag.current;
                    if (!g || g.pointer !== e.pointerId) return;
                    e.stopPropagation();
                    drag.current = null;
                    if (g.point && g.moved)
                      state.editPoint(g.id, g.point, true);
                    else state.cancelPreview();
                    if (e.currentTarget.hasPointerCapture(e.pointerId))
                      e.currentTarget.releasePointerCapture(e.pointerId);
                  }}
                  onPointerCancel={() => {
                    drag.current = null;
                    state.cancelPreview();
                  }}
                  onLostPointerCapture={() => {
                    if (drag.current) {
                      drag.current = null;
                      state.cancelPreview();
                    }
                  }}
                >
                  <circle cx={p.x} cy={p.y} r="22" fill="transparent" />
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={active && state.selected === s.id ? 7 : 5}
                    fill={s.id === 'A' || s.id === 'B' ? '#f6b74a' : '#d65b3f'}
                    stroke="white"
                    strokeWidth="2"
                  />
                  <text x={p.x} y={p.y - 12}>
                    {s.label}
                  </text>
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}
