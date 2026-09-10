'use client';
import { collectionPreviewPoints } from '@/modules/collections/previewBounds';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AboutPanel } from '@/modules/help/AboutPanel';
import { PRODUCT_NAME } from '@/config/product';
import { TextSuggestions } from '@/modules/input/SmartText';
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
import { RotateCcw } from 'lucide-react';
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
import { trackNavigation } from '@/modules/guidance/savedRoute';
import { createSession } from '@/modules/guidance/session';
import { NavigationStart } from '@/modules/guidance/NavigationStart';
import { RouteShare } from '@/modules/routeShare/RouteShare';
import { RouteQrReader } from '@/modules/routeShare/RouteQrReader';
import { annotationViewZoom } from '@/modules/annotations/view';
import {
  sharePlanned,
  shareTrack,
  type ShareRoute,
} from '@/modules/routeShare/data';
import {
  validFavorite,
  type RouteFavorite,
} from '@/modules/navigation/favorites';
import { GuidanceCard } from '@/modules/guidance/GuidanceCard';
import { useRouteFavorites } from '@/modules/navigation/useRouteFavorites';
import { MapBoxSelect } from '@/modules/collections/MapBoxSelect';
import { catalogEntries } from '@/modules/collections/catalog';
import { CollectionsPanel } from '@/modules/collections/CollectionsPanel';
import { CenterCursor } from '@/modules/map/CenterCursor';
import { FreeMapCredit } from '@/modules/mapSources/FreeMapLibrary';
import {
  RouteCard,
  RouteDetails,
  RouteEditToolbar,
  RouteMarkerTypes,
  RouteUnsavedDialog,
} from '@/modules/tracks/RouteViews';
import { useRouteEditor } from '@/modules/tracks/useRouteEditor';
import {
  appendEditBranch,
  selectEditNode,
  moveEditNode,
  insertEditNode,
  removeEditNode,
  removeEditNodes,
  toggleEditBranch,
  undoRouteEdit,
  styleRouteEdit,
} from '@/modules/tracks/routeEdit';
import { trackAlternatives } from '@/modules/tracks/alternatives';
import { equalCoordinate } from '@/modules/tracks/editing';
import { readElevation } from '@/modules/terrain/elevation';
import type { ManualTrack } from '@/modules/tracks/drawing';

