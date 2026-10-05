import { useEffect, useRef, useState } from 'react';
import {
  canStartNativeStartupLocation,
  watchNativePosition,
  type NativePositionBridge,
} from './nativePosition';
import { canFollow } from './follow';
import { watchIpPosition } from './ipPosition';
import {
  compassHeading,
  headingDelta,
  positionFix,
  wrapHeading,
  type DirectionMode,
  type PositionFix,
  type LocationMode,
} from './types';
type OrientationPermission = typeof DeviceOrientationEvent & {
  requestPermission?: (absolute?: boolean) => Promise<string>;
};
export function usePosition() {
  const [mode, setMode] = useState<LocationMode>('auto');
  const modeRef = useRef<LocationMode>('auto');
  const [networkAvailable, setNetworkAvailable] = useState(false);
  const [showStatus, setShowStatus] = useState(true);
  const [fallbackReason, setFallbackReason] = useState('');
  const nativeStop = useRef<(() => void) | null>(null);
  const startupStop = useRef<(() => void) | null>(null);
  const startupTimer = useRef<number | null>(null);
  const [fix, setFix] = useState<PositionFix | null>(null),
    [startupFix, setStartupFix] = useState<PositionFix | null>(null),
    [locating, setLocating] = useState(false),
    [watching, setWatching] = useState(false);
  const [locationError, setLocationError] = useState(''),
    [directionError, setDirectionError] = useState('');
  const [direction, setDirection] = useState<DirectionMode>('free'),
    [heading, setHeading] = useState<number | null>(null);
  const watch = useRef<number | null>(null),
    active = useRef(false),
    locationCallback = useRef<((fix: PositionFix) => void) | null>(null);
  const sensorCleanup = useRef<() => void>(() => {}),
    generation = useRef(0);
  const latestFix = useRef(fix);
  latestFix.current = fix;
  const locationGeneration = useRef(0), healthyWatch = useRef(false);
  const ipStop = useRef<(() => void) | null>(null), fallbackTimer = useRef<number | null>(null);
  const stopFallback = () => {
    if (fallbackTimer.current !== null) window.clearTimeout(fallbackTimer.current);
    fallbackTimer.current = null;
    ipStop.current?.(); ipStop.current = null;
  };
  const stopWatch = () => {
    locationGeneration.current++;
    healthyWatch.current = false;
    stopFallback();
    nativeStop.current?.();
    nativeStop.current = null;
    if (watch.current !== null)
      navigator.geolocation?.clearWatch(watch.current);
    watch.current = null;
  };
  const stopStartup = () => {
    startupStop.current?.();
    startupStop.current = null;
    if (startupTimer.current !== null) window.clearTimeout(startupTimer.current);
    startupTimer.current = null;
  };
  const beginWatch = () => {
    stopWatch();
    const request = locationGeneration.current;
    healthyWatch.current = true;
    const accept = (value: PositionFix) => {
      if (!active.current || request !== locationGeneration.current) return;
      if (value.provider === 'ip' && latestFix.current?.provider !== 'ip' && canFollow(latestFix.current)) return;
      if (value.provider !== 'ip' && canFollow(value)) { stopFallback(); setFallbackReason(''); }
      healthyWatch.current = true;
      latestFix.current = value;
      setFix(value);
      setLocating(false);
      setLocationError('');
      locationCallback.current?.(value);
      locationCallback.current = null;
    };
    const startFallback = (reason = '系统定位暂未返回有效位置') => {
      if (!active.current || request !== locationGeneration.current || ipStop.current ||
          (latestFix.current?.provider !== 'ip' && canFollow(latestFix.current))) return;
      setLocating(true);
      setFallbackReason(reason);
      setLocationError('系统定位未就绪，正在尝试IP估计位置…');
      ipStop.current = watchIpPosition(accept, error => {
        if (!active.current || request !== locationGeneration.current ||
            (latestFix.current?.provider !== 'ip' && canFollow(latestFix.current))) return;
        healthyWatch.current = false;
        setLocating(false); setLocationError(error);
      });
    };
    fallbackTimer.current = window.setTimeout(() => startFallback(), 6000);
    const bridge = window.GuanyunNative;
    if (bridge?.locate && bridge.locationState && bridge.stopLocation) {
      nativeStop.current = watchNativePosition(
        bridge as NativePositionBridge,
        modeRef.current,
        accept,
        (error) => {
          if (!active.current || request !== locationGeneration.current) return;
          if (error) { setLocating(false); healthyWatch.current = false; }
          setLocationError(error);
          if (error) startFallback(error);
        },
      );
      return;
    }
    if (!window.isSecureContext || !navigator.geolocation) { startFallback('当前浏览器未提供系统定位'); return; }
    watch.current = navigator.geolocation.watchPosition(
      (position) => {
        const value = positionFix(position);
        if (!active.current || request !== locationGeneration.current || !value) return;
        // Browser location can be a coarse system/network estimate. Keep its
        // reported accuracy and prefer it over a city-level IP fallback.
        accept(value.accuracy > 80 ? { ...value, source: 'network' } : value);
      },
      (error) => {
        if (!active.current || request !== locationGeneration.current) return;
        healthyWatch.current = false;
        setLocating(false);
        setLocationError(
          error.code === 1
            ? '定位权限未允许，请在系统设置中开启。'
            : error.code === 3
              ? '定位超时，请到开阔处重试。'
              : '暂时无法定位，请检查系统定位开关。',
        );
        if (error.code === 1) {
          if (watch.current !== null) navigator.geolocation.clearWatch(watch.current);
          watch.current = null;
        }
        startFallback(error.code === 1 ? '浏览器未允许定位权限' : error.code === 3 ? '系统定位超时' : '系统定位暂不可用');
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
  };
  const locate = (onFix?: (fix: PositionFix) => void) => {
    stopStartup();
    setShowStatus(true);
    const reuse = active.current && healthyWatch.current && (nativeStop.current !== null || watch.current !== null || ipStop.current !== null);
    active.current = true;
    locationCallback.current = onFix ?? null;
    setWatching(true);
    const cached = latestFix.current;
    const usable = canFollow(cached);
    setLocating(!usable);
    setLocationError('');
    if (usable && onFix) { onFix(cached); locationCallback.current = null; }
    if (!reuse) beginWatch();
  };
  const changeMode = (
    next: LocationMode,
    onFix?: (fix: PositionFix) => void,
  ) => {
    stopStartup();
    stopWatch();
    modeRef.current = next;
    setMode(next);
    latestFix.current = null;
    setFix(null);
    locate(onFix);
  };
  const stopDirection = () => {
    generation.current++;
    sensorCleanup.current();
    sensorCleanup.current = () => {};
    setHeading(null);
    setDirectionError('');
  };
  const north = () => {
    stopDirection();
    setDirection('north');
  };
  const free = () => {
    stopDirection();
    setDirection('free');
  };
  const device = async () => {
    stopDirection();
    const request = generation.current;
    setDirection('device');
    const bridge = window.GuanyunNative;
    if (bridge?.compassEnabled && bridge.compassState) {
      bridge.compassEnabled(true);
      let last: number | null = null;
      const poll = () => {
        if (document.hidden) return;
        try {
          const data = JSON.parse(bridge.compassState!());
          if (data.error) { setHeading(null); setDirectionError(data.error); return; }
          if (typeof data.heading !== 'number' || !Number.isFinite(data.heading) || Date.now() - data.time > 3000) { setHeading(null); setDirectionError('等待指南针方向，请平放手机校准'); return; }
          const value = last === null ? wrapHeading(data.heading) : wrapHeading(last + headingDelta(last, data.heading) * .3);
          last = value; setHeading(value); setDirectionError('');
        } catch { setHeading(null); setDirectionError('指南针暂未就绪'); }
      };
      const timer = window.setInterval(poll, 120); poll();
      sensorCleanup.current = () => { clearInterval(timer); bridge.compassEnabled?.(false); };
      return;
    }
    if (!window.isSecureContext || !window.DeviceOrientationEvent) {
      setDirection('free');
      setDirectionError('设备没有提供方向传感器，请使用正北模式。');
      return;
    }
    try {
      const ctor = window.DeviceOrientationEvent as OrientationPermission;
      if (
        ctor.requestPermission &&
        (await ctor.requestPermission(true)) !== 'granted'
      )
        throw new Error('没有获得方向传感器权限。');
      if (request !== generation.current) return;
      let last: number | null = null,
        lastTime = 0;
      const timeout = setTimeout(
        () =>
          setDirectionError('暂未收到可靠方向；请平放手机校准，或切换正北。'),
        4500,
      );
      const listener = (raw: DeviceOrientationEvent) => {
        if (document.hidden) return;
        const value = compassHeading(
          raw,
          window.screen.orientation?.angle ?? 0,
        );
        if (value === null) return;
        clearTimeout(timeout);
        setDirectionError('');
        const time = performance.now();
        if (time - lastTime < 100) return;
        lastTime = time;
        const smoothed =
          last === null
            ? value
            : wrapHeading(last + headingDelta(last, value) * 0.3);
        if (last === null || Math.abs(headingDelta(last, smoothed)) >= 0.7) {
          last = smoothed;
          setHeading(smoothed);
        }
      };
      window.addEventListener('deviceorientationabsolute', listener);
      window.addEventListener('deviceorientation', listener);
      sensorCleanup.current = () => {
        clearTimeout(timeout);
        window.removeEventListener('deviceorientationabsolute', listener);
        window.removeEventListener('deviceorientation', listener);
      };
    } catch (e) {
      if (request === generation.current) {
        setDirection('free');
        setDirectionError(
          e instanceof Error ? e.message : '方向传感器不可用。',
        );
      }
    }
  };
  useEffect(() => {
    const bridge = window.GuanyunNative;
    setNetworkAvailable(
      true,
    );
    if (!bridge?.locate) {
      modeRef.current = 'auto'; setMode('auto');
      active.current = true;
      setLocating(true); setWatching(true);
      locationCallback.current = value => setStartupFix(value);
      beginWatch();
    }
    if (canStartNativeStartupLocation(bridge as NativePositionBridge)) {
      let firstFix = false;
      const acceptStartup = (value: PositionFix) => {
        setFix(value);
        setLocationError('');
        const focusable = canFollow(value);
        if (!firstFix && focusable) {
          firstFix = true;
          setStartupFix(value);
        }
        if (value.source === 'gps' && focusable) stopStartup();
      };
      startupStop.current = watchNativePosition(
        bridge as NativePositionBridge,
        'auto',
        acceptStartup,
        (error) => {
          if (error) setLocationError(error);
        },
      );
      startupTimer.current = window.setTimeout(stopStartup, 20000);
    }
    const visibility = () => {
      // Android pauses providers in onPause and resolves its own permission dialog.
      // Restarting the bridge here could re-request a just-denied permission.
      const bridge = window.GuanyunNative;
      if (bridge?.locate && bridge.locationState && bridge.stopLocation) return;
      if (document.hidden) stopWatch();
      else if (active.current) beginWatch();
    };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      active.current = false;
      stopStartup();
      stopWatch();
      generation.current++;
      sensorCleanup.current();
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  return {
    mode,
    changeMode,
    networkAvailable,
    showStatus,
    fallbackReason,
    fix,
    startupFix,
    locating,
    watching,
    locationError,
    directionError,
    direction,
    heading,
    locate,
    north,
    free,
    device,
    motion: () => { stopDirection(); setDirection('motion'); },
    stopLocation: () => {
      stopStartup();
      if (direction === 'motion') free();
      active.current = false;
      stopWatch();
      setWatching(false);
      setLocating(false);
      setFix(null);
      locationCallback.current = null;
    },
    clearError: () => {
      setShowStatus(false);
      setLocationError('');
      setDirectionError('');
    },
  };
}
