import { useEffect, useRef, useState } from 'react';
import {
  watchNativePosition,
  type NativePositionBridge,
} from './nativePosition';
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
  const nativeStop = useRef<(() => void) | null>(null);
  const [fix, setFix] = useState<PositionFix | null>(null),
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
  const stopWatch = () => {
    nativeStop.current?.();
    nativeStop.current = null;
    if (watch.current !== null)
      navigator.geolocation?.clearWatch(watch.current);
    watch.current = null;
  };
  const beginWatch = () => {
    stopWatch();
    const accept = (value: PositionFix) => {
      if (!active.current) return;
      setFix(value);
      setLocating(false);
      setLocationError('');
      locationCallback.current?.(value);
      locationCallback.current = null;
    };
    const bridge = window.GuanyunNative;
    if (bridge?.locate && bridge.locationState && bridge.stopLocation) {
      nativeStop.current = watchNativePosition(
        bridge as NativePositionBridge,
        modeRef.current,
        accept,
        (error) => {
          if (!active.current) return;
          if (error) setLocating(false);
          setLocationError(error);
        },
      );
      return;
    }
    watch.current = navigator.geolocation.watchPosition(
      (position) => {
        const value = positionFix(position);
        if (!active.current || !value) return;
        accept(value);
      },
      (error) => {
        if (!active.current) return;
        setLocating(false);
        locationCallback.current = null;
        setLocationError(
          error.code === 1
            ? '定位权限未允许，请在系统设置中开启。'
            : error.code === 3
              ? '定位超时，请到开阔处重试。'
              : '暂时无法定位，请检查系统定位开关。',
        );
        if (error.code === 1) {
          active.current = false;
          setWatching(false);
          stopWatch();
        }
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
  };
  const locate = (onFix?: (fix: PositionFix) => void) => {
    setShowStatus(true);
    if (
      !window.GuanyunNative?.locate &&
      (!window.isSecureContext || !navigator.geolocation)
    ) {
      setLocationError('此页面无法定位，请使用APK或HTTPS页面。');
      return;
    }
    active.current = true;
    locationCallback.current = onFix ?? null;
    setWatching(true);
    setLocating(true);
    setLocationError('');
    beginWatch();
  };
  const changeMode = (
    next: LocationMode,
    onFix?: (fix: PositionFix) => void,
  ) => {
    modeRef.current = next;
    setMode(next);
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
      Boolean(bridge?.locate && bridge.locationState && bridge.stopLocation),
    );
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
    fix,
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
    stopLocation: () => {
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
