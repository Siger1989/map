'use client';
import { RallyNavigation } from '@/modules/rally/RallyNavigation';
import { NavigationTelemetry } from '@/modules/guidance/NavigationTelemetry';
import { SelectedRouteInfo } from '@/modules/routeDisplay/SelectedRouteInfo';
import { collectionPreviewPoints } from '@/modules/collections/previewBounds';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { drawingMapProjection } from '@/modules/mapComparison/drawingMapProjection';
import { AboutPanel } from '@/modules/help/AboutPanel';
import { PRODUCT_NAME } from '@/config/product';
import { TextSuggestions } from '@/modules/input/SmartText';
import { requestAppBack } from '@/modules/input/appBack';
import { CurrentMapContext } from '@/modules/routeShare/CurrentMapContext';
import { useMapSources } from '@/modules/mapSources/useMapSources';
import { settingsForBasemapSource, sourcePanelSettings } from '@/modules/mapSources/selection';
import { readRasterDatums } from '@/modules/mapSources/coordinates';
import { readContourInterval, saveContourInterval } from '@/modules/terrain/contourInterval';
import { RouteImportDialog } from '@/modules/dataTransfer/RouteImportDialog';
import { useIncomingRoute } from '@/modules/dataTransfer/useIncomingRoute';
import {
  MapSourcesPanel,
  type MapSourcesNavigation,
} from '@/modules/mapSources/MapSourcesPanel';
import { useTripPhotos } from '@/modules/photos/useTripPhotos';
import { PhotoPanel } from '@/modules/photos/PhotoPanel';
import { useRecordingTracks } from '@/modules/outdoor/useRecordingTracks';
import { composeTrackOverlay } from '@/modules/workbench/trackOverlay';
import { PhotoViewer } from '@/modules/photos/PhotoViewer';
import { useMapFocusLock } from '@/modules/controls/useMapFocusLock';
import { useScreenAwake } from '@/modules/position/useScreenAwake';
import { useRecording } from '@/modules/outdoor/useRecording';
import { OutdoorPanel } from '@/modules/outdoor/OutdoorPanel';
import { ReturnPanel } from '@/modules/returnHome/ReturnPanel';
import { RecordingQuickAction } from '@/modules/outdoor/RecordingQuickAction';
import { isDesktopShell } from '@/modules/platform/desktop';
import { TerrainMap, type MapHandle } from '@/modules/map/TerrainMap';
import { MapComparisonHost, type ComparisonSession } from '@/modules/mapComparison/MapComparisonHost';
import { createComparisonExitGate } from '@/modules/mapComparison/comparisonExitGate';
import { comparisonChoices } from '@/modules/mapComparison/choices';
import { FavoriteSourceSwitcher } from '@/modules/mapSources/FavoriteSourceSwitcher';
import { readLastView, saveLastView, shouldFocusStartupPosition } from '@/modules/map/lastView';
import { readLayerPreferences, saveLayerPreferences } from '@/modules/map/layerPreferences';
import { LayerWindow } from '@/modules/controls/LayerWindow';
import { PlaceSearch } from '@/modules/controls/PlaceSearch';
import { RouteNameInput } from '@/modules/navigation/RouteNameInput';
import { defaultRouteName } from '@/modules/navigation/routeName';
import { samePlannedRoute } from '@/modules/navigation/routeVisibility';
import { PlaceShare } from '@/modules/placeShare/PlaceShare';
import { annotationSharePlace } from '@/modules/annotations/share';
import { RasterLevelControl } from '@/modules/cartography/RasterLevelControl';
import { basemapConfiguration } from '@/modules/cartography/basemaps';
import { usesSentinel, usesTianditu, SENTINEL_MAXZOOM, SENTINEL_NAME } from '@/modules/cartography/sentinel';
import { tiandituBase, TIANDITU_LAYERS } from '@/modules/cartography/tianditu';
import { ControlDock, type ControlPanel } from '@/modules/controls/ControlDock';
import { INDUSTRY_TOOLS_ENABLED, mountIndustryToolsPanel, showIndustryToolsEntry } from '@/config/features';
import { createIndustryToolsState, IndustryTools, type IndustryToolsState } from '@/modules/industry/IndustryTools';
import { MapActions } from '@/modules/controls/MapActions';
import { CameraGizmo } from '@/modules/controls/CameraGizmo';
import { RoutePanel } from '@/modules/navigation/RoutePanel';
import { useNavigation } from '@/modules/navigation/useNavigation';
import { useGuidance } from '@/modules/guidance/useGuidance';
import { RouteDisconnectedError, RouteEndpointRequiredError, trackNavigation } from '@/modules/guidance/savedRoute';
import { useGuidanceWorkflow } from '@/modules/workbench/useGuidanceWorkflow';
import { RouteShare } from '@/modules/routeShare/RouteShare';
import { RouteQrReader } from '@/modules/routeShare/RouteQrReader';
import type { DirectionMode } from '@/modules/position/types';
import {
  sharePlanned,
  shareTrack,
  type ShareRoute,
} from '@/modules/routeShare/data';
import { GuidanceCard } from '@/modules/guidance/GuidanceCard';
import { useRouteFavorites } from '@/modules/navigation/useRouteFavorites';
import { MapBoxSelect } from '@/modules/collections/MapBoxSelect';
import { catalogEntries } from '@/modules/collections/catalog';
import { CollectionsPanel } from '@/modules/collections/CollectionsPanel';
import { CenterMarkButton, CenterReticle } from '@/modules/map/CenterCursor';
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
  renameEditRoute,
  editSelectionDetails,
  addEditMarker,
  setEditEnd,
} from '@/modules/tracks/routeEdit';
import { trackAlternatives } from '@/modules/tracks/alternatives';
import { equalCoordinate } from '@/modules/tracks/editing';
import { moveSelectedPoints } from '@/modules/tracks/displayColors';
import { moves as visibleNodeMoves } from '@/modules/tracks/visibleNodeMove';
import type { ManualTrack } from '@/modules/tracks/drawing';
import { shareDraftTrack } from '@/modules/tracks/shareDraft';

