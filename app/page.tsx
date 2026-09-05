'use client';
import { useEffect, useRef, useState } from 'react';
import {
  CloudSun,
  Compass,
  Layers,
  LocateFixed,
  Minus,
  Mountain,
  Plus,
  RotateCcw,
} from 'lucide-react';
import { TerrainMap, type MapHandle } from '@/modules/map/TerrainMap';
import { LayerPanel } from '@/modules/controls/LayerPanel';
import { WeatherPanel } from '@/modules/controls/WeatherPanel';
import { Timeline } from '@/modules/controls/Timeline';
import { ViewController } from '@/modules/controls/ViewController';
import { useWeather } from '@/modules/weather/useWeather';
import { useMapTools } from '@/modules/controls/useMapTools';
import type { SatelliteState } from '@/modules/satellite/satellite';
import {
  DEFAULT_LAYERS,
  INITIAL_VIEW,
  type LayerSettings,
  type Point,
  type ViewState,
} from '@/modules/map/types';

export default function Home() {
  const map = useRef<MapHandle>(null);
  const [layers, setLayers] = useState<LayerSettings>(DEFAULT_LAYERS);
  const [point, setPoint] = useState<Point>({
    lng: INITIAL_VIEW.center[0],
    lat: INITIAL_VIEW.center[1],
    elevation: null,
  });
  const [mapStatus, setMapStatus] = useState('正在加载真实地形…');
  const [panel, setPanel] = useState(true);
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
  const update = (patch: Partial<LayerSettings>) =>
    setLayers((current) => ({ ...current, ...patch }));
  useMapTools({
    read: () => ({
      layers,
      view,
      point,
      satellite,
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
  return (
    <main className="observatory">
      <TerrainMap
        ref={map}
        settings={layers}
        onPoint={setPoint}
        onStatus={setMapStatus}
        onView={setView}
        onAnchor={setAnchor}
        onSatellite={setSatellite}
        weather={weather.data}
        hourIndex={hourIndex}
      />
      <header className="topbar">
        <div className="brand">
          <span className="brand-icon">
            <CloudSun size={27} />
          </span>
          <div>
            <h1>观云</h1>
            <span>WEATHER OBSERVATORY</span>
          </div>
        </div>
        <div className="region">
          <span className="live-dot" />
          成都 · 川西山区{' '}
          <span className="region-secondary">CHENGDU / WESTERN SICHUAN</span>
        </div>
        <button
          className="icon-button panel-button"
          aria-label="显示或隐藏图层面板"
          aria-pressed={panel}
          onClick={() => setPanel(!panel)}
        >
          <Layers size={20} />
        </button>
      </header>
      <section className="location-card glass" aria-label="当前地图位置">
        <span className="eyebrow">山川与天气，一起看</span>
        <h2>从成都，望向群山</h2>
        <p>拖动探索 · 右键旋转 · 滚轮缩放</p>
        <div className="coordinates">
          <span>{point.lat.toFixed(3)}° N</span>
          <span>{point.lng.toFixed(3)}° E</span>
        </div>
        <div className="altitude">
          <Mountain size={18} />
          <span>所选地点海拔</span>
          <strong>
            {point.elevation == null
              ? '—'
              : Math.round(point.elevation).toLocaleString()}{' '}
            <small>m</small>
          </strong>
        </div>
        <p className="secondary">点击地图查看该点海拔与天气</p>
      </section>
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
      <div className="view-presets glass" aria-label="观察模式">
        <button
          className={layers.clouds || layers.rain ? 'active' : ''}
          onClick={() =>
            update({ terrain: true, clouds: true, rain: true, contours: false })
          }
        >
          <CloudSun size={17} />
          天气总览
        </button>
        <button
          className={!layers.clouds && !layers.rain ? 'active' : ''}
          onClick={() =>
            update({
              terrain: true,
              clouds: false,
              rain: false,
              contours: true,
            })
          }
        >
          <Mountain size={17} />
          看清地形
        </button>
      </div>
      {panel && (
        <LayerPanel
          settings={layers}
          onChange={update}
          satelliteDate={satellite.date}
          satelliteStatus={satellite.status}
        />
      )}
      <ViewController
        view={view}
        onView={(pitch, bearing, animate) => {
          if (pitch > 0 && !layers.terrain) update({ terrain: true });
          map.current?.view(pitch, bearing, animate);
        }}
        onReset={() => {
          update({ terrain: true });
          map.current?.reset();
        }}
        withPanel={panel}
      />
      <nav
        className={`map-tools glass ${panel ? 'with-panel' : ''}`}
        aria-label="地图视角控制"
      >
        <button
          className="icon-button"
          aria-label="放大地图"
          onClick={() => map.current?.zoom(1)}
        >
          <Plus size={20} />
        </button>
        <button
          className="icon-button"
          aria-label="缩小地图"
          onClick={() => map.current?.zoom(-1)}
        >
          <Minus size={20} />
        </button>
        <span className="tool-divider" />
        <button
          className="icon-button"
          aria-label="地图朝北"
          onClick={() => map.current?.north()}
        >
          <Compass size={21} />
        </button>
        <button
          className="icon-button"
          aria-label="返回成都川西视角"
          onClick={() => map.current?.reset()}
        >
          <RotateCcw size={18} />
        </button>
        <button
          className="dimension-button"
          aria-label={layers.terrain ? '切换二维地图' : '切换三维地形'}
          onClick={() => {
            update({ terrain: !layers.terrain });
            map.current?.view(layers.terrain ? 0 : 62, view.bearing);
          }}
        >
          {layers.terrain ? '3D' : '2D'}
        </button>
      </nav>
      <div className="map-status glass" role="status">
        <LocateFixed size={14} />
        {mapStatus}
      </div>
      <Timeline
        data={weather.data}
        index={hourIndex}
        playing={playing}
        onIndex={setHourIndex}
        onPlaying={setPlaying}
        rainVisible={layers.rain}
      />
    </main>
  );
}
