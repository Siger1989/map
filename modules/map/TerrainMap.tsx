'use client';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { Map } from 'maplibre-gl';
import { addContours, baseStyle } from '../terrain/terrain';
import { readElevation } from '../terrain/elevation';
import {
  loadLatestSatellite,
  type SatelliteState,
} from '../satellite/satellite';
import type { WeatherLayer } from '../weather/WeatherLayer';
import type { WeatherData } from '../weather/data';
import { addCartography, syncCartography } from '../cartography/cartography';
import { GeologyLayer } from '../geology/GeologyLayer';
import type { GeologyState } from '../geology/data';
import { RouteLayer } from '../navigation/RouteLayer';
import type { Coordinate, RouteOverlay } from '../navigation/types';
import { coordinate } from '../navigation/types';
import { TrackLayer, type TrackOverlay } from '../tracks/TrackLayer';
import type { ScreenPoint } from '../tracks/drawing';
import {
  DrawingGestureBridge,
  type DrawingInput,
} from '../tracks/DrawingGestureBridge';
import { observeMagnifier } from './magnifier';
import { snapMapRoad } from './roadSnap';
import {
  FeatureDragBridge,
  type DragTarget,
  type FeatureMove,
} from './FeatureDragBridge';
import type { RoadSnapper } from '../tracks/roadSnapping';
import type { AnnotationLayer } from '../annotations/AnnotationLayer';
import type { Annotation } from '../annotations/data';
import { PlaneSectionLayer } from '../section/PlaneSectionLayer';
import { TerrainClip } from '../section/terrainClip';
import { TERRAIN_SECTION_ENABLED } from '../../config/features';
import type { SectionSettings, SectionStatus } from '../section/types';
import { basemapConfiguration } from '../cartography/basemaps';
import { PositionLayer } from '../position/PositionLayer';
import type { PositionFix } from '../position/types';
import {
  INITIAL_VIEW,
  type LayerSettings,
  type Point,
  type ViewState,
} from './types';
export type MapHandle = {
  sectionCenter: () => {
    center: [number, number];
    altitude: number;
    width: number;
    heading: number;
  } | null;
  refreshSection: () => void;
  snapRoad: RoadSnapper;
  zoom: (amount: number) => void;
  north: () => void;
  reset: () => void;
  view: (pitch: number, bearing: number, animate?: boolean) => void;
  refreshSatellite: () => void;
  refreshGeology: () => void;
  inspect: () => unknown;
  focusPoint: (coordinates: Coordinate, zoom?: number) => void;
  fitRoute: (coordinates: Coordinate[]) => void;
  toCoordinate: (point: ScreenPoint) => Coordinate | null;
  stop: () => void;
  toScreen: (coordinate: Coordinate) => ScreenPoint | null;
  magnify: (target: HTMLCanvasElement, point: ScreenPoint) => () => void;
};
type Props = {
  section: SectionSettings;
  onSectionStatus: (status: SectionStatus) => void;
  onSectionChange: (settings: SectionSettings) => void;
  settings: LayerSettings;
  onPoint: (point: Point) => void;
  onStatus: (status: string) => void;
  onView: (view: ViewState) => void;
  onAnchor: (anchor: [number, number]) => void;
  onSatellite: (satellite: SatelliteState) => void;
  onGeology: (state: GeologyState) => void;
  weather: WeatherData | null;
  hourIndex: number;
  routeOverlay: RouteOverlay;
  onMapPick: (coordinates: Coordinate) => void;
  trackOverlay: TrackOverlay;
  drawingActive: boolean;
  onDrawingInput: (event: DrawingInput) => void;
  position: PositionFix | null;
  onManualRotate: () => void;
  annotations: Annotation[];
  annotationSelected: string | null;
  onAnnotationSelect: (id: string) => void;
  roadSnapping: boolean;
  pickingActive: boolean;
  onTrackSelect: (id: string) => void;
  onDragBegin: (target: DragTarget) => void;
  onDragPreview: (move: FeatureMove | null) => void;
  onDragCommit: (move: FeatureMove) => void;
};
export const TerrainMap = forwardRef<MapHandle, Props>(
  function TerrainMap(props, ref) {
    const { settings, onPoint, onStatus } = props;
    const container = useRef<HTMLDivElement>(null);
    const mapRef = useRef<Map | null>(null);
    const latest = useRef(props);
    latest.current = props;
    const weatherRef = useRef<WeatherLayer | null>(null);
    const geologyRef = useRef<GeologyLayer | null>(null);
    const routeRef = useRef<RouteLayer | null>(null);
    const trackRef = useRef<TrackLayer | null>(null);
    const drawingRef = useRef<DrawingGestureBridge | null>(null);
    const featureDragRef = useRef<FeatureDragBridge | null>(null);
    const positionRef = useRef<PositionLayer | null>(null);
    const annotationRef = useRef<AnnotationLayer | null>(null);
    const sectionRef = useRef<PlaneSectionLayer | null>(null);
    const sectionClipRef = useRef<TerrainClip | null>(null);
    const satelliteAbort = useRef<AbortController | null>(null);
    const terrainAbort = useRef<AbortController | null>(null);
    const loaded = useRef(false);
    const domestic = basemapConfiguration().domestic;
    const syncSatellite = () => {
      const map = mapRef.current;
      if (!map || !loaded.current) return;
      satelliteAbort.current?.abort();
      const abort = new AbortController();
      satelliteAbort.current = abort;
      const center = map.getCenter();
      if (map.getLayer('satellite')) map.removeLayer('satellite');
      if (map.getSource('satellite')) map.removeSource('satellite');
      if (
        domestic ||
        !latest.current.settings.satellite ||
        latest.current.settings.imageryMode !== 'latest'
      ) {
        latest.current.onSatellite({
          date: '',
          ready: false,
          status: domestic
            ? '天地图地表影像，非实时云况；拍摄日期由图源提供'
            : '选择最新云况影像时获取卫星观测',
        });
        return;
      }
      latest.current.onSatellite({
        date: '',
        ready: false,
        status: '正在检查当前位置最新可用卫星影像…',
      });
      loadLatestSatellite(map, center.lng, center.lat, abort.signal)
        .then((result) => {
          if (!abort.signal.aborted) {
            latest.current.onSatellite(result);
            sync();
          }
        })
        .catch((e) => {
          if (!abort.signal.aborted)
            latest.current.onSatellite({
              date: '',
              ready: false,
              status: e instanceof Error ? e.message : '卫星影像暂不可用',
            });
        });
    };
    const sync = () => {
      const map = mapRef.current;
      if (!map || !loaded.current) return;
      const s = latest.current.section.enabled
        ? {
            ...latest.current.settings,
            terrain: true,
            exaggeration: 1,
            clouds: false,
            rain: false,
            geology: false,
            contours: false,
            elevationColors: false,
            roads: false,
            labels: false,
          }
        : latest.current.settings;
      if (!domestic || latest.current.roadSnapping) addCartography(map);
      const terrain = map.getTerrain();
      if (
        !latest.current.section.enabled &&
        (s.terrain
          ? !terrain ||
            terrain.source !== 'elevation' ||
            terrain.exaggeration !== s.exaggeration
          : Boolean(terrain))
      )
        map.setTerrain(
          s.terrain
            ? { source: 'elevation', exaggeration: s.exaggeration }
            : null,
        );
      for (const id of ['contours', 'contour-labels'])
        if (map.getLayer(id))
          map.setLayoutProperty(
            id,
            'visibility',
            s.contours ? 'visible' : 'none',
          );
      if (map.getLayer('elevation-colors'))
        map.setLayoutProperty(
          'elevation-colors',
          'visibility',
          s.elevationColors ? 'visible' : 'none',
        );
      for (const id of ['relief', 'detail', 'satellite'])
        if (map.getLayer(id))
          map.setLayoutProperty(
            id,
            'visibility',
            (
              domestic && id !== 'satellite'
                ? id === 'relief'
                  ? !s.satellite
                  : s.satellite
                : s.satellite &&
                  (id === 'relief' ||
                    (id === 'detail'
                      ? s.imageryMode === 'detail'
                      : s.imageryMode === 'latest'))
            )
              ? 'visible'
              : 'none',
          );
      weatherRef.current?.update(
        latest.current.weather,
        latest.current.hourIndex,
        s,
      );
      syncCartography(
        map,
        domestic
          ? {
              ...s,
              roads: s.roads && latest.current.roadSnapping,
              labels: false,
            }
          : s,
      );
      if (domestic) {
        for (const id of ['road-names', 'road-numbers'])
          if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
        for (const id of ['domestic-labels-image', 'domestic-labels-map'])
          if (map.getLayer(id))
            map.setLayoutProperty(
              id,
              'visibility',
              s.labels && (id.endsWith('image') ? s.satellite : !s.satellite)
                ? 'visible'
                : 'none',
            );
      }
      geologyRef.current?.sync(s);
      routeRef.current?.sync(latest.current.routeOverlay);
      trackRef.current?.sync(latest.current.trackOverlay);
      positionRef.current?.sync(latest.current.position);
      annotationRef.current?.update(
        latest.current.annotations,
        latest.current.annotationSelected,
        s,
      );
      if (map.getLayer('hillshade'))
        map.setLayoutProperty(
          'hillshade',
          'visibility',
          latest.current.section.enabled ? 'none' : 'visible',
        );
      sectionRef.current?.configure(
        latest.current.section,
        latest.current.annotations,
      );
    };
    useImperativeHandle(
      ref,
      () => ({
        sectionCenter: () => {
          const m = mapRef.current;
          if (!m) return null;
          const center = m.getCenter().toArray() as [number, number];
          const metersPerPixel =
            (40075016.68557849 * Math.cos((center[1] * Math.PI) / 180)) /
            (512 * 2 ** m.getZoom());
          return {
            center,
            altitude: Math.round(m.queryTerrainElevation(center) ?? 1500),
            width: Math.max(
              100,
              Math.min(
                200000,
                metersPerPixel * m.getCanvas().clientWidth * 0.6,
              ),
            ),
            heading: m.getBearing(),
          };
        },
        refreshSection: () => sectionRef.current?.refresh(),
        snapRoad: (point, previous) =>
          snapMapRoad(
            mapRef.current,
            point,
            previous,
            latest.current.settings.roads,
          ),
        zoom: (amount) =>
          mapRef.current?.zoomTo((mapRef.current?.getZoom() ?? 9) + amount),
        north: () => mapRef.current?.easeTo({ bearing: 0 }),
        reset: () => mapRef.current?.flyTo(INITIAL_VIEW),
        stop: () => {
          mapRef.current?.stop();
        },
        toScreen: (point) => {
          const projected = mapRef.current?.project(point);
          return projected &&
            Number.isFinite(projected.x) &&
            Number.isFinite(projected.y)
            ? projected
            : null;
        },
        magnify: (target, point) =>
          mapRef.current
            ? observeMagnifier(mapRef.current, target, point)
            : () => {},
        toCoordinate: (point) => {
          const m = mapRef.current;
          if (!m || !loaded.current) return null;
          const p = m.unproject([point.x, point.y]).toArray();
          if (!coordinate(p)) return null;
          const projected = m.project(p);
          return Math.hypot(projected.x - point.x, projected.y - point.y) < 8
            ? p
            : null;
        },
        focusPoint: (center, zoom = 13) =>
          mapRef.current?.flyTo({
            center,
            zoom: Math.max(3, Math.min(20, zoom)),
            duration: 700,
          }),
        fitRoute: (coordinates) => {
          const m = mapRef.current;
          if (!m || !coordinates.length) return;
          const min: Coordinate = [Infinity, Infinity],
            max: Coordinate = [-Infinity, -Infinity];
          for (const c of coordinates) {
            min[0] = Math.min(min[0], c[0]);
            min[1] = Math.min(min[1], c[1]);
            max[0] = Math.max(max[0], c[0]);
            max[1] = Math.max(max[1], c[1]);
          }
          const h = m.getContainer().clientHeight;
          m.fitBounds([min, max], {
            padding: {
              top: Math.min(110, h * 0.2),
              bottom: Math.min(170, h * 0.25),
              left: 78,
              right: 65,
            },
            maxZoom: 14,
            pitch: latest.current.settings.terrain ? 40 : 0,
            bearing: 0,
            duration: 800,
          });
        },
        view: (pitch, bearing, animate = true) =>
          mapRef.current?.easeTo({
            pitch: Math.min(80, Math.max(0, pitch)),
            bearing,
            duration: animate ? 500 : 0,
          }),
        refreshSatellite: syncSatellite,
        refreshGeology: () => geologyRef.current?.retry(),
        inspect: () => {
          const map = mapRef.current;
          if (!map || !loaded.current) return { ready: false };
          return {
            ready: true,
            terrain: map.getTerrain(),
            elevationReady: map.isSourceLoaded('elevation'),
            renderedElevation: map.queryTerrainElevation(map.getCenter()),
            cloudRainLayerReady: Boolean(map.getLayer('cloud-rain-3d')),
            geologyReady: geologyRef.current?.isReady() ?? false,
            center: map.getCenter().toArray(),
            pitch: map.getPitch(),
            bearing: map.getBearing(),
            zoom: map.getZoom(),
            layers: map.getStyle().layers.map((l) => ({
              id: l.id,
              visible: l.layout?.visibility !== 'none',
            })),
          };
        },
      }),
      [],
    );
    useEffect(() => {
      let disposed = false;
      let selected: [number, number] = INITIAL_VIEW.center;
      let weatherAnchor: [number, number] = INITIAL_VIEW.center;
      let cameraFrame = 0;
      import('maplibre-gl').then((maplibre) => {
        if (disposed || !container.current) return;
        try {
          // Bundlers relocate import.meta.url. Use explicit local module workers so
          // DEM and vector decoding do not silently wait on an HTML fallback URL.
          maplibre.setWorkerUrl('/vendor/maplibre/maplibre-gl-worker.mjs');
          maplibre.setWorkerCount(2);
          const map = new maplibre.Map({
            container: container.current,
            style: baseStyle(),
            ...INITIAL_VIEW,
            hash: true,
            maxPitch: 80,
            maxZoom: 20,
            minZoom: 3,
            attributionControl: false,
            // Native two-finger handlers keep single-finger drags as panning.
            touchZoomRotate: true,
            touchPitch: true,
            dragPan: true,
            canvasContextAttributes: { antialias: true },
          });
          mapRef.current = map;
          const sectionGl = TERRAIN_SECTION_ENABLED
            ? map.getCanvas().getContext('webgl2')
            : null;
          if (sectionGl) sectionClipRef.current = new TerrainClip(sectionGl);
          drawingRef.current = new DrawingGestureBridge(map, (input) =>
            latest.current.onDrawingInput(input),
          );
          drawingRef.current.configure(latest.current.drawingActive);
          featureDragRef.current = new FeatureDragBridge(map, {
            enabled: () =>
              !latest.current.drawingActive &&
              !latest.current.pickingActive &&
              !latest.current.section.enabled,
            hit: (point, element) => {
              const marker =
                element instanceof Element
                  ? element.closest<HTMLElement>('[data-annotation-id]')
                  : null;
              const id = marker?.dataset.annotationId;
              const item = latest.current.annotations.find(
                (a) => a.id === id && a.visible,
              );
              if (item)
                return {
                  kind: 'annotation',
                  id: item.id,
                  coordinate: item.coordinates,
                };
              if (element !== map.getCanvas()) return null;
              const model = annotationRef.current?.pickForMove(point);
              if (model) return { kind: 'annotation', ...model };
              const node = trackRef.current?.pickNode(point);
              return node ? { kind: 'track', node } : null;
            },
            begin: (target) => latest.current.onDragBegin(target),
            preview: (move) => latest.current.onDragPreview(move),
            commit: (move) => latest.current.onDragCommit(move),
          });
          map.addControl(
            new maplibre.AttributionControl({ compact: true }),
            'bottom-left',
          );
          map.addControl(
            new maplibre.ScaleControl({ maxWidth: 100, unit: 'metric' }),
            'bottom-left',
          );
          const marker = new maplibre.Marker({ color: '#9de8c4', scale: 0.6 })
            .setLngLat(selected)
            .addTo(map);
          const pick = (lng: number, lat: number) => {
            terrainAbort.current?.abort();
            const abort = new AbortController();
            terrainAbort.current = abort;
            selected = [lng, lat];
            marker.setLngLat(selected);
            latest.current.onPoint({ lng, lat, elevation: null });
            void readElevation(lng, lat, abort.signal)
              .then((elevation) => {
                if (!disposed && !abort.signal.aborted)
                  latest.current.onPoint({ lng, lat, elevation });
              })
              .catch(() => {});
          };
          map.once('style.load', async () => {
            if (disposed) return;
            loaded.current = true;
            geologyRef.current = new GeologyLayer(map, (state) =>
              latest.current.onGeology(state),
            );
            routeRef.current = new RouteLayer(map);
            trackRef.current = new TrackLayer(map);
            positionRef.current = new PositionLayer(map);
            try {
              const { AnnotationLayer } =
                await import('../annotations/AnnotationLayer');
              if (disposed) return;
              annotationRef.current = new AnnotationLayer((id) => {
                if (
                  !latest.current.drawingActive &&
                  !latest.current.pickingActive &&
                  !latest.current.section.enabled
                )
                  latest.current.onAnnotationSelect(id);
              });
              map.addLayer(annotationRef.current);
              if (sectionClipRef.current) {
                sectionRef.current = new PlaneSectionLayer(
                  map,
                  (status) => latest.current.onSectionStatus(status),
                  sectionClipRef.current,
                  (settings) => latest.current.onSectionChange(settings),
                  (settings, side) =>
                    annotationRef.current?.setSectionPlane(settings, side),
                );
                map.addLayer(sectionRef.current, 'annotation-models');
              }
            } catch {
              if (!disposed)
                latest.current.onStatus('标记模型暂未加载，地图仍可使用');
            }
            if (disposed) return;
            sync();
            const initialCenter = map.getCenter();
            weatherAnchor = initialCenter.toArray();
            latest.current.onAnchor(weatherAnchor);
            latest.current.onView({
              pitch: map.getPitch(),
              bearing: map.getBearing(),
              zoom: map.getZoom(),
            });
            pick(initialCenter.lng, initialCenter.lat);
            syncSatellite();
            latest.current.onStatus('真实地形 · 点击地图读取海拔');
            try {
              await addContours(map);
              if (!disposed) sync();
            } catch {
              if (!disposed)
                latest.current.onStatus('等高线暂未加载，请稍后刷新');
            }
            if (disposed) return;
            try {
              const { WeatherLayer } = await import('../weather/WeatherLayer');
              if (disposed) return;
              const layer = new WeatherLayer(latest.current.settings);
              weatherRef.current = layer;
              map.addLayer(layer);
              sync();
            } catch (e) {
              console.warn('Weather layer:', e);
              if (!disposed)
                latest.current.onStatus('三维云雨暂未加载，数值面板仍可使用');
            }
            if (!disposed) {
              if (map.getLayer('annotation-models'))
                map.moveLayer('annotation-models');
              sync();
            }
          });
          map.on('click', (event) => {
            if (latest.current.section.enabled) return;
            if (
              latest.current.drawingActive ||
              featureDragRef.current?.blocksClick()
            )
              return;
            if (!latest.current.pickingActive) {
              const annotation = annotationRef.current?.pick(event.point);
              if (annotation) {
                latest.current.onAnnotationSelect(annotation);
                return;
              }
              const track = trackRef.current?.pickTrack(event.point);
              if (track) {
                latest.current.onTrackSelect(track);
                return;
              }
            }
            pick(event.lngLat.lng, event.lngLat.lat);
            latest.current.onMapPick([event.lngLat.lng, event.lngLat.lat]);
          });
          map.on('move', () => {
            if (cameraFrame) return;
            cameraFrame = requestAnimationFrame(() => {
              cameraFrame = 0;
              if (!disposed)
                latest.current.onView({
                  bearing: map.getBearing(),
                  pitch: map.getPitch(),
                  zoom: map.getZoom(),
                });
            });
          });
          map.on('rotatestart', (event) => {
            if (event.originalEvent) latest.current.onManualRotate();
          });
          map.on('moveend', () => {
            trackRef.current?.sync(latest.current.trackOverlay);
            const p = map.getCenter();
            if (
              Math.abs(p.lng - weatherAnchor[0]) +
                Math.abs(p.lat - weatherAnchor[1]) >
                0.6 &&
              Math.abs(p.lat) < 75
            ) {
              weatherAnchor = [
                Number(p.lng.toFixed(2)),
                Number(p.lat.toFixed(2)),
              ];
              latest.current.onAnchor(weatherAnchor);
              syncSatellite();
            }
          });
          map.on('error', (event) => {
            if (
              'sourceId' in event &&
              typeof event.sourceId === 'string' &&
              event.sourceId.startsWith('geology-')
            )
              return;
            console.warn('Map data:', event.error.message);
            if (!disposed)
              latest.current.onStatus('部分地图数据加载失败，正在等待网络恢复');
          });
        } catch {
          latest.current.onStatus(
            '当前设备无法启动三维地图，请使用支持 WebGL 的浏览器',
          );
        }
      });
      return () => {
        disposed = true;
        loaded.current = false;
        cancelAnimationFrame(cameraFrame);
        satelliteAbort.current?.abort();
        terrainAbort.current?.abort();
        geologyRef.current?.dispose();
        geologyRef.current = null;
        routeRef.current = null;
        trackRef.current = null;
        positionRef.current = null;
        annotationRef.current = null;
        sectionRef.current?.dispose();
        sectionRef.current = null;
        sectionClipRef.current?.dispose();
        sectionClipRef.current = null;
        featureDragRef.current?.dispose();
        featureDragRef.current = null;
        drawingRef.current?.dispose();
        drawingRef.current = null;
        mapRef.current?.remove();
        mapRef.current = null;
        weatherRef.current = null;
      };
    }, []);
    useEffect(() => {
      sync();
    }, [
      settings,
      props.weather,
      props.hourIndex,
      props.roadSnapping,
      props.section.enabled,
    ]);
    useEffect(() => {
      sectionRef.current?.configure(props.section, props.annotations);
    }, [props.section, props.annotations]);
    useEffect(() => {
      syncSatellite();
    }, [settings.imageryMode, settings.satellite]);
    useEffect(() => {
      if (loaded.current) routeRef.current?.sync(props.routeOverlay);
    }, [props.routeOverlay]);
    useEffect(() => {
      if (loaded.current) trackRef.current?.sync(props.trackOverlay);
    }, [props.trackOverlay]);
    useEffect(() => {
      if (loaded.current) positionRef.current?.sync(props.position);
    }, [props.position]);
    useEffect(() => {
      if (loaded.current)
        annotationRef.current?.update(
          props.annotations,
          props.annotationSelected,
          props.section.enabled
            ? { ...latest.current.settings, terrain: true, exaggeration: 1 }
            : latest.current.settings,
        );
    }, [props.annotations, props.annotationSelected, props.section.enabled]);
    useEffect(() => {
      if (props.drawingActive || props.pickingActive || props.section.enabled)
        featureDragRef.current?.cancel();
      drawingRef.current?.configure(props.drawingActive);
    }, [props.drawingActive, props.pickingActive, props.section.enabled]);
    useEffect(() => {
      const map = mapRef.current;
      if (map && !settings.terrain) map.easeTo({ pitch: 0, duration: 750 });
    }, [settings.terrain]);
    return (
      <div
        ref={container}
        className="map-canvas"
        data-picking={
          props.pickingActive || props.drawingActive || props.section.enabled
        }
        aria-label="成都与川西三维地形地图"
      />
    );
  },
);
