import { ColorElevation } from '../tracks/ColorElevation';
import type { ManualTrack } from '../tracks/drawing';
import { useEffect, useMemo, useState } from 'react';
import {
  formatDistance,
  formatDuration,
  type Coordinate,
  type TravelMode,
} from '../navigation/types';
import { hasLoosePoints, joinSegments } from '../tracks/snapping';
import { routeConnectionLabel } from '../tracks/routeInfo';
import {
  elevationStats,
  lineLength,
  sampleTerrain,
  weatherStops,
  type ElevationSample,
} from './metrics';
import { readProfile } from './elevationProvider';
const metres = (value: number | null) =>
  value === null ? '—' : `${Math.round(value).toLocaleString()} m`;
const beijing = (time: number) =>
  new Date(time).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
function Profile({ samples }: { samples: ElevationSample[] }) {
  const stats = elevationStats(samples),
    total = samples.at(-1)?.distance ?? 0;
  if (stats.min === null || stats.max === null) return null;
  const range = Math.max(10, stats.max - stats.min);
  let path = '',
    connected = false,
    part = -1;
  for (const s of samples) {
    if (s.elevation === null) {
      connected = false;
      continue;
    }
    const x = 6 + (s.distance / (total || 1)) * 218,
      y = 61 - ((s.elevation - stats.min) / range) * 49;
    path += `${connected && part === s.part ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)} `;
    connected = true;
    part = s.part;
  }
  return (
    <div className="journey-profile">
      <svg
        viewBox="0 0 230 78"
        role="img"
        aria-label={`高程剖面，已采样最低 ${metres(stats.min)}，最高 ${metres(stats.max)}`}
      >
        <path d="M 6 62 H 224" stroke="#ffffff30" />
        <path d={path} stroke="#9de8c4" strokeWidth="1.8" fill="none" />
        <text x="6" y="76">
          0 km
        </text>
        <text x="224" y="76" textAnchor="end">
          {(total / 1000).toFixed(1)} km
        </text>
      </svg>
    </div>
  );
}