import { TrackJourneyRail } from '@/modules/tracks/TrackJourneyRail';
import type { TrackLinePoint } from '@/modules/tracks/linePoint';
import { markerChainage } from '@/modules/tracks/linePoint';
import { useRouteJourney } from '@/modules/journey/useRouteJourney';
import {
  RouteWeatherRail,
  RouteWeatherSettings,
} from '@/modules/journey/RouteWeatherRail';
import { usePosition } from '@/modules/position/usePosition';
import { recordingPosition, positionZoom } from '@/modules/position/follow';
import { useFollowPosition } from '@/modules/position/useFollowPosition';
import {
  formatDistance,
  formatDuration,
  TRAVEL_MODES,
  type Coordinate,
} from '@/modules/navigation/types';
import { normalizeTrackStyle } from '@/modules/tracks/style';
import { useManualTracks } from '@/modules/tracks/useManualTracks';
import { keepsOriginalPoints } from '@/modules/tracks/provenance';
import { DRAFT_ID } from '@/modules/tracks/editing';
import type { FeatureMove } from '@/modules/map/FeatureDragBridge';
import { SectionProfile } from '@/modules/section/SectionProfile';
import { useSavedSection } from '@/modules/section/useSavedSection';
import { useSurveySection } from '@/modules/section/useSurveySection';
import { SurveySectionPanel } from '@/modules/section/SurveySectionPanel';
import { SurveyMapOverlay } from '@/modules/section/SurveyMapOverlay';
import { surveyCoordinate, surveyRange } from '@/modules/section/surveyLine';
import { SectionList } from '@/modules/section/SectionList';
import { EMPTY_SECTION } from '@/modules/section/savedSection';
import type {
  SectionProfileData,
  ProfilePoint,
} from '@/modules/section/contours';
import { ObjectGizmo } from '@/modules/objectTransform/ObjectGizmo';
import type { WatchProjection } from '@/modules/objectTransform/projection';
import {
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
import {
  AnnotationWorkspace,
  type MarkerTab,
} from '@/modules/annotations/AnnotationWorkspace';
import { useMarkerCamera } from '@/modules/photos/useMarkerCamera';
import { useMeasurement } from '@/modules/measurement/useMeasurement';
import { Measurement } from '@/modules/measurement/Measurement';
import { SavedMeasurements } from '@/modules/measurement/SavedMeasurements';
import { TrackNodeBoxSelect } from '@/modules/tracks/TrackNodeBoxSelect';
import { photosForMarker, mapPhotos } from '@/modules/photos/association';
import { editorPose } from '@/modules/annotations/editorSession';
import { QuickAdd } from '@/modules/annotations/QuickAdd';
import type { MapHold } from '@/modules/map/MapLongPress';
import {
  ANNOTATION_CHOICES,
  type Annotation,
} from '@/modules/annotations/data';
import { TrackPanel, TrackTools } from '@/modules/tracks/TrackPanel';
import {
  TrackDrawing,
  type TrackDrawingHandle,
} from '@/modules/tracks/TrackDrawing';
import { ElevationLegend } from '@/modules/controls/ElevationLegend';
import { INITIAL_GEOLOGY } from '@/modules/geology/data';
import { GeologyPanel } from '@/modules/geology/GeologyPanel';
import { useAreas } from '@/modules/areas/useAreas';
import { AreaTools } from '@/modules/areas/AreaTools';
import { outlineModel } from '@/modules/areas/extrude';
import { useWeather } from '@/modules/weather/useWeather';
import { TemperatureLegend } from '@/modules/weather/TemperatureLegend';
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
  const areaDrawing = useRef<TrackDrawingHandle>(null);
  const areas = useAreas();
  const [areaEditing, setAreaEditing] = useState(false);
  const [modelTerrainStatus, setModelTerrainStatus] = useState('');
  const [layers, setLayers] = useState<LayerSettings>({
    ...DEFAULT_LAYERS,
    satellite: true,
  });
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
  const markerCamera = useMarkerCamera(photos.save);
  const measurement = useMeasurement();
  const [routeNodeBox, setRouteNodeBox] = useState(false);
  const mapSources = useMapSources(false);
  const guidance = useGuidance(
    navigation.route,
    position.fix,
    position.locationError,
  );
  const guidanceOwnsLocation = useRef(false),
    guidanceFocused = useRef(false);
  const [savedNavigationError, setSavedNavigationError] = useState('');
  const [navigationTarget, setNavigationTarget] =
    useState<RouteFavorite | null>(null);
  const [shareTarget, setShareTarget] = useState<ShareRoute | null>(null);
  const [routeQr, setRouteQr] = useState<string | null>(null);
  const shareTrackById = (id: string) => {
    const track = tracks.saved.find((t) => t.id === id);
    if (track) {
      try {
        setShareTarget(shareTrack(track, annotations.items, tracks.saved));
      } catch (e) {
        setSavedNavigationError(
          e instanceof Error ? e.message : '无法分享轨迹',
        );
      }
    }
  };
  const [photoGroup, setPhotoGroup] = useState<string[]>([]);

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
  const editor = useRouteEditor();
  const [routeWindow, setRouteWindow] = useState<'card' | 'details' | 'marker'>(
    'card',
  );
  const [unsavedExit, setUnsavedExit] = useState(false);
  const [routeChild, setRouteChild] = useState(false);
  const [routeAltitude, setRouteAltitude] = useState<number | null>(null);
  const routeReturnPoint = useRef<TrackLinePoint | null>(null);
  const [featureMove, setFeatureMove] = useState<FeatureMove | null>(null);
  const [activeTrackNode, setActiveTrackNode] = useState<
    import('@/modules/tracks/editing').TrackNode | null
  >(null);
  const [quickAdd, setQuickAdd] = useState<MapHold | null>(null);
  const [connectingNode, setConnectingNode] = useState<
    import('@/modules/tracks/editing').TrackNode | null
  >(null);
  useEffect(() => {
    if (!activeTrackNode || panel !== null) setConnectingNode(null);
  }, [activeTrackNode, panel]);
  const [trackLinePoint, setTrackLinePoint] = useState<TrackLinePoint | null>(
    null,
  );
  const [collectionOutputKey, setCollectionOutputKey] = useState<string | null>(
    null,
  );
  const [boxSelecting, setBoxSelecting] = useState(false);
  const [collectionSelectedKeys, setCollectionSelectedKeys] = useState<
    string[]
  >([]);
  const [outdoorPhotos, setOutdoorPhotos] = useState(false);
  useEffect(() => {
    if (panel !== 'favorites') {
      setCollectionOutputKey(null);
      setCollectionSelectedKeys([]);
    }
    if (panel !== 'outdoor') setOutdoorPhotos(false);
  }, [panel]);
  const sections = useSavedSection();
  const survey = useSurveySection(sections, (id) => {
    annotations.select(id);
    setAnnotationTab('basic');
    setPanel('annotations');
  });
  const startArea = () => {
    tracks.pause();
    setActiveTrackNode(null);
    annotations.select(null);
    navigation.setPicking(null);
    setProfileOpen(false);
    setSectionEditing(false);
    setPanel(null);
    setQuickAdd(null);
    map.current?.stop();
    areas.start();
    setAreaEditing(true);
  };
  const areaOverlay = useMemo(
    () => ({
      items: areas.items,
      selected: areas.selected,
      draft: areas.draft,
      preview:
        featureMove?.target.kind === 'area'
          ? {
              id: featureMove.target.id,
              index: featureMove.target.index,
              coordinate: featureMove.coordinate,
            }
          : null,
    }),
    [areas.items, areas.selected, areas.draft, featureMove],
  );
  const [sectionListOpen, setSectionListOpen] = useState(false);
  const {
    settings: sectionDraft,
    set: setSection,
    error: sectionSaveError,
    ready: sectionReady,
  } = sections;
  const [sectionEditing, setSectionEditing] = useState(false);
  const [planePreview, setPlanePreview] = useState<SectionSettings | null>(
    null,
  );
  const [annotationPreview, setAnnotationPreview] = useState<Annotation | null>(
    null,
  );
  const [annotationTab, setAnnotationTab] = useState<MarkerTab>('basic');
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
      areas.drawing ||
      tracks.editing ||
      !!annotations.picking ||
      navigation.picking !== null ||
      !!featureMove ||
      !!quickAdd ||
      sectionEditing,
    onFollow: (coordinates, fix) =>
      map.current?.followPosition(
        coordinates,
        position.direction !== 'device',
        fix.source === 'network' ? positionZoom(fix) : undefined,
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
  const activateGuidance = (route = navigation.route) => {
    if (!guidance.start(route)) {
      setPanel('route');
      return;
    }
    guidanceOwnsLocation.current =
      guidanceOwnsLocation.current || !position.watching;
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
    if (position.mode === 'network') position.changeMode('auto');
    else position.locate();
  };
  const startGuidance = () => {
    const route = navigation.route;
    if (route && navigation.start && navigation.end)
      setNavigationTarget({
        id: 'current-route',
        name: `${navigation.start.name} → ${navigation.end.name}`,
        savedAt: Date.now(),
        start: navigation.start,
        end: navigation.end,
        route,
      });
  };
  const navigateFavorite = (favorite: RouteFavorite) =>
    setNavigationTarget(favorite);
  const beginFavorite = (favorite: RouteFavorite) => {
    setSavedNavigationError('');
    try {
      if (!validFavorite(favorite))
        throw new Error('收藏路线数据无效，无法导航。');
      createSession(favorite.route);
      if (!navigation.restore(favorite)) return;
      map.current?.fitRoute(favorite.route.coordinates);
      activateGuidance(favorite.route);
      setNavigationTarget(null);
    } catch (error) {
      setSavedNavigationError(
        error instanceof Error ? error.message : '无法开始导航。',
      );
    }
  };
  const navigateTrack = (id: string) => {
    setSavedNavigationError('');
    try {
      const track = tracks.saved.find((item) => item.id === id);
      if (!track) throw new Error('轨迹已不存在，请重新选择。');
      if (tracks.selectedId !== id) openRoute(id);
      navigateFavorite(
        trackNavigation(
          track,
          Date.now(),
          track.navigationMode ?? 'pedestrian',
          tracks.saved,
          activeAlternative,
        ),
      );
    } catch (error) {
      setSavedNavigationError(
        error instanceof Error ? error.message : '无法开始轨迹导航。',
      );
    }
  };
  const guidanceOverlay = useMemo(
    () =>
      guidance.rejoin
        ? {
            coordinates: guidance.rejoin.route.coordinates,
            segments: guidance.rejoin.route.segments,
            target: guidance.rejoin.target.point,
          }
        : null,
    [guidance.rejoin],
  );
  const focusSection = (value: SectionSettings) => {
    if (!value.plane) return;
    if (value.survey) {
      const range = surveyRange(value.survey);
      const points = [
        surveyCoordinate(value.survey, range.start),
        surveyCoordinate(value.survey, range.end),
      ];
      // Wait for the favorites split to close before fitting the full map.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          map.current?.fitCollection(points, {
            top: 140,
            right: 84,
            bottom: 120,
            left: 48,
          });
        }),
      );
      return;
    }
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
  const prepareSectionEditing = () => {
    tracks.finish();
    tracks.select(null);
    annotations.select(null);
    navigation.setPicking(null);
    position.free();
    setPanel(null);
    setPlanePreview(null);
    setSectionHistory([]);
    setSectionListOpen(false);
    setSectionCursor(null);
    setSectionEditing(true);
  };
  const openSection = (id: string) => {
    const item = sections.items.find((s) => s.id === id);
    if (!item) return;
    if (item.settings.survey) {
      measurement.close();
      tracks.finish();
      tracks.select(null);
      annotations.select(null);
      annotations.setPicking(null);
      navigation.setPicking(null);
      position.free();
      setPanel(null);
      setProfileOpen(false);
      setSectionEditing(false);
      setSectionListOpen(false);
      survey.open(item);
      focusSection(item.settings);
      return;
    }
    survey.close();
    sections.select(id);
    if (
      !item.settings.enabled &&
      !setSection({ ...item.settings, enabled: true })
    )
      return;
    prepareSectionEditing();
    setProfileOpen(true);
    focusSection(item.settings);
  };
  const toggleSection = () => {
    if (!sectionReady) return;
    survey.close();
    measurement.close();
    tracks.finish();
    tracks.select(null);
    annotations.select(null);
    navigation.setPicking(null);
    position.free();
    setPanel(null);
    setProfileOpen(false);
    setPlanePreview(null);
    setSectionEditing(false);
    setSectionListOpen((open) => !open);
  };
  const createSection = () => {
    measurement.close();
    tracks.finish();
    tracks.select(null);
    annotations.select(null);
    annotations.setPicking(null);
    navigation.setPicking(null);
    position.free();
    setPanel(null);
    setSectionListOpen(false);
    setSectionEditing(false);
    setProfileOpen(false);
    survey.start();
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
  const linkedPhotos = useMemo(
    () => mapPhotos(photos.items, annotationOverlay),
    [photos.items, annotationOverlay],
  );
  const photoOverlay =
    photos.visible && navigation.picking === null ? linkedPhotos : [];
  const photoMarkerIds = new Set(
    photoOverlay
      .filter((p) => p.kind === 'annotation')
      .map((p) => p.annotationId),
  );
  const displayedAnnotations = annotationOverlay.map((a) =>
    a.kind === 'pin' && photoMarkerIds.has(a.id) ? { ...a, visible: false } : a,
  );
  const selectedAnnotation = annotationOverlay.find(
    (item) => item.id === annotations.selected,
  );
  const selectedPose = selectedAnnotation
    ? editorPose(selectedAnnotation)
    : null;
  const changeSection = (next: SectionSettings) => {
    setSectionHistory((history) => [...history.slice(-19), sectionDraft]);
    setSection(next);
  };
  const selectedTrack = tracks.saved.find(
    (track) => track.id === tracks.selectedId,
  );
  useEffect(() => {
    if (panel !== 'favorites') return;
    const entries = catalogEntries(
      favorites.items,
      tracks.saved,
      annotations.items,
      sections.items,
      areas.items,
      measurement.saved.items,
    );
    const selected = entries.find(
      (e) =>
        e.key === `annotation:${annotations.selected}` ||
        e.key === `track:${tracks.selectedId}`,
    );
    const target = selected
      ? collectionPreviewPoints(selected)
      : entries.flatMap(collectionPreviewPoints);
    const frame = requestAnimationFrame(() => {
      position.free();
      follow.pause();
      if (target.length) map.current?.fitCollection(target);
    });
    return () => cancelAnimationFrame(frame);
  }, [panel]);
  const selectedDraft =
    tracks.selectedId === DRAFT_ID && tracks.draft.length > 0;
  const railTrack =
    selectedTrack ??
    (selectedDraft
      ? {
          id: DRAFT_ID,
          name: tracks.draftName || '路线草稿',
          createdAt: 0,
          segments: tracks.draft,
          edgeColors: tracks.edgeColors,
          style: tracks.style,
          nodes: tracks.vertices,
        }
      : null);
  const [activeAlternative, setActiveAlternative] = useState('main');
  const selectedAlternatives = useMemo(
    () =>
      selectedTrack
        ? trackAlternatives(selectedTrack.segments, selectedTrack.style?.color)
        : [],
    [selectedTrack?.segments, selectedTrack?.style?.color],
  );
  useEffect(
    () => setActiveAlternative('main'),
    [tracks.selectedId, selectedTrack?.segments, tracks.draft],
  );
  const linePoint =
    trackLinePoint?.trackId === tracks.selectedId &&
    !tracks.drawing &&
    !areas.drawing &&
    !annotations.picking &&
    !sectionEditing
      ? trackLinePoint
      : null;
  useEffect(() => {
    setTrackLinePoint((point) =>
      point?.trackId === tracks.selectedId ? point : null,
    );
  }, [tracks.selectedId]);
  const selectLinePoint = (point: TrackLinePoint) => {
    if (editor.session) {
      if (editor.session.branch !== null)
        editor.change((value) => appendEditBranch(value, point.coordinate));
      else if (point.trackId === editor.session.track.id) {
        setTrackLinePoint(point);
        editor.change((value) => ({ ...value, selected: null }));
      }
      return;
    }
    setRouteWindow('card');
    setRouteChild(false);
    position.free();
    follow.pause();
    tracks.select(point.trackId);
    annotations.select(null);
    areas.select(null);
    setActiveTrackNode(null);
    setQuickAdd(null);
    setProfileOpen(false);
    setPanel(null);
    setTrackLinePoint(point);
  };
  const openRoute = (id: string) => {
    setSavedNavigationError('');
    const track = tracks.saved.find((t) => t.id === id);
    if (!track) return;
    if (track.hidden) tracks.showTrack(id);
    tracks.finish();
    tracks.setVisible(true);
    selectLinePoint({
      trackId: id,
      coordinate: track.segments[0][0],
      distance: 0,
    });
  };
  const closeEditor = () => {
    setRouteNodeBox(false);
    editor.close();
    setUnsavedExit(false);
    setRouteWindow('card');
    setActiveTrackNode(null);
    setTrackLinePoint(routeReturnPoint.current);
  };
  const saveEditor = () => {
    if (!editor.session) return;
    const result = tracks.commitEdit(editor.session);
    if (!result.track) {
      editor.setError(result.error);
      setUnsavedExit(false);
      return;
    }
    if (result.removed) {
      closeEditor();
      setTrackLinePoint(null);
      return;
    }
    const previous =
      routeReturnPoint.current?.coordinate ?? result.track.segments[0][0];
    closeEditor();
    setTrackLinePoint({
      trackId: result.track.id,
      coordinate: previous,
      distance: 0,
    });
  };
  const backEditor = () =>
    editor.session?.history.length ? setUnsavedExit(true) : closeEditor();
  const beginRouteEdit = (track: ManualTrack) => {
    setSavedNavigationError('');
    routeReturnPoint.current = trackLinePoint;
    tracks.select(track.id);
    tracks.finish();
    setPanel(null);
    setRouteWindow('card');
    setRouteChild(false);
    annotations.select(null);
    editor.start(track);
  };
  const addEditPoint = () => {
    const current = editor.session;
    if (!current) return;
    if (current.selected) {
      const segment = current.track.segments.find((l) =>
        l.some((p) => equalCoordinate(p, current.selected!)),
      );
      const index =
        segment?.findIndex((p) => equalCoordinate(p, current.selected!)) ?? -1;
      const other = segment?.[index + 1] ?? segment?.[index - 1];
      if (other)
        editor.change((v) =>
          insertEditNode(v, [
            (current.selected![0] + other[0]) / 2,
            (current.selected![1] + other[1]) / 2,
          ]),
        );
    } else if (trackLinePoint?.trackId === current.track.id)
      editor.change((v) =>
        insertEditNode(
          v,
          trackLinePoint.coordinate,
          trackLinePoint.sourceDistance ?? trackLinePoint.distance,
        ),
      );
    else editor.setError('请先点选需要添加节点的线段。');
  };
  useEffect(() => {
    setRouteAltitude(null);
    if (!linePoint) return;
    const request = new AbortController(),
      timer = setTimeout(() => request.abort(), 15000);
    void readElevation(
      linePoint.coordinate[0],
      linePoint.coordinate[1],
      request.signal,
    )
      .then((value) => {
        if (!request.signal.aborted) setRouteAltitude(value);
      })
      .catch(() => {})
      .finally(() => clearTimeout(timer));
    return () => {
      clearTimeout(timer);
      request.abort();
    };
  }, [linePoint?.coordinate[0], linePoint?.coordinate[1]]);
  const routeVisible =
    !!railTrack &&
    !tracks.drawing &&
    !guidance.active &&
    !areas.drawing &&
    !sectionEditing;
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
      route: guidance.session?.route ?? navigation.route,
      via: navigation.via,
    }),
    [
      navigation.start,
      navigation.end,
      navigation.route,
      navigation.via,
      guidance.session?.route,
    ],
  );
  const trackOverlay = useMemo(
    () => ({
      saved: recordedSegments.length
        ? [
            ...tracks.overlaySaved.filter(
              (t) =>
                !editor.session?.sources.some((source) => source.id === t.id),
            ),
            ...(editor.session && editor.session.track.id !== DRAFT_ID
              ? [editor.session.track]
              : []),
            {
              id: 'live-recording',
              name: '实走记录',
              createdAt: recorder.record.startedAt,
              style: recorder.record.style,
              segments: recordedSegments,
            },
          ]
        : editor.session
          ? [
              ...tracks.overlaySaved.filter(
                (t) =>
                  !editor.session!.sources.some((source) => source.id === t.id),
              ),
              ...(editor.session.track.id !== DRAFT_ID
                ? [editor.session.track]
                : []),
            ]
          : tracks.overlaySaved,
      draft: editor.session
        ? editor.session.original.id === DRAFT_ID
          ? editor.session.track.segments
          : []
        : tracks.draft,
      visible: tracks.visible || recorder.record.phase !== 'idle',
      draftEdgeColors: editor.session?.track.edgeColors ?? tracks.edgeColors,
      style: editor.session?.track.style ?? tracks.style,
      nodes: editor.session?.track.nodes ?? tracks.vertices,
      drawing: tracks.drawing,
      selectedId: tracks.selectedId,
      activeNode: editor.session?.selected
        ? {
            trackId: editor.session.track.id,
            coordinate: editor.session.selected,
          }
        : null,
      editing: !!editor.session || tracks.drawing,
      movableTrackId:
        editor.session && editor.session.branch === null
          ? editor.session.track.id
          : null,
      connecting: editor.session?.branch != null,
      snapTargets:
        !!editor.session && editor.session.branch === null && tracks.snapping,
      alternativeId: activeAlternative,
      linePoint: panel === null ? linePoint : null,
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
      editor.session,
      activeTrackNode,
      connectingNode,
      activeAlternative,
      linePoint,
      panel,
      recorder.record.startedAt,
      recorder.record.style,
      recorder.record.phase,
      tracks.overlaySaved,
      tracks.draft,
      tracks.edgeColors,
      tracks.visible,
      tracks.style,
      tracks.vertices,
      tracks.drawing,
      tracks.selectedId,
      tracks.snapping,
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
  const branchEditing = !!editor.session && editor.session.branch !== null;
  const branchTip = branchEditing
    ? (editor.session!.track.segments[editor.session!.branch!].at(-1) ?? null)
    : null;
  const branchCandidates = branchEditing
    ? [
        ...editor.session!.track.segments.flat(),
        ...tracks.saved
          .filter(
            (t) =>
              !t.hidden && !editor.session!.sources.some((s) => s.id === t.id),
          )
          .flatMap((t) => t.segments.flat()),
      ]
    : [];
  const drawBranchVertex = (point: Coordinate, section?: Coordinate[]) => {
    editor.change((value) =>
      appendEditBranch(
        value,
        point,
        tracks.saved.find(
          (t) =>
            !t.hidden &&
            t.id !== value.track.id &&
            !value.sources.some((s) => s.id === t.id) &&
            t.segments.some((line) =>
              line.some((p) => equalCoordinate(p, point)),
            ),
        ),
        section,
      ),
    );
  };
  const suggestionValues = useMemo(
    () => ({
      name: [
        ...annotations.items.map((a) => a.name),
        ...tracks.saved.map((t) => t.name),
        ...photos.items.map((p) => p.title || p.name),
      ],
      note: [
        ...annotations.items.flatMap((a) => [
          a.note || '',
          ...(a.attributes ?? []).map((f) => f.value),
        ]),
        ...photos.items.map((p) => p.note || ''),
      ],
      attribute: annotations.items.flatMap((a) =>
        (a.attributes ?? []).map((f) => f.name),
      ),
    }),
    [annotations.items, tracks.saved, photos.items],
  );
  return (
    <TextSuggestions.Provider value={suggestionValues}>
      <main
        className="observatory"
        data-measuring={measurement.active}
        data-panel={panel ?? 'map'}
        data-section={sectionEditing}
        data-survey={survey.active && panel === null}
        data-survey-expanded={
          !!survey.markerTarget ||
          (survey.pointMenu &&
            !!survey.object &&
            !['point', 'marker'].includes(survey.picking ?? ''))
        }
        data-route-notice={Boolean(
          navigation.picking !== null || navigation.route,
        )}
        data-drawing={tracks.drawing && panel === null}
        data-route-window={
          routeVisible || !!editor.session || !!navigationTarget
        }
        data-route-edit={!!editor.session}
        data-editing-track={tracks.editing || !!editor.session}
        data-picking-route={navigation.picking !== null}
        data-route-rail={Boolean(navigation.route)}
        data-placing-annotation={Boolean(annotations.picking)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || event.defaultPrevented) return;
          if (navigation.picking !== null) {
            event.preventDefault();
            navigation.setPicking(null);
            setPanel('route');
            return;
          }
          if (editor.session) {
            event.preventDefault();
            backEditor();
            return;
          }
          if (routeVisible && panel === null) {
            event.preventDefault();
            if (routeWindow !== 'card') setRouteWindow('card');
            else tracks.select(null);
            return;
          }
          if (
            routeQr !== null ||
            shareTarget ||
            navigationTarget ||
            sectionListOpen
          ) {
            event.preventDefault();
            if (routeQr !== null) setRouteQr(null);
            else if (shareTarget) setShareTarget(null);
            else if (navigationTarget) setNavigationTarget(null);
            else setSectionListOpen(false);
            return;
          }
          if (profileOpen) {
            event.preventDefault();
            setProfileOpen(false);
            return;
          }
          if (trackLinePoint) {
            event.preventDefault();
            setTrackLinePoint(null);
            return;
          }
          if (activeTrackNode) {
            event.preventDefault();
            setActiveTrackNode(null);
            return;
          }
          if (areas.drawing || areas.selected) {
            event.preventDefault();
            if (areas.drawing) areas.pause();
            else if (areaEditing) setAreaEditing(false);
            else areas.select(null);
            return;
          }
          if (annotations.selected && !annotations.picking) {
            if (panel === 'annotations' || annotations.selectionRequest) return;
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
          section={section.survey ? { ...section, enabled: false } : section}
          sectionItems={sections.items.filter((s) => !s.settings.survey)}
          selectedSectionId={sections.selectedId}
          sectionEditing={sectionEditing}
          onSectionStatus={setSectionStatus}
          onSectionChange={setSection}
          onSectionProfile={setProfileData}
          sectionCursor={sectionCursor}
          onSectionSelect={(id) => {
            const selected = id ?? sections.selectedId;
            if (selected) openSection(selected);
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
          areaOverlay={areaOverlay}
          onModelTerrainStatus={setModelTerrainStatus}
          onAreaSelect={(id) => {
            if (editor.session) return;
            areas.select(id);
            annotations.select(null);
            tracks.select(null);
            tracks.pause();
            setProfileOpen(false);
            setAreaEditing(true);
            setPanel(null);
          }}
          drawingActive={
            (branchEditing || tracks.drawing || areas.drawing) && panel === null
          }
          onDrawingInput={(event) =>
            areas.drawing
              ? areaDrawing.current?.input(event)
              : drawing.current?.input(event)
          }
          collectionPreviewActive={panel === 'favorites'}
          photos={photoOverlay}
          onPhotoSelect={(ids) => {
            if (survey.active && survey.picking) {
              const photo = linkedPhotos.find((p) => p.id === ids[0]);
              if (photo) survey.pick(photo.coordinates);
              return;
            }
            if (measurement.active) {
              const photo = linkedPhotos.find((p) => p.id === ids[0]);
              if (photo && measurement.adding)
                measurement.add(
                  photo.coordinates,
                  map.current?.groundElevation(photo.coordinates) ?? null,
                );
              return;
            }
            if (editor.session) return;
            const photo = linkedPhotos.find((p) => p.id === ids[0]);
            if (photo?.kind === 'annotation' && photo.annotationId) {
              if (!annotations.select(photo.annotationId)) return;
              setPanel('annotations');
              follow.pause();
              return;
            }
            follow.pause();
            map.current?.stop();
            setPanel(null);
            setPhotoGroup(ids);
            photos.setSelected(ids[0]);
          }}
          position={displayedFix}
          onBrowse={follow.pause}
          onManualRotate={position.free}
          annotations={displayedAnnotations}
          roadSnapping={tracks.roadSnapping}
          nodeSnapping={tracks.snapping}
          riverSnapping={tracks.riverSnapping}
          annotationSelected={annotations.selected}
          annotationEditingId={annotations.edit?.draft.id}
          measurementPicking={measurement.active || !!survey.picking}
          annotationPicking={
            navigation.picking !== null ||
            measurement.active ||
            !!survey.picking
          }
          pickingActive={Boolean(
            annotations.picking ||
            navigation.picking !== null ||
            measurement.active ||
            survey.picking,
          )}
          onTrackSelect={(id) => {
            if (!editor.session) openRoute(id);
          }}
          onTrackLineSelect={selectLinePoint}
          onTrackNodeSelect={(node) => {
            if (node.trackId === 'live-recording') return;
            if (editor.session) {
              if (editor.session.branch !== null)
                editor.change((value) =>
                  appendEditBranch(
                    value,
                    node.coordinate,
                    node.trackId === value.track.id
                      ? undefined
                      : tracks.saved.find((t) => t.id === node.trackId),
                  ),
                );
              else if (node.trackId === editor.session.track.id)
                editor.change((value) =>
                  selectEditNode(value, node.coordinate),
                );
              return;
            }
            selectLinePoint({
              trackId: node.trackId,
              coordinate: node.coordinate,
              distance: 0,
            });
          }}
          onDragBegin={(target) => {
            position.free();
            tracks.finish();
            if (target.kind === 'track') {
              tracks.select(target.node.trackId);
              annotations.select(null);
            } else if (target.kind === 'area') {
              areas.select(target.id);
              setAreaEditing(false);
              annotations.select(null);
              tracks.select(null);
            } else {
              if (!annotations.select(target.id)) return;
              annotations.beginEdit(target.id);
              setAnnotationTab('position');
              tracks.select(null);
            }
            setPanel(target.kind === 'annotation' ? 'annotations' : null);
          }}
          onDragPreview={setFeatureMove}
          onDragCommit={({ target, coordinate, snappedNode }) => {
            if (target.kind === 'track' && editor.session) {
              editor.change((value) =>
                moveEditNode(
                  value,
                  target.node.coordinate,
                  coordinate,
                  snappedNode
                    ? tracks.saved.find((t) => t.id === snappedNode.trackId)
                    : undefined,
                ),
              );
              setFeatureMove(null);
            } else if (target.kind === 'track') {
              if (tracks.moveNode(target.node, coordinate))
                setActiveTrackNode({ ...target.node, coordinate });
            } else if (target.kind === 'area')
              areas.move(target.id, target.index, coordinate);
            else {
              annotations.move(target.id, coordinate);
              setPanel('annotations');
            }
          }}
          onAnnotationSelect={(id) => {
            if (survey.active && survey.picking) {
              const item = annotations.items.find(
                (a) => a.id === id && a.visible,
              );
              if (item) survey.pick(item.coordinates);
              return;
            }
            if (measurement.active) {
              const item = annotations.items.find(
                (a) => a.id === id && a.visible,
              );
              if (item && measurement.adding)
                measurement.add(
                  item.coordinates,
                  map.current?.groundElevation(item.coordinates) ?? null,
                );
              return;
            }
            if (editor.session) return;
            if (navigation.picking !== null) {
              const item = annotations.items.find(
                (a) => a.id === id && a.visible,
              );
              if (item) {
                navigation.place(navigation.picking, {
                  name: item.name || '未命名标记',
                  coordinates: [...item.coordinates],
                });
                setPanel('route');
              }
              return;
            }
            setTrackLinePoint(null);
            setActiveTrackNode(null);
            areas.select(null);
            setProfileOpen(false);
            if (!annotations.select(id)) return;
            tracks.select(
              annotations.items.find((a) => a.id === id)?.trackAnchor
                ?.trackId ?? null,
            );
            tracks.finish();
            navigation.setPicking(null);
            setPanel('annotations');
          }}
          onMapHold={(value) => {
            if (
              editor.session ||
              measurement.active ||
              panel !== null ||
              navigation.picking !== null
            )
              return;
            follow.pause();
            position.free();
            tracks.select(null);
            annotations.select(null);
            setPanel(null);
            setQuickAdd(value);
          }}
          onMapPick={(coordinates) => {
            if (survey.pick(coordinates)) return;
            if (measurement.active) {
              if (measurement.adding)
                measurement.add(
                  coordinates,
                  map.current?.groundElevation(coordinates) ?? null,
                );
              return;
            }
            if (editor.session) {
              if (editor.session.branch !== null)
                editor.change((value) => appendEditBranch(value, coordinates));
              return;
            }
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
              // A map gesture is part of editing, not a request to leave the marker.
              if (annotations.edit) return;
              setActiveTrackNode(null);
              tracks.select(null);
              if (annotations.select(null) && panel === 'annotations')
                setPanel(null);
            }
          }}
        />
        {routeVisible &&
          railTrack &&
          panel === null &&
          !editor.session &&
          !routeChild &&
          !selectedPhoto &&
          !navigationTarget &&
          !shareTarget && (
            <>
              {routeWindow === 'card' && (
                <RouteCard
                  track={railTrack}
                  point={linePoint}
                  altitude={routeAltitude}
                  alternative={activeAlternative}
                  error={savedNavigationError || tracks.error}
                  onBack={() => {
                    tracks.select(null);
                    setTrackLinePoint(null);
                  }}
                  onNavigate={() => {
                    if (railTrack.id !== DRAFT_ID) {
                      navigateTrack(railTrack.id);
                      return;
                    }
                    const id = tracks.saveForMarker();
                    if (!id) return;
                    try {
                      setNavigationTarget(
                        trackNavigation(
                          { ...railTrack, id },
                          Date.now(),
                          'pedestrian',
                          tracks.saved,
                          activeAlternative,
                        ),
                      );
                    } catch (e) {
                      setSavedNavigationError(
                        e instanceof Error ? e.message : '无法导航',
                      );
                    }
                  }}
                  onMarker={() => setRouteWindow('marker')}
                  onEdit={() => beginRouteEdit(railTrack)}
                  onDetails={() => setRouteWindow('details')}
                />
              )}
              {routeWindow === 'details' && (
                <RouteDetails
                  track={railTrack}
                  alternative={activeAlternative}
                  onCondition={(color, value) =>
                    tracks.setColorCondition(railTrack.id, color, value)
                  }
                  markers={annotations.items}
                  photos={photos.items}
                  onBack={() => setRouteWindow('card')}
                  onShare={() => shareTrackById(railTrack.id)}
                  deleteError={tracks.error}
                  onDelete={() => {
                    if (!tracks.remove(railTrack.id)) return false;
                    setTrackLinePoint(null);
                    setRouteWindow('card');
                    return true;
                  }}
                  onMarker={(id) => {
                    annotations.select(id);
                    setRouteChild(true);
                    setPanel('annotations');
                  }}
                  onPhoto={(id) => {
                    photos.setSelected(id);
                    setPhotoGroup([id]);
                  }}
                />
              )}
              {routeWindow === 'marker' && (
                <RouteMarkerTypes
                  error={annotations.error || tracks.error}
                  onBack={() => setRouteWindow('card')}
                  onAdd={(kind) => {
                    if (!linePoint) return;
                    const id =
                      railTrack.id === DRAFT_ID
                        ? tracks.saveForMarker()
                        : railTrack.id;
                    if (!id) return;
                    if (
                      annotations.add(kind, linePoint.coordinate, {
                        trackId: id,
                        distance: markerChainage(
                          railTrack.segments,
                          linePoint.coordinate,
                        ).distance,
                      })
                    ) {
                      setRouteWindow('card');
                      setRouteChild(true);
                      setPanel('annotations');
                    }
                  }}
                />
              )}
            </>
          )}
        {editor.session && (
          <RouteEditToolbar
            session={editor.session}
            snapName={
              featureMove?.snappedNode
                ? tracks.saved.find(
                    (t) => t.id === featureMove.snappedNode!.trackId,
                  )?.name
                : undefined
            }
            snapping={tracks.snapping}
            roadSnapping={tracks.roadSnapping || tracks.riverSnapping}
            onSnapping={() => tracks.setSnapping(!tracks.snapping)}
            onRoadSnapping={() => {
              if (tracks.riverSnapping) tracks.setRiverSnapping(false);
              else tracks.setRoadSnapping(!tracks.roadSnapping);
            }}
            error={editor.error}
            onBack={backEditor}
            onSave={saveEditor}
            onAdd={addEditPoint}
            onRemove={() => editor.change(removeEditNode)}
            onBoxSelect={() => {
              map.current?.stop();
              setRouteNodeBox(true);
            }}
            onBranch={() => editor.change(toggleEditBranch)}
            onUndo={() => editor.change(undoRouteEdit)}
            onStyle={(style) =>
              editor.change((value) => styleRouteEdit(value, style))
            }
          />
        )}
        {editor.session && routeNodeBox && (
          <TrackNodeBoxSelect
            points={editor.session.track.segments.flat()}
            project={(point) => map.current?.toScreen(point) ?? null}
            onCancel={() => setRouteNodeBox(false)}
            onDelete={(points) => {
              if (editor.change((session) => removeEditNodes(session, points)))
                setRouteNodeBox(false);
            }}
          />
        )}
        {editor.session && unsavedExit && (
          <RouteUnsavedDialog
            onSave={saveEditor}
            onDiscard={closeEditor}
            onContinue={() => setUnsavedExit(false)}
          />
        )}
        <FreeMapCredit id={mapSources.selected} />
        {quickAdd && (
          <QuickAdd
            onArea={startArea}
            at={quickAdd}
            error={annotations.error}
            onClose={() => setQuickAdd(null)}
            onAdd={(kind) => {
              if (annotations.add(kind, quickAdd.coordinate)) {
                areas.select(null);
                setQuickAdd(null);
                setProfileOpen(false);
                setPanel('annotations');
              }
            }}
          />
        )}
        {panel === null &&
          !tracks.drawing &&
          !survey.active &&
          !areas.drawing &&
          !annotations.picking &&
          !navigation.picking &&
          !sectionEditing &&
          !selectedAnnotation &&
          !selectedPhoto &&
          !featureMove &&
          !measurement.active &&
          !guidance.active &&
          !boxSelecting && (
            <CenterCursor
              map={() => map.current}
              onAdd={(coordinates) => {
                map.current?.stop();
                position.free();
                follow.pause();
                const screen = map.current?.toScreen(coordinates);
                if (!screen) return;
                tracks.select(null);
                areas.select(null);
                setProfileOpen(false);
                setQuickAdd({ coordinate: coordinates, point: screen });
              }}
            />
          )}
        <TrackDrawing
          ref={drawing}
          enabled={
            (branchEditing || tracks.drawing) &&
            !areas.drawing &&
            panel === null
          }
          length={tracks.rodLength}
          style={
            branchEditing
              ? normalizeTrackStyle(editor.session!.track.style)
              : tracks.style
          }
          mode={branchEditing ? 'points' : tracks.mode}
          anchor={branchEditing ? branchTip : tracks.anchor}
          candidates={branchEditing ? branchCandidates : tracks.candidates}
          snapping={tracks.snapping}
          roadSnapping={tracks.roadSnapping || tracks.riverSnapping}
          riverSnapping={tracks.riverSnapping}
          snapRoad={(point, previous, from) =>
            (tracks.riverSnapping
              ? map.current?.snapRiver(point, previous, from)
              : map.current?.snapRoad(point, previous, from)) ?? {
              status: 'loading',
              match: null,
            }
          }
          lastVertex={
            branchEditing ? branchTip : (tracks.draft.at(-1)?.at(-1) ?? null)
          }
          toScreen={(point) => map.current?.toScreen(point) ?? null}
          magnify={(canvas, point) =>
            map.current?.magnify(canvas, point) ?? (() => {})
          }
          onAnchor={branchEditing ? () => {} : tracks.setAnchor}
          onVertex={branchEditing ? drawBranchVertex : tracks.addVertex}
          toCoordinate={(point) => map.current?.toCoordinate(point) ?? null}
          onStroke={tracks.addStroke}
        />
        <TrackDrawing
          ref={areaDrawing}
          enabled={areas.drawing && panel === null}
          length={tracks.rodLength}
          style={{ color: '#66cfa2', width: 3 }}
          mode="points"
          anchor={null}
          candidates={areas.draft}
          snapping={true}
          roadSnapping={areas.roadSnapping}
          snapRoad={(point, previous, from) =>
            map.current?.snapRoad(point, previous, from) ?? {
              status: 'loading',
              match: null,
            }
          }
          lastVertex={areas.draft.at(-1) ?? null}
          toScreen={(p) => map.current?.toScreen(p) ?? null}
          toCoordinate={(p) => map.current?.toCoordinate(p) ?? null}
          magnify={(canvas, point) =>
            map.current?.magnify(canvas, point) ?? (() => {})
          }
          onAnchor={() => {}}
          onVertex={areas.add}
          onStroke={() => {}}
        />
        {(areas.drawing || (areas.selected && areaEditing)) &&
          panel === null && (
            <AreaTools
              key={areas.selected ?? 'draft-area'}
              state={areas}
              onHide={() => setAreaEditing(false)}
              onExtrude={(height) => {
                const area = areas.items.find((a) => a.id === areas.selected);
                if (!area) return '请先闭合轮廓';
                try {
                  if (!annotations.addOutline(outlineModel(area, height)))
                    return '轮廓模型保存失败，请检查标记数量和存储空间';
                  areas.update(area.id, { visible: false });
                  areas.select(null);
                  setPanel('annotations');
                  return null;
                } catch (e) {
                  return e instanceof Error ? e.message : '拉伸失败';
                }
              }}
              onFinish={() => {
                const first = areas.draft[0],
                  last = areas.draft.at(-1),
                  pixel = first && map.current?.toScreen(first);
                const result =
                  areas.roadSnapping && pixel
                    ? map.current?.snapRoad(pixel, null, last)
                    : null;
                if (result?.section?.length)
                  areas.add(first, [...result.section.slice(0, -1), first]);
                else areas.finish();
              }}
            />
          )}
        {areas.selected && !areaEditing && !areas.drawing && panel === null && (
          <div className="area-selection glass">
            <button onClick={() => setAreaEditing(true)}>区域编辑</button>
            <button disabled={!areas.canUndo} onClick={areas.undoMove}>
              撤销调点
            </button>
            <button onClick={() => areas.select(null)}>关闭</button>
            {areas.error && <p role="status">{areas.error}</p>}
          </div>
        )}
        {tracks.editing &&
          tracks.drawing &&
          !areas.drawing &&
          panel === null && (
            <TrackTools
              tracks={tracks}
              onLocate={(point) => map.current?.focusPoint(point)}
              onFinish={() => {
                if (tracks.complete()) setRouteWindow('card');
              }}
            />
          )}
        {selectedAnnotation &&
          selectionName &&
          (!activeTrackNode || selectedAnnotation) &&
          !linePoint &&
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
                      : '点选节点出圈，再拖动调整'}
                </span>
                {selectedAnnotation && featureMove && (
                  <span>
                    经度 {selectedAnnotation.coordinates[0].toFixed(6)} · 纬度{' '}
                    {selectedAnnotation.coordinates[1].toFixed(6)}
                    {featureMove?.target.kind === 'annotation'
                      ? '（预览）'
                      : ''}
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
        {markerCamera.input}
        <SurveyMapOverlay
          items={sections.items}
          state={survey}
          watch={watchObjectProjection}
          scale={layers.terrain ? layers.exaggeration : 0}
          projectGround={(p) => map.current?.toScreen(p) ?? null}
          toCoordinate={(p) => map.current?.toCoordinate(p) ?? null}
          onOpen={(object) => openSection(object.id)}
        />
        {survey.active && panel === null && (
          <SurveySectionPanel
            key={survey.object?.id ?? 'new-survey'}
            state={survey}
            markers={annotations.items.filter(
              (a) => a.sectionAnchor?.sectionId === survey.object?.id,
            )}
            onMarker={(id) => {
              annotations.select(id);
              setAnnotationTab('basic');
              setPanel('annotations');
            }}
            onLocate={(p) => map.current?.focusPoint(p)}
            onFavorites={() => {
              survey.close();
              setPanel('favorites');
            }}
          />
        )}
        {!!measurement.saved.items.length && (
          <SavedMeasurements
            items={measurement.saved.items.filter(
              (item) =>
                !measurement.active || item.id !== measurement.record?.id,
            )}
            onPick={
              measurement.active
                ? (p) => {
                    if (measurement.adding)
                      measurement.add(
                        p.coordinates,
                        map.current?.groundElevation(p.coordinates) ?? null,
                      );
                  }
                : undefined
            }
            watchProjection={watchObjectProjection}
            elevationScale={layers.terrain ? layers.exaggeration : 0}
            projectGround={(p) => map.current?.toScreen(p.coordinates) ?? null}
            onOpen={(item) => {
              if (editor.session || !annotations.select(null)) return;
              tracks.pause();
              navigation.setPicking(null);
              annotations.setPicking(null);
              photos.setSelected(null);
              setPanel(null);
              setQuickAdd(null);
              map.current?.stop();
              position.free();
              follow.pause();
              measurement.load(item);
            }}
          />
        )}
        {measurement.active && (
          <Measurement
            elevationScale={layers.terrain ? layers.exaggeration : 0}
            state={measurement}
            watchProjection={watchObjectProjection}
            projectGround={(p) => map.current?.toScreen(p.coordinates) ?? null}
            onBegin={() => {
              map.current?.stop();
              position.free();
              follow.pause();
            }}
            toCoordinate={(p) => map.current?.toCoordinate(p) ?? null}
            groundElevation={(p) => map.current?.groundElevation(p) ?? null}
          />
        )}
        {selectedPhoto && panel === null && (
          <PhotoViewer
            photo={selectedPhoto}
            group={photos.items.filter((p) => photoGroup.includes(p.id))}
            onSelect={photos.setSelected}
            onClose={() => {
              photos.setSelected(null);
              if (
                selectedPhoto.kind === 'annotation' &&
                selectedAnnotation?.id === selectedPhoto.annotationId
              )
                setPanel('annotations');
            }}
            onRemove={photos.remove}
            onUpdate={photos.update}
            track={photoTracks.find((t) => t.id === selectedPhoto.trackId)}
          />
        )}
        <header className="topbar glass">
          <button
            className="brand"
            aria-label="关于山兔与使用教程"
            onClick={() => {
              if (annotations.edit && !annotations.select(null)) return;
              tracks.pause();
              setPanel('about');
            }}
          >
            <span className="brand-icon">
              <img src="/brand/shantu-logo.png" alt="" width={25} height={25} />
            </span>
            <h1>{PRODUCT_NAME}</h1>
          </button>
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
              : `放置${ANNOTATION_CHOICES[annotations.picking]}`}
            <button
              onClick={() => {
                annotations.setPicking(null);
                setPanel('annotations');
              }}
            >
              取消
            </button>
          </div>
        ) : navigation.picking !== null ? null : (
          navigation.route &&
          !measurement.active &&
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
              onShare={() => {
                const s = guidance.session;
                if (s)
                  setShareTarget(
                    sharePlanned(
                      s.route,
                      '当前导航全程',
                      s.departureLength > 0,
                    ),
                  );
              }}
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
          className={`map-legends${layers.temperature ? ' map-legends-temperature' : ''}`}
          hidden={
            panel !== 'layers' &&
            !layers.elevationColors &&
            !layers.temperature &&
            !layers.geology
          }
        >
          {layers.temperature && (
            <TemperatureLegend
              data={weather.data}
              index={hourIndex}
              loading={weather.loading}
              error={weather.error}
            />
          )}
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
        {railTrack &&
          !editor.session &&
          panel === null &&
          routeWindow === 'card' &&
          !routeChild &&
          !navigationTarget &&
          !shareTarget &&
          tracks.visible &&
          !tracks.drawing &&
          !areas.drawing &&
          !sectionEditing &&
          !guidance.active && (
            <TrackJourneyRail
              key={railTrack.id}
              track={railTrack}
              activeAlternative={activeAlternative}
              onAlternative={(id) => {
                setActiveAlternative(id);
              }}
              markers={annotations.items}
              selected={linePoint}
              onPoint={selectLinePoint}
              onMarker={(id) => {
                const marker = annotations.items.find((a) => a.id === id);
                if (!marker) return;
                map.current?.focusPoint(
                  marker.coordinates,
                  Math.max(15, view.zoom),
                );
                annotations.select(id);
                setTrackLinePoint(null);
                setPanel('annotations');
              }}
            />
          )}
        {navigation.route &&
          !railTrack &&
          !measurement.active &&
          !sectionEditing &&
          !guidance.active && (
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
            (position.locationError ||
              position.locating ||
              (position.showStatus &&
                position.watching &&
                position.fix?.source)))) &&
          !panel && (
            <div className="position-status glass" role="status">
              <span>
                {position.locationError ||
                  position.directionError ||
                  (position.locating
                    ? '正在获取当前位置…'
                    : position.fix
                      ? `${position.fix.source === 'network' ? '基站 / Wi-Fi 大致位置' : 'GPS 位置'} · 估计误差 ${Math.round(position.fix.accuracy)} 米`
                      : '')}
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
        {boxSelecting && (
          <MapBoxSelect
            entries={catalogEntries(
              favorites.items.filter(
                (f) => f.route.createdAt === routeOverlay.route?.createdAt,
              ),
              tracks.visible ? tracks.overlaySaved : [],
              annotations.items,
              sections.items,
              areas.items,
              measurement.saved.items,
            )}
            project={(p) => map.current?.toScreen(p) ?? null}
            onCancel={() => setBoxSelecting(false)}
            onDone={(keys) => {
              setBoxSelecting(false);
              setCollectionOutputKey(null);
              setCollectionSelectedKeys(keys);
              setPanel('favorites');
            }}
          />
        )}
        <MapActions
          compact={panel === 'favorites'}
          onBoxSelect={() => {
            follow.pause();
            map.current?.stop();
            tracks.pause();
            annotations.select(null);
            annotations.setPicking(null);
            navigation.setPicking(null);
            setSectionEditing(false);
            setAreaEditing(false);
            setProfileOpen(false);
            setQuickAdd(null);
            setTrackLinePoint(null);
            setPanel(null);
            setBoxSelecting(true);
          }}
          networkAvailable={
            position.networkAvailable &&
            recorder.record.phase !== 'recording' &&
            !guidance.active
          }
          networkMode={position.mode === 'network'}
          onNetwork={() => {
            follow.pause();
            position.changeMode(
              position.mode === 'network' ? 'auto' : 'network',
              (fix) => {
                map.current?.focusPoint(fix.coordinates, positionZoom(fix));
              },
            );
          }}
          sectionActive={sectionEditing || survey.active}
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
            {recorder.record.phase === 'recording' ? '● 记录中' : '记录待处理'}{' '}
            · {recorder.record.segments.reduce((n, s) => n + s.length, 0)} 点
          </button>
        )}
        {selectedAnnotation &&
          (panel === 'annotations' || annotations.selectionRequest) &&
          !annotations.picking && (
            <AnnotationWorkspace
              key={`annotation-workspace:${selectedAnnotation.id}`}
              state={annotations}
              shownItem={selectedAnnotation}
              tab={annotationTab}
              onTab={(tab) => {
                setAnnotationTab(tab);
                if (tab === 'position')
                  map.current?.focusPoint(
                    selectedAnnotation.coordinates,
                    annotationViewZoom(selectedAnnotation),
                  );
              }}
              dragging={!!featureMove || !!annotationPreview}
              terrainStatus={modelTerrainStatus}
              photos={photosForMarker(photos.items, selectedAnnotation.id)}
              onCapture={markerCamera.capture}
              cameraBusy={markerCamera.busy}
              cameraStatus={
                markerCamera.markerId === selectedAnnotation.id
                  ? markerCamera.status
                  : ''
              }
              cameraRetry={
                markerCamera.markerId === selectedAnnotation.id &&
                markerCamera.retry
              }
              onCameraRetry={markerCamera.onRetry}
              onPhoto={(id) => {
                setPhotoGroup(
                  photosForMarker(photos.items, selectedAnnotation.id).map(
                    (p) => p.id,
                  ),
                );
                photos.setSelected(id);
                setPanel(null);
              }}
              onClose={() => {
                if (annotations.select(null)) {
                  setPanel(null);
                  tracks.select(null);
                  setActiveTrackNode(null);
                  setTrackLinePoint(null);
                }
              }}
              onShare={(id) => {
                setCollectionOutputKey(`annotation:${id}`);
                setPanel('favorites');
              }}
              onNavigate={(item) => {
                navigation.clear();
                navigation.place('end', {
                  name: item.name || '标记位置',
                  coordinates: item.coordinates,
                });
                if (
                  position.fix &&
                  Date.now() - position.fix.timestamp < 120000
                )
                  navigation.place('start', {
                    name: '我的位置',
                    coordinates: position.fix.coordinates,
                  });
                setPanel('route');
              }}
            />
          )}
        <ControlDock
          onMeasure={() => {
            if (editor.session) {
              backEditor();
              return;
            }
            if (!annotations.select(null)) return;
            tracks.pause();
            navigation.setPicking(null);
            annotations.setPicking(null);
            photos.setSelected(null);
            setPanel(null);
            setQuickAdd(null);
            position.free();
            follow.pause();
            survey.close();
            measurement.open();
          }}
          keepOpenOnMapInteraction={
            panel !== null && !['tools', 'time'].includes(panel)
          }
          mapPicking={navigation.picking !== null || !!annotations.picking}
          onScanRoute={() => {
            setPanel(null);
            setRouteQr('');
          }}
          onSection={TERRAIN_SECTION_ENABLED ? toggleSection : undefined}
          sectionActive={sectionEditing || survey.active}
          sectionReady={sectionReady}
          active={
            panel === 'layers' ||
            (panel === 'annotations' && selectedAnnotation)
              ? null
              : panel
          }
          title={panel === 'sources' ? sourcesNavigation?.title : undefined}
          back={
            selectedAnnotation && panel === 'route'
              ? {
                  label: '返回标记',
                  onClick: () => {
                    navigation.setPicking(null);
                    setPanel('annotations');
                  },
                }
              : routeChild
                ? {
                    label: '返回路线',
                    onClick: () => {
                      setRouteChild(false);
                      annotations.select(null);
                      setPanel(null);
                    },
                  }
                : panel === 'sources'
                  ? (sourcesNavigation ?? {
                      label:
                        sourcesParent === 'layers' ? '返回图层' : '返回工具',
                      onClick: () => setPanel(sourcesParent),
                    })
                  : undefined
          }
          onActive={(next) => {
            measurement.close();
            if (
              annotations.edit &&
              next !== 'annotations' &&
              !annotations.select(null)
            )
              return;
            navigation.setPicking(null);
            if (!next && routeChild) {
              setRouteChild(false);
              annotations.select(null);
            }
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
              onRouteQr={(text) => {
                setPanel(null);
                setRouteQr(text);
              }}
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
              initialTab={outdoorPhotos ? 'photos' : 'record'}
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
          {panel === 'annotations' && !selectedAnnotation && (
            <AnnotationPanel
              onShare={(id) => {
                setCollectionOutputKey(`annotation:${id}`);
                setPanel('favorites');
              }}
              terrainStatus={modelTerrainStatus}
              onArea={startArea}
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
              mapCenter={map.current?.centerCoordinate() ?? anchor}
              onLocate={(entry) => {
                position.free();
                follow.pause();
                if (entry.kind === 'route') navigation.restore(entry.route);
                if (entry.kind === 'track') tracks.select(entry.track.id);
                map.current?.fitCollection(collectionPreviewPoints(entry));
              }}
              onClose={() => setPanel(null)}
              initialOutputKey={collectionOutputKey}
              initialSelectedKeys={collectionSelectedKeys}
              photos={photos.items}
              areas={areas.items}
              measurements={measurement.saved.items}
              onMeasurement={(id) => {
                const item = measurement.saved.items.find((m) => m.id === id);
                if (!item) return;
                tracks.finish();
                tracks.select(null);
                annotations.select(null);
                navigation.setPicking(null);
                setPanel(null);
                setProfileOpen(false);
                setSectionEditing(false);
                position.free();
                measurement.load(item);
                map.current?.fitRoute(item.points.map((p) => p.coordinates));
              }}
              onArea={(id) => {
                const a = areas.items.find((a) => a.id === id);
                if (a) {
                  areas.select(id);
                  annotations.select(null);
                  tracks.select(null);
                  map.current?.fitRoute(a.boundary);
                  setAreaEditing(true);
                  setPanel(null);
                }
              }}
              annotations={annotations.items}
              sections={sections.items}
              onAnnotation={(id) => {
                const item = annotations.items.find((a) => a.id === id);
                if (!item) return;
                annotations.select(id);
                tracks.select(null);
                setProfileOpen(false);
                map.current?.focusPoint(
                  item.coordinates,
                  annotationViewZoom(item),
                );
                setPanel('annotations');
              }}
              onSection={(id) => {
                setPanel(null);
                openSection(id);
              }}
              onShareRoute={(favorite) =>
                setShareTarget(sharePlanned(favorite.route, favorite.name))
              }
              onShareTrack={shareTrackById}
              favorites={favorites}
              tracks={tracks}
              onNavigateRoute={navigateFavorite}
              onNavigateTrack={navigateTrack}
              navigationError={savedNavigationError}
              onRoute={(favorite) => {
                navigation.restore(favorite);
                map.current?.fitRoute(favorite.route.coordinates);
                setPanel(null);
              }}
              onTrack={(id) => {
                openRoute(id);
                const track = tracks.saved.find((t) => t.id === id);
                if (track) map.current?.fitRoute(track.segments.flat());
              }}
            />
          )}
          {panel === 'track' && (
            <TrackPanel
              onOpen={openRoute}
              photos={photos.items}
              onPhoto={(id) => {
                const p = photos.items.find((p) => p.id === id);
                if (!p) return;
                setPhotoGroup([id]);
                photos.setSelected(id);
                map.current?.focusPoint(p.coordinates, view.zoom);
                setPanel(null);
              }}
              onAddPhotos={(id) => {
                tracks.select(id);
                setOutdoorPhotos(true);
                setPanel('outdoor');
              }}
              onShare={shareTrackById}
              tracks={tracks}
              onNavigate={navigateTrack}
              navigationError={savedNavigationError}
              onEditNodes={(id) => {
                const track = tracks.saved.find((t) => t.id === id);
                if (track) beginRouteEdit(track);
              }}
              onDraw={(endpoint) => {
                map.current?.stop();
                setSectionEditing(false);
                setProfileOpen(false);
                setPlanePreview(null);
                navigation.setPicking(null);
                annotations.select(null);
                setPanel(null);
                if (endpoint) map.current?.focusPoint(endpoint);
              }}
              onShow={(points) => {
                map.current?.fitRoute(points);
                setPanel(null);
              }}
            />
          )}
          {panel === 'route' && (
            <RoutePanel
              onShare={() => {
                if (navigation.route)
                  setShareTarget(sharePlanned(navigation.route));
              }}
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
                setPanel('route');
              }}
              onPlace={(place) => map.current?.focusPoint(place.coordinates)}
              onShow={(route) => {
                map.current?.fitRoute(route.coordinates);
                setPanel('route');
              }}
            />
          )}
          {panel === 'route' &&
            navigation.route &&
            navigation.picking === null && (
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
          {panel === 'about' && <AboutPanel />}
        </ControlDock>
        {sectionSaveError && (
          <p className="section-save-error glass" role="alert">
            {sectionSaveError}
          </p>
        )}
        {sectionListOpen && (
          <SectionList
            state={sections}
            onCreate={createSection}
            onSelect={openSection}
            onClose={() => setSectionListOpen(false)}
          />
        )}
        {section.enabled &&
          sectionEditing &&
          profileOpen &&
          panel === null &&
          !selectedAnnotation && (
            <SectionProfile
              key={sections.selectedId}
              name={
                sections.items.find((s) => s.id === sections.selectedId)?.name
              }
              data={profileData}
              settings={section}
              onCursor={setSectionCursor}
              onChange={changeSection}
              onRestore={(value) => {
                if (!sections.restore(value)) return;
                setSectionHistory([]);
                setPlanePreview(null);
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
          (panel === null ||
            (panel === 'annotations' &&
              annotations.edit &&
              annotationTab === 'position')) &&
          (selectedAnnotation &&
          !selectedAnnotation.trackAnchor &&
          !selectedAnnotation.sectionAnchor &&
          selectedPose &&
          annotations.edit &&
          annotationTab === 'position' ? (
            <ObjectGizmo
              key={`annotation-gizmo:${selectedAnnotation.id}`}
              name={selectedAnnotation.name || '标记'}
              kind={selectedAnnotation.kind}
              pose={selectedPose}
              hideToolbar
              watchProjection={watchObjectProjection}
              onLocate={() =>
                map.current?.focusPoint(
                  selectedAnnotation.coordinates,
                  annotationViewZoom(selectedAnnotation),
                )
              }
              error={annotations.error}
              canUndo={annotations.moveUndoId === selectedAnnotation.id}
              onBegin={() => {
                map.current?.stop();
                position.free();
                follow.pause();
                // Keep the numeric editor; it hides only during the map gesture.
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
              onDetails={() => setPanel('annotations')}
              onClose={() => {
                if (annotations.select(null)) setPanel(null);
              }}
            />
          ) : section.enabled &&
            !section.survey &&
            sectionEditing &&
            section.plane &&
            panel === null ? (
            <ObjectGizmo
              key={`section-${sections.selectedId}`}
              name={
                sections.items.find((s) => s.id === sections.selectedId)
                  ?.name ?? '矩形剖面'
              }
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
                setPlanePreview(
                  pose ? applyPlanePose(sectionDraft, pose) : null,
                )
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
        {navigationTarget && (
          <NavigationStart
            key={navigationTarget.id}
            target={navigationTarget}
            alternatives={
              selectedTrack && selectedTrack.id === navigationTarget.id
                ? selectedAlternatives
                : []
            }
            alternativeId={activeAlternative}
            onAlternative={setActiveAlternative}
            startError={savedNavigationError}
            onStart={beginFavorite}
            onClose={() => setNavigationTarget(null)}
          />
        )}
        {shareTarget && (
          <RouteShare
            data={shareTarget}
            photos={photos.items}
            onClose={() => setShareTarget(null)}
          />
        )}
        {routeQr !== null && (
          <RouteQrReader
            initial={routeQr}
            onClose={() => setRouteQr(null)}
            onLoaded={(track) => {
              setRouteQr(null);
              tracks.pause();
              tracks.select(track.id);
              tracks.setVisible(true);
              setActiveTrackNode(null);
              annotations.select(null);
              areas.select(null);
              map.current?.fitRoute(track.segments.flat());
              setPanel('track');
            }}
          />
        )}
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
    </TextSuggestions.Provider>
  );
}
