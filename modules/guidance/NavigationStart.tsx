import { useEffect, useMemo, useRef, useState } from 'react';
import { RouteBack } from '../tracks/RouteViews';
import { RouteElevationSummary } from '../journey/RouteElevationSummary';
import type { TrackAlternative } from '../tracks/alternatives';
import { useRouteDialogFocus } from '../tracks/useRouteDialogFocus';
import { RouteMiniMap } from './RouteMiniMap';
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
  alternatives = [],
  alternativeId = 'main',
  onAlternative,
  startError = '',
}: {
  target: RouteFavorite;
  onStart: (value: RouteFavorite) => void;
  onClose: () => void;
  alternatives?: TrackAlternative[];
  alternativeId?: string;
  onAlternative?: (id: string) => void;
  startError?: string;
}) {
  const root = useRouteDialogFocus(onClose);
  const choice = alternatives.find((v) => v.id === alternativeId);
  const source = useMemo(
    () =>
      choice
        ? {
            ...target,
            route: {
              ...target.route,
              coordinates: choice.coordinates,
              preferredTrackPath: choice.coordinates,
            },
          }
        : target,
    [target, choice],
  );
  const [mode, setMode] = useState<TravelMode>(target.route.mode),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  const [reversed, setReversed] = useState(false);
  const [startPlace, setStartPlace] = useState(target.start),
    [endPlace, setEndPlace] = useState(target.end);
  const [roadPreview, setRoadPreview] = useState<typeof target.route | null>(
    null,
  );
  useEffect(() => {
    if (target.route.geometryKind === 'track') return;
    setRoadPreview(null);
    setError('');
    if (mode === target.route.mode && !reversed) {
      setBusy(false);
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    const timer = setTimeout(() => controller.abort(), 20000);
    let current = true;
    const original = target.route.stops ?? [target.start, target.end],
      stops = reversed ? original.slice().reverse() : original;
    setBusy(true);
    void planRoute(
      stops[0],
      stops.at(-1)!,
      mode,
      controller.signal,
      stops.slice(1, -1),
    )
      .then((route) => {
        if (current) setRoadPreview(route);
      })
      .catch((e) => {
        if (current)
          setError(
            controller.signal.aborted
              ? '路线规划超时，请切换出行方式重试'
              : e instanceof Error
                ? e.message
                : '路线规划失败',
          );
      })
      .finally(() => {
        clearTimeout(timer);
        if (current) setBusy(false);
      });
    return () => {
      current = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [target, mode, reversed]);
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
  const prepared = useMemo(() => {
    try {
      return {
        route:
          target.route.geometryKind === 'track'
            ? orientTrack(source, startPlace, endPlace, mode, reversed).route
            : (roadPreview ?? target.route),
        error: '',
      };
    } catch (e) {
      return {
        route: target.route,
        error: e instanceof Error ? e.message : '请选择有效起终点',
      };
    }
  }, [target, source, startPlace, endPlace, mode, reversed, roadPreview]);
  const preview = prepared.route,
    selectedDistance = preview.distance,
    selectionError = prepared.error;
  const start = async () => {
    const abort = new AbortController();
    request.current = abort;
    setBusy(true);
    setError('');
    try {
      let route = preview;
      if (route.geometryKind === 'track') {
        route = orientTrack(source, startPlace, endPlace, mode, reversed).route;
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
    <div className="route-window-backdrop">
      <section
        ref={root}
        className="route-surface navigation-start"
        role="dialog"
        aria-modal="true"
        aria-label="导航准备"
      >
        <header>
          <RouteBack onBack={onClose} />
          <strong>导航准备</strong>
          <span />
        </header>
        <div className="navigation-start-body">
          <p>
            {target.name} · {formatDistance(selectedDistance)}
          </p>
          <div className="navigation-mode-row">
            {TRAVEL_MODES.slice()
              .reverse()
              .map((m) => (
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
          {alternatives.length > 0 && (
            <div className="navigation-variant-row" aria-label="路线方案">
              {alternatives.map((v) => (
                <button
                  key={v.id}
                  aria-pressed={alternativeId === v.id}
                  onClick={() => onAlternative?.(v.id)}
                >
                  <i style={{ background: v.color }} />
                  {v.label}
                </button>
              ))}
            </div>
          )}
          <div className="navigation-direction">
            {(['起点', '终点'] as const).map((label, i) => {
              const place = i ? endPlace : startPlace;
              return (
                <label key={label}>
                  <span
                    className={`navigation-endpoint-label ${i ? 'is-end' : 'is-start'}`}
                  >
                    {label}
                  </span>
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
              ⇅ 交换
            </button>
          </div>
          {!selectionError && !busy && !error && (
            <>
              <RouteMiniMap
                coordinates={preview.coordinates}
                color={choice?.color}
              />
              <RouteElevationSummary
                coordinates={preview.coordinates}
                distance={selectedDistance}
                duration={preview.duration}
              />
            </>
          )}
          <p className="navigation-entry-note">
            {target.route.trackNetwork
              ? '从当前位置最近的相连路段接入，走另一分叉时自动切换，终点保持不变。'
              : '不在起点时，先按相同方式规划到起点，再继续主体线路。'}
          </p>
          {target.route.geometryKind === 'track' && (
            <p className="route-note">
              保留原轨迹；预计用时按所选方式估算，未核实车辆通行条件。接入段按道路规划。
            </p>
          )}
          {(error || selectionError || startError) && (
            <p role="alert" className="route-error">
              {error || selectionError || startError}
            </p>
          )}
        </div>
        <footer>
          <button
            className="route-solid"
            disabled={busy || !!selectionError || !!error}
            onClick={() => void start()}
          >
            {busy ? '正在按出行方式规划…' : '开始导航'}
          </button>
        </footer>
      </section>
    </div>
  );
}
