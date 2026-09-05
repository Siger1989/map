'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CloudSun, Mountain, RotateCcw } from 'lucide-react';
import { TerrainMap, type MapHandle } from '@/modules/map/TerrainMap';
import { LayerPanel } from '@/modules/controls/LayerPanel';
import { WeatherPanel } from '@/modules/controls/WeatherPanel';
import { WeatherSummary } from '@/modules/controls/WeatherSummary';
import { ControlDock, type ControlPanel } from '@/modules/controls/ControlDock';
import { MapActions } from '@/modules/controls/MapActions';
import { Timeline } from '@/modules/controls/Timeline';
import { CameraGizmo } from '@/modules/controls/CameraGizmo';
import { RoutePanel } from '@/modules/navigation/RoutePanel';
import { useNavigation } from '@/modules/navigation/useNavigation';
import {
  formatDistance,
  formatDuration,
  TRAVEL_MODES,
} from '@/modules/navigation/types';
import { useManualTracks } from '@/modules/tracks/useManualTracks';
import { TrackPanel, TrackTools } from '@/modules/tracks/TrackPanel';
import {
  TrackDrawing,
  type TrackDrawingHandle,
} from '@/modules/tracks/TrackDrawing';
import { ElevationLegend } from '@/modules/controls/ElevationLegend';
import { INITIAL_GEOLOGY } from '@/modules/geology/data';
import { GeologyPanel } from '@/modules/geology/GeologyPanel';
import { useWeather } from '@/modules/weather/useWeather';
import { useMapTools } from '@/modules/controls/useMapTools';
import type { SatelliteState } from '@/modules/satellite/satellite';
import {
  DEFAULT_LAYERS,
  applyLayerPatch,
  INITIAL_VIEW,
  type LayerSettings,
  type Point,
  type ViewState,
} from '@/modules/map/types';

