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
import type { LayerSettings } from '../map/types';
const sessions=new Map<string,Record<string,RouteFavorite['route']>>();
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
  mapSettings,
}: {
  target: RouteFavorite;
  onStart: (value: RouteFavorite) => void;
  onClose: () => void;
  alternatives?: TrackAlternative[];
  alternativeId?: string;
  onAlternative?: (id: string) => void;
  startError?: string;
  mapSettings?: LayerSettings;
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
  const [routeChoice,setRouteChoice]=useState<'original'|'road'>('original');
  const sessionKey=JSON.stringify([target.id,target.route.coordinates,target.route.mode,target.route.stops,target.route.trackNetwork]);
  const previewKey=JSON.stringify([mode,startPlace.coordinates,endPlace.coordinates,reversed]);
  const [plans,setPlans]=useState<Record<string,typeof target.route>>(()=>sessions.get(sessionKey)??{});
  useEffect(()=>{setPlans(sessions.get(sessionKey)??{});setRouteChoice('original');},[sessionKey]);
  const generation=useRef(0);
  useEffect(()=>{generation.current++;request.current?.abort();setBusy(false);setError('');},[sessionKey,previewKey,routeChoice]);
  const replan = async () => {
    request.current?.abort();
    const controller=new AbortController();request.current=controller;
    const token=++generation.current;
    const timer=setTimeout(()=>controller.abort(),20000);
    setBusy(true);setError('');
    const original=target.route.stops??[target.start,target.end];
    const stops=target.route.geometryKind==='track'?[startPlace,endPlace]:reversed?original.slice().reverse():original;
    try {
      const route=await planRoute(stops[0],stops.at(-1)!,mode,controller.signal,stops.slice(1,-1));
      if(controller.signal.aborted || generation.current!==token)return;
      setPlans(previous=>{const next={...previous,[previewKey]:route};sessions.set(sessionKey,next);if(sessions.size>8)sessions.delete(sessions.keys().next().value!);return next;});
    } catch(e) {if(generation.current===token)setError(controller.signal.aborted?'路线规划超时，可重试':e instanceof Error?e.message:'路线规划失败');}
    finally {clearTimeout(timer);if(generation.current===token)setBusy(false);}
  };
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
      const original=source.route.geometryKind==='track' ? orientTrack(source,startPlace,endPlace,source.route.mode,reversed).route : source.route;
      return {route:routeChoice==='original'?original:plans[previewKey]??original,error:routeChoice==='original' && source.route.geometryKind!=='track' && reversed?'道路原路线不能直接反向，请选择方式后规划。':''};
    } catch(e) {return {route:target.route,error:e instanceof Error?e.message:'请选择有效起终点'};}
  },[target,source,startPlace,endPlace,reversed,routeChoice,plans,previewKey]);
  const preview=prepared.route, selectedDistance=preview.distance, selectionError=prepared.error;
  const roadReady=routeChoice==='original' || !!plans[previewKey];
  const routeOptions=[{id:'original',coordinates:source.route.coordinates,color:choice?.color??'#c2513f'},...Object.entries(plans).map(([id,route])=>({id,coordinates:route.coordinates,color:({pedestrian:'#287d53',bicycle:'#287bbe',auto:'#9056b0'} as const)[route.mode]}))];
  const start = async () => {
    if(!roadReady || busy || selectionError)return;
    const abort = new AbortController();
    request.current = abort;
    setBusy(true);
    setError('');
    try {
      let route = preview;
      if (routeChoice === 'original' && source.route.geometryKind==='track') {
        route = orientTrack(source, startPlace, endPlace, source.route.mode, reversed).route;
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
                  aria-pressed={routeChoice==='road' && mode === m.id}
                  onClick={() => {setMode(m.id);setRouteChoice('road');}}
                >
                  {m.label}
                </button>
              ))}
          </div>
          <div className="navigation-mode-row navigation-route-choice" aria-label="选择导航线路">
            <button aria-pressed={routeChoice==='original'} onClick={()=>setRouteChoice('original')}>原始路线</button>
            {routeChoice==='road' && <button disabled={busy} onClick={()=>void replan()}>{plans[previewKey]?'重新规划':'规划此方式'}</button>}
          </div>
          {routeChoice==='road' && !roadReady && !busy && <p role="status">此方式尚未规划，点击“规划此方式”生成。</p>}
          {alternatives.length > 1 && routeChoice==='original' && (
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
          {routeChoice==='road' && busy && <p role="status">正在获取{TRAVEL_MODES.find(m=>m.id===mode)?.label}道路路线预览…</p>}
          <RouteMiniMap coordinates={preview.coordinates} routes={routeOptions} selectedId={routeChoice==='original'?'original':roadReady?previewKey:''} settings={mapSettings} />
          {!selectionError && roadReady && <RouteElevationSummary coordinates={preview.coordinates} distance={selectedDistance} duration={preview.duration} />}
          <p className="navigation-entry-note">
            {routeChoice==='original' && target.route.trackNetwork
              ? '从当前位置最近的相连路段接入，走另一分叉时自动切换，终点保持不变。'
              : '不在起点时，先按相同方式规划到起点，再继续主体线路。'}
          </p>
          {routeChoice === 'original' && (
            <p className="route-note">
              保留原轨迹；预计用时按所选方式估算，未核实车辆通行条件。接入段按道路规划。
            </p>
          )}
          {((routeChoice==='road' && error) || selectionError || startError) && (
            <p role="alert" className="route-error">
              {(routeChoice==='road' && error) || selectionError || startError}
            </p>
          )}
        </div>
        <footer>
          <button
            className="route-solid"
            disabled={!!selectionError || (routeChoice==='road' && (busy || !roadReady))}
            onClick={() => void start()}
          >
            {routeChoice==='road' && busy ? '正在按出行方式规划…' : routeChoice==='original' ? '沿原路线开始导航' : '使用新规划开始导航'}
          </button>
        </footer>
      </section>
    </div>
  );
}
