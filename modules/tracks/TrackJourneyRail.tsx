import { useState } from 'react';
import type { Annotation } from '../annotations/data';
import { formatDistance } from '../navigation/types';
import { trackDistance, type ManualTrack } from './drawing';
import { markerChainage, trackPointAt, type TrackLinePoint } from './linePoint';
import { railFraction } from '../journey/scrub';
import './trackPoints.css';

export function TrackJourneyRail({
  track,
  markers,
  selected,
  onPoint,
  onMarker,
}: {
  track: Pick<ManualTrack, 'id' | 'segments' | 'name'>;
  markers: Annotation[];
  selected: TrackLinePoint | null;
  onPoint: (point: TrackLinePoint) => void;
  onMarker: (id: string) => void;
}) {
  const [list, setList] = useState(false);
  const length = trackDistance(track.segments);
  const entries = markers
    .filter((m) => m.trackAnchor?.trackId === track.id)
    .map((marker) => ({
      marker,
      ...markerChainage(
        track.segments,
        marker.coordinates,
        marker.trackAnchor!.distance,
      ),
    }))
    .sort((a, b) => a.distance - b.distance);
  const select = (fraction: number) => {
    const distance = Math.max(0, Math.min(1, fraction)) * length;
    const coordinate = trackPointAt(track.segments, distance);
    if (coordinate) onPoint({ trackId: track.id, coordinate, distance });
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
        标记<small>{entries.length}</small>
      </button>
      <span className="rail-end">
        终点<small>{(length / 1000).toFixed(1)} km</small>
      </span>
      <div
        className="rail-colors"
        role="slider"
        tabIndex={0}
        aria-label="浏览轨迹里程"
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={length ? ((selected?.distance ?? 0) / length) * 100 : 0}
        onPointerDown={(e) => {
          if (!e.isPrimary || e.button !== 0) return;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          const r = e.currentTarget.getBoundingClientRect();
          select(railFraction(e.clientY, r.top, r.height));
        }}
        onPointerMove={(e) => {
          if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
          const r = e.currentTarget.getBoundingClientRect();
          select(railFraction(e.clientY, r.top, r.height));
        }}
        onPointerUp={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId))
            e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onKeyDown={(e) => {
          if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
            e.preventDefault();
            select(
              e.key === 'Home'
                ? 0
                : e.key === 'End'
                  ? 1
                  : (selected?.distance ?? 0) / (length || 1) +
                    (e.key === 'ArrowUp' ? 0.01 : -0.01),
            );
          }
        }}
      >
        <div className="rail-tracks">
          <span className="track-mileage-color" />
        </div>
        <div className="rail-ticks" aria-hidden="true">
          {Array.from({ length: 11 }, (_, i) => (
            <i key={i} style={{ top: `${i * 10}%` }} data-major={i % 5 === 0} />
          ))}
        </div>
        {entries.map(({ marker, fraction }) => (
          <span
            key={marker.id}
            className="rail-track-marker"
            title={marker.name}
            style={{
              top: `${(1 - fraction) * 100}%`,
              background: marker.color,
            }}
          />
        ))}
        {selected && (
          <span
            className="rail-track-preview"
            style={{ top: `${(1 - selected.distance / (length || 1)) * 100}%` }}
          />
        )}
      </div>
      <span className="rail-end">
        起点<small>0 km</small>
      </span>
      {list && (
        <div className="track-marker-list glass" aria-label="行程标记列表">
          <header>
            <strong>行程标记</strong>
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
