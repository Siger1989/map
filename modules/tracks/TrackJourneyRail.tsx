import { useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { Annotation } from '../annotations/data';
import { formatDistance } from '../navigation/types';
import { trackDistance, type ManualTrack } from './drawing';
import { markerChainage, trackPointAt, type TrackLinePoint } from './linePoint';
import { trackAlternatives } from './alternatives';
import { normalizeTrackStyle } from './style';
import { railFraction } from '../journey/scrub';
import { resolvedRouteTerminals } from './routeTerminals';
import './trackPoints.css';

export function TrackJourneyRail({
  track,
  markers,
  selected,
  onPoint,
  onMarker,
  activeAlternative,
  onAlternative,
  homeOverview = false,
  reversed = false,
  onReverse,
}: {
  track: Pick<
    ManualTrack,
    'id' | 'segments' | 'name' | 'style' | 'sourceTrackIds' | 'routeTerminals' | 'sharedRoute'
  >;
  markers: Annotation[];
  selected: TrackLinePoint | null;
  onPoint: (point: TrackLinePoint) => void;
  onMarker: (id: string) => void;
  activeAlternative: string;
  onAlternative: (id: string) => void;
  homeOverview?: boolean;
  reversed?: boolean;
  onReverse?: () => void;
}) {
  const [list, setList] = useState(false);
  const [overviewOpen, setOverviewOpen] = useState(true);
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
  const [routeStart, routeEnd] = resolvedRouteTerminals(track);
  const hasDirection = !!routeStart && !!routeEnd;
  const displayStart = hasDirection && reversed ? routeEnd : routeStart;
  const displayEnd = hasDirection ? (reversed ? routeStart : routeEnd) : null;
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
      ? (() => {
          const hit = markerChainage(linesFor(id), selected.coordinate, selected.distance);
          return hit.offset <= 0.25 ? hit.distance : (positions[id] ?? 0);
        })()
      : (positions[id] ?? 0);
  const activeStart = displayStart && markerChainage(linesFor(active.id), displayStart);
  const activeEnd = displayEnd && markerChainage(linesFor(active.id), displayEnd);
  const endDistance = activeStart && activeEnd && activeStart.offset <= 0.25 && activeEnd.offset <= 0.25
    ? formatDistance(Math.abs(activeEnd.distance - activeStart.distance))
    : '已指定';
  const selectTerminal = (coordinate: NonNullable<typeof displayStart>) => {
    const activeHit = markerChainage(linesFor(active.id), coordinate);
    const sourceHit = markerChainage(track.segments, coordinate);
    if (activeHit.offset <= 0.25)
      setPositions((p) => ({ ...p, [active.id]: activeHit.distance }));
    onPoint({
      trackId: track.id,
      coordinate,
      distance: activeHit.offset <= 0.25 ? activeHit.distance : sourceHit.distance,
      sourceDistance: sourceHit.distance,
    });
  };
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
  if (homeOverview)
    return (
      <aside className="home-journey-points" aria-label="路线行程点">
        <button
          className="home-journey-heading"
          onClick={() => setOverviewOpen(!overviewOpen)}
          aria-expanded={overviewOpen}
        >
          <strong>行程点</strong>
          {overviewOpen ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>
        {overviewOpen && <>
          <div className="home-journey-switches">
            {multiple && (
              <button
                onClick={() =>
                  onAlternative(
                    choices[(choices.indexOf(active) + 1) % choices.length].id,
                  )
                }
              >
                {active.label} ⇄
              </button>
            )}
            {onReverse && <button className="home-route-direction" aria-label="切换路线方向" aria-pressed={hasDirection && reversed} disabled={!hasDirection} title={hasDirection ? undefined : '请先在线路编辑中确定起终点'} onClick={onReverse}>⇄ {hasDirection && reversed ? '反向' : '正向'}</button>}
          </div>
          <div className="home-journey-list">
            <button disabled={!displayStart} onClick={() => displayStart && selectTerminal(displayStart)}>
              <i />
              <span>{displayStart ? '起点' : '起点未指定'}</span>
              <small>{displayStart ? '0.0 km' : '编辑路线设置'}</small>
            </button>
            {(reversed ? [...entries].reverse() : entries).map(({ marker, distance }) => (
              <button key={marker.id} onClick={() => onMarker(marker.id)}>
                <i style={{ background: marker.color }} />
                <span>{marker.name || '标记'}</span>
                <small>{formatDistance(reversed ? Math.max(0,active.distance-distance) : distance)}</small>
              </button>
            ))}
            <button className="home-journey-end" disabled={!displayEnd} aria-label={displayEnd ? '查看已选终点' : '终点未指定'} onClick={() => displayEnd && selectTerminal(displayEnd)}>
              <i />
              <span>{displayEnd ? '终点' : '终点未指定'}</span>
              <small>{displayEnd ? endDistance : '编辑路线设置'}</small>
            </button>
          </div>
        </>}
      </aside>
    );
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
        {displayEnd ? '终点' : '终点未指定'}<small>{displayEnd ? endDistance : '—'}</small>
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
        {displayStart ? '起点' : '起点未指定'}<small>{displayStart ? '0 km' : '—'}</small>
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
