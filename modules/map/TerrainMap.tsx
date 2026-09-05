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
import { PositionLayer } from '../position/PositionLayer';
import type { PositionFix } from '../position/types';
import {
  INITIAL_VIEW,
  type LayerSettings,
  type Point,
  type ViewState,
} from './types';
export type MapHandle = {
  zoom: (amount: number) => void;
  north: () => void;
  reset: () => void;
  view: (pitch: number, bearing: number, animate?: boolean) => void;
  refreshSatellite: () => void;
  refreshGeology: () => void;
  inspect: () => unknown;
  focusPoint: (coordinates: Coordinate) => void;
  fitRoute: (coordinates: Coordinate[]) => void;
  toCoordinate: (point: ScreenPoint) => Coordinate | null;
  stop: () => void;
  toScreen: (coordinate: Coordinate) => ScreenPoint | null;
  magnify: (target: HTMLCanvasElement, point: ScreenPoint) => () => void;
};
type Props = {
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
    const positionRef = useRef<PositionLayer | null>(null);
    const satelliteAbort = useRef<AbortController | null>(null);
    const terrainAbort = useRef<AbortController | null>(null);
    const loaded = useRef(false);
    const syncSatellite = () => {
      const map = mapRef.current;
      if (!map || !loaded.current) return;
      satelliteAbort.current?.abort();
      const abort = new AbortController();
      satelliteAbort.current = abort;
      const center = map.getCenter();
      if (map.getLayer('satellite')) map.removeLayer('satellite');
      if (map.getSource('satellite')) map.removeSource('satellite');
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
      const s = latest.current.settings;
      const terrain = map.getTerrain();
      if (
        s.terrain
          ? !terrain || terrain.exaggeration !== s.exaggeration
          : Boolean(terrain)
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
            s.satellite &&
              (id === 'relief' ||
                (id === 'detail'
                  ? s.imageryMode === 'detail'
                  : s.imageryMode === 'latest'))
              ? 'visible'
              : 'none',
          );
      weatherRef.current?.update(
        latest.current.weather,
        latest.current.hourIndex,
        s,
      );
      syncCartography(map, s);
      geologyRef.current?.sync(s);
      routeRef.current?.sync(latest.current.routeOverlay);
      trackRef.current?.sync(latest.current.trackOverlay);
      positionRef.current?.sync(latest.current.position);
    };
    useImperativeHandle(
      ref,
      () => ({
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
        focusPoint: (center) =>
          mapRef.current?.flyTo({ center, zoom: 13, duration: 700 }),
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
            maxZoom: 16,
            minZoom: 3,
            attributionControl: false,
            // Native two-finger handlers keep single-finger drags as panning.
            touchZoomRotate: true,
            touchPitch: true,
            dragPan: true,
            canvasContextAttributes: { antialias: true },
          });
          mapRef.current = map;
          drawingRef.current = new DrawingGestureBridge(map, (input) =>
            latest.current.onDrawingInput(input),
          );
          drawingRef.current.configure(latest.current.drawingActive);
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
              addCartography(map);
              sync();
            }
          });
          map.on('click', (event) => {
            if (latest.current.drawingActive) return;
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
        drawingRef.current?.dispose();
        drawingRef.current = null;
        mapRef.current?.remove();
        mapRef.current = null;
        weatherRef.current = null;
      };
    }, []);
    useEffect(() => {
      sync();
    }, [settings, props.weather, props.hourIndex]);
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
      drawingRef.current?.configure(props.drawingActive);
    }, [props.drawingActive]);
    useEffect(() => {
      const map = mapRef.current;
      if (map && !settings.terrain) map.easeTo({ pitch: 0, duration: 750 });
    }, [settings.terrain]);
    return (
      <div
        ref={container}
        className="map-canvas"
        aria-label="成都与川西三维地形地图"
      />
    );
  },
);
