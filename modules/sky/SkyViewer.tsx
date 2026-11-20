import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Mountain, X } from 'lucide-react';
import {
  getLocalDayBounds,
  getObserverTimeZone,
  getSkyPosition,
} from './astronomy';
import { loadTerrainHorizon, terrainHorizonAtAltitude, type TerrainHorizon } from './terrainHorizon';
import { useDeviceSkyCamera, type DeviceSkyLocation, type DeviceSkyPose } from './deviceSkyCamera';
import { createSkyScene } from './skyScene';
import { useSolarDay } from './useSolarDay';
import { SkyMoonGuide, SkyMoonMarker } from './MoonGuideReadout';
import { findMoonPreview, getMoonGuide } from './moonGuideGeometry';
import {SatelliteTerrainCanvas} from './SatelliteTerrainCanvas';
import { SkyTracks } from './SkyTracks';
import { SkyTimeline } from './SkyTimeline';
import type { PositionFix } from '../position/types';
import type { Coordinate } from '../navigation/types';
import './sky.css';

function calendarDate(time: number, zone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(time);
  return ['year', 'month', 'day']
    .map((k) => parts.find((p) => p.type === k)!.value)
    .join('-');
}
function validFix(fix: PositionFix | null) {
  return fix &&
    fix.provider !== 'ip' &&
    Date.now() - fix.timestamp <= 30000 &&
    fix.accuracy <= 200
    ? fix
    : null;
}

/** Keep radial DEM and daily visibility calculations independent of the pressure sample rate. */
function useObservationHeight(key: string | null, height: number | null) {
  const latest = useRef(height);
  latest.current = height;
  const [applied, setApplied] = useState<{ key: string; height: number } | null>(null);
  useEffect(() => {
    if (key === null) return;
    const update = () => {
      const height = latest.current;
      if (height === null || !Number.isFinite(height)) return;
      setApplied(previous => previous?.key === key && Math.abs(previous.height - height) < 2
        ? previous : { key, height });
    };
    update();
    const timer = window.setInterval(update, 5000);
    return () => window.clearInterval(timer);
  }, [key]);
  return key !== null && applied?.key === key ? applied.height : null;
}