/** Optional route details. Reads the shared DEM and estimates the trip schedule. */
export function JourneyPanel({
  segments,
  onLocate,
  mode = 'pedestrian',
  track,
  onCondition,
}: {
  segments: Coordinate[][];
  onLocate: (point: Coordinate) => void;
  mode?: TravelMode;
  track?: ManualTrack;
  onCondition?: (color: string, value: string) => boolean;
}) {
  const chains = useMemo(() => joinSegments(segments), [segments]);
  const distance = useMemo(
    () => chains.reduce((sum, l) => sum + lineLength(l), 0),
    [chains],
  );
  const samples = useMemo(() => sampleTerrain(chains), [chains]);
  const stops = useMemo(
    () => (chains.length === 1 ? weatherStops(chains[0]) : []),
    [chains],
  );
  const [profile, setProfile] = useState<ElevationSample[]>([]),
    [terrainLoading, setTerrainLoading] = useState(false);
  const [terrainError, setTerrainError] = useState('');
  const [departure, setDeparture] = useState(() =>
      new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 16),
    ),
    [speed, setSpeed] = useState(
      { auto: '50', bicycle: '15', pedestrian: '4' }[mode],
    );
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const request = new AbortController();
    setProfile([]);
    setTerrainError('');
    setTerrainLoading(true);
    void readProfile(samples, request.signal)
      .then((result) => {
        if (!request.signal.aborted) setProfile(result);
      })
      .catch(() => {
        if (!request.signal.aborted) setTerrainError('高程读取失败，请重试。');
      })
      .finally(() => {
        if (!request.signal.aborted) setTerrainLoading(false);
      });
    return () => request.abort();
  }, [samples, retry]);
  const stats = elevationStats(profile),
    departureTime = new Date(departure + '+08:00').getTime(),
    kmh = Number(speed);
  const validTiming =
    Number.isFinite(departureTime) && kmh >= 0.5 && kmh <= 150;
  const incomplete = hasLoosePoints(segments),
    canTime = stops.length > 0 && !incomplete && distance > 0;
  const maxInterval = samples.reduce(
    (max, s, i) =>
      i && samples[i - 1].part === s.part
        ? Math.max(max, s.distance - samples[i - 1].distance)
        : max,
    0,
  );
  return (
    <section className="journey-panel" aria-label="整条线路统计与行程时间">
      <div className="journey-total">
        <strong>{formatDistance(distance)}</strong>
        <span>
          {chains.length === 1 && !incomplete
            ? '连续线路'
            : `${chains.length} 段 · ${routeConnectionLabel({ segments })}`}
        </span>
      </div>
      <dl className="journey-stats">
        <div>
          <dt>累计爬升</dt>
          <dd>{metres(stats.ascent)}</dd>
        </div>
        <div>
          <dt>累计下降</dt>
          <dd>{metres(stats.descent)}</dd>
        </div>
        <div>
          <dt>最低海拔</dt>
          <dd>{metres(stats.min)}</dd>
        </div>
        <div>
          <dt>最高海拔</dt>
          <dd>{metres(stats.max)}</dd>
        </div>
        <div>
          <dt>起点海拔</dt>
          <dd>{chains.length === 1 ? metres(stats.start) : '—'}</dd>
        </div>
        <div>
          <dt>终点海拔</dt>
          <dd>{chains.length === 1 ? metres(stats.end) : '—'}</dd>
        </div>
        <div>
          <dt>起终净高差</dt>
          <dd>
            {stats.change !== null && stats.change > 0 ? '+' : ''}
            {metres(stats.change)}
          </dd>
        </div>
      </dl>
      {terrainLoading ? (
        <p className="route-note" role="status">
          正在采样线路高程…
        </p>
      ) : (
        <>
          {track ? (
            <ColorElevation
              track={track}
              lines={chains}
              samples={profile}
              onCondition={onCondition}
            />
          ) : (
            <Profile samples={profile} />
          )}
          <p className="route-note">
            地形估算 · 采样间隔不超过 {Math.ceil(maxInterval)} m · 爬升抑制小于
            3 m 的反向波动。里程不含垂直距离。
          </p>
          {(!stats.complete || terrainError) && (
            <p className="route-error">
              {terrainError ||
                `高程 ${stats.available}/${samples.length} 点可用，缺失处断开，整线爬升暂不提供。`}
              <button onClick={() => setRetry((n) => n + 1)}>重试高程</button>
            </p>
          )}
        </>
      )}
      <strong className="journey-subtitle">行程时间</strong>
      {canTime ? (
        <>
          <label className="journey-input">
            出发时间 · 北京时间
            <input
              type="datetime-local"
              value={departure}
              onChange={(e) => setDeparture(e.target.value)}
            />
          </label>
          <label className="journey-input">
            预计平均速度 · km/h
            <input
              type="number"
              min="0.5"
              max="150"
              step="0.5"
              value={speed}
              onChange={(e) => setSpeed(e.target.value)}
            />
          </label>
          <div className="route-edit-actions">
            {[
              ['步行', '4'],
              ['骑行', '15'],
              ['驾车', '50'],
            ].map(([label, value]) => (
              <button key={label} onClick={() => setSpeed(value)}>
                {label} {value}
              </button>
            ))}
          </div>
          <p className="route-note">
            {validTiming
              ? `预计 ${formatDuration(distance / (kmh / 3.6))}，未计入休息和路况。`
              : '请填有效时间和 0.5–150 km/h 的速度。'}
          </p>
          {validTiming && (
            <>
              <p className="route-note">
                行程时间按平均速度估算；点按地点可在地图定位。
              </p>
              <ol className="journey-weather" aria-label="行程时间安排">
                {stops.map((stop, i) => {
                  const arrival =
                    departureTime + (stop.distance / (kmh / 3.6)) * 1000;
                  return (
                    <li key={i}>
                      <button onClick={() => onLocate(stop.coordinates)}>
                        <b>
                          {i === 0
                            ? '起点'
                            : i === stops.length - 1
                              ? '终点'
                              : `沿途 ${i}`}{' '}
                          · {formatDistance(stop.distance)}
                        </b>
                        <span>预计 {beijing(arrival)}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </>
          )}
        </>
      ) : (
        <p className="route-note">
          先连接各段并确定起终点顺序，再估算沿途到达时间。分岔或空隙不会自动当成可通行路线。
        </p>
      )}
    </section>
  );
}
