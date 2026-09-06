'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRecording } from '@/modules/outdoor/useRecording';
import { useOffline } from '@/modules/outdoor/useOffline';
import { OutdoorPanel } from '@/modules/outdoor/OutdoorPanel';
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
import { useRouteFavorites } from '@/modules/navigation/useRouteFavorites';
import { FavoritesPanel } from '@/modules/navigation/FavoritesPanel';
import { useRouteJourney } from '@/modules/journey/useRouteJourney';
import {
  RouteWeatherRail,
  RouteWeatherSettings,
} from '@/modules/journey/RouteWeatherRail';
import { usePosition } from '@/modules/position/usePosition';
import {
  formatDistance,
  formatDuration,
  TRAVEL_MODES,
} from '@/modules/navigation/types';
import { useManualTracks } from '@/modules/tracks/useManualTracks';
import { DRAFT_ID } from '@/modules/tracks/editing';
import type { FeatureMove } from '@/modules/map/FeatureDragBridge';
import { SectionPanel } from '@/modules/section/SectionPanel';
import { TERRAIN_SECTION_ENABLED } from '@/config/features';
import {
  INITIAL_SECTION_STATUS,
  type SectionSettings,
} from '@/modules/section/types';
import { useAnnotations } from '@/modules/annotations/useAnnotations';
import { AnnotationPanel } from '@/modules/annotations/AnnotationPanel';
import { KINDS } from '@/modules/annotations/data';
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
  const favorites = useRouteFavorites();
  const routeJourney = useRouteJourney(navigation.route);
  const position = usePosition();
  const tracks = useManualTracks();
  const annotations = useAnnotations();
  const recorder = useRecording();
  const offline = useOffline();
  const [cameraOpen, setCameraOpen] = useState(false);
  const recordedSegments = useMemo(
    () =>
      recorder.record.segments
        .filter((s) => s.length >= 2)
        .map((s) => s.map((p) => p.coordinates)),
    [recorder.record],
  );
  const [featureMove, setFeatureMove] = useState<FeatureMove | null>(null);
  const [sectionDraft, setSection] = useState<SectionSettings>({
    enabled: false,
    altitude: 1500,
    color: '#ffffff',
  });
  const section = useMemo(
    () =>
      TERRAIN_SECTION_ENABLED
        ? sectionDraft
        : { ...sectionDraft, enabled: false },
    [sectionDraft],
  );
  const [sectionStatus, setSectionStatus] = useState(INITIAL_SECTION_STATUS);
  const toggleSection = () => {
    if (section.enabled) {
      setSection((current) => ({ ...current, enabled: false }));
      return;
    }
    tracks.finish();
    tracks.select(null);
    annotations.select(null);
    navigation.setPicking(null);
    position.free();
    setPanel(null);
    setSectionStatus(INITIAL_SECTION_STATUS);
    const placement = map.current?.sectionCenter();
    setSection({
      enabled: true,
      altitude: placement?.altitude ?? Math.round(point.elevation ?? 1500),
      color: section.color,
      plane: {
        center: placement?.center ?? [point.lng, point.lat],
        width: placement?.width ?? 5000,
        height: Math.min(
          30000,
          Math.max(2000, (placement?.width ?? 5000) * 0.65),
        ),
        heading: placement?.heading ?? view.bearing,
        tilt: 0,
      },
    });
  };
  const annotationOverlay = useMemo(() => {
    const target = featureMove?.target;
    return target?.kind === 'annotation' && featureMove
      ? annotations.items.map((item) =>
          item.id === target.id
            ? { ...item, coordinates: featureMove.coordinate }
            : item,
        )
      : annotations.items;
  }, [annotations.items, featureMove]);
  const selectedAnnotation = annotationOverlay.find(
    (item) => item.id === annotations.selected,
  );
  const selectedTrack = tracks.saved.find(
    (track) => track.id === tracks.selectedId,
  );
  const selectedDraft =
    tracks.selectedId === DRAFT_ID && tracks.draft.length > 0;
  const selectionName = selectedAnnotation
    ? selectedAnnotation.name || '未命名标记'
    : selectedTrack?.name || (selectedDraft ? '路线草稿' : '');
  useEffect(() => {
    if (
      position.direction === 'device' &&
      position.heading !== null &&
      !tracks.drawing
    )
      map.current?.view(view.pitch, position.heading, false);
  }, [position.direction, position.heading, tracks.drawing]);
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
      saved: recordedSegments.length
        ? [
            ...tracks.overlaySaved,
            {
              id: 'live-recording',
              name: '实走记录',
              createdAt: recorder.record.startedAt,
              segments: recordedSegments,
            },
          ]
        : tracks.overlaySaved,
      draft: tracks.draft,
      visible: tracks.visible || recorder.record.phase !== 'idle',
      style: tracks.style,
      nodes: tracks.vertices,
      selectedId: tracks.selectedId,
      preview:
        featureMove?.target.kind === 'track'
          ? {
              node: featureMove.target.node,
              coordinate: featureMove.coordinate,
            }
          : null,
    }),
    [
      recordedSegments,
      recorder.record.startedAt,
      recorder.record.phase,
      tracks.overlaySaved,
      tracks.draft,
      tracks.visible,
      tracks.style,
      tracks.vertices,
      tracks.selectedId,
      featureMove,
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
      data-section={section.enabled}
      data-route-notice={Boolean(navigation.picking || navigation.route)}
      data-drawing={tracks.drawing && panel === null}
      data-editing-track={tracks.editing}
      data-picking-route={Boolean(navigation.picking)}
      data-route-rail={Boolean(navigation.route)}
      data-placing-annotation={Boolean(annotations.picking)}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        if (section.enabled) {
          event.preventDefault();
          setSection((current) => ({ ...current, enabled: false }));
          return;
        }
        if (annotations.picking) {
          event.preventDefault();
          annotations.setPicking(null);
          setPanel('annotations');
        } else if (navigation.picking) {
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
        section={section}
        onSectionStatus={setSectionStatus}
        onSectionChange={setSection}
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
        position={position.fix}
        onManualRotate={position.free}
        annotations={annotationOverlay}
        roadSnapping={tracks.roadSnapping}
        annotationSelected={annotations.selected}
        pickingActive={Boolean(annotations.picking || navigation.picking)}
        onTrackSelect={(id) => {
          tracks.select(id);
          annotations.select(null);
          tracks.finish();
          setPanel('track');
        }}
        onDragBegin={(target) => {
          position.free();
          tracks.finish();
          if (target.kind === 'track') {
            tracks.select(target.node.trackId);
            annotations.select(null);
          } else {
            annotations.select(target.id);
            tracks.select(null);
          }
          setPanel(null);
        }}
        onDragPreview={setFeatureMove}
        onDragCommit={({ target, coordinate }) => {
          if (target.kind === 'track') tracks.moveNode(target.node, coordinate);
          else annotations.move(target.id, coordinate);
        }}
        onAnnotationSelect={(id) => {
          annotations.select(id);
          tracks.select(null);
          tracks.finish();
          navigation.setPicking(null);
          setPanel('annotations');
        }}
        onMapPick={(coordinates) => {
          if (annotations.picking) {
            const kind = annotations.picking;
            if (annotations.place(coordinates))
              map.current?.focusPoint(coordinates, kind === 'pin' ? 15 : 18);
            else annotations.setPicking(null);
            setPanel('annotations');
            return;
          }
          if (navigation.pick(coordinates)) setPanel('route');
          else {
            tracks.select(null);
            annotations.select(null);
          }
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
        roadSnapping={tracks.roadSnapping}
        snapRoad={(point, previous) =>
          map.current?.snapRoad(point, previous) ?? {
            status: 'loading',
            match: null,
          }
        }
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
      {tracks.editing && tracks.drawing && panel === null && (
        <TrackTools
          tracks={tracks}
          onLocate={(point) => map.current?.focusPoint(point)}
          onFinish={() => {
            tracks.finish();
            setPanel('track');
          }}
        />
      )}
      {selectionName &&
        !tracks.drawing &&
        !annotations.picking &&
        !navigation.picking &&
        panel === null && (
          <div
            className={`selection-tools glass${selectedAnnotation ? ' is-annotation' : ''}`}
            aria-label="选中对象编辑工具"
          >
            <div role="status">
              <strong>{selectionName}</strong>
              <span>
                {featureMove
                  ? '正在调整位置 · 松手确认，双指取消'
                  : selectedAnnotation
                    ? '长按模型后拖动 · 松手保存'
                    : '长按节点约半秒，再拖动位置'}
              </span>
              {selectedAnnotation && featureMove && (
                <span>
                  经度 {selectedAnnotation.coordinates[0].toFixed(6)} · 纬度{' '}
                  {selectedAnnotation.coordinates[1].toFixed(6)}
                  {featureMove?.target.kind === 'annotation' ? '（预览）' : ''}
                </span>
              )}
            </div>
            {(selectedAnnotation ? annotations.error : tracks.error) && (
              <p role="alert">
                {selectedAnnotation ? annotations.error : tracks.error}
              </p>
            )}
            <div>
              <button
                disabled={!!featureMove}
                onClick={() =>
                  setPanel(selectedAnnotation ? 'annotations' : 'track')
                }
              >
                详情 / 编辑
              </button>
              <button
                disabled={
                  !!featureMove ||
                  (selectedAnnotation
                    ? annotations.moveUndoId !== selectedAnnotation.id
                    : selectedDraft
                      ? !tracks.canUndo
                      : tracks.nodeUndoId !== tracks.selectedId)
                }
                onClick={() =>
                  selectedAnnotation
                    ? annotations.undoMove()
                    : selectedDraft
                      ? tracks.undo()
                      : tracks.undoNodeMove()
                }
              >
                撤销
              </button>
              <button
                disabled={!!featureMove}
                onClick={() => {
                  tracks.select(null);
                  annotations.select(null);
                }}
              >
                完成调整
              </button>
            </div>
          </div>
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
      {annotations.picking ? (
        <div className="route-map-notice glass" role="status">
          点击地图
          {annotations.picking === 'move'
            ? '移动标记'
            : `放置${KINDS[annotations.picking]}`}
          <button
            onClick={() => {
              annotations.setPicking(null);
              setPanel('annotations');
            }}
          >
            取消
          </button>
        </div>
      ) : navigation.picking ? (
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
      <div className="map-legends" hidden={panel !== 'layers'}>
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
      {navigation.route && !section.enabled && (
        <RouteWeatherRail
          route={navigation.route}
          journey={routeJourney}
          fix={position.fix}
          onSettings={() => {
            tracks.pause();
            setPanel('route');
          }}
        />
      )}
      {(position.locationError ||
        position.directionError ||
        position.locating) && (
        <div className="position-status glass" role="status">
          <span>
            {position.locationError ||
              position.directionError ||
              '正在获取当前位置…'}
          </span>
          <button
            aria-label="收起定位提示"
            onClick={() =>
              position.locating
                ? position.stopLocation()
                : position.clearError()
            }
          >
            ×
          </button>
        </div>
      )}
      <MapActions
        sectionActive={section.enabled}
        onSection={toggleSection}
        terrain={layers.terrain}
        bearing={view.bearing}
        onZoom={(amount) => map.current?.zoom(amount)}
        onNorth={() => {
          position.north();
          map.current?.north();
        }}
        onLocate={() =>
          position.locate((fix) => map.current?.focusPoint(fix.coordinates))
        }
        locating={position.locating}
        watching={position.watching}
        onStopLocation={position.stopLocation}
        direction={position.direction}
        onDevice={() =>
          position.direction === 'device'
            ? position.free()
            : void position.device()
        }
        onDimension={() => {
          update({ terrain: !layers.terrain });
          map.current?.view(layers.terrain ? 0 : 62, view.bearing);
        }}
      />
      {recorder.record.phase !== 'idle' && (
        <button
          className="recording-chip glass"
          onClick={() => setPanel('outdoor')}
        >
          {recorder.record.phase === 'recording' ? '● 记录中' : '记录待处理'} ·{' '}
          {recorder.record.segments.reduce((n, s) => n + s.length, 0)} 点
        </button>
      )}
      <ControlDock
        active={panel}
        cameraOpen={cameraOpen}
        onCamera={() => {
          setCameraOpen((v) => !v);
          setPanel(null);
        }}
        onActive={(next) => {
          if (next) {
            tracks.pause();
            navigation.setPicking(null);
            annotations.setPicking(null);
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
              annotations.setPicking(null);
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
        {panel === 'outdoor' && (
          <OutdoorPanel
            recorder={recorder}
            offline={offline}
            points={
              selectedTrack?.segments.flat() ??
              navigation.route?.coordinates ?? [[point.lng, point.lat]]
            }
            name={
              selectedTrack?.name ??
              (navigation.route ? '当前规划路线' : '地图选点周边')
            }
            onShow={(points) => {
              map.current?.fitRoute(points);
              setPanel(null);
            }}
            onOpenMap={() =>
              update({
                satellite: false,
                contours: false,
                clouds: false,
                rain: false,
                geology: false,
                elevationColors: false,
                roads: true,
                labels: true,
              })
            }
          />
        )}
        {panel === 'annotations' && (
          <AnnotationPanel
            state={annotations}
            onPick={(kind) => {
              tracks.pause();
              navigation.setPicking(null);
              annotations.setPicking(kind);
              map.current?.stop();
              setPanel(null);
            }}
            onLocate={(coordinates) => {
              map.current?.focusPoint(coordinates, 18);
              setPanel(null);
            }}
          />
        )}
        {(panel === 'route' || panel === 'track' || panel === 'favorites') && (
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
            <button
              aria-pressed={panel === 'favorites'}
              onClick={() => setPanel('favorites')}
            >
              收藏夹
            </button>
          </nav>
        )}
        {panel === 'favorites' && (
          <FavoritesPanel
            favorites={favorites}
            tracks={tracks}
            onRoute={(favorite) => {
              navigation.restore(favorite);
              map.current?.fitRoute(favorite.route.coordinates);
              setPanel(null);
            }}
            onTrack={(id) => {
              const track = tracks.saved.find((t) => t.id === id);
              if (track) {
                tracks.select(id);
                annotations.select(null);
                tracks.setVisible(true);
                map.current?.fitRoute(track.segments.flat());
                setPanel('track');
              }
            }}
          />
        )}
        {panel === 'track' && (
          <TrackPanel
            tracks={tracks}
            onEditNodes={(id) => {
              tracks.select(id);
              tracks.setVisible(true);
              annotations.select(null);
              tracks.finish();
              setPanel(null);
            }}
            onDraw={() => {
              map.current?.stop();
              navigation.setPicking(null);
              tracks.start();
              annotations.select(null);
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
            onSave={() => {
              if (navigation.start && navigation.end && navigation.route)
                favorites.save(
                  navigation.start,
                  navigation.end,
                  navigation.route,
                );
            }}
            saveMessage={
              favorites.messageRoute === navigation.route?.createdAt
                ? favorites.message
                : ''
            }
            locating={position.locating}
            onCurrentPosition={() =>
              position.locate((fix) => {
                navigation.place('start', {
                  name: '当前位置',
                  coordinates: fix.coordinates,
                });
                map.current?.focusPoint(fix.coordinates);
              })
            }
            onPick={(slot) => {
              annotations.setPicking(null);
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
        {panel === 'route' && navigation.route && (
          <RouteWeatherSettings journey={routeJourney} />
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
      {section.enabled && (
        <SectionPanel
          settings={section}
          status={sectionStatus}
          onChange={setSection}
          onCenter={() => {
            const placement = map.current?.sectionCenter();
            if (placement)
              setSection((current) => ({
                ...current,
                altitude: placement.altitude,
                plane: { ...current.plane!, center: placement.center },
              }));
          }}
          onClose={() =>
            setSection((current) => ({ ...current, enabled: false }))
          }
          onRetry={() => map.current?.refreshSection()}
        />
      )}
      {cameraOpen && (
        <CameraGizmo
          view={view}
          onView={(pitch, bearing) => {
            position.free();
            if (pitch > 0 && !layers.terrain && !section.enabled)
              update({ terrain: true });
            map.current?.view(pitch, bearing, false);
          }}
        />
      )}
    </main>
  );
}