import type { TrackLinePoint } from '@/modules/tracks/linePoint';
import { markerChainage } from '@/modules/tracks/linePoint';
import { pickTrackContinuation } from '@/modules/tracks/prepareTrackContinuation';
import { usePosition } from '@/modules/position/usePosition';
import { useMotionHeading } from '@/modules/position/useMotionHeading';
import { canFollow, isPositionTracking, recordingPosition, positionZoom } from '@/modules/position/follow';
import { useFollowPosition } from '@/modules/position/useFollowPosition';
import { useRouteDisplay } from '@/modules/routeDisplay/useRouteDisplay';
import { RouteDisplaySettings } from '@/modules/routeDisplay/RouteDisplaySettings';
import {
  formatDistance,
  formatDuration,
  TRAVEL_MODES,
  type Coordinate,
} from '@/modules/navigation/types';
import { normalizeTrackStyle } from '@/modules/tracks/style';
import { useManualTracks } from '@/modules/tracks/useManualTracks';
import { focusLockVisibility } from '@/modules/controls/focusLockVisibility';
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
  const desktopShell = isDesktopShell();
  useEffect(() => {
    const back = (event: Event) => {
      if (!event.defaultPrevented && requestAppBack(document)) event.preventDefault();
    };
    window.addEventListener('shantu-app-back', back);
    return () => window.removeEventListener('shantu-app-back', back);
  }, []);
  const map = useRef<MapHandle>(null);
  useEffect(() => {
    const focusCad = (event: Event) => {
      const points = (event as CustomEvent<Coordinate[]>).detail;
      if (Array.isArray(points) && points.length && points.every(p=>Array.isArray(p) && p.length===2 && p.every(Number.isFinite)))
        map.current?.fitCollection(points);
    };
    window.addEventListener('shantu-cad-focus', focusCad);
    return () => window.removeEventListener('shantu-cad-focus', focusCad);
  }, []);
  const watchObjectProjection = useCallback<WatchProjection>(
    (listener) => map.current?.watchObjectProjection(listener) ?? (() => {}),
    [],
  );
  const drawing = useRef<TrackDrawingHandle>(null);
  const areaDrawing = useRef<TrackDrawingHandle>(null);
  const comparisonDrawings = [useRef<TrackDrawingHandle>(null), useRef<TrackDrawingHandle>(null)] as const;
  const areas = useAreas();
  const [areaEditing, setAreaEditing] = useState(false);
  const [modelTerrainStatus, setModelTerrainStatus] = useState('');
  const [layers, setLayers] = useState<LayerSettings>(() => {
    const fallback: LayerSettings = {
      ...DEFAULT_LAYERS,
      terrain: readLastView()?.terrain ?? DEFAULT_LAYERS.terrain,
      satellite: true,
      rasterDatums: readRasterDatums(),
      contourInterval: readContourInterval(),
    };
    const preferences = readLayerPreferences(fallback);
    return {
      ...preferences,
      terrain: readLastView()?.terrain ?? preferences.terrain,
      rasterDatums: fallback.rasterDatums,
      contourInterval: fallback.contourInterval,
    };
  });
  useEffect(() => { saveLayerPreferences(layers); }, [layers]);
  const [geology, setGeology] = useState(INITIAL_GEOLOGY);
  const [point, setPoint] = useState<Point>({
    lng: INITIAL_VIEW.center[0],
    lat: INITIAL_VIEW.center[1],
    elevation: null,
  });
  const [mapStatus, setMapStatus] = useState('正在加载真实地形…');
  const [panel, setPanel] = useState<ControlPanel>(null);
  const [industryToolsState, setIndustryToolsState] = useState<IndustryToolsState>(() => createIndustryToolsState());
  const previousPanel = useRef<ControlPanel>(panel);
  const favoritesCamera = useRef<ReturnType<MapHandle['cameraSnapshot']>>(null);
  const preserveFavoritesCamera = useRef(false);
  const favoritesRestoreGeneration = useRef(0);
  const preserveFavoritesFocus = () => {
    if (panel === 'favorites') preserveFavoritesCamera.current = true;
  };
  useEffect(() => {
    const previous = previousPanel.current;
    if (panel === 'favorites' && previous !== 'favorites') {
      favoritesRestoreGeneration.current++;
      favoritesCamera.current = map.current?.cameraSnapshot() ?? null;
      preserveFavoritesCamera.current = false;
    } else if (previous === 'favorites' && panel !== 'favorites') {
      const camera = favoritesCamera.current;
      favoritesCamera.current = null;
      if (!preserveFavoritesCamera.current && camera) {
        const generation = ++favoritesRestoreGeneration.current;
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (generation === favoritesRestoreGeneration.current)
            map.current?.restoreCamera(camera);
        }));
      }
      preserveFavoritesCamera.current = false;
    }
    previousPanel.current = panel;
  }, [panel]);
  const [rallyMode, setRallyMode] = useState(false);
  useEffect(() => { if (panel !== null) setRallyMode(false); }, [panel]);
  const [sourcesParent, setSourcesParent] = useState<'layers' | 'tools'>(
    'tools',
  );
  const [sourcesNavigation, setSourcesNavigation] =
    useState<MapSourcesNavigation | null>(null);
  const [mapCenter, setMapCenter] = useState<[number, number] | null>(null);
  const [view, setView] = useState<ViewState>(INITIAL_VIEW);
  const [satellite, setSatellite] = useState<SatelliteState>({
    date: '',
    status: '正在获取卫星影像日期…',
    ready: false,
  });
  const navigation = useNavigation();
  const favorites = useRouteFavorites();
  const position = usePosition();
  const tracks = useManualTracks();
  const annotations = useAnnotations();
  const recorder = useRecording();
  const photos = useTripPhotos();
  const markerCamera = useMarkerCamera(photos.save);
  const measurement = useMeasurement();
  const [routeNodeBox, setRouteNodeBox] = useState(false);
  const [routeNodeBoxMode, setRouteNodeBoxMode] = useState<'add' | 'subtract'>('add');
  const [routeNodeSelection, setRouteNodeSelection] = useState<Coordinate[]>([]);
  const mapSources = useMapSources();
  const [comparison, setComparison] = useState<ComparisonSession | null>(null);
  const [favoriteSourceOpen, setFavoriteSourceOpen] = useState(false);
  const domesticBasemap = usesTianditu(layers, basemapConfiguration().domestic);
  const rasterMaxLevel = mapSources.source ? mapSources.source.kind === 'image' ? 0 : mapSources.source.maxzoom
    : usesSentinel(layers) ? SENTINEL_MAXZOOM : domesticBasemap ? TIANDITU_LAYERS[tiandituBase(layers)].maxzoom : layers.satellite ? layers.imageryMode === 'detail' ? 14 : 9 : 0;
  const rasterName = mapSources.source?.name ?? (usesSentinel(layers) ? `${SENTINEL_NAME} · 约10米` : domesticBasemap ? `天地图${TIANDITU_LAYERS[tiandituBase(layers)].name}` : layers.satellite ? layers.imageryMode === 'detail' ? '地表影像' : '最新云况影像' : '开源道路地形');
  const sourceChoices = useMemo(() => comparisonChoices(layers, mapSources.source, rasterName, mapSources.maps), [layers, mapSources.source, rasterName, mapSources.maps]);
  const favoriteSourceId = mapSources.source
    ? sourceChoices.find(choice => choice.id !== 'current' && choice.source?.id === mapSources.source?.id)?.id ?? 'current'
    : domesticBasemap ? `tdt-${tiandituBase(layers)}` : !layers.satellite ? 'terrain' : layers.imageryMode === 'latest' ? 'latest' : 'sentinel';
  const rasterSelectionSignature = useRef<string | null>(null);
  useEffect(() => {
    if (!mapSources.ready) return;
    const signature = JSON.stringify([mapSources.selected, layers.satellite, layers.satelliteProvider, layers.imageryMode, layers.offlineBasemap]);
    if (rasterSelectionSignature.current === null) rasterSelectionSignature.current = signature;
    else if (rasterSelectionSignature.current !== signature) {
      rasterSelectionSignature.current = signature;
      setLayers(value => value.rasterLevel == null ? value : { ...value, rasterLevel: null });
    }
  }, [mapSources.ready, mapSources.selected, layers.satellite, layers.satelliteProvider, layers.imageryMode, layers.offlineBasemap]);
  const guidance = useGuidance(
    navigation.route,
    position.fix,
    position.locationError,
  );
  const startupFix = position.startupFix;
  const [shareTarget, setShareTarget] = useState<ShareRoute | null>(null);
  const [placeShareTarget, setPlaceShareTarget] = useState<{ place: { name: string; coordinates: Coordinate; shareText?: string; shareSummary?: string }; markerId?: string } | null>(null);
  const [routeQr, setRouteQr] = useState<string | null>(null);
  const [routeImportOpen, setRouteImportOpen] = useState(false);
  const incomingRoute = useIncomingRoute();
  const [photoGroup, setPhotoGroup] = useState<string[]>([]);

  const { live: liveRecording, photos: photoTracks } = useRecordingTracks(
    recorder.record,
    tracks.saved,
  );
  const selectedPhoto = photos.items.find((p) => p.id === photos.selected);
  const editor = useRouteEditor();
  useEffect(() => {
    const keys = new Set(editor.session?.track.segments.flat().map(p => p.join(',')) ?? []);
    setRouteNodeSelection(old => {
      const kept = old.filter(p => keys.has(p.join(',')));
      return kept.length === old.length ? old : kept;
    });
  }, [editor.session?.track]);
  const [routeWindow, setRouteWindow] = useState<'card' | 'details' | 'marker' | 'display'>(
    'card',
  );
  const [navigationDisplayOpen, setNavigationDisplayOpen] = useState(false);
  const [unsavedExit, setUnsavedExit] = useState(false);
  const comparisonExitGate = useRef(createComparisonExitGate()).current;
  const [routeChild, setRouteChild] = useState(false);
  const routeReturnPoint = useRef<TrackLinePoint | null>(null);
  const [featureMove, setFeatureMove] = useState<FeatureMove | null>(null);
  const [activeTrackNode, setActiveTrackNode] = useState<
    import('@/modules/tracks/editing').TrackNode | null
  >(null);
  const [quickAdd, setQuickAdd] = useState<(MapHold & { fromCenter?: boolean }) | null>(null);
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
  const [boxSelectionAction, setBoxSelectionAction] = useState<'export' | 'share' | 'delete' | null>(null);
  const [boxSelectionResumeToken, setBoxSelectionResumeToken] = useState(0);
  const [collectionSelectedKeys, setCollectionSelectedKeys] = useState<
    string[]
  >([]);
  const [outdoorPhotos, setOutdoorPhotos] = useState(false);
  const [outdoorRecording, setOutdoorRecording] = useState(false);
  useEffect(() => {
    if (panel !== 'favorites') {
      setCollectionOutputKey(null);
    }
    if (panel !== 'outdoor') { setOutdoorPhotos(false); setOutdoorRecording(false); }
  }, [panel]);
  const sections = useSavedSection();
  const survey = useSurveySection(sections, (id) => {
    annotations.select(id);
    setAnnotationTab('basic');
    setPanel('annotations');
  }, (point) => map.current?.groundElevation(point) ?? null);
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
  const [adjustingPinId, setAdjustingPinId] = useState<string | null>(null);
  const [sectionHistory, setSectionHistory] = useState<SectionSettings[]>([]);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileData, setProfileData] = useState<SectionProfileData | null>(
    null,
  );
  const [sectionCursor, setSectionCursor] = useState<ProfilePoint | null>(null);
  const suspendPanelForDialog = () => {
    preserveFavoritesFocus();
    setPanel(null);
    setSectionListOpen(false);
    setAdjustingPinId(null);
    setRouteChild(false);
  };
  const openRouteImportDialog = () => {
    suspendPanelForDialog();
    setRouteImportOpen(true);
  };
  const openRouteShareDialog = (target: ShareRoute) => {
    suspendPanelForDialog();
    setShareTarget(target);
  };
  const openPlaceShareDialog = (target: NonNullable<typeof placeShareTarget>) => {
    suspendPanelForDialog();
    setPlaceShareTarget(target);
  };
  const shareTrackById = (id: string, exportTrack?: ManualTrack) => {
    if (id === DRAFT_ID) {
      const draft = shareDraftTrack({
        segments: tracks.draft,
        name: tracks.draftName,
        style: tracks.style,
        edgeColors: tracks.edgeColors,
        colorConditions: tracks.colorConditions,
      });
      if (!draft) {
        setSavedNavigationError('至少需要两个路线点才能分享。');
        return;
      }
      try {
        const matches = exportTrack?.id === id && JSON.stringify(exportTrack.segments) === JSON.stringify(tracks.draft);
        const shareable = matches && exportTrack?.samples ? { ...draft, samples: exportTrack.samples } : draft;
        openRouteShareDialog(shareTrack(shareable, annotations.items, tracks.saved));
      } catch (e) {
        setSavedNavigationError(e instanceof Error ? e.message : '无法分享轨迹');
      }
      return;
    }
    const track = tracks.saved.find((t) => t.id === id);
    if (track) {
      try {
        const matches = exportTrack?.id === id && JSON.stringify(exportTrack.segments) === JSON.stringify(track.segments);
        const shareable = matches && exportTrack?.samples ? { ...track, samples: exportTrack.samples } : track;
        openRouteShareDialog(shareTrack(shareable, annotations.items, tracks.saved));
      } catch (e) {
        setSavedNavigationError(
          e instanceof Error ? e.message : '无法分享轨迹',
        );
      }
    }
  };
  useEffect(() => {
    if (!incomingRoute.incoming) return;
    preserveFavoritesFocus();
    setPanel(null);
    setSectionListOpen(false);
    setAdjustingPinId(null);
  }, [incomingRoute.incoming]);
  useEffect(() => {
    if (!incomingRoute.mapSource) return;
    setRouteImportOpen(false);
    setComparison(null);
    setSourcesParent('tools');
    setPanel('sources');
  }, [incomingRoute.mapSource]);
  useEffect(() => {
    if (panel === null) return;
    setSectionListOpen(false);
    if (panel !== 'annotations') setAdjustingPinId(null);
  }, [panel]);
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
  const motionHeading = useMotionHeading(cameraFix, position.direction === 'motion');
  const directionHeading = position.direction === 'motion' ? motionHeading.heading : position.heading;
  const markerHeading = position.direction === 'device' || position.direction === 'motion' ? directionHeading :
    displayedFix?.heading !== undefined && Number.isFinite(displayedFix.heading) && (displayedFix.speed ?? 0) >= 1 && (displayedFix.headingAccuracy ?? 0) <= 35 ? displayedFix.heading : null;
  const skipNextFollowKey = useRef('');
  const follow = useFollowPosition({
    fix: cameraFix,
    phase: recorder.record.phase,
    blocked:
      areas.drawing ||
      !!editor.session ||
      measurement.active ||
      survey.active ||
      tracks.editing ||
      !!annotations.picking ||
      navigation.picking !== null ||
      !!featureMove ||
      !!quickAdd ||
      sectionEditing,
    onFollow: (coordinates, fix, initial) => {
      const key = `${fix.timestamp}/${fix.coordinates.join('/')}`;
      if (skipNextFollowKey.current === key) {
        skipNextFollowKey.current = '';
        return true;
      }
      return map.current?.followPosition(
        coordinates,
        position.direction !== 'device' && position.direction !== 'motion',
      ) ?? false;
    },
  });
  const focusLock = useMapFocusLock({ map: () => map.current, following:follow.following, guiding:guidance.active, direction:position.direction,
    fix:cameraFix?.coordinates ?? null, pause:follow.pause, resume:follow.resume, north:position.north, free:position.free, device:position.device, motion:position.motion });
  const pendingPositionFocus = useRef(false);
  const startupCameraStatus = useRef<'pending' | 'applied' | 'cancelled'>('pending');
  const startupSavedCamera = useRef<boolean | null>(null);
  const cancelStartupCamera = useCallback(() => {
    if (startupCameraStatus.current === 'pending')
      startupCameraStatus.current = 'cancelled';
  }, []);
  const userBrowse = useCallback(() => {
    cancelStartupCamera();
    follow.pause();
  }, [cancelStartupCamera, follow.pause]);
  const startupCameraBlocked =
    follow.blocked ||
    guidance.active ||
    navigation.picking !== null ||
    !!editor.session ||
    tracks.editing ||
    tracks.drawing ||
    areas.drawing ||
    measurement.active ||
    survey.active ||
    !!featureMove ||
    !!quickAdd ||
    sectionEditing;
  useEffect(() => {
    if (startupCameraStatus.current !== 'pending') return;
    if (startupSavedCamera.current === null)
      startupSavedCamera.current = !shouldFocusStartupPosition(readLastView());
    if (startupSavedCamera.current) {
      startupCameraStatus.current = 'cancelled';
      return;
    }
    if (startupCameraBlocked) {
      startupCameraStatus.current = 'cancelled';
      return;
    }
    if (!canFollow(startupFix)) return;
    const fix = startupFix;
    let disposed = false;
    let frame = 0;
    const deadline = performance.now() + 20000;
    const focus = () => {
      if (disposed || startupCameraStatus.current !== 'pending') return;
      if (
        map.current?.focusPosition(
          fix.coordinates,
          positionZoom(fix),
          layers.terrain ? 40 : 0,
        )
      ) {
        startupCameraStatus.current = 'applied';
        return;
      }
      if (performance.now() >= deadline) {
        startupCameraStatus.current = 'cancelled';
        return;
      }
      frame = requestAnimationFrame(focus);
    };
    focus();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
    };
  }, [
    startupFix?.timestamp,
    startupFix?.coordinates[0],
    startupFix?.coordinates[1],
    startupFix?.accuracy,
    startupFix?.source,
    startupCameraBlocked,
    layers.terrain,
  ]);
  const focusOnReliablePosition = (fix: NonNullable<typeof cameraFix>) => {
    cancelStartupCamera();
    pendingPositionFocus.current = false;
    focusLock.adoptMode(true, 'north');
    position.north();
    const zoom = Math.max(16, map.current?.cameraSnapshot()?.zoom ?? view.zoom);
    const focused = map.current?.focusPosition(fix.coordinates, zoom, layers.terrain ? 40 : 0);
    skipNextFollowKey.current = focused ? `${fix.timestamp}/${fix.coordinates.join('/')}` : '';
    follow.resume();
  };
  const locateAndFocus = () => {
    cancelStartupCamera();
    if (follow.blocked) return;
    if (canFollow(cameraFix)) focusOnReliablePosition(cameraFix);
    else {
      pendingPositionFocus.current = true;
      position.locate();
    }
  };
  const changeMapDirection = (direction: DirectionMode) => {
    cancelStartupCamera();
    focusLock.adoptMode(direction === 'motion' || follow.following, direction);
    if (direction === 'device') void position.device();
    else if (direction === 'motion') {
      position.motion(); follow.resume();
      if (recorder.record.phase !== 'recording') position.locate();
    } else if (direction === 'north') { position.north(); map.current?.north(); }
    else position.free();
  };
  const toggleMapFollowing = () => {
    cancelStartupCamera();
    if (follow.blocked) { if (recorder.record.phase !== 'recording') position.locate(); return; }
    const tracking = isPositionTracking(follow.following, follow.waiting, position.locationError, cameraFix);
    focusLock.adoptMode(!tracking, position.direction);
    if (tracking) { follow.pause(); map.current?.stop(); }
    else { map.current?.stop(); follow.resume(); if (recorder.record.phase !== 'recording') position.locate(); }
  };
  const resumeNavigation = () => {
    cancelStartupCamera();
    map.current?.previewRoute(null);
    position.motion();
    follow.resume();
    if (canFollow(cameraFix)) map.current?.followPosition(cameraFix.coordinates, false);
    if (!position.watching || position.locationError) position.locate();
  };
  useEffect(() => {
    if (pendingPositionFocus.current && !follow.blocked && canFollow(cameraFix))
      focusOnReliablePosition(cameraFix);
  }, [cameraFix?.timestamp, cameraFix?.coordinates[0], cameraFix?.coordinates[1], cameraFix?.accuracy, follow.blocked]);
  useScreenAwake(guidance.active || recorder.record.phase === 'recording' || focusLock.locked);
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
  const photoOverlay = useMemo(
    () => photos.visible && navigation.picking === null ? linkedPhotos : [],
    [photos.visible, navigation.picking, linkedPhotos],
  );
  const displayedAnnotations = useMemo(() => {
    const photoMarkerIds = new Set(photoOverlay.filter(p => p.kind === 'annotation').map(p => p.annotationId));
    return annotationOverlay.map(a => a.kind === 'pin' && photoMarkerIds.has(a.id) ? { ...a, visible: false } : a);
  }, [annotationOverlay, photoOverlay]);
  const mapAnnotations = useMemo(
    () => [...displayedAnnotations, ...(editor.session?.pendingMarkers ?? [])],
    [displayedAnnotations, editor.session?.pendingMarkers],
  );
  const mapSection = useMemo(() => section.survey ? { ...section, enabled: false } : section, [section]);
  const mapSections = useMemo(() => sections.items.filter(s => !s.settings.survey), [sections.items]);
  const selectedAnnotation = annotationOverlay.find(
    (item) => item.id === annotations.selected,
  );
  useEffect(() => {
    if (adjustingPinId && selectedAnnotation?.id !== adjustingPinId)
      setAdjustingPinId(null);
  }, [adjustingPinId, selectedAnnotation?.id]);
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
    if (panel !== 'favorites' || boxSelecting || collectionSelectedKeys.length) return;
    const frame = requestAnimationFrame(() => {
      position.free();
      follow.pause();
    });
    return () => cancelAnimationFrame(frame);
  }, [panel, boxSelecting, collectionSelectedKeys.length]);
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
  const [routeDirection, setRouteDirection] = useState<{ id:string; reversed:boolean } | null>(null);
  const routeReversed = routeDirection?.id === railTrack?.id && !!routeDirection?.reversed;
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
  const routeProfilePoint = linePoint ?? (
    railTrack && selectedAnnotation?.trackAnchor?.trackId === railTrack.id
      ? { trackId: railTrack.id, coordinate: selectedAnnotation.coordinates, distance: selectedAnnotation.trackAnchor.distance }
      : null
  );
  useEffect(() => {
    setTrackLinePoint((point) =>
      point?.trackId === tracks.selectedId ? point : null,
    );
  }, [tracks.selectedId]);
  const openFavoriteRoute = (id: string) => {
    const favorite = favorites.items.find((item) => item.id === id.slice('favorite:'.length));
    if (!favorite || !navigation.restore(favorite)) return;
    survey.close();
    tracks.select(null);
    annotations.select(null);
    areas.select(null);
    setTrackLinePoint(null);
    setPanel('route');
  };
  const selectLinePoint = (point: TrackLinePoint) => {
    if (point.trackId.startsWith('favorite:')) {
      if (!editor.session) openFavoriteRoute(point.trackId);
      return;
    }
    if (point.trackId.startsWith('measurement:')) return;
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
    map.current?.clearRouteIssue();
    const track = tracks.saved.find((t) => t.id === id);
    if (!track) return;
    survey.close();
    if (track.hidden) tracks.showTrack(id);
    tracks.finish();
    tracks.setVisible(true);
    selectLinePoint({
      trackId: id,
      coordinate: track.segments[0][0],
      distance: 0,
    });
  };
  const plannedEdit = useRef<{ createdAt: number; selectedId: string | null } | null>(null);
  const closeEditor = () => {
    if (plannedEdit.current) {
      tracks.select(plannedEdit.current.selectedId);
      plannedEdit.current = null;
    }
    setRouteNodeBox(false);
    setRouteNodeSelection([]);
    editor.close();
    setUnsavedExit(false);
    setRouteWindow('card');
    setActiveTrackNode(null);
    setTrackLinePoint(routeReturnPoint.current);
  };
  const saveEditor = (asCopy = false, name?: string) => {
    if (name !== undefined) editor.change(value => renameEditRoute(value, name));
    const current = editor.currentSession();
    if (!current) return false;
    const copyId = asCopy ? crypto.randomUUID() : '';
    const result = tracks.commitEdit(asCopy ? {
      ...current,
      original: { ...current.original, id: copyId, name: `${current.track.name} · 副本`, createdAt: Date.now() },
      track: { ...current.track, id: copyId, name: `${current.track.name} · 副本` },
      sources: [],
    } : current);
    if (!result.track) {
      editor.setError(result.error);
      setUnsavedExit(false);
      return false;
    }
    if (result.removed) {
      closeEditor();
      setTrackLinePoint(null);
      return true;
    }
    if (plannedEdit.current) {
      if (navigation.route?.createdAt === plannedEdit.current.createdAt) navigation.clear();
      plannedEdit.current = null;
    }
    const previous =
      routeReturnPoint.current?.coordinate ?? result.track.segments[0][0];
    closeEditor();
    setTrackLinePoint({
      trackId: result.track.id,
      coordinate: previous,
      distance: 0,
    });
    return true;
  };
  const requestComparisonExit = (exit: () => void = () => setComparison(null)) => {
    const current = editor.currentSession();
    comparisonExitGate.request({
      editingRoute: !!current,
      dirtyRoute: !!current?.history.length,
      closeRouteEditor: closeEditor,
      confirmRouteExit: () => setUnsavedExit(true),
      exitComparison: exit,
    });
  };
  const backEditor = (name?: string) => {
    if (name !== undefined) editor.change(value => renameEditRoute(value, name));
    if (editor.currentSession()?.history.length) setUnsavedExit(true);
    else closeEditor();
  };
  const beginRouteEdit = (track: ManualTrack) => {
    setSavedNavigationError('');
    map.current?.clearRouteGap();
    map.current?.clearRouteIssue();
    routeReturnPoint.current = trackLinePoint;
    tracks.select(track.id);
    tracks.finish();
    setPanel(null);
    setRouteWindow('card');
    setRouteChild(false);
    annotations.select(null);
    editor.start(track);
  };
  const editPlannedPoints = () => {
    const route = navigation.route;
    if (!route) return;
    plannedEdit.current = { createdAt: route.createdAt, selectedId: tracks.selectedId };
    guidance.stop();
    setRallyMode(false);
    routeReturnPoint.current = trackLinePoint;
    tracks.finish();
    setPanel(null);
    setRouteWindow('card');
    annotations.select(null);
    editor.start({ id: crypto.randomUUID(), name: route.name || defaultRouteName({ name: navigation.start?.name || '起点' }, { name: navigation.end?.name || '终点' }), createdAt: Date.now(), source: 'manual', navigationMode: route.mode,
      segments: [route.coordinates.map(p => [...p] as Coordinate)] }, true);
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
  const routeVisible =
    !!railTrack &&
    !tracks.drawing &&
    !guidance.active &&
    !areas.drawing &&
    !sectionEditing &&
    !survey.active;
  const selectionName = selectedAnnotation
    ? selectedAnnotation.name || '未命名标记'
    : selectedTrack?.name || (selectedDraft ? '路线草稿' : '');
  useEffect(() => {
    if (
      (position.direction === 'device' || (position.direction === 'motion' && follow.following)) &&
      directionHeading !== null &&
      !follow.blocked
    )
      map.current?.view(view.pitch, directionHeading, false);
  }, [position.direction, directionHeading, follow.following, follow.blocked]);
  const {
    savedNavigationError,
    savedNavigationGap,
    setSavedNavigationError,
    setDisconnectedNavigationError,
    navigationTarget,
    setNavigationTarget,
    startGuidance,
    navigateFavorite,
    navigateTrack,
    onRouteApplied,
  } = useGuidanceWorkflow({
    guidance,
    position,
    initialFix: position.fix,
    follow,
    recorder,
    navigation,
    tracks,
    map,
    activeAlternative,
    onOpenRoute: openRoute,
    onOpenRouteCard: () => {
      setNavigationDisplayOpen(false);
      setPanel('route');
    },
    onInvalidRoute: () => setPanel('route'),
    onActivateUi: () => {
      setNavigationDisplayOpen(false);
      setBoxSelecting(false);
      setCollectionSelectedKeys([]);
      setCollectionOutputKey(null);
      setBoxSelectionAction(null);
      setSectionEditing(false);
      setProfileOpen(false);
      tracks.finish();
      tracks.select(null);
      annotations.select(null);
      navigation.setPicking(null);
      setQuickAdd(null);
      setPanel(null);
    },
  });
  const stopNavigation = () => {
    setNavigationDisplayOpen(false);
    guidance.stop();
    navigation.clear();
    setNavigationTarget(null);
    setRallyMode(false);
    tracks.select(null);
    setTrackLinePoint(null);
    map.current?.previewRoute(null);
    setPanel(null);
  };
  const routeOverlay = useMemo(
    () => {
      const activeRoute = guidance.active ? guidance.session?.route : null;
      const start = activeRoute
        ? activeRoute.stops?.[0] ?? { name: '当前位置', coordinates: activeRoute.coordinates[0] }
        : navigation.start;
      const end = activeRoute
        ? activeRoute.stops?.at(-1) ?? { name: '终点', coordinates: activeRoute.coordinates.at(-1)! }
        : navigation.end;
      return {
        start: navigation.visible ? start : null,
        end: navigation.visible ? end : null,
        route: navigation.visible ? activeRoute ?? navigation.route : null,
        via: navigation.visible ? activeRoute?.stops?.slice(1, -1) ?? navigation.via : [],
      };
    },
    [
      navigation.start,
      navigation.end,
      navigation.route,
      navigation.via,
      navigation.visible,
      guidance.active,
      guidance.session?.route,
    ],
  );
  const savedTrackOverlay = useMemo(() => [...tracks.overlaySaved,
          ...favorites.items.filter(f => f.visible && (navigation.visible || !samePlannedRoute(f.route, navigation.route))).map(f => ({ id:`favorite:${f.id}`, name:f.name, createdAt:f.savedAt, segments:f.route.segments?.map(s => s.coordinates) ?? [f.route.coordinates], style:{ color:'#337aaa', width:2 } })),
          ...measurement.saved.items.filter(m => m.visible).map(m => ({ id:`measurement:${m.id}`, name:m.name, createdAt:m.updatedAt, segments:[m.points.map(p => p.coordinates)], style:{ color:'#bc5d22', width:2 } })),
        ],
    [tracks.overlaySaved, favorites.items, measurement.saved.items, navigation.visible, navigation.route],
  );
  const visibleLinePoint = panel === null ? linePoint : null;
  const trackOverlay = useMemo(
    () =>
      composeTrackOverlay({
        saved: savedTrackOverlay,
        draft: tracks.draft,
        session: editor.session,
        nodeSelection: editor.session ? { trackId: editor.session.track.id, points: routeNodeSelection } : undefined,
        recording: liveRecording,
        visible: tracks.visible || recorder.record.phase !== 'idle',
        draftEdgeColors: tracks.edgeColors,
        style: tracks.style,
        nodes: tracks.vertices,
        drawing: tracks.drawing,
        selectedId: tracks.selectedId,
        reversed:routeReversed,
        snapTargets: tracks.snapping,
        alternativeId: activeAlternative,
        linePoint: visibleLinePoint,
      }),
    [
      liveRecording,
      editor.session,
      routeNodeSelection,
      activeAlternative,
      visibleLinePoint,
      recorder.record.phase,
      savedTrackOverlay,
      tracks.draft,
      tracks.edgeColors,
      tracks.visible,
      tracks.style,
      tracks.vertices,
      tracks.drawing,
      tracks.selectedId,
      routeReversed,
      tracks.snapping,
    ],
  );
  const routeDisplay = useRouteDisplay(
    trackOverlay,
    routeOverlay,
    railTrack?.id ?? null,
    follow.blocked || !!editor.session || measurement.active || survey.active,
  );
  useEffect(() => {
    if (!guidance.active || panel || quickAdd || rallyMode || editor.session || measurement.active || sectionEditing)
      setNavigationDisplayOpen(false);
  }, [guidance.active, panel, quickAdd, rallyMode, editor.session, measurement.active, sectionEditing]);
  const update = (patch: Partial<LayerSettings>) => {
    if (patch.contourInterval !== undefined) saveContourInterval(patch.contourInterval);
    if (patch.terrain !== undefined) map.current?.setTerrainMode(patch.terrain);
    setLayers((current) => applyLayerPatch(current, patch));
  };
  const selectBasemapSource = (settings: LayerSettings, sourceId: string) => {
    mapSources.select(sourceId);
    update(settingsForBasemapSource(settings, layers));
  };
  useMapTools({
    read: () => ({
      layers,
      view,
      point,
      satellite,
      geology,
      map: map.current?.inspect(),
    }),
    configure: (patch, pitch, bearing) => {
      update(patch);
      if (pitch !== undefined || bearing !== undefined)
        map.current?.view(pitch ?? view.pitch, bearing ?? view.bearing, false);
    },
  });
  const branchEditing = !!editor.session && editor.session.branch !== null;
  const branchTip = branchEditing
    ? (editor.session!.track.segments[editor.session!.branch!].at(-1) ?? null)
    : null;
  const branchSavedCandidates = useMemo(() => branchEditing
    ? tracks.saved
          .filter(
            (t) =>
              !t.hidden && !editor.session!.sources.some((s) => s.id === t.id),
          )
          .flatMap((t) => t.segments.flat())
    : [], [branchEditing, editor.session?.sources, tracks.saved]);
  const branchCandidates = useMemo(() => branchEditing
    ? [...editor.session!.track.segments.flat(), ...branchSavedCandidates]
    : [], [branchEditing, editor.session?.track.segments, branchSavedCandidates]);
  const drawingToScreen = useCallback((point: Coordinate) => map.current?.toScreen(point) ?? null, []);
  const continueAtVisibleTrack = (point: Coordinate) => {
    if (tracks.draft.some((segment) => segment.length)) return false;
    const activeMap = map.current,
      screen = drawingToScreen(point);
    if (!activeMap || !screen) return false;
    const hit = pickTrackContinuation(
      tracks.saved,
      screen,
      (coordinate) =>
        drawingToScreen(coordinate) ?? { x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY },
      { draftEmpty: true },
    );
    if (!hit) return false;
    return tracks.continueTrack(hit.track.id, { coordinate: hit.coordinate, distance: hit.distance });
  };
  const drawingSnapViewport = useCallback(() => map.current?.getSnapViewport() ?? null, []);
  const drawBranchVertex = (point: Coordinate, section?: Coordinate[]) => {
    let committed: { track: ManualTrack; line: Coordinate[] } | undefined;
    editor.change((value) => {
      const next = appendEditBranch(
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
      );
      if (next !== value && value.branch !== null) {
        const before = value.track.segments[value.branch];
        committed = { track: next.track, line: next.track.segments[value.branch].slice(before.length - 1) };
      }
      return next;
    });
    if (committed) {
      const receipt = { trackId: committed.track.id, segments: committed.track.segments };
      const overlays = comparison ? comparisonDrawings : [drawing];
      overlays.forEach(overlay => overlay.current?.retainCommit(receipt, committed!.line));
    }
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
  const previousRoutePanel = useRef(panel);
  useEffect(() => {
    if (previousRoutePanel.current === 'route' && panel !== 'route' &&
        !navigation.route && !guidance.active) navigation.clear();
    previousRoutePanel.current = panel;
  }, [panel]);
  const canAddCenterMarker = !savedNavigationError.includes('已定位约') && (focusLock.locked || (panel === null &&
    !tracks.drawing &&
    !areas.drawing &&
    !(areas.selected && areaEditing) &&
    !annotations.picking &&
    !navigation.picking &&
    !sectionEditing &&
    !selectedPhoto &&
    !featureMove &&
    !measurement.active &&
    !boxSelecting));
  // follow.blocked also covers a paused drawing's retained editing state.
  // It controls camera following, not whether an on-screen task is open.
  const focusLockControl = focusLockVisibility(focusLock.locked, panel, {
    drawing: tracks.drawing,
    areaDrawing: areas.drawing,
    areaEditing: !!areas.selected && areaEditing,
    routeEditor: !!editor.session,
    measurement: measurement.active,
    survey: survey.active,
    markerPicking: !!annotations.picking,
    routePicking: navigation.picking !== null,
    movingFeature: !!featureMove,
    quickAdd: !!quickAdd,
    sectionEditing,
    navigation: guidance.active,
    comparison: !!comparison,
    boxSelection: boxSelecting,
    sectionList: sectionListOpen,
    annotationDetails: panel === 'annotations' && !!selectedAnnotation,
    photoDetails: !!selectedPhoto,
    rally: rallyMode && !!navigation.route,
    routeCard: routeVisible && !routeChild,
    navigationTarget: !!navigationTarget,
    sharing: !!shareTarget,
    sourcePicker: favoriteSourceOpen,
  });
  const switchFromSection = () => {
    if (survey.picking || survey.dragging || survey.markerTarget) return false;
    if (survey.active) survey.close();
    if (sectionEditing) {
      setSectionEditing(false);
      setProfileOpen(false);
      setSectionCursor(null);
    }
    return true;
  };
  const placeSearch = (
    <PlaceSearch
      onShare={(place) => openPlaceShareDialog({ place: { name: place.name, coordinates: [...place.coordinates] } })}
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
  );
  const renderMarkerWorkspace = (onClose: () => void) => selectedAnnotation && !annotations.picking ? (
    <AnnotationWorkspace
      key={`annotation-workspace:${selectedAnnotation.id}`}
      state={annotations}
      shownItem={selectedAnnotation}
      tab={annotationTab}
      onTab={setAnnotationTab}
      onAddModel={(kind, coordinates) => annotations.addAndEdit(kind, coordinates)}
      dragging={!!featureMove || !!annotationPreview}
      terrainStatus={modelTerrainStatus}
      photos={photosForMarker(photos.items, selectedAnnotation.id)}
      onCapture={markerCamera.capture}
      onImport={markerCamera.importPhoto}
      onAdjust={() => {
        setAnnotationTab('position');
        setAdjustingPinId(selectedAnnotation.id);
        setPanel(null);
        position.free();
        follow.pause();
        if (!comparison)
          map.current?.focusPoint(selectedAnnotation.coordinates, map.current?.cameraSnapshot()?.zoom ?? view.zoom);
      }}
      cameraBusy={markerCamera.busy}
      cameraStatus={markerCamera.markerId === selectedAnnotation.id ? markerCamera.status : ''}
      cameraRetry={markerCamera.markerId === selectedAnnotation.id && markerCamera.retry}
      onCameraRetry={markerCamera.onRetry}
      onPhoto={(id) => {
        setPhotoGroup(photosForMarker(photos.items, selectedAnnotation.id).map(p => p.id));
        photos.setSelected(id);
        setPanel(null);
      }}
      onClose={onClose}
      onShare={(item) => {
        if (item.kind === 'pin') {
          openPlaceShareDialog({ place: annotationSharePlace(item), markerId: item.id });
          return;
        }
        setCollectionOutputKey(`annotation:${item.id}`);
        setPanel('favorites');
      }}
      onNavigate={(item) => {
        navigation.clear();
        navigation.place('end', {
          name: item.name || '标记位置',
          coordinates: item.coordinates,
        });
        setPanel('route');
      }}
    />
  ) : null;
  const routeEditorDialog = editor.session && unsavedExit ? <RouteUnsavedDialog
    onSave={() => { if (saveEditor()) comparisonExitGate.resolve(true); }}
    onDiscard={() => { closeEditor(); comparisonExitGate.resolve(true); }}
    onContinue={() => { comparisonExitGate.resolve(false); setUnsavedExit(false); }}
  /> : null;
  const routeEditorOverlay = editor.session ? <>
    <RouteEditToolbar
      session={editor.session}
      snapName={featureMove?.snappedNode ? tracks.saved.find(t => t.id === featureMove.snappedNode!.trackId)?.name : undefined}
      snapping={tracks.snapping}
      roadSnapping={tracks.roadSnapping}
      riverSnapping={tracks.riverSnapping}
      onSnapping={() => tracks.setSnapping(!tracks.snapping)}
      onRoadSnapping={() => tracks.setRoadSnapping(!tracks.roadSnapping)}
      onRiverSnapping={() => tracks.setRiverSnapping(!tracks.riverSnapping)}
      error={editor.error}
      onName={name => editor.change(value => renameEditRoute(value, name))}
      onBack={backEditor}
      onSave={name => saveEditor(false, name)}
      onSaveCopy={name => saveEditor(true, name)}
      onAdd={addEditPoint}
      selectedPoints={routeNodeSelection}
      boxMode={routeNodeBox ? routeNodeBoxMode : null}
      onSelectionDetails={detail => { editor.change(session => editSelectionDetails(session, routeNodeSelection, detail)); routeDisplay.update({ mode: 'original' }); }}
      onPointMarker={input => routeNodeSelection.length === 1 && editor.change(session => addEditMarker(session, routeNodeSelection[0], input, crypto.randomUUID(), map.current?.groundElevation(routeNodeSelection[0]) ?? null))}
      onSetEnd={() => { if (routeNodeSelection.length === 1) editor.change(session => setEditEnd(session, routeNodeSelection[0])); }}
      onClearSelection={() => { setRouteNodeSelection([]); editor.change(session => ({ ...session, selected: null })); }}
      onRemove={() => {
        if (!routeNodeSelection.length) editor.change(removeEditNode);
        else if (editor.change(session => removeEditNodes(session, routeNodeSelection))) setRouteNodeSelection([]);
      }}
      onSelectionMode={mode => {
        map.current?.stop();
        if (mode) setRouteNodeBoxMode(mode);
        setRouteNodeBox(mode !== null);
      }}
      onBranch={() => editor.change(toggleEditBranch)}
      onUndo={() => editor.change(undoRouteEdit)}
      onStyle={style => { editor.change(value => styleRouteEdit(value, style)); routeDisplay.update({ mode: 'original' }); }}
    />
    {!comparison && (routeNodeBox || !!routeNodeSelection.length) && <TrackNodeBoxSelect
      active={routeNodeBox}
      mode={routeNodeBoxMode}
      pointSize={normalizeTrackStyle(editor.session.track.style).pointSize ?? 8}
      points={editor.session.track.segments.flat()}
      selected={routeNodeSelection}
      project={point => map.current?.toScreen(featureMove?.target.kind === 'track' && equalCoordinate(point, featureMove.target.node.coordinate) ? featureMove.coordinate : point) ?? null}
      onTwoFingerMove={(previous, next) => map.current?.panZoomGesture(previous, next)}
      onTwoFingerEnd={() => map.current?.finishPanZoomGesture()}
      onChange={points => { setRouteNodeSelection(points); editor.change(session => ({ ...session, selected: points.length === 1 ? points[0] : null })); }}
      onExit={() => setRouteNodeBox(false)}
    />}
    {!comparison && routeEditorDialog}
  </> : null;

  return (
    <TextSuggestions.Provider value={suggestionValues}>
      <CurrentMapContext.Provider value={() => map.current?.shareMapStyle() ?? null}>
      <main
        className="observatory home-map"
        data-comparing={comparison !== null}
        data-ui-style="outdoor"
        data-rally={rallyMode && !!navigation.route}
        data-guiding={guidance.active && !rallyMode}
        data-focus-locked={focusLock.locked}
        data-focus-lock-blockers={focusLockControl.reasons.join(' ')}
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
        data-route-notice={navigation.picking !== null}
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
          if (comparison) { event.preventDefault(); setComparison(null); return; }
          if (navigation.picking !== null) {
            event.preventDefault();
            navigation.setPicking(null);
            setPanel('route');
            return;
          }
          if (quickAdd) { event.preventDefault(); setQuickAdd(null); return; }
          if (navigationDisplayOpen) { event.preventDefault(); setNavigationDisplayOpen(false); return; }
          if (panel !== null) {
            event.preventDefault();
            if (panel === 'annotations' && !annotations.select(null)) return;
            setPanel(null);
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
          if (survey.active) { event.preventDefault(); survey.close(); return; }
          if (measurement.active) { event.preventDefault(); measurement.close(); return; }
          if (annotations.picking) {
            event.preventDefault();
            annotations.setPicking(null);
            setPanel('annotations');
          } else if (navigation.picking !== null) {
            event.preventDefault();
            navigation.setPicking(null);
            setPanel('route');
          } else if (tracks.drawing) {
            event.preventDefault();
            tracks.pause();
            setPanel(null);
          }
        }}
      >
        {focusLockControl.visible && (
          <button className="global-focus-lock" aria-label={focusLock.locked ? '解除界面隐藏锁定' : '隐藏界面并锁定视角'} aria-pressed={focusLock.locked}
            onClick={focusLock.toggle}>{focusLock.locked ? '解锁' : '锁定'}<small>{focusLock.locked && focusLock.browsing ? '10秒回位' : focusLock.locked ? '显示UI' : '隐藏UI'}</small></button>
        )}
        {focusLock.locked && (guidance.session || recorder.record.phase === 'recording') && <section className="focus-live-data" aria-label="锁定实时数据">{guidance.session ? <NavigationTelemetry session={guidance.session} fix={displayedFix}/> : <span>正在记录 · {cameraFix ? `${cameraFix.coordinates[1].toFixed(5)}, ${cameraFix.coordinates[0].toFixed(5)}` : '等待定位'}</span>}</section>}
        <MapComparisonHost session={comparison} primary={map} view={view} search={comparison ? placeSearch : null}
          editorOverlay={comparison ? routeEditorOverlay : null}
          plannedRoute={panel === 'route' && navigation.route && !editor.session ? {
            name: navigation.route.name || defaultRouteName({ name: navigation.start?.name || '起点' }, { name: navigation.end?.name || '终点' }),
            onRename: name => !!navigation.route && favorites.rename(navigation.route, name) && navigation.rename(name),
            visible: navigation.visible,
            onToggleVisible: () => navigation.setVisible(!navigation.visible),
            distance: navigation.route.distance,
            duration: navigation.route.duration,
            onEdit: editPlannedPoints,
            onShow: () => map.current?.fitCollection(navigation.route!.coordinates, { top: 80, right: 32, bottom: 150, left: 24 }),
            onDetails: () => setComparison(null),
            onClose: () => setPanel(null),
          } : null}
          editorDialog={comparison ? routeEditorDialog : null}
          editorPaneOverlay={(_, paneMap) => (routeNodeBox || !!routeNodeSelection.length) && editor.session && <div className="map-comparison-edit-overlay">
            <TrackNodeBoxSelect
              active={routeNodeBox}
              mode={routeNodeBoxMode}
              pointSize={normalizeTrackStyle(editor.session.track.style).pointSize ?? 8}
              points={editor.session.track.segments.flat()}
              selected={routeNodeSelection}
              project={point => paneMap.current?.toScreen(featureMove?.target.kind === 'track' && equalCoordinate(point, featureMove.target.node.coordinate) ? featureMove.coordinate : point) ?? null}
              onTwoFingerMove={(previous, next) => paneMap.current?.panZoomGesture(previous, next)}
              onTwoFingerEnd={() => paneMap.current?.finishPanZoomGesture()}
              onChange={points => { setRouteNodeSelection(points); editor.change(session => ({ ...session, selected: points.length === 1 ? points[0] : null })); }}
              onExit={() => setRouteNodeBox(false)}
            />
          </div>}
          onDrawingInput={(index, event) => comparisonDrawings[index].current?.input(event)}
          drawingOverlay={(index, mapRef) => (
            <div className="map-comparison-drawing">
              <TrackDrawing
                ref={comparisonDrawings[index]}
                committedSegments={editor.session?.track.segments}
                waitForCommit={(receipt, done) => mapRef.current?.waitForTrackRender(receipt, done) ?? (() => {})}
                enabled={branchEditing || tracks.drawing}
                distanceSegments={branchEditing ? [editor.session!.track.segments[editor.session!.branch!]] : tracks.draft}
                length={tracks.rodLength}
                style={branchEditing ? normalizeTrackStyle(editor.session!.track.style) : tracks.style}
                mode="points"
                anchor={branchEditing ? branchTip : tracks.anchor}
                candidates={branchEditing ? branchCandidates : tracks.candidates}
                snapping={tracks.snapping}
                roadSnapping={tracks.roadSnapping || tracks.riverSnapping}
                riverSnapping={tracks.riverSnapping}
                snapRoad={(point, previous, from) =>
                  (tracks.riverSnapping
                    ? mapRef.current?.snapRiver(point, previous, from)
                    : mapRef.current?.snapRoad(point, previous, from)) ?? {
                    status: 'loading', match: null,
                  }
                }
                lastVertex={branchEditing ? branchTip : tracks.draft.at(-1)?.at(-1) ?? null}
                toScreen={drawingMapProjection(mapRef)}
                getSnapViewport={() => mapRef.current?.getSnapViewport() ?? null}
                magnify={(canvas, point) => mapRef.current?.magnify(canvas, point) ?? (() => {})}
                onAnchor={branchEditing ? () => {} : tracks.setAnchor}
                onVertex={branchEditing ? drawBranchVertex : tracks.addVertex}
                toCoordinate={(point) => mapRef.current?.toCoordinate(point) ?? null}
                onStroke={branchEditing ? () => {} : tracks.addStroke}
              />
            </div>
          )}
          onClose={() => requestComparisonExit()} onUse={choice => requestComparisonExit(() => {
          selectBasemapSource(choice.settings, choice.source?.id ?? '');
          setComparison(null);
        })} markerEditor={renderMarkerWorkspace} operations={{
          onMark: (coordinates, kind) => annotations.add(kind, coordinates),
          onOutline: () => { setComparison(null); startArea(); },
          direction: position.direction,
          directionStatus: position.direction === 'motion' ? motionHeading.status : position.directionError,
          onDirectionChange: changeMapDirection,
          following: follow.following,
          tracking: isPositionTracking(follow.following, follow.waiting, position.locationError, cameraFix),
          locating: (follow.following && follow.waiting) || (recorder.record.phase !== 'recording' && position.locating),
          locationError: position.locationError,
          followBlocked: follow.blocked,
          onToggleFollowing: toggleMapFollowing,
          onDraw: () => { tracks.start(); setPanel(null); },
          onUndo: tracks.undo,
          onSave: () => tracks.save('', true),
          onPause: tracks.finish,
          onLocate: locateAndFocus,
          canUndo: tracks.canUndo,
          drawingEnabled: tracks.drawing,
          snapping: tracks.snapping,
          onSnappingChange: tracks.setSnapping,
          roadSnapping: tracks.roadSnapping,
          onRoadSnappingChange: tracks.setRoadSnapping,
          riverSnapping: tracks.riverSnapping,
          onRiverSnappingChange: tracks.setRiverSnapping,
          error: tracks.error || annotations.error,
          style: tracks.style,
          onStyle: tracks.setStyle,
          onSelectMarker: id => annotations.items.some(item => item.id === id) && annotations.select(id),
          selectedTrack: !editor.session && selectedTrack ? { id: selectedTrack.id, name: selectedTrack.name } : null,
          editingTrack: !!editor.session,
          onBackEditor: backEditor,
          onEditSelectedTrack: () => {
            const track = tracks.saved.find(item => item.id === tracks.selectedId);
            if (track) beginRouteEdit(track);
          },
          onDeleteSelectedTrack: () => {
            const track = tracks.saved.find(item => item.id === tracks.selectedId);
            if (!track || !tracks.remove(track.id)) return false;
            setTrackLinePoint(null);
            return true;
          },
        }}>
        <TerrainMap
          mapSource={mapSources.source}
          onSourceStatus={mapSources.setStatus}
          ref={map}
          section={mapSection}
          sectionItems={mapSections}
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
          }}
          onCameraMoveStart={() => setQuickAdd(null)}
          onCenter={setMapCenter}
          onSatellite={setSatellite}
          onGeology={setGeology}
          routeOverlay={plannedEdit.current && editor.session ? { ...routeDisplay.route, route: null } : routeDisplay.route}
          guidanceOverlay={guidanceOverlay}
          trackOverlay={routeDisplay.tracks}
          areaOverlay={areaOverlay}
          onModelTerrainStatus={setModelTerrainStatus}
          onAreaSelect={(id) => {
            if (focusLock.locked) return;
            if (editor.session || !switchFromSection()) return;
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
          collectionPreviewActive={panel === 'favorites' && !boxSelecting && collectionSelectedKeys.length === 0}
          photos={photoOverlay}
          onPhotoSelect={(ids) => {
            if (survey.active && survey.picking) {
              const photo = linkedPhotos.find((p) => p.id === ids[0]);
              if (photo) survey.pick(photo.coordinates);
              return;
            }
            if (!switchFromSection()) return;
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
          positionHeading={markerHeading}
          onBrowse={userBrowse}
          onManualRotate={position.free}
          annotations={mapAnnotations}
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
            survey.picking || survey.dragging || survey.markerTarget,
          )}
          onTrackSelect={(id) => {
            if (focusLock.locked || !switchFromSection()) return;
            if (id.startsWith('favorite:')) {
              if (!editor.session) openFavoriteRoute(id);
            } else if (!editor.session) openRoute(id);
          }}
          onRouteSelect={() => {
            if (!navigation.route || focusLock.locked || !switchFromSection()) return;
            requestComparisonExit(() => {
              tracks.select(null);
              annotations.select(null);
              areas.select(null);
              setTrackLinePoint(null);
              setPanel('route');
            });
          }}
          onTrackLineSelect={point => { if (!focusLock.locked && switchFromSection()) selectLinePoint(point); }}
          onTrackNodeSelect={(node) => {
            if (!switchFromSection()) return;
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
              else if (node.trackId === editor.session.track.id) {
                setRouteNodeSelection([node.coordinate]);
                editor.change((value) =>
                  selectEditNode(value, node.coordinate),
                );
              }
              return;
            }
            selectLinePoint({
              trackId: node.trackId,
              coordinate: node.coordinate,
              distance: markerChainage(
                node.trackId === DRAFT_ID
                  ? tracks.draft
                  : tracks.saved.find((t) => t.id === node.trackId)?.segments ?? [],
                node.coordinate,
              ).distance,
            });
          }}
          onDragBegin={(target) => {
            if (!switchFromSection()) return;
            position.free();
            follow.pause();
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
              if (annotations.edit && !annotations.saveEdit()) return;
              setAnnotationTab('basic');
              setAdjustingPinId(null);
              tracks.select(null);
            }
            setPanel(null);
          }}
          onDragPreview={setFeatureMove}
          onDragCommit={({ target, coordinate, snappedNode }) => {
            if (target.kind === 'track' && editor.session) {
              const moved = editor.change((value) =>
                moveEditNode(
                  value,
                  target.node.coordinate,
                  coordinate,
                  snappedNode
                    ? tracks.saved.find((t) => t.id === snappedNode.trackId)
                    : undefined,
                  target.node.controlMove,
                ),
              );
              if (moved) setRouteNodeSelection(points => {
                if (!target.node.controlMove) return moveSelectedPoints(points, target.node.coordinate, coordinate);
                const movedPoints = visibleNodeMoves(target.node.controlMove, coordinate);
                return points.map(point => movedPoints.get(point.join(',')) ?? point);
              });
              setFeatureMove(null);
            } else if (target.kind === 'track') {
              if (tracks.moveNode(target.node, coordinate))
                setActiveTrackNode({ ...target.node, coordinate });
            } else if (target.kind === 'area')
              areas.move(target.id, target.index, coordinate);
            else {
              annotations.move(target.id, coordinate);
              setPanel(null);
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
            if (!switchFromSection()) return;
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
            if (annotations.selected === id && panel === null) {
              setAdjustingPinId(null);
              setPanel('annotations');
              return;
            }
            if (!annotations.select(id)) return;
            tracks.select(
              annotations.items.find((a) => a.id === id)?.trackAnchor
                ?.trackId ?? null,
            );
            tracks.finish();
            navigation.setPicking(null);
            setAdjustingPinId(null);
            setPanel(null);
          }}
          onAnnotationNavigate={(id, slot) => {
            if (!switchFromSection()) return;
            const item = annotations.items.find(annotation => annotation.id === id && annotation.visible);
            if (!item) return;
            navigation.place(slot, {
              name: item.name || '标记位置',
              coordinates: [...item.coordinates],
            });
            follow.pause();
            setPanel('route');
          }}
          onMapHold={(value) => {
            if (
              editor.session ||
              measurement.active ||
              survey.active ||
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
              // Placing a marker does not request a new camera or detail level.
              if (!annotations.place(coordinates)) annotations.setPicking(null);
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
        </MapComparisonHost>
        {routeVisible &&
          railTrack &&
          panel === null &&
          !editor.session &&
          !routeChild &&
          !selectedPhoto &&
          !navigationTarget &&
          !shareTarget && (
            <>
              {(routeWindow === 'card' || routeWindow === 'display') && !guidance.active && !measurement.active && !sectionEditing && <SelectedRouteInfo track={routeWindow === 'display' ? routeDisplay.target ?? railTrack : railTrack} preferences={routeDisplay.preferences} reversed={routeReversed} point={routeProfilePoint} />}
              {routeWindow === 'card' && (
                <>
                <RouteCard
                  key={railTrack.id}
                  track={railTrack}
                  onRename={(name) => tracks.rename(railTrack.id, name)}
                  point={linePoint}
                  alternative={activeAlternative}
                  error={savedNavigationError || tracks.error}
                  onLocateGap={savedNavigationGap ? () => {
                    userBrowse();
                    map.current?.focusRouteGap(savedNavigationGap);
                  } : undefined}
                  onClearError={() => {
                    setSavedNavigationError('');
                    map.current?.clearRouteGap();
                    map.current?.clearRouteIssue();
                  }}
                  onBack={() => {
                    map.current?.clearRouteGap();
                    map.current?.clearRouteIssue();
                    setSavedNavigationError('');
                    tracks.select(null);
                    setTrackLinePoint(null);
                  }}
                  onNavigate={() => {
                    if (railTrack.id !== DRAFT_ID) {
                      navigateTrack(railTrack.id, routeReversed);
                      return;
                    }
                    map.current?.clearRouteIssue();
                    const id = tracks.saveForMarker();
                    if (!id) return;
                    try {
                      navigateFavorite(
                        trackNavigation(
                          { ...railTrack, id },
                          Date.now(),
                          'pedestrian',
                          tracks.saved,
                          activeAlternative,
                          routeReversed,
                          true,
                        ),
                      );
                    } catch (e) {
                      if (e instanceof RouteEndpointRequiredError) {
                        map.current?.focusRouteIssue(e.target, e.targetKind);
                        setSavedNavigationError(e.targetKind === 'fork'
                          ? '已定位一处分叉点。请在线路编辑中选择目标终点并设为终点。'
                          : '路线终点未指定，已定位末端候选节点。请进入线路编辑，点选节点并设为终点。');
                        return;
                      }
                      if (e instanceof RouteDisconnectedError) {
                        setDisconnectedNavigationError(e);
                        return;
                      }
                      setSavedNavigationError(
                        e instanceof Error ? e.message : '无法导航',
                      );
                    }
                  }}
                  onMarker={() => setRouteWindow('marker')}
                  onEdit={() => beginRouteEdit(railTrack)}
                  onDetails={() => setRouteWindow('details')}
                  onDisplay={() => { routeDisplay.choose(railTrack.id); setRouteWindow('display'); }}
                  onDelete={railTrack.id === DRAFT_ID ? undefined : () => {
                    if (!tracks.remove(railTrack.id)) return false;
                    setTrackLinePoint(null);
                    return true;
                  }}
                />
                </>
              )}
              {routeWindow === 'display' && (
                <RouteDisplaySettings display={routeDisplay} onClose={() => setRouteWindow('card')} />
              )}
              {routeWindow === 'details' && (
                <RouteDetails
                  onAppearance={(style) => {
                    let ok = true;
                    if (railTrack.id === DRAFT_ID) tracks.setStyle(style);
                    else ok = tracks.updateStyle(railTrack.id, style);
                    if (ok && (style.color !== railTrack.style?.color || style.colorMode !== railTrack.style?.colorMode)) routeDisplay.update({ mode: 'original' });
                    return ok;
                  }}
                  sourceName={tracks.saved.find(t => railTrack.sourceTrackIds?.includes(t.id) && t.source === 'recorded')?.name}
                  onSource={tracks.saved.some(t => railTrack.sourceTrackIds?.includes(t.id) && t.source === 'recorded') ? () => { const source = tracks.saved.find(t => railTrack.sourceTrackIds?.includes(t.id) && t.source === 'recorded'); if (source) openRoute(source.id); } : undefined}
                  key={railTrack.id}
                  track={railTrack}
                  onRename={(name) => tracks.rename(railTrack.id, name)}
                  onShowMetric={(mode) => { routeDisplay.choose(railTrack.id); routeDisplay.update({ mode, legend: true }); setRouteWindow('card'); }}
                  alternative={activeAlternative}
                  onCondition={(color, value) =>
                    tracks.setColorCondition(railTrack.id, color, value)
                  }
                  markers={annotations.items}
                  photos={photos.items}
                  onBack={() => setRouteWindow('card')}
                  onHide={() => {
                    tracks.showTrack(railTrack.id, !!railTrack.hidden);
                  }}
                  onShare={(routeForShare) => shareTrackById(railTrack.id, routeForShare)}
                  onPointShare={(place) => openPlaceShareDialog({ place })}
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
        {!comparison && routeEditorOverlay}
        <FreeMapCredit id={mapSources.selected} />
        {quickAdd && (
          <QuickAdd
            onShare={() => { openPlaceShareDialog({ place: { name: '地图位置', coordinates: [...quickAdd.coordinate] } }); setQuickAdd(null); }}
            onArea={startArea}
            at={quickAdd}
            centered={quickAdd.fromCenter === true}
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
        <CenterReticle />
        <TrackDrawing
          ref={drawing}
          committedSegments={editor.session?.track.segments}
          waitForCommit={(receipt, done) => map.current?.waitForTrackRender(receipt, done) ?? (() => {})}
          distanceSegments={branchEditing ? [editor.session!.track.segments[editor.session!.branch!]] : tracks.draft}
          enabled={
            !comparison && (branchEditing || tracks.drawing) &&
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
          toScreen={drawingToScreen}
          getSnapViewport={drawingSnapViewport}
          magnify={(canvas, point) =>
            map.current?.magnify(canvas, point) ?? (() => {})
          }
          onAnchor={branchEditing ? () => {} : (point) => {
            if (!continueAtVisibleTrack(point)) tracks.setAnchor(point);
          }}
          onVertex={branchEditing ? drawBranchVertex : (point, section) => {
            if (section?.length || !continueAtVisibleTrack(point))
              tracks.addVertex(point, section);
          }}
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
              display={routeDisplay}
              onLocate={(point) => map.current?.focusPoint(point)}
              onFinish={() => {
                if (tracks.complete()) setRouteWindow('card');
              }}
            />
          )}
        {tracks.drawing &&
          !areas.drawing &&
          panel === null &&
          !guidance.active &&
          !measurement.active &&
          !survey.active &&
          !sectionEditing &&
          routeDisplay.target?.id === DRAFT_ID &&
          routeDisplay.target.segments.some((line) => line.length >= 2) && (
            <SelectedRouteInfo
              track={routeDisplay.target}
              preferences={routeDisplay.preferences}
              reversed={false}
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
        <header className="home-topbar">
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
          {!comparison && placeSearch}
          <span className="map-load-status" role="status">
            {mapStatus}
          </span>
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
        ) : null}
        {guidance.active &&
          !editor.session &&
          !sectionEditing &&
          !annotations.picking &&
          navigation.picking === null &&
          !quickAdd &&
          !tracks.editing && (
          <GuidanceCard
              displayPanel={navigationDisplayOpen && !panel && !rallyMode && !quickAdd && !measurement.active
                ? <RouteDisplaySettings display={routeDisplay} embedded navigating onClose={() => setNavigationDisplayOpen(false)} /> : undefined}
              onCloseDisplay={() => setNavigationDisplayOpen(false)}
              telemetry={guidance.session && <NavigationTelemetry session={guidance.session} fix={displayedFix} />}
              onRally={() => { setPanel(null); setRallyMode(true); }}
              onDisplay={() => {
                setPanel(null);
                routeDisplay.choose('display-planned-route');
                setNavigationDisplayOpen(true);
              }}
              onShare={() => {
                const s = guidance.session;
                if (s)
                  openRouteShareDialog(
                    sharePlanned(
                      s.route,
                      s.route.name?.trim() || '当前导航全程',
                      s.departureLength > 0,
                    ),
                  );
              }}
              guidance={guidance}
              following={follow.following}
              onStop={stopNavigation}
              onFollow={resumeNavigation}
              onShow={() => {
                if (guidance.rejoin) {
                  follow.pause();
                  map.current?.fitRoute(guidance.rejoin.route.coordinates);
                }
              }}
            />
          )}
        {guidance.session && !rallyMode && !panel && !measurement.active && !sectionEditing && <NavigationTelemetry session={guidance.session} fix={displayedFix} elevation display={routeDisplay} />}
        {rallyMode && navigation.route && <RallyNavigation
          display={routeDisplay}
          route={guidance.session?.route ?? navigation.route} guidance={guidance} fix={displayedFix}
          onNormal={() => setRallyMode(false)} onStart={startGuidance} onStop={stopNavigation}
          onLocate={() => { userBrowse(); if (displayedFix) map.current?.focusPoint(displayedFix.coordinates); else position.locate(); }}
          onOverview={() => { userBrowse(); map.current?.fitCollection((guidance.session?.route ?? navigation.route!).coordinates, { top: 30, right: 20, bottom: 30, left: 20 }); }}
        />}
        <div
          className="map-legends"
          hidden={panel !== 'layers' && !layers.elevationColors && !layers.geology}
        >
          {layers.geology && (
            <GeologyPanel
              state={geology}
              source={layers.geologySource}
              onSource={(geologySource) => update({ geologySource })}
              onRetry={() => map.current?.refreshGeology()}
            />
          )}
        </div>
        {(position.directionError || (position.direction === 'motion' && motionHeading.status) || (position.showStatus && displayedFix?.provider === 'ip') ||
          (!guidance.active &&
            (position.locationError || position.locating))) &&
          !panel && (
            <div className="position-status glass" role="status">
              <span>
                {position.locationError ||
                  position.directionError ||
                  (position.locating ? '正在获取当前位置…' : displayedFix?.provider === 'ip' ? `${position.fallbackReason || '系统定位不可用'}，已用IP估计位置；可能偏离实际地点。${position.direction === 'motion' ? 'IP定位不能提供运动朝向。' : ''}` : position.direction === 'motion' ? motionHeading.status : '')}
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
            onTwoFingerMove={(previous, next) => map.current?.panZoomGesture(previous, next)}
            onTwoFingerEnd={() => map.current?.finishPanZoomGesture()}
            onResultAction={(action, keys) => {
              setCollectionSelectedKeys(keys);
              setBoxSelectionAction(action);
              setPanel('favorites');
            }}
            resumeToken={boxSelectionResumeToken}
            selected={collectionSelectedKeys}
            onChange={keys => {
              setCollectionSelectedKeys(keys);
              if (keys.length) setPanel('favorites');
            }}
            onExit={() => {
              setBoxSelecting(false);
              setCollectionSelectedKeys([]);
              setCollectionOutputKey(null);
              setBoxSelectionAction(null);
              setPanel(null);
            }}
          />
        )}
        <MapActions
          boxSelecting={boxSelecting}
          favoriteControl={panel === null && !comparison && !focusLock.locked && !editor.session && !featureMove && !areas.drawing && !(areas.selected && areaEditing) && !tracks.drawing && !measurement.active && !sectionEditing ? <FavoriteSourceSwitcher
            choices={sourceChoices} currentId={favoriteSourceId} onOpenChange={setFavoriteSourceOpen}
            onSelect={id => {
              const choice = sourceChoices.find(item => item.id === id);
              if (!choice) return;
              selectBasemapSource(choice.settings, choice.source?.id ?? '');
            }}
            onManage={() => { setSourcesParent('layers'); setPanel('sources'); }}
          /> : undefined}
          markControl={canAddCenterMarker ? <CenterMarkButton map={() => map.current} target={linePoint?.coordinate} onAdd={(coordinates) => {
            if (focusLock.locked) focusLock.toggle();
            map.current?.stop();
            position.free();
            follow.pause();
            tracks.select(null);
            areas.select(null);
            setProfileOpen(false);
            if (annotations.add('pin', coordinates)) {
              setAnnotationTab('basic');
              setPanel('annotations');
            }
          }} /> : undefined}
          elevationControl={layers.elevationColors ? <ElevationLegend /> : undefined}
          layerControl={<RasterLevelControl name={rasterName} level={layers.rasterLevel ?? null} minLevel={Math.max(1, mapSources.source?.minzoom ?? 1)} maxLevel={rasterMaxLevel} availableLevel={Math.min(rasterMaxLevel, Math.floor(view.zoom + Math.log2(512 / (mapSources.source?.tileSize ?? 256))))} onLevel={rasterLevel => update({ rasterLevel })} onSources={() => { setSourcesParent('layers'); setPanel('sources'); }} opacity={layers.roadsOpacity ?? 1} onOpacity={roadsOpacity => update({ roadsOpacity })} />}
          viewControl={
            <CameraGizmo
              view={view}
              onGestureView={(pitch, bearing, phase) => {
                if (phase !== 'cancel') {
                  follow.pause();
                  position.free();
                  if (pitch > 0 && !layers.terrain && !section.enabled)
                    update({ terrain: true });
                }
                map.current?.viewGesture(pitch, bearing, phase);
              }}
              onView={(pitch, bearing) => {
                follow.pause();
                position.free();
                if (pitch > 0 && !layers.terrain && !section.enabled)
                  update({ terrain: true });
                map.current?.view(pitch, bearing, false);
              }}
            />
          }
          onOverview={railTrack ? () => {
            userBrowse();
            map.current?.fitRoute(railTrack.segments.flat());
          } : undefined}
          compact={panel === 'favorites'}
          onBoxSelect={() => {
            if (boxSelecting) {
              setBoxSelecting(false);
              setCollectionSelectedKeys([]);
              setCollectionOutputKey(null);
              setBoxSelectionAction(null);
              setPanel(null);
              return;
            }
            userBrowse();
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
            cancelStartupCamera();
            follow.resume();
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
          onZoom={(amount) => {
            cancelStartupCamera();
            map.current?.zoom(amount);
          }}
          onNorth={() => {
            cancelStartupCamera();
            position.north();
            map.current?.north();
          }}
          onLocate={toggleMapFollowing}
          onLocateAndFollow={locateAndFocus}
          directionStatus={position.direction === 'motion' ? motionHeading.status : position.directionError}
          onDirection={changeMapDirection}
          following={follow.following}
          tracking={isPositionTracking(follow.following, follow.waiting, position.locationError, cameraFix)}
          locationError={position.locationError}
          followBlocked={follow.blocked}
          locating={
            (follow.following && follow.waiting) ||
            (recorder.record.phase !== 'recording' && position.locating)
          }
          watching={position.watching}
          onStopLocation={() => {
            cancelStartupCamera();
            guidance.stop();
            follow.pause();
            position.stopLocation();
          }}
          direction={position.direction}
          onDimension={() => {
            const terrain = !layers.terrain;
            update({ terrain });
            const camera = map.current?.cameraSnapshot();
            if (camera) saveLastView({ ...camera, pitch: terrain ? 62 : 0, terrain });
            map.current?.view(terrain ? 62 : 0, view.bearing, false);
            map.current?.syncCameraHash();
          }}
        />
        {!desktopShell && panel === null &&
          !survey.active &&
          !sectionEditing &&
          !tracks.drawing &&
          !editor.session &&
          !quickAdd &&
          !annotations.picking &&
          !areas.drawing &&
          !areas.selected &&
          navigation.picking === null && (
            <RecordingQuickAction
              recorder={recorder}
              onDetails={() => { setOutdoorRecording(true); setPanel('outdoor'); }}
            />
          )}
        {selectedAnnotation &&
          (panel === 'annotations' || annotations.selectionRequest) &&
          !annotations.picking && (
            renderMarkerWorkspace(() => {
                setAdjustingPinId(null);
                if (annotations.select(null)) {
                  setPanel(null);
                  tracks.select(null);
                  setActiveTrackNode(null);
                  setTrackLinePoint(null);
                }
              })
          )}
        <ControlDock
          industryEnabled={showIndustryToolsEntry(INDUSTRY_TOOLS_ENABLED)}
          showRecordingEntry={!desktopShell}
          onArea={TERRAIN_SECTION_ENABLED ? startArea : undefined}
          onCompare={() => {
            const camera = map.current?.cameraSnapshot();
            if (!camera) return;
            map.current?.stop();
            follow.pause();
            position.free();
            tracks.pause();
            setRallyMode(false);
            setQuickAdd(null);
            setPanel(null);
            setComparison({ camera, choices: comparisonChoices(layers, mapSources.source, rasterName, mapSources.maps) });
          }}
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
          keepOpenOnMapInteraction={panel !== null}
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
          drawingActive={panel === null && tracks.drawing}
          title={panel === 'industry' ? '行业工具' : panel === 'sources' ? sourcesNavigation?.title : undefined}
          titleContent={panel === 'route' && navigation.route ? <RouteNameInput
            key={navigation.route.createdAt}
            name={navigation.route.name || defaultRouteName({ name: navigation.start?.name || '起点' }, { name: navigation.end?.name || '终点' })}
            onSave={name => !!navigation.route && favorites.rename(navigation.route, name) && navigation.rename(name)}
          /> : undefined}
          onHide={panel === 'route' && navigation.route ? () => navigation.setVisible(!navigation.visible) : undefined}
          hideLabel={navigation.visible ? '隐藏' : '显示'}
          back={
            selectedAnnotation && panel === 'route'
              ? {
                  label: '返回标记',
                  onClick: () => {
                    navigation.setPicking(null);
                    setPanel('annotations');
                  },
                }
              : panel === 'industry'
                ? { label: '返回工具', onClick: () => setPanel('tools') }
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
            setSectionListOpen(false);
            if (next !== 'annotations') setAdjustingPinId(null);
            if (next !== panel) setCollectionSelectedKeys([]);
            measurement.close();
            if (
              annotations.edit &&
              next !== 'annotations' &&
              !annotations.select(null)
            )
              return;
            if (boxSelecting && next !== 'favorites') {
              setBoxSelecting(false);
              setCollectionSelectedKeys([]);
              setCollectionOutputKey(null);
              setBoxSelectionAction(null);
            }
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
              if (next !== 'track') tracks.pause();
              navigation.setPicking(null);
              annotations.setPicking(null);
            }
            if (next === 'track') {
              if (routeChild) {
                setRouteChild(false);
                annotations.select(null);
              }
              tracks.start();
              setPanel(null);
              return;
            }
            setPanel(next);
          }}
        >
          {mountIndustryToolsPanel(INDUSTRY_TOOLS_ENABLED, panel) && <IndustryTools state={industryToolsState} onStateChange={setIndustryToolsState} />}
          {panel === 'sources' && (
            <MapSourcesPanel
              incomingFile={incomingRoute.mapSource}
              onIncomingConsumed={incomingRoute.dismissMapSource}
              settings={layers}
              onSettings={patch=>{
                const result = sourcePanelSettings(patch, layers);
                if (result.sourceChanged) mapSources.select('');
                update(result.settings);
              }}
              onRouteQr={(text) => {
                setPanel(null);
                setRouteQr(text);
              }}
              onNavigation={setSourcesNavigation}
              sources={mapSources}
              builtin={!layers.satellite ? 'terrain' : layers.imageryMode}
              onBuiltin={(id) => {
                mapSources.select('');
                const target = applyLayerPatch(layers, {
                  offlineBasemap: false,
                  satellite: id !== 'terrain',
                  satelliteProvider: 'sentinel',
                  ...(id !== 'terrain' ? { imageryMode: id } : {}),
                });
                update(settingsForBasemapSource(target, layers));
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
              onImport={openRouteImportDialog}
              key={outdoorPhotos?'photos':'record'}
              initialTab={desktopShell || outdoorPhotos ? 'photos' : 'record'}
              recordingEnabled={!desktopShell}
              locationStatus={position.locationError || (position.locating ? '正在定位…' : displayedFix && Date.now() - displayedFix.timestamp < 30000 ? `定位估计误差 ±${Math.round(displayedFix.accuracy)} 米` : '当前位置尚未定位，点标记可获取位置')}
              onMarkCurrent={() => {
                if (!displayedFix || Date.now() - displayedFix.timestamp >= 30000) {
                  position.locate();
                  return '正在获取当前位置，定位后再点标记。';
                }
                if (!annotations.add('pin', displayedFix.coordinates)) return '无法新增标记，请检查标记数量或存储空间。';
                tracks.pause();
                areas.select(null);
                setQuickAdd(null);
                setProfileOpen(false);
                setPanel('annotations');
                return '';
              }}
              tracks={tracks.saved}
              selectedId={tracks.selectedId}
              recorder={recorder}
              onSavedTrack={tracks.select}
              onTrackRemapped={photos.remapTrack}
              returnPanel={
                <ReturnPanel
                  tracks={tracks.saved}
                  record={recorder.record}
                  fix={position.fix}
                  center={mapCenter ?? [point.lng, point.lat]}
                  markers={annotations.items}
                  onRemember={(p, defaults) =>
                    annotations.add('pin', p, undefined, defaults)
                  }
                  onNavigate={navigateFavorite}
                  onShow={(points) => {
                    map.current?.fitRoute(points);
                    setPanel(null);
                  }}
                />
              }
              photos={
                <PhotoPanel
                  tracks={photoTracks}
                  preferred={recorder.record.phase !== 'idle' ? recorder.record.id : tracks.selectedId}
                  folderReady={recorder.record.phase === 'idle' || recorder.record.phase === 'finished'}
                  cameraPosition={displayedFix}
                  liveTrackId={recorder.record.phase !== 'idle' ? recorder.record.id : null}
                  onRequestLocation={position.locate}
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
                map.current?.focusPoint(coordinates);
                setPanel(null);
              }}
            />
          )}
          {panel === 'favorites' && (
            <CollectionsPanel
              onImportedData={data => {
                follow.pause(); position.free();
                const track = data.tracks[0];
                if (track) {
                  tracks.pause(); tracks.select(track.id); tracks.setVisible(true);
                  setActiveTrackNode(null); annotations.select(null); areas.select(null);
                  map.current?.fitRoute(track.segments.flat());
                  setPanel(null);
                } else {
                  const points = data.favorites[0]?.route.coordinates ?? [...data.annotations.map(a=>a.coordinates), ...(data.areas??[]).flatMap(a=>a.boundary)];
                  if (points.length) map.current?.fitRoute(points);
                  setPanel('favorites');
                }
                setMapStatus(`已导入 ${data.tracks.length} 条轨迹、${data.annotations.length} 个标记、${data.areas?.length??0} 个区域；可在收藏查看`);
              }}
              mapCenter={map.current?.centerCoordinate() ?? mapCenter ?? INITIAL_VIEW.center}
              onLocate={(entry) => {
                preserveFavoritesFocus();
                position.free();
                follow.pause();
                if (entry.kind === 'route' && navigation.restore(entry.route)) {
                  tracks.select(null);
                  annotations.select(null);
                  areas.select(null);
                  setTrackLinePoint(null);
                  map.current?.fitCollection(collectionPreviewPoints(entry));
                  setPanel('route');
                  return;
                }
                if (entry.kind === 'track') tracks.select(entry.track.id);
                map.current?.fitCollection(collectionPreviewPoints(entry));
              }}
              onClose={() => {
                if (boxSelecting) {
                  setBoxSelecting(false);
                  setCollectionSelectedKeys([]);
                  setCollectionOutputKey(null);
                  setBoxSelectionAction(null);
                }
                setPanel(null);
              }}
              onReselect={keys => { setPanel(null); setCollectionSelectedKeys(keys); setBoxSelecting(true); setBoxSelectionResumeToken(token => token + 1); }}
              initialOutputKey={collectionOutputKey}
              initialSelectedKeys={collectionSelectedKeys}
              initialSelectionAction={boxSelectionAction}
              onSelectionActionHandled={() => setBoxSelectionAction(null)}
              photos={photos.items}
              areas={areas.items}
              measurements={measurement.saved.items}
              onMeasurement={(id) => {
                const item = measurement.saved.items.find((m) => m.id === id);
                if (!item) return;
                preserveFavoritesFocus();
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
                  preserveFavoritesFocus();
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
                preserveFavoritesFocus();
                annotations.select(id);
                tracks.select(null);
                setProfileOpen(false);
                map.current?.focusPoint(
                  item.coordinates,
                );
                setPanel('annotations');
              }}
              onSection={(id) => {
                preserveFavoritesFocus();
                setPanel(null);
                openSection(id);
              }}
              onShareRoute={(favorite) =>
                openRouteShareDialog(sharePlanned(favorite.route, favorite.name))
              }
              onShareTrack={shareTrackById}
              favorites={favorites}
              tracks={tracks}
              onNavigateRoute={navigateFavorite}
              onNavigateTrack={navigateTrack}
              navigationError={savedNavigationError}
              onRoute={(favorite) => {
                preserveFavoritesFocus();
                if (!navigation.restore(favorite)) return;
                map.current?.fitRoute(favorite.route.coordinates);
                setPanel('route');
              }}
              onTrack={(id) => {
                preserveFavoritesFocus();
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
              onImport={openRouteImportDialog}
              onEditPoints={editPlannedPoints}
              onCancel={stopNavigation}
              onRally={() => { setPanel(null); setRallyMode(true); }}
              onShare={() => {
                if (navigation.route)
                  openRouteShareDialog(sharePlanned(navigation.route));
              }}
              navigation={navigation}
              onRouteApplied={onRouteApplied}
              onStartNavigation={startGuidance}
              navigating={guidance.active}
              guidanceError={guidance.error}
              near={mapCenter ?? [point.lng, point.lat]}
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
                map.current?.fitCollection(route.coordinates, { top: 100, right: 64, bottom: 230, left: 24 });
                setPanel('route');
              }}
            />
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
          annotationTab === 'position' &&
          (selectedAnnotation.kind !== 'pin' || adjustingPinId === selectedAnnotation.id) ? (
            <ObjectGizmo
              key={`annotation-gizmo:${selectedAnnotation.id}`}
              name={selectedAnnotation.name || '标记'}
              kind={selectedAnnotation.kind}
              pose={selectedPose}
              pinGroundElevation={(coordinates) => {
                const ground = map.current?.groundElevation(coordinates);
                return ground == null ? null : ground * layers.exaggeration;
              }}
              hideToolbar={panel === 'annotations'}
              watchProjection={watchObjectProjection}
              onLocate={() =>
                map.current?.focusPoint(
                  selectedAnnotation.coordinates,
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
              onClose={() => { setAdjustingPinId(null); setPanel('annotations'); }}
              showPositionReadout
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
        {placeShareTarget && <PlaceShare place={placeShareTarget.place} onClose={() => setPlaceShareTarget(null)} onExport={placeShareTarget.markerId ? () => { setCollectionOutputKey(`annotation:${placeShareTarget.markerId}`); setPlaceShareTarget(null); setPanel('favorites'); } : undefined} />}
        {shareTarget && (
          <RouteShare
            data={shareTarget}
            photos={photos.items}
            onClose={() => setShareTarget(null)}
          />
        )}
        {(routeImportOpen || incomingRoute.incoming) && <RouteImportDialog
          files={incomingRoute.incoming?.files}
          error={incomingRoute.incoming?.error}
          status={incomingRoute.incoming?.status}
          onClose={() => { setRouteImportOpen(false); incomingRoute.dismiss(); }}
          onImported={data => {
            setRouteImportOpen(false); incomingRoute.dismiss();
            follow.pause(); position.free();
            const track = data.tracks[0];
            if (track) {
              tracks.pause(); tracks.select(track.id); tracks.setVisible(true);
              setActiveTrackNode(null); annotations.select(null); areas.select(null);
              map.current?.fitRoute(track.segments.flat());
              setPanel(null);
            } else {
              const points = data.favorites[0]?.route.coordinates ?? [...data.annotations.map(a=>a.coordinates), ...(data.areas??[]).flatMap(a=>a.boundary)];
              if (points.length) map.current?.fitRoute(points);
              setPanel('favorites');
            }
            setMapStatus(`已导入 ${data.tracks.length} 条轨迹、${data.annotations.length} 个标记、${data.areas?.length??0} 个区域；可在收藏查看`);
          }} />}
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
      </main>
      </CurrentMapContext.Provider>
    </TextSuggestions.Provider>
  );
}
