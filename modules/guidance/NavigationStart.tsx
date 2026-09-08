import { useEffect, useRef, useState } from 'react';
import type { RouteFavorite } from '../navigation/favorites';
import {
  TRAVEL_MODES,
  formatDistance,
  type TravelMode,
} from '../navigation/types';
import { planRoute } from '../navigation/provider';
import './navigationStart.css';
import { orientTrack } from './direction';
import { networkEndpoints, vertexKey } from './network';
import type { RoutePlace } from '../navigation/types';
export function NavigationStart({
  target,
  onStart,
  onClose,
}: {
  target: RouteFavorite;
  onStart: (value: RouteFavorite) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<TravelMode>(target.route.mode),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  const [reversed, setReversed] = useState(false);
  const [startPlace, setStartPlace] = useState(target.start),
    [endPlace, setEndPlace] = useState(target.end);
  const choices: RoutePlace[] = [
    ...new Map(
      [
        ...(target.route.trackNetwork
          ? networkEndpoints(target.route.trackNetwork).map(
              (coordinates, i) => ({ name: `分叉端点 ${i + 1}`, coordinates }),
            )
          : []),
        target.start,
        target.end,
      ].map((p) => [vertexKey(p.coordinates), p]),
    ).values(),
  ];
  useEffect(() => () => request.current?.abort(), []);
  let selectedDistance = target.route.distance,
    selectionError = '';
  if (target.route.geometryKind === 'track') {
    try {
      selectedDistance = orientTrack(
        target,
        startPlace,
        endPlace,
        mode,
        reversed,
      ).route.distance;
    } catch (e) {
      selectionError = e instanceof Error ? e.message : '请选择有效起终点';
    }
  }
  const start = async () => {
    const abort = new AbortController();
    request.current = abort;
    setBusy(true);
    setError('');
    try {
      let route = target.route;
      if (route.geometryKind === 'track') {
        route = orientTrack(target, startPlace, endPlace, mode, reversed).route;
      } else if (route.mode !== mode || reversed) {
        const originalStops = route.stops ?? [target.start, target.end];
        const stops = reversed
          ? originalStops.slice().reverse()
          : originalStops;
        route = await planRoute(
          stops[0],
          stops.at(-1)!,
          mode,
          abort.signal,
          stops.slice(1, -1),
        );
      }
      if (!abort.signal.aborted)
        onStart({ ...target, start: startPlace, end: endPlace, route });
    } catch (e) {
      if (!abort.signal.aborted)
        setError(e instanceof Error ? e.message : '路线计算失败');
    } finally {
      if (!abort.signal.aborted) setBusy(false);
    }
  };
  return (
    <div className="route-dialog-backdrop">
      <section
        className="route-dialog glass"
        role="dialog"
        aria-modal="true"
        aria-label="导航出行方式"
      >
        <header>
          <strong>开始导航</strong>
          <button onClick={onClose} aria-label="取消导航">
            关闭
          </button>
        </header>
        <p>
          {target.name} · {formatDistance(selectedDistance)}
        </p>
        <div className="route-modes">
          {TRAVEL_MODES.map((m) => (
            <button
              key={m.id}
              disabled={busy}
              aria-pressed={mode === m.id}
              onClick={() => setMode(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="navigation-direction">
          {(['起点', '终点'] as const).map((label, i) => {
            const place = i ? endPlace : startPlace;
            return (
              <label key={label}>
                {label}
                {target.route.trackNetwork ? (
                  <select
                    aria-label={`导航${label}`}
                    disabled={busy}
                    value={vertexKey(place.coordinates)}
                    onChange={(e) => {
                      const next = choices.find(
                        (p) => vertexKey(p.coordinates) === e.target.value,
                      )!;
                      if (i) setEndPlace(next);
                      else setStartPlace(next);
                    }}
                  >
                    {choices.map((p) => (
                      <option
                        key={vertexKey(p.coordinates)}
                        value={vertexKey(p.coordinates)}
                      >
                        {p.name} · {p.coordinates[1].toFixed(4)},{' '}
                        {p.coordinates[0].toFixed(4)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span>{place.name}</span>
                )}
              </label>
            );
          })}
          <button
            disabled={busy}
            onClick={() => {
              setStartPlace(endPlace);
              setEndPlace(startPlace);
              setReversed(!reversed);
            }}
          >
            ⇅ 交换起点和终点
          </button>
        </div>
        <p>
          {target.route.trackNetwork
            ? '从当前位置最近的相连路段接入，走另一分叉时自动切换，终点保持不变。'
            : '不在起点时，先按相同方式规划到起点，再继续主体线路。'}
        </p>
        {target.route.geometryKind === 'track' && (
          <p className="route-note">
            保留原轨迹；预计用时按所选方式估算，未核实车辆通行条件。接入段按道路规划。
          </p>
        )}
        {(error || selectionError) && (
          <p role="alert" className="route-error">
            {error || selectionError}
          </p>
        )}
        <button
          className="route-primary"
          disabled={busy || !!selectionError}
          onClick={() => void start()}
        >
          {busy ? '正在按出行方式规划…' : '定位并开始导航'}
        </button>
      </section>
    </div>
  );
}