export default function Home() {
  const map = useRef<MapHandle>(null);
  const drawing = useRef<TrackDrawingHandle>(null);
  const [layers, setLayers] = useState<LayerSettings>(DEFAULT_LAYERS);
  const [geology, setGeology] = useState(INITIAL_GEOLOGY);
  const [point, setPoint] = useState<Point>({
    lng: INITIAL_VIEW.center[0],
    lat: INITIAL_VIEW.center[1],
    elevation: null,
  });
  const [mapStatus, setMapStatus] = useState('正在加载真实地形…');
  const [panel, setPanel] = useState<ControlPanel>(null);
  const [anchor, setAnchor] = useState<[number, number]>(INITIAL_VIEW.center);
  const [view, setView] = useState<ViewState>(INITIAL_VIEW);
  const [satellite, setSatellite] = useState<SatelliteState>({
    date: '',
    status: '正在获取卫星影像日期…',
    ready: false,
  });
  const [hourIndex, setHourIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const weather = useWeather(anchor);
  const navigation = useNavigation();
  const tracks = useManualTracks();
  const routeOverlay = useMemo(
    () => ({
      start: navigation.start,
      end: navigation.end,
      route: navigation.route,
    }),
    [navigation.start, navigation.end, navigation.route],
  );
  const trackOverlay = useMemo(
    () => ({
      saved: tracks.overlaySaved,
      draft: tracks.draft,
      visible: tracks.visible,
      style: tracks.style,
      nodes: tracks.vertices,
    }),
    [
      tracks.overlaySaved,
      tracks.draft,
      tracks.visible,
      tracks.style,
      tracks.vertices,
    ],
  );
  const update = (patch: Partial<LayerSettings>) =>
    setLayers((current) => applyLayerPatch(current, patch));
  useMapTools({
    read: () => ({
      layers,
      view,
      point,
      satellite,
      geology,
      weatherTime: weather.data?.times[hourIndex] ?? null,
      weatherError: weather.error,
      map: map.current?.inspect(),
    }),
    configure: (patch, pitch, bearing) => {
      update(patch);
      if (pitch !== undefined || bearing !== undefined)
        map.current?.view(pitch ?? view.pitch, bearing ?? view.bearing, false);
    },
  });
  useEffect(() => {
    setHourIndex(0);
    setPlaying(false);
  }, [weather.data?.fetchedAt]);
  useEffect(() => {
    if (!playing || !weather.data) return;
    const interval = setInterval(
      () => setHourIndex((i) => (i + 1) % weather.data!.times.length),
      1600,
    );
    return () => clearInterval(interval);
  }, [playing, weather.data]);
  const resetView = () => {
    update({ terrain: true });
    map.current?.reset();
  };
  return (
    <main
      className="observatory"
      data-panel={panel ?? 'map'}
      data-route-notice={Boolean(navigation.picking || navigation.route)}
      data-drawing={tracks.drawing && panel === null}
      data-editing-track={tracks.editing}
      data-picking-route={Boolean(navigation.picking)}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        if (navigation.picking) {
          event.preventDefault();
          navigation.setPicking(null);
          setPanel('route');
        } else if (tracks.editing) {
          event.preventDefault();
          tracks.finish();
          setPanel('track');
        }
      }}
    >
      <TerrainMap
        ref={map}
        settings={layers}
        onPoint={setPoint}
        onStatus={setMapStatus}
        onView={setView}
        onAnchor={setAnchor}
        onSatellite={setSatellite}
        onGeology={setGeology}
        weather={weather.data}
        hourIndex={hourIndex}
        routeOverlay={routeOverlay}
        trackOverlay={trackOverlay}
        drawingActive={tracks.drawing && panel === null}
        onDrawingInput={(event) => drawing.current?.input(event)}
        onMapPick={(coordinates) => {
          if (navigation.pick(coordinates)) setPanel('route');
        }}
      />
      <TrackDrawing
        ref={drawing}
        enabled={tracks.drawing && panel === null}
        length={tracks.rodLength}
        style={tracks.style}
        mode={tracks.mode}
        anchor={tracks.anchor}
        candidates={tracks.candidates}
        snapping={tracks.snapping}
        lastVertex={tracks.draft.at(-1)?.at(-1) ?? null}
        toScreen={(point) => map.current?.toScreen(point) ?? null}
        magnify={(canvas, point) =>
          map.current?.magnify(canvas, point) ?? (() => {})
        }
        onAnchor={tracks.setAnchor}
        onVertex={tracks.addVertex}
        toCoordinate={(point) => map.current?.toCoordinate(point) ?? null}
        onStroke={tracks.addStroke}
      />
      {tracks.editing && (
        <TrackTools
          tracks={tracks}
          onLocate={(point) => map.current?.focusPoint(point)}
          onFinish={() => {
            tracks.finish();
            setPanel('track');
          }}
        />
      )}
      <header className="topbar glass">
        <div className="brand">
          <span className="brand-icon">
            <CloudSun size={17} />
          </span>
          <h1>观云</h1>
        </div>
        <div className="region">
          <strong>成都 · 川西</strong>
          <span title={mapStatus} role="status">
            {mapStatus}
          </span>
        </div>
        <button
          className="icon-button"
          aria-label="返回成都川西视角"
          onClick={resetView}
        >
          <RotateCcw size={15} />
        </button>
      </header>
      {navigation.picking ? (
        <div className="route-map-notice glass" role="status">
          点击地图设置{navigation.picking === 'start' ? '起点' : '终点'}
          <button
            onClick={() => {
              navigation.setPicking(null);
              setPanel('route');
            }}
          >
            取消
          </button>
        </div>
      ) : (
        navigation.route && (
          <button
            className="route-map-notice glass"
            onClick={() => setPanel(panel === 'route' ? null : 'route')}
            aria-label="查看路线详情"
          >
            {TRAVEL_MODES.find((m) => m.id === navigation.mode)?.label} ·{' '}
            {formatDistance(navigation.route.distance)} · 预计{' '}
            {formatDuration(navigation.route.duration)}
          </button>
        )
      )}
      <div className="map-legends">
        {layers.elevationColors && <ElevationLegend />}
        {layers.geology && (
          <GeologyPanel
            state={geology}
            source={layers.geologySource}
            onSource={(geologySource) => update({ geologySource })}
            onRetry={() => map.current?.refreshGeology()}
          />
        )}
      </div>
      <MapActions
        terrain={layers.terrain}
        bearing={view.bearing}
        onZoom={(amount) => map.current?.zoom(amount)}
        onNorth={() => map.current?.north()}
        onDimension={() => {
          update({ terrain: !layers.terrain });
          map.current?.view(layers.terrain ? 0 : 62, view.bearing);
        }}
      />
      <ControlDock
        active={panel}
        onActive={(next) => {
          if (next) {
            tracks.pause();
            navigation.setPicking(null);
          }
          setPanel(next);
        }}
        timeLabel={playing ? '播放中' : hourIndex ? `+${hourIndex}h` : '时间'}
        summary={
          <WeatherSummary
            data={weather.data}
            index={hourIndex}
            point={point}
            loading={weather.loading}
            error={weather.error}
            active={panel === 'weather'}
            onOpen={() => {
              tracks.pause();
              navigation.setPicking(null);
              setPanel(panel === 'weather' ? null : 'weather');
            }}
          />
        }
        timeline={
          <Timeline
            data={weather.data}
            index={hourIndex}
            playing={playing}
            onIndex={setHourIndex}
            onPlaying={setPlaying}
            rainVisible={layers.rain}
            expanded
          />
        }
      >
        {(panel === 'route' || panel === 'track') && (
          <nav className="route-tabs" aria-label="路线类型">
            <button
              aria-pressed={panel === 'route'}
              onClick={() => setPanel('route')}
            >
              道路规划
            </button>
            <button
              aria-pressed={panel === 'track'}
              onClick={() => setPanel('track')}
            >
              手绘轨迹
            </button>
          </nav>
        )}
        {panel === 'track' && (
          <TrackPanel
            tracks={tracks}
            onDraw={() => {
              map.current?.stop();
              navigation.setPicking(null);
              tracks.start();
              setPanel(null);
            }}
            onShow={(points) => {
              map.current?.fitRoute(points);
              setPanel(null);
            }}
          />
        )}
        {panel === 'route' && (
          <RoutePanel
            navigation={navigation}
            near={[point.lng, point.lat]}
            onPick={(slot) => {
              navigation.setPicking(slot);
              setPanel(null);
            }}
            onPlace={(place) => map.current?.focusPoint(place.coordinates)}
            onShow={(route) => {
              map.current?.fitRoute(route.coordinates);
              setPanel(null);
            }}
          />
        )}
        {panel === 'weather' && (
          <WeatherPanel
            data={weather.data}
            index={hourIndex}
            point={point}
            loading={weather.loading}
            error={weather.error}
            onRefresh={() => {
              void weather.refresh();
              map.current?.refreshSatellite();
            }}
          />
        )}
        {panel === 'layers' && (
          <>
            <div className="view-presets" aria-label="观察模式">
              <button
                aria-pressed={layers.clouds || layers.rain}
                onClick={() =>
                  update({
                    terrain: true,
                    clouds: true,
                    rain: true,
                    contours: false,
                  })
                }
              >
                <CloudSun size={18} />
                天气总览
              </button>
              <button
                aria-pressed={!layers.clouds && !layers.rain}
                onClick={() =>
                  update({
                    terrain: true,
                    clouds: false,
                    rain: false,
                    contours: true,
                  })
                }
              >
                <Mountain size={18} />
                看清地形
              </button>
            </div>
            <LayerPanel
              settings={layers}
              onChange={update}
              satelliteDate={satellite.date}
              satelliteStatus={satellite.status}
            />
          </>
        )}
        {(panel === 'weather' || panel === 'layers') && (
          <p className="map-status" role="status">
            {mapStatus}
          </p>
        )}
      </ControlDock>
      <CameraGizmo
        view={view}
        onView={(pitch, bearing) => {
          if (pitch > 0 && !layers.terrain) update({ terrain: true });
          map.current?.view(pitch, bearing, false);
        }}
      />
    </main>
  );
}
