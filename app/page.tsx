'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PRODUCT_NAME } from '@/config/product';
import { useMapSources } from '@/modules/mapSources/useMapSources';
import {
  MapSourcesPanel,
  type MapSourcesNavigation,
} from '@/modules/mapSources/MapSourcesPanel';
import { useTripPhotos } from '@/modules/photos/useTripPhotos';
import { PhotoPanel } from '@/modules/photos/PhotoPanel';
import { recordingTrack } from '@/modules/outdoor/savedRecording';
import { PhotoViewer } from '@/modules/photos/PhotoViewer';
import { useRecording } from '@/modules/outdoor/useRecording';
import { useOffline } from '@/modules/outdoor/useOffline';
import { OutdoorPanel } from '@/modules/outdoor/OutdoorPanel';
import { CloudSun, RotateCcw } from 'lucide-react';
import { TerrainMap, type MapHandle } from '@/modules/map/TerrainMap';
import { LayerWindow } from '@/modules/controls/LayerWindow';
import { WeatherPanel } from '@/modules/controls/WeatherPanel';
import { WeatherSummary } from '@/modules/controls/WeatherSummary';
import { PlaceSearch } from '@/modules/controls/PlaceSearch';
import { ControlDock, type ControlPanel } from '@/modules/controls/ControlDock';
import { MapActions } from '@/modules/controls/MapActions';
import { Timeline } from '@/modules/controls/Timeline';
import { CameraGizmo } from '@/modules/controls/CameraGizmo';
import { RoutePanel } from '@/modules/navigation/RoutePanel';
import { useNavigation } from '@/modules/navigation/useNavigation';
import { useGuidance } from '@/modules/guidance/useGuidance';
import { GuidanceCard } from '@/modules/guidance/GuidanceCard';
import { useRouteFavorites } from '@/modules/navigation/useRouteFavorites';
import { CollectionsPanel } from '@/modules/collections/CollectionsPanel';
import { useRouteJourney } from '@/modules/journey/useRouteJourney';
import {
  RouteWeatherRail,
  RouteWeatherSettings,
} from '@/modules/journey/RouteWeatherRail';
import { usePosition } from '@/modules/position/usePosition';
import { recordingPosition } from '@/modules/position/follow';
import { useFollowPosition } from '@/modules/position/useFollowPosition';
import {
  formatDistance,
  formatDuration,
  TRAVEL_MODES,
} from '@/modules/navigation/types';
import { useManualTracks } from '@/modules/tracks/useManualTracks';
import { DRAFT_ID } from '@/modules/tracks/editing';
import type { FeatureMove } from '@/modules/map/FeatureDragBridge';
import { SectionProfile } from '@/modules/section/SectionProfile';
import { useSavedSection } from '@/modules/section/useSavedSection';
import { EMPTY_SECTION } from '@/modules/section/savedSection';
import type {
  SectionProfileData,
  ProfilePoint,
} from '@/modules/section/contours';
import { ObjectGizmo } from '@/modules/objectTransform/ObjectGizmo';
import type { WatchProjection } from '@/modules/objectTransform/projection';
import {
  annotationPose,
  planePose,
  applyAnnotationPose,
  applyPlanePose,
} from '@/modules/objectTransform/math';
import { TERRAIN_SECTION_ENABLED } from '@/config/features';
import {
  INITIAL_SECTION_STATUS,
  type SectionSettings,
} from '@/modules/section/types';
import { useAnnotations } from '@/modules/annotations/useAnnotations';
import { AnnotationPanel } from '@/modules/annotations/AnnotationPanel';
import { QuickAdd } from '@/modules/annotations/QuickAdd';
import type { MapHold } from '@/modules/map/MapLongPress';
import { KINDS, type Annotation } from '@/modules/annotations/data';
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
  const watchObjectProjection = useCallback<WatchProjection>(
    (listener) => map.current?.watchObjectProjection(listener) ?? (() => {}),
    [],
  );
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
  const [sourcesParent, setSourcesParent] = useState<'layers' | 'tools'>(
    'tools',
  );
  const [sourcesNavigation, setSourcesNavigation] =
    useState<MapSourcesNavigation | null>(null);
  const [anchor, setAnchor] = useState<[number, number]>(INITIAL_VIEW.center);
  const [mapCenter, setMapCenter] = useState<[number, number] | null>(null);
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
  const photos = useTripPhotos();
  const mapSources = useMapSources();
  const guidance = useGuidance(
    navigation.route,
    position.fix,
    position.locationError,
  );
  const guidanceOwnsLocation = useRef(false),
    guidanceFocused = useRef(false);
  const [photoGroup, setPhotoGroup] = useState<string[]>([]);
  const photoOverlay = useMemo(
    () => (photos.visible ? photos.items : []),
    [photos.visible, photos.items],
  );
  const photoTracks = useMemo(() => {
    const record = recorder.record;
    if (!record.id || !record.segments.some((s) => s.length))
      return tracks.saved;
    return [
      { ...recordingTrack(record, true), name: '当前实走记录' },
      ...tracks.saved.filter((t) => t.id !== record.id),
    ];
  }, [tracks.saved, recorder.record]);
  const selectedPhoto = photos.items.find((p) => p.id === photos.selected);
  const recordedSegments = useMemo(
    () =>
      recorder.record.segments
        .filter((s) => s.length >= 2)
        .map((s) => s.map((p) => p.coordinates)),
    [recorder.record],
  );
  const [featureMove, setFeatureMove] = useState<FeatureMove | null>(null);
  const [quickAdd, setQuickAdd] = useState<MapHold | null>(null);
  const {
    settings: sectionDraft,
    set: setSection,
    error: sectionSaveError,
    ready: sectionReady,
  } = useSavedSection();
  const [sectionEditing, setSectionEditing] = useState(false);
  const [planePreview, setPlanePreview] = useState<SectionSettings | null>(
    null,
  );
  const [annotationPreview, setAnnotationPreview] = useState<Annotation | null>(
    null,
  );
  const [sectionHistory, setSectionHistory] = useState<SectionSettings[]>([]);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileData, setProfileData] = useState<SectionProfileData | null>(
    null,
  );
  const [sectionCursor, setSectionCursor] = useState<ProfilePoint | null>(null);
  const section = useMemo(
    () =>
      TERRAIN_SECTION_ENABLED
        ? (planePreview ?? sectionDraft)
        : { ...sectionDraft, enabled: false },
    [sectionDraft, planePreview],
  );
  const [sectionStatus, setSectionStatus] = useState(INITIAL_SECTION_STATUS);
  const recordingFix = useMemo(
    () => recordingPosition(recorder.record),
    [recorder.record],
  );
  const cameraFix = guidance.active
    ? guidance.session?.quality
      ? null
      : (guidance.session?.last ?? null)
    : recorder.record.phase === 'recording'
      ? recordingFix
      : position.fix;
  const displayedFix = guidance.active
    ? (guidance.session?.last ?? null)
    : recorder.record.phase === 'recording'
      ? recordingFix
      : recorder.record.phase !== 'idle' &&
          recordingFix &&
          (!position.fix || recordingFix.timestamp >= position.fix.timestamp)
        ? recordingFix
        : position.fix;
  const follow = useFollowPosition({
    fix: cameraFix,
    phase: recorder.record.phase,
    blocked:
      tracks.editing ||
      !!annotations.picking ||
      navigation.picking !== null ||
      !!featureMove ||
      !!quickAdd ||
      sectionEditing,
    onFollow: (coordinates) =>
      map.current?.followPosition(
        coordinates,
        position.direction !== 'device',
      ) ?? false,
  });
  useEffect(() => {
    if (!guidance.active && guidanceOwnsLocation.current) {
      guidanceOwnsLocation.current = false;
      position.stopLocation();
      if (recorder.record.phase !== 'recording') follow.pause();
    }
    const s = guidance.session;
    if (s?.last && !s.quality && !guidanceFocused.current) {
      guidanceFocused.current = true;
      map.current?.focusPoint(
        s.last.coordinates,
        s.route.mode === 'auto' ? 16 : 17,
      );
      follow.resume();
    }
  }, [
    guidance.active,
    guidance.session?.last?.timestamp,
    guidance.session?.quality,
  ]);
  const startGuidance = () => {
    if (!guidance.start()) {
      setPanel('route');
      return;
    }
    guidanceOwnsLocation.current = !position.watching;
    setSectionEditing(false);
    setProfileOpen(false);
    guidanceFocused.current = false;
    tracks.finish();
    tracks.select(null);
    annotations.select(null);
    navigation.setPicking(null);
    setQuickAdd(null);
    setPanel(null);
    position.free();
    map.current?.previewRoute(null);
    position.locate();
  };
  const guidanceOverlay = useMemo(
    () =>
      guidance.rejoin
        ? {
            coordinates: guidance.rejoin.route.coordinates,
            target: guidance.rejoin.target.point,
          }
        : null,
    [guidance.rejoin],
  );
  const focusSection = (value: SectionSettings) => {
    if (!value.plane) return;
    map.current?.stop();
    map.current?.focusPoint(
      value.plane.center,
      Math.max(
        3,
        Math.min(
          20,
          Math.log2(
            40075016 / (Math.max(value.plane.width, value.plane.height) * 2),
          ),
        ),
      ),
    );
  };
  const toggleSection = () => {
    if (!sectionReady) return;
    setProfileOpen(false);
    setPlanePreview(null);
    setSectionHistory([]);
    if (sectionDraft.plane) {
      tracks.finish();
      tracks.select(null);
      navigation.setPicking(null);
      position.free();
      if (!sectionDraft.enabled) setSection({ ...sectionDraft, enabled: true });
      setSectionEditing(true);
      setProfileOpen(true);
      setPanel(null);
      annotations.select(null);
      focusSection(sectionDraft);
      return;
    }
    setSectionEditing(true);
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
    if (annotationPreview)
      return annotations.items.map((item) =>
        item.id === annotationPreview.id ? annotationPreview : item,
      );
    return target?.kind === 'annotation' && featureMove
      ? annotations.items.map((item) =>
          item.id === target.id
            ? { ...item, coordinates: featureMove.coordinate }
            : item,
        )
      : annotations.items;
  }, [annotations.items, featureMove, annotationPreview]);
  const selectedAnnotation = annotationOverlay.find(
    (item) => item.id === annotations.selected,
  );
  const selectedPose = selectedAnnotation
    ? annotationPose(selectedAnnotation)
    : null;
  const changeSection = (next: SectionSettings) => {
    setSectionHistory((history) => [...history.slice(-19), sectionDraft]);
    setSection(next);
  };
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
      via: navigation.via,
    }),
    [navigation.start, navigation.end, navigation.route, navigation.via],
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
      drawing: tracks.drawing,
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
      tracks.drawing,
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
      data-section={sectionEditing}
      data-route-notice={Boolean(
        navigation.picking !== null || navigation.route,
      )}
      data-drawing={tracks.drawing && panel === null}
      data-editing-track={tracks.editing}
      data-picking-route={navigation.picking !== null}
      data-route-rail={Boolean(navigation.route)}
      data-placing-annotation={Boolean(annotations.picking)}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        if (profileOpen) {
          event.preventDefault();
          setProfileOpen(false);
          return;
        }
        if (annotations.selected && !annotations.picking) {
          event.preventDefault();
          annotations.select(null);
          setPanel(null);
          return;
        }
        if (sectionEditing) {
          event.preventDefault();
          setSectionEditing(false);
          return;
        }
        if (annotations.picking) {
          event.preventDefault();
          annotations.setPicking(null);
          setPanel('annotations');
        } else if (navigation.picking !== null) {
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
        mapSource={mapSources.source}
        onSourceStatus={mapSources.setStatus}
        ref={map}
        section={section}
        sectionEditing={sectionEditing}
        onSectionStatus={setSectionStatus}
        onSectionChange={setSection}
        onSectionProfile={setProfileData}
        sectionCursor={sectionCursor}
        onSectionSelect={() => {
          tracks.finish();
          tracks.select(null);
          setSectionEditing(true);
          annotations.select(null);
          setPanel(null);
          setProfileOpen(true);
        }}
        settings={layers}
        onPoint={setPoint}
        onStatus={setMapStatus}
        onView={(value) => {
          setView(value);
          setQuickAdd(null);
        }}
        onAnchor={setAnchor}
        onCenter={setMapCenter}
        onSatellite={setSatellite}
        onGeology={setGeology}
        weather={weather.data}
        hourIndex={hourIndex}
        routeOverlay={routeOverlay}
        guidanceOverlay={guidanceOverlay}
        trackOverlay={trackOverlay}
        drawingActive={tracks.drawing && panel === null}
        onDrawingInput={(event) => drawing.current?.input(event)}
        photos={photoOverlay}
        onPhotoSelect={(ids) => {
          follow.pause();
          map.current?.stop();
          setPanel(null);
          setPhotoGroup(ids);
          photos.setSelected(ids[0]);
        }}
        position={displayedFix}
        onBrowse={follow.pause}
        onManualRotate={position.free}
        annotations={annotationOverlay}
        roadSnapping={tracks.roadSnapping}
        annotationSelected={annotations.selected}
        pickingActive={Boolean(
          annotations.picking || navigation.picking !== null,
        )}
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
          setProfileOpen(false);
          annotations.select(id);
          tracks.select(null);
          tracks.finish();
          navigation.setPicking(null);
          setPanel('annotations');
        }}
        onMapHold={(value) => {
          follow.pause();
          position.free();
          tracks.select(null);
          annotations.select(null);
          setPanel(null);
          setQuickAdd(value);
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
      {quickAdd && (
        <QuickAdd
          at={quickAdd}
          error={annotations.error}
          onClose={() => setQuickAdd(null)}
          onAdd={(kind) => {
            if (annotations.add(kind, quickAdd.coordinate)) setQuickAdd(null);
          }}
        />
      )}
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
        snapRoad={(point, previous, from) =>
          map.current?.snapRoad(point, previous, from) ?? {
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
        !selectedPose &&
        !tracks.drawing &&
        !annotations.picking &&
        navigation.picking === null &&
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
      {selectedPhoto && panel === null && (
        <PhotoViewer
          photo={selectedPhoto}
          group={photos.items.filter((p) => photoGroup.includes(p.id))}
          onSelect={photos.setSelected}
          onClose={() => photos.setSelected(null)}
          onRemove={photos.remove}
          onUpdate={photos.update}
          track={photoTracks.find((t) => t.id === selectedPhoto.trackId)}
        />
      )}
      <header className="topbar glass">
        <div className="brand">
          <span className="brand-icon">
            <CloudSun size={17} />
          </span>
          <h1>{PRODUCT_NAME}</h1>
        </div>
        <PlaceSearch
          center={mapCenter}
          zoom={view.zoom}
          onOpen={() => {
            setPanel(null);
            photos.setSelected(null);
            tracks.pause();
          }}
          onSelect={(place) => {
            setPanel(null);
            follow.pause();
            position.free();
            navigation.setPicking(null);
            annotations.setPicking(null);
            setQuickAdd(null);
            map.current?.focusPoint(place.coordinates, 14);
          }}
        />
        <span className="map-load-status" role="status">
          {mapStatus}
        </span>
        <button
          className="icon-button"
          aria-label="查看世界地图"
          title="查看世界地图"
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
      ) : navigation.picking !== null ? (
        <div className="route-map-notice glass" role="status">
          点击地图设置{navigation.pickingLabel}
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
        navigation.route &&
        !guidance.active && (
          <div className="route-map-notice route-start-notice glass">
            <button
              onClick={() => setPanel(panel === 'route' ? null : 'route')}
              aria-label="查看路线详情"
            >
              {TRAVEL_MODES.find((m) => m.id === navigation.mode)?.label} ·{' '}
              {formatDistance(navigation.route.distance)} · 预计{' '}
              {formatDuration(navigation.route.duration)}
            </button>
            <button onClick={startGuidance}>开始导航</button>
          </div>
        )
      )}
      {guidance.active &&
        !sectionEditing &&
        !annotations.picking &&
        navigation.picking === null &&
        !selectionName &&
        !quickAdd &&
        !tracks.editing && (
          <GuidanceCard
            guidance={guidance}
            following={follow.following}
            onStop={guidance.stop}
            onFollow={() => {
              follow.resume();
              if (!position.watching || position.locationError)
                position.locate();
            }}
            onShow={() => {
              if (guidance.rejoin) {
                follow.pause();
                map.current?.fitRoute(guidance.rejoin.route.coordinates);
              }
            }}
          />
        )}
      <div
        className="map-legends"
        hidden={panel !== 'layers' && !layers.elevationColors}
      >
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
      {navigation.route && !sectionEditing && !guidance.active && (
        <RouteWeatherRail
          route={navigation.route}
          journey={routeJourney}
          onPreview={(coordinates) => {
            if (coordinates) position.free();
            map.current?.previewRoute(coordinates);
          }}
          fix={displayedFix}
          following={follow.following}
          onSettings={() => {
            tracks.pause();
            setPanel('route');
          }}
        />
      )}
      {(position.directionError ||
        (!guidance.active &&
          (position.locationError || position.locating))) && (
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
      <LayerWindow
        open={panel === 'layers'}
        onOpen={(open) => {
          if (open) {
            photos.setSelected(null);
            tracks.pause();
            navigation.setPicking(null);
            annotations.setPicking(null);
          }
          setPanel(open ? 'layers' : null);
        }}
        settings={layers}
        onChange={update}
        customSource={mapSources.source?.name}
        onOpenSources={() => {
          setSourcesParent('layers');
          setSourcesNavigation(null);
          setPanel('sources');
        }}
        satelliteDate={satellite.date}
        satelliteStatus={satellite.status}
        mapStatus={mapStatus}
      />
      <MapActions
        sectionActive={sectionEditing}
        terrain={layers.terrain}
        bearing={view.bearing}
        onZoom={(amount) => map.current?.zoom(amount)}
        onNorth={() => {
          position.north();
          map.current?.north();
        }}
        onLocate={() => {
          if (follow.following) {
            follow.pause();
            map.current?.stop();
          } else {
            map.current?.previewRoute(null);
            follow.resume();
            if (recorder.record.phase !== 'recording') position.locate();
          }
        }}
        following={follow.following}
        followBlocked={follow.blocked}
        locating={
          follow.following &&
          (follow.waiting ||
            (recorder.record.phase !== 'recording' && position.locating))
        }
        watching={position.watching}
        onStopLocation={() => {
          guidance.stop();
          follow.pause();
          position.stopLocation();
        }}
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
        onSection={TERRAIN_SECTION_ENABLED ? toggleSection : undefined}
        sectionActive={sectionEditing}
        sectionReady={sectionReady}
        active={panel === 'layers' ? null : panel}
        title={panel === 'sources' ? sourcesNavigation?.title : undefined}
        back={
          panel === 'sources'
            ? (sourcesNavigation ?? {
                label: sourcesParent === 'layers' ? '返回图层' : '返回工具',
                onClick: () => setPanel(sourcesParent),
              })
            : undefined
        }
        onActive={(next) => {
          if (next === 'sources') {
            setSourcesParent('tools');
            setSourcesNavigation(null);
          }
          if (next) {
            photos.setSelected(null);
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
        {panel === 'sources' && (
          <MapSourcesPanel
            onNavigation={setSourcesNavigation}
            sources={mapSources}
            builtin={!layers.satellite ? 'terrain' : layers.imageryMode}
            onBuiltin={(id) => {
              mapSources.select('');
              update({
                satellite: id !== 'terrain',
                ...(id !== 'terrain' ? { imageryMode: id } : {}),
              });
            }}
            onFocus={(bounds) =>
              map.current?.fitRoute([
                [bounds[0], bounds[1]],
                [bounds[2], bounds[3]],
              ])
            }
          />
        )}
        {panel === 'outdoor' && (
          <OutdoorPanel
            recorder={recorder}
            onSavedTrack={tracks.select}
            photos={
              <PhotoPanel
                tracks={photoTracks}
                preferred={tracks.selectedId}
                photos={photos}
                onOpen={(id) => {
                  const p = photos.items.find((p) => p.id === id);
                  if (!p) return;
                  setPhotoGroup([id]);
                  photos.setSelected(id);
                  map.current?.focusPoint(p.coordinates, view.zoom);
                  setPanel(null);
                }}
              />
            }
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
        {panel === 'favorites' && (
          <CollectionsPanel
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
              setSectionEditing(false);
              setProfileOpen(false);
              setPlanePreview(null);
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
            onStartNavigation={startGuidance}
            navigating={guidance.active}
            guidanceError={guidance.error}
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
        {panel === 'weather' && (
          <p className="map-status" role="status">
            {mapStatus}
          </p>
        )}
      </ControlDock>
      {sectionSaveError && (
        <p className="section-save-error glass" role="alert">
          {sectionSaveError}
        </p>
      )}
      {section.enabled &&
        sectionEditing &&
        profileOpen &&
        panel === null &&
        !selectedAnnotation && (
          <SectionProfile
            data={profileData}
            settings={section}
            onCursor={setSectionCursor}
            onChange={changeSection}
            onRestore={(value) => {
              changeSection(value);
              focusSection(value);
            }}
            onClose={() => setProfileOpen(false)}
            onHide={() => {
              setSection((s) => ({ ...s, enabled: false }));
              setPlanePreview(null);
              setProfileOpen(false);
              setSectionEditing(false);
            }}
            onDelete={() => {
              setSection(EMPTY_SECTION);
              setPlanePreview(null);
              setProfileOpen(false);
              setSectionEditing(false);
              setSectionHistory([]);
              setProfileData(null);
            }}
            onRetry={() => map.current?.refreshSection()}
          />
        )}
      {!tracks.editing &&
        !annotations.picking &&
        navigation.picking === null &&
        !selectedPhoto &&
        !featureMove &&
        (panel === null || panel === 'annotations') &&
        (selectedAnnotation && selectedPose ? (
          <ObjectGizmo
            key={selectedAnnotation.id}
            name={selectedAnnotation.name || '标记'}
            kind={selectedAnnotation.kind}
            pose={selectedPose}
            watchProjection={watchObjectProjection}
            onLocate={() =>
              map.current?.focusPoint(selectedAnnotation.coordinates, view.zoom)
            }
            error={annotations.error}
            canUndo={annotations.moveUndoId === selectedAnnotation.id}
            onBegin={() => {
              map.current?.stop();
              position.free();
              follow.pause();
              setPanel(null);
            }}
            onPreview={(pose) =>
              setAnnotationPreview(
                pose ? applyAnnotationPose(selectedAnnotation, pose) : null,
              )
            }
            onCommit={(pose) => {
              annotations.transform(
                applyAnnotationPose(selectedAnnotation, pose),
              );
            }}
            onUndo={annotations.undoMove}
            onDetails={() =>
              setPanel(panel === 'annotations' ? null : 'annotations')
            }
            onClose={() => {
              annotations.select(null);
              setPanel(null);
            }}
          />
        ) : section.enabled &&
          sectionEditing &&
          section.plane &&
          panel === null ? (
          <ObjectGizmo
            key="section-plane"
            name="矩形剖面"
            kind="plane"
            pose={planePose(section)}
            watchProjection={watchObjectProjection}
            canUndo={sectionHistory.length > 0}
            onLocate={() => focusSection(section)}
            onBegin={() => {
              map.current?.stop();
              position.free();
              follow.pause();
              setProfileOpen(false);
            }}
            onPreview={(pose) =>
              setPlanePreview(pose ? applyPlanePose(sectionDraft, pose) : null)
            }
            onCommit={(pose) =>
              changeSection(applyPlanePose(sectionDraft, pose))
            }
            onUndo={() => {
              const prior = sectionHistory.at(-1);
              if (prior) {
                setSection(prior);
                setSectionHistory((h) => h.slice(0, -1));
              }
            }}
            onDetails={() => setProfileOpen((open) => !open)}
            onClose={() => {
              setSectionEditing(false);
              setPlanePreview(null);
              setProfileOpen(false);
            }}
          />
        ) : null)}
      <CameraGizmo
        view={view}
        onView={(pitch, bearing) => {
          follow.pause();
          position.free();
          if (pitch > 0 && !layers.terrain && !section.enabled)
            update({ terrain: true });
          map.current?.view(pitch, bearing, false);
        }}
      />
    </main>
  );
}
