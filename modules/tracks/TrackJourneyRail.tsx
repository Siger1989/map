import { useRef, useState } from 'react';
import type { Annotation } from '../annotations/data';
import { formatDistance } from '../navigation/types';
import { trackDistance, type ManualTrack } from './drawing';
import { markerChainage, trackPointAt, type TrackLinePoint } from './linePoint';
import { trackAlternatives } from './alternatives';
import { normalizeTrackStyle } from './style';
import { railFraction } from '../journey/scrub';
import './trackPoints.css';

export function TrackJourneyRail({
  track,
  markers,
  selected,
  onPoint,
  onMarker,
  activeAlternative,
  onAlternative,
}: {
  track: Pick<
    ManualTrack,
    'id' | 'segments' | 'name' | 'style' | 'sourceTrackIds'
  >;
  markers: Annotation[];
  selected: TrackLinePoint | null;
  onPoint: (point: TrackLinePoint) => void;
  onMarker: (id: string) => void;
  activeAlternative: string;
  onAlternative: (id: string) => void;
}) {
  const [list, setList] = useState(false);
  const [positions, setPositions] = useState<Record<string, number>>({});
  const variants = trackAlternatives(
    track.segments,
    normalizeTrackStyle(track.style).color,
  );
  const multiple = variants.length > 1;
  const choices = variants.length
    ? variants
    : [
        {
          id: 'main',
          label: '原路',
          color: '#a5cf79',
          coordinates: [],
          detour: [],
          distance: trackDistance(track.segments),
        },
      ];
  const active = choices.find((v) => v.id === activeAlternative) ?? choices[0];
  const linesFor = (id: string) =>
    variants.length
      ? [choices.find((v) => v.id === id)!.coordinates]
      : track.segments;
  const linked = markers.filter(
    (m) =>
      m.trackAnchor &&
      [track.id, ...(track.sourceTrackIds ?? [])].includes(
        m.trackAnchor.trackId,
      ),
  );
  const entries = linked
    .map((marker) => ({
      marker,
      ...markerChainage(
        linesFor(active.id),
        marker.coordinates,
        marker.trackAnchor!.distance,
      ),
    }))
    .filter((entry) => !multiple || entry.offset <= 30)
    .sort((a, b) => a.distance - b.distance);
  const pointerChoice = useRef(active.id);
  const shown = multiple
    ? [choices[0], active.id === 'main' ? choices[1] : active]
    : choices;
  const atDistance = (id: string) =>
    id === active.id && selected
      ? markerChainage(linesFor(id), selected.coordinate, selected.distance)
          .distance
      : (positions[id] ?? 0);
  const select = (id: string, fraction: number) => {
    const choice = choices.find((v) => v.id === id)!;
    const distance = Math.max(0, Math.min(1, fraction)) * choice.distance;
    const coordinate = trackPointAt(linesFor(id), distance);
    if (!coordinate) return;
    onAlternative(id);
    setPositions((p) => ({ ...p, [id]: distance }));
    onPoint({
      trackId: track.id,
      coordinate,
      distance,
      sourceDistance: markerChainage(track.segments, coordinate).distance,
    });
  };
  return (
    <aside
      className="route-weather-rail track-journey-rail"
      aria-label={`${track.name}行程进度与标记`}
    >
      <button
        className="rail-heading glass"
        onClick={() => setList(!list)}
        aria-label={`行程标记 ${entries.length} 个`}
        aria-expanded={list}
      >
        标记 {entries.length}
      </button>
      {multiple && (
        <button
          className="rail-choice glass"
          aria-label={`当前${active.label}，切换原路或备选`}
          title="点击切换原路与备选，也可直接点下方细轨道"
          style={{ borderBottomColor: active.color }}
          onClick={() =>
            onAlternative(
              choices[(choices.indexOf(active) + 1) % choices.length].id,
            )
          }
        >
          {active.label} ⇄
        </button>
      )}
      <span className="rail-end">
        终点<small>{(active.distance / 1000).toFixed(1)} km</small>
      </span>
      <div
        className="rail-colors"
        role="slider"
        tabIndex={0}
        aria-label={multiple ? `浏览${active.label}里程` : '浏览轨迹里程'}
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={
          active.distance ? (atDistance(active.id) / active.distance) * 100 : 0
        }
        onPointerDown={(e) => {
          if (!e.isPrimary || e.button !== 0) return;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          const r = e.currentTarget.getBoundingClientRect();
          const choice =
            shown[
              Math.min(
                shown.length - 1,
                Math.max(
                  0,
                  Math.floor(((e.clientX - r.left) / r.width) * shown.length),
                ),
              )
            ];
          pointerChoice.current = choice.id;
          select(choice.id, railFraction(e.clientY, r.top, r.height));
        }}
        onPointerMove={(e) => {
          if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
          const r = e.currentTarget.getBoundingClientRect();
          select(
            pointerChoice.current,
            railFraction(e.clientY, r.top, r.height),
          );
        }}
        onPointerUp={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId))
            e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onKeyDown={(e) => {
          if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
            e.preventDefault();
            select(
              active.id,
              e.key === 'Home'
                ? 0
                : e.key === 'End'
                  ? 1
                  : atDistance(active.id) / (active.distance || 1) +
                    (e.key === 'ArrowUp' ? 0.01 : -0.01),
            );
          }
        }}
      >
        {shown.map((choice, index) => (
          <div
            key={choice.id}
            className="track-rail-lane"
            data-active={choice.id === active.id}
            aria-label={`${choice.label}进度轨道`}
            title={choice.label}
            style={{
              left: multiple ? 12 + index * 12 : 19,
              background: choice.color,
            }}
          >
            {linked
              .map((marker) => ({
                marker,
                ...markerChainage(
                  linesFor(choice.id),
                  marker.coordinates,
                  marker.trackAnchor!.distance,
                ),
              }))
              .filter((m) => !multiple || m.offset <= 30)
              .map(({ marker, fraction }) => (
                <span
                  key={marker.id}
                  className="rail-lane-marker"
                  title={marker.name}
                  style={{
                    top: `${(1 - fraction) * 100}%`,
                    background: marker.color,
                  }}
                />
              ))}
            <span
              className="rail-lane-thumb"
              style={{
                top: `${(1 - atDistance(choice.id) / (choice.distance || 1)) * 100}%`,
              }}
            />
          </div>
        ))}
        <div
          className="rail-ticks"
          aria-hidden="true"
          style={{ left: multiple ? 37 : 29 }}
        >
          {Array.from({ length: 11 }, (_, i) => (
            <i key={i} style={{ top: `${i * 10}%` }} data-major={i % 5 === 0} />
          ))}
        </div>
      </div>
      <span className="rail-end">
        起点<small>0 km</small>
      </span>
      {list && (
        <div className="track-marker-list glass" aria-label="行程标记列表">
          <header>
            <strong>行程标记 · {active.label}</strong>
            <button
              onClick={() => setList(false)}
              aria-label="关闭行程标记列表"
            >
              ×
            </button>
          </header>
          {entries.length ? (
            entries.map(({ marker, distance, offset }) => (
              <button key={marker.id} onClick={() => onMarker(marker.id)}>
                <i style={{ background: marker.color }} />
                <span>
                  {marker.name || '未命名标记'}
                  <small>
                    {formatDistance(distance)}
                    {offset > 30 ? ` · 离线约${Math.round(offset)}m` : ''}
                  </small>
                </span>
              </button>
            ))
          ) : (
            <p>点击轨迹线段，添加沿途标记。</p>
          )}
        </div>
      )}
    </aside>
  );
}