export function SkyViewer({
  mapPoint,
  markerName,
  fix,
  locate,
  onClose,
  demo = false,
  previewTerrain,
}: {
  demo?: boolean;
  previewTerrain?: TerrainHorizon;
  mapPoint: Coordinate;
  markerName?: string;
  fix: PositionFix | null;
  locate(): void;
  onClose(): void;
}) {
  const [gps, setGps] = useState(() => validFix(fix));
  const [source, setSource] = useState<'gps' | 'map'>(demo || markerName ? 'map' : 'gps');
  useEffect(() => {
    const fresh = validFix(fix);
    if (!fresh) return;
    setGps((previous) => {
      if (!previous) return fresh;
      const [lon, lat] = previous.coordinates;
      const distance =
        111320 *
        Math.hypot(
          fresh.coordinates[1] - lat,
          Math.cos((lat * Math.PI) / 180) * (fresh.coordinates[0] - lon),
        );
      return distance > Math.max(30, fresh.accuracy) ||
        previous.accuracy > 2 * fresh.accuracy ||
        (previous.mslAltitudeMeters == null && fresh.mslAltitudeMeters != null)
        ? fresh
        : previous;
    });
  }, [fix]);
  const actual = !markerName && source === 'gps' ? gps : null;
  const [lng, lat] = actual?.coordinates ?? mapPoint;
  const [mode, setMode] = useState<'camera' | 'simulation'>(() =>
    !markerName && !demo && ('ShantuSkyCamera' in window || navigator.maxTouchPoints > 0)
      ? 'camera'
      : 'simulation',
  );
  const [manual, setManual] = useState(!!markerName);
  const cameraLive = mode === 'camera';
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [retry, setRetry] = useState(0);
  const [terrainResult, setTerrainResult] = useState<{
    key: string;
    terrain: TerrainHorizon | null;
  } | null>(null);
  const gpsMsl = actual?.source === 'gps' && actual.accuracy <= 50 ? actual.mslAltitudeMeters ?? null : null;
  const key = [lng, lat, retry].join('/');
  useEffect(() => {
    const abort = new AbortController();
    async function readTerrain() {
      if (demo && !actual && previewTerrain) return previewTerrain;
      return loadTerrainHorizon(
        { lng, lat },
        abort.signal,
      );
    }
    readTerrain()
      .then((terrain) => {
        if (!abort.signal.aborted) setTerrainResult({ key, terrain });
      })
      .catch(() => {
        if (!abort.signal.aborted) setTerrainResult({ key, terrain: null });
      });
    return () => abort.abort();
  }, [lng, lat, key, demo, !!actual, previewTerrain]);
  const surveyedTerrain = terrainResult?.key === key ? terrainResult.terrain : null;
  const loading = terrainResult?.key !== key;
  // The calibration input comes only from the original GPS/geoid or DEM observation.
  const groundAndEye = surveyedTerrain?.observerAltitudeMeters ?? null;
  const baseAltitude = gpsMsl ?? groundAndEye;
  const referenceSource = gpsMsl !== null ? 'gps-msl' : groundAndEye !== null ? 'dem-eye' : undefined;
  const cameraLocation = useMemo<DeviceSkyLocation | null>(
    () => actual ? { latitude: lat, longitude: lng, altitude: baseAltitude,
      altitudeSource: cameraLive ? referenceSource : undefined } : null,
    [!!actual, lat, lng, baseAltitude, cameraLive, referenceSource],
  );
  const camera = useDeviceSkyCamera(
    !markerName && (cameraLive || !manual),
    viewport,
    video,
    cameraLocation,
    cameraLive,
  );
  const pressureKey = cameraLive && actual && camera.altitudeSource && camera.altitudeMeters !== null
    ? [lng, lat, camera.altitudeSource].join('/') : null;
  const pressureHeight = useObservationHeight(pressureKey, camera.altitudeMeters);
  const elevation = pressureHeight ?? baseAltitude;
  const terrain = useMemo(
    () => surveyedTerrain && elevation !== null
      ? terrainHorizonAtAltitude(surveyedTerrain, elevation) : surveyedTerrain,
    [surveyedTerrain, elevation],
  );
  const observer = useMemo(
    () => ({ latitude: lat, longitude: lng, elevationM: elevation ?? 0 }),
    [lat, lng, elevation],
  );
  const heightQuality = pressureHeight !== null
    ? camera.altitudeSource === 'barometer-gps-msl' ? '气压计 · GPS正高校准' : '气压计 · 地形校准'
    : gpsMsl !== null ? 'GPS正高'
      : groundAndEye !== null ? '地形估算' : '高程待确认';
  const zone = useMemo(() => getObserverTimeZone(lat, lng), [lat, lng]);
  const [time, setTime] = useState(Date.now);
  const [liveTime, setLiveTime] = useState(true);
  const date = useMemo(() => calendarDate(time, zone), [time, zone]);
  const day = useMemo(() => getLocalDayBounds(date, zone), [date, zone]);
  const solarDay = useSolarDay(day, observer, terrain);
  const sky = useMemo(() => getSkyPosition(time, observer), [time, observer]);
  useEffect(() => {
    if (!liveTime) return;
    const timer = window.setInterval(() => setTime(Date.now()), 10000);
    return () => window.clearInterval(timer);
  }, [liveTime]);
  const [pose, setPose] = useState<DeviceSkyPose>(() => ({
    azimuth: sky.sun.azimuthDeg,
    altitude: Math.min(65, Math.max(3, sky.sun.altitudeDeg)),
    roll: 0,
  }));
  const [hudBase, setHudBase] = useState<string>();
  useEffect(() => {
    if (!viewport) return;
    function update() {
      const channels = getComputedStyle(viewport!)
        .color.match(/[\d.]+/g)
        ?.slice(0, 3)
        .map(Number);
      if (channels?.length === 3)
        setHudBase(
          0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2] >
            145
            ? '#1e292e'
            : '#faf5eb',
        );
    }
    update();
    const changes = new MutationObserver(update);
    changes.observe(document.documentElement, { attributes: true });
    return () => changes.disconnect();
  }, [viewport]);
  const sensorPose = actual && (!manual || cameraLive) ? camera.pose : null;
  const looking = sensorPose || pose;
  const [textureStatus,setTextureStatus]=useState('loading');
  const [size, setSize] = useState({ width: 390, height: 857 });
  useEffect(() => {
    if (!viewport) return;
    const update = () =>
      setSize({ width: viewport.clientWidth, height: viewport.clientHeight });
    const resize = new ResizeObserver(update);
    resize.observe(viewport);
    update();
    return () => resize.disconnect();
  }, [viewport]);
  const optics = cameraLive
    ? camera.optics
    : {
        horizontalFov:
          (2 *
            Math.atan(
              (Math.tan(Math.PI / 5) * size.width) / Math.max(1, size.height),
            ) *
            180) /
          Math.PI,
        verticalFov: 72,
      };
  const draw =
    !cameraLive ||
    (camera.status === 'ready' && !!sensorPose && !!actual && !!optics);
  const renderer = useRef<ReturnType<typeof createSkyScene> | null>(null);
  const [graphicsError, setGraphicsError] = useState('');
  const [restored, setRestored] = useState(0);
  useEffect(() => {
    if (!canvas) return;
    try {
      renderer.current = createSkyScene(canvas);
      setGraphicsError('');
    } catch (e) {
      setGraphicsError(e instanceof Error ? e.message : '天空绘制失败');
    }
    const lost = (event: Event) => {
      event.preventDefault();
      setGraphicsError('天空图层正在恢复');
    };
    const restore = () => setRestored((n) => n + 1);
    canvas.addEventListener('webglcontextlost', lost);
    canvas.addEventListener('webglcontextrestored', restore);
    return () => {
      canvas.removeEventListener('webglcontextlost', lost);
      canvas.removeEventListener('webglcontextrestored', restore);
      renderer.current?.dispose();
      renderer.current = null;
    };
  }, [canvas, restored]);
  useEffect(() => {
    if (draw && optics)
      renderer.current?.draw(looking, optics, sky, terrain, cameraLive, textureStatus==="ready");
  }, [draw, canvas, restored, looking, optics, sky, terrain, cameraLive, size,textureStatus]);
  const drag = useRef<{ x: number; y: number; start: DeviceSkyPose } | null>(
    null,
  );
  const firstPreviewRise = useRef(demo);
  useEffect(() => {
    if (
      !firstPreviewRise.current ||
      loading ||
      !solarDay.data ||
      solarDay.data.flatReference
    )
      return;
    const rise = solarDay.data.value.events.find(
      (event) => event.kind === 'rise',
    );
    firstPreviewRise.current = false;
    if (rise) {
      setLiveTime(false);
      setTime(rise.timeMs);
      const sun = getSkyPosition(rise.timeMs, observer).sun;
      setPose({ azimuth: sun.azimuthDeg, altitude: sun.altitudeDeg, roll: 0 });
    }
  }, [solarDay.data, observer, loading]);
  const [notice, setNotice] = useState('');
  const exitRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    exitRef.current?.focus({ preventScroll: true });
  }, []);
  const chooseTime = (t: number, aim = false) => {
    firstPreviewRise.current = false;
    setNotice('');
    setLiveTime(false);
    setTime(t);
    if (aim && !cameraLive && !sensorPose) {
      const s = getSkyPosition(t, observer).sun;
      setPose({ azimuth: s.azimuthDeg, altitude: s.altitudeDeg, roll: 0 });
    }
  };
  const changeDate = (d: string) => {
    try {
      const next = getLocalDayBounds(d, zone);
      chooseTime(Math.min(next.endMs - 1, next.startMs + time - day.startMs));
      setNotice('');
    } catch {
      setNotice('该地点没有这个日历日期');
    }
  };
  const guide = getMoonGuide({
    moon: sky.moon,
    pose: cameraLive && !draw ? null : looking,
    optics,
    terrain,
    ...size,
  });
  const findMoon = () => {
    if (cameraLive) {
      setNotice(
        guide.message +
          ' · 方位 ' +
          Math.round(sky.moon.azimuthDeg) +
          '°，仰角 ' +
          sky.moon.altitudeDeg.toFixed(1) +
          '°',
      );
      return;
    }
    const result = findMoonPreview(
      day,
      observer,
      terrain?.status === 'unavailable' ? null : terrain,
      time,
    );
    if (result.status !== 'found') {
      setNotice(
        result.status === 'unknown'
          ? '部分方位缺少地形，无法确定月亮的可见时段'
          : '当天未找到月亮露出山脊的时段',
      );
      return;
    }
    if (result.relation !== 'current') chooseTime(result.timeMs);
    setManual(true);
    firstPreviewRise.current = false;
    setPose({
      azimuth: result.moon.azimuthDeg,
      altitude: result.moon.altitudeDeg,
      roll: 0,
    });
    const clock = new Intl.DateTimeFormat('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: zone,
    });
    setNotice(
      result.relation !== 'current'
        ? '已跳到 ' + clock.format(result.timeMs) + ' 月亮可见时段'
        : result.flatReference
          ? '已对准月亮 · 平地参考'
          : '',
    );
  };
  const status = !cameraLive
    ? ''
    : camera.status === 'denied'
      ? '相机权限未开启，可切换模拟'
      : camera.status === 'unavailable'
        ? '未找到后置摄像头，可切换模拟'
        : camera.status === 'error'
          ? '摄像头打开失败，可切换模拟'
          : camera.status !== 'ready'
            ? '正在打开后置摄像头…'
            : !actual
              ? '等待当前位置以对齐镜头'
              : !camera.optics
                ? '当前镜头缺少视场标定，可切换模拟'
                : !camera.pose
                  ? camera.poseStatus === 'unavailable'
                    ? '此设备缺少绝对方向传感器'
                    : camera.poseStatus === 'magnetic'
                      ? '磁场干扰，请移开磁性物件并校准'
                      : '等待镜头方向，请校准指南针'
                  : '';
  return (
    <section
      className="sky-viewer"
      style={{ '--sky-hud-base': hudBase } as React.CSSProperties}
      data-live={cameraLive && camera.status === 'ready'}
      role="dialog"
      aria-modal="true"
      aria-label="日月观景"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div
        className="sky-viewport"
        ref={setViewport}
        onPointerDown={(e) => {
          if (cameraLive || sensorPose) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, start: looking };
        }}
        onPointerMove={(e) => {
          const p = drag.current;
          if (!p) return;
          setPose({
            azimuth:
              (p.start.azimuth + ((p.x - e.clientX) * 72) / size.height + 360) %
              360,
            altitude: Math.max(
              -90,
              Math.min(
                90,
                p.start.altitude + ((e.clientY - p.y) * 72) / size.height,
              ),
            ),
            roll: 0,
          });
        }}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
      >
        <video
          ref={setVideo}
          playsInline
          autoPlay
          muted
          hidden={!cameraLive || camera.source === 'native'}
        />
        <canvas
          ref={setCanvas}
          hidden={!draw}
          aria-label="第一人称日月与山脊"
        />
        {!cameraLive && optics && <SatelliteTerrainCanvas observer={observer} pose={looking} optics={optics} {...size}
          eyeHeightMeters={gpsMsl===null?1.7:undefined} onStatus={setTextureStatus}/>}
        {draw && optics && (
          <SkyTracks
            pose={looking}
            optics={optics}
            day={day}
            observer={observer}
            terrain={terrain}
            events={solarDay.data?.value.events ?? []}
            timeZone={zone}
            width={size.width}
            height={size.height}
            flatReference={solarDay.data?.flatReference}
          />
        )}
        {draw && <SkyMoonMarker guide={guide} />}
      </div>
      <div className="sky-head">
        <div className="sky-bar">
          <strong>{markerName ? '标记点观景' : '日月观景'}</strong>
          {!markerName && <><button
            aria-pressed={cameraLive}
            onClick={() => {
              setMode('camera');
              setSource('gps');
              if (!actual) locate();
            }}
          >
            <Camera size={16} />
            实景
          </button>
          <button
            aria-pressed={!cameraLive}
            onClick={() => setMode('simulation')}
          >
            <Mountain size={16} />
            模拟
          </button></>}
          <button aria-label="退出日月观景" ref={exitRef} onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="sky-info">
          <span>
            {markerName || (actual
              ? `定位 ±${Math.round(actual.accuracy)} m`
              : demo
                ? '青城山预演'
                : '地图中心预演')}{' '}
            · {lat.toFixed(3)}°, {lng.toFixed(3)}°
          </span>
          {cameraLive && actual && <span>
            {elevation !== null ? `${Math.round(elevation)} m · ${heightQuality}` : heightQuality}
          </span>}
          {!markerName && <button
            onClick={() => {
              setSource('gps');
              locate();
            }}
          >
            重新定位
          </button>}
          {actual && !cameraLive && (
            <button onClick={() => setSource('map')}>地图中心</button>
          )}
        </div>
      </div>
      <div className="sky-bottom">
        {!cameraLive && <small className="sky-satellite-credit">{textureStatus==='ready'?'天地图卫星影像':textureStatus==='partial'?'天地图卫星影像 · 部分覆盖':textureStatus==='loading'?'加载天地图卫星影像…':'天地图卫星影像未就绪 · 地形轮廓'}</small>}
        {(status || notice || graphicsError) && (
          <div className="sky-status" role="status">
            {graphicsError || notice || status}
          </div>
        )}
        <SkyMoonGuide guide={guide} onFindMoon={findMoon} />
        <div className="sky-readout">
          <span>
            {cameraLive && !sensorPose
              ? '镜头方向待定'
              : `${sensorPose ? '镜头' : '手动'} ${Math.round(looking.azimuth) % 360}° · 仰角 ${looking.altitude.toFixed(1)}°`}
          </span>
          {!cameraLive && (markerName || camera.source === 'browser') && (
            <span>拖动看四周</span>
          )}
          {!markerName && !cameraLive && camera.source === 'native' && (
            <button
              onClick={() => {
                setManual((v) => !v);
                if (sensorPose) setPose({ ...sensorPose });
              }}
              aria-pressed={manual}
            >
              {manual ? '启用姿态跟随' : sensorPose ? '改用拖动' : '拖动看四周'}
            </button>
          )}
          {!loading && terrain?.status !== 'complete' && (
            <button onClick={() => setRetry((n) => n + 1)}>重读山脊</button>
          )}
        </div>
        <SkyTimeline
          result={solarDay}
          date={date}
          time={time}
          day={day}
          timeZone={zone}
          observer={observer}
          terrain={terrain}
          loadingTerrain={loading}
          onDate={changeDate}
          onTime={chooseTime}
          onNow={() => {
            firstPreviewRise.current = false;
            setLiveTime(true);
            setTime(Date.now());
          }}
        />
      </div>
    </section>
  );
}
