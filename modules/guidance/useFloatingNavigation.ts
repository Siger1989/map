import { useCallback, useEffect, useRef, useState } from 'react';
import type { GuidanceSession } from './session';
import {
  buildFloatingNavigationPayload,
  parseFloatingNavigationStatus,
  serializeFloatingNavigationOptions,
  serializeFloatingNavigationPayload,
  type FloatingNavigationMode,
  type FloatingNavigationOptions,
  type FloatingNavigationStatus,
} from './floatingNavigation';

const emptyStatus: FloatingNavigationStatus = {
  available: false,
  enabled: false,
  visible: false,
  windowEnabled: true,
  lockscreenEnabled: true,
  energySaving: false,
  lockscreenKeepOn: false,
  mode: 'north',
  kind: 'position',
  message: '',
};

/** React UI for the native cross-app map. Native preferences remain the only saved source. */
export function useFloatingNavigation(
  session: GuidanceSession | null,
  options: { manageSession?: boolean; observe?: boolean } = {},
) {
  const [status, setStatus] = useState(emptyStatus);
  const [localMessage, setLocalMessage] = useState('');
  const [foregroundEpoch, setForegroundEpoch] = useState(0);
  const currentSession = useRef(session);
  currentSession.current = session;
  const lastSent = useRef<{
    coordinates: GuidanceSession['route']['coordinates'] | null;
    label: string;
    color: string;
    mode: FloatingNavigationMode;
    kind: 'route' | 'position';
  } | null>(null);
  const requestedRoute = useRef(false);

  const refresh = useCallback(() => {
    if (typeof window === 'undefined') return null;
    const bridge = window.ShantuFloatingNavigation;
    if (!bridge) {
      setStatus(emptyStatus);
      return null;
    }
    try {
      const next = parseFloatingNavigationStatus(bridge.status());
      if (!next) {
        setStatus({ ...emptyStatus, available: true, message: '悬浮导航状态暂不可读' });
        return null;
      }
      setStatus(next);
      setLocalMessage('');
      return next;
    } catch {
      setStatus({ ...emptyStatus, available: true, message: '无法读取悬浮导航状态' });
      return null;
    }
  }, []);

  const send = useCallback((
    action: 'start' | 'update' | 'restore',
    nextMode: FloatingNavigationMode,
  ) => {
    if (typeof window === 'undefined') return false;
    const bridge = window.ShantuFloatingNavigation;
    if (!bridge) {
      setLocalMessage('此平台不支持跨App悬浮地图');
      return false;
    }
    if (action === 'restore' && typeof bridge.restore !== 'function') return false;
    try {
      const liveSession = currentSession.current;
      const kind = liveSession ? 'route' : 'position';
      const payload = buildFloatingNavigationPayload(liveSession, nextMode, kind);
      const serialized = serializeFloatingNavigationPayload(payload);
      if (action === 'start') bridge.start(serialized);
      else if (action === 'update') bridge.update(serialized);
      else bridge.restore!(serialized);
      requestedRoute.current = kind === 'route';
      lastSent.current = {
        coordinates: liveSession ? liveSession.route.coordinates : null,
        label: payload.label,
        color: payload.color ?? '',
        mode: nextMode,
        kind,
      };
      setLocalMessage('');
      refresh();
      return true;
    } catch (error) {
      setLocalMessage(error instanceof Error ? error.message : '悬浮地图操作失败');
      refresh();
      return false;
    }
  }, [refresh]);

  const restore = useCallback(() => {
    if (options.manageSession === false || typeof window === 'undefined') return;
    const bridge = window.ShantuFloatingNavigation;
    if (!bridge || typeof bridge.restore !== 'function') return;
    const native = refresh();
    if (!native?.available || native.enabled || (!native.windowEnabled && !native.lockscreenEnabled)) return;
    send('restore', native.mode);
  }, [options.manageSession, refresh, send]);

  useEffect(() => {
    if (options.observe === false) return;
    refresh();
    restore();
    const onNativeState = () => {
      refresh();
      if (document.visibilityState === 'visible') setForegroundEpoch((epoch) => epoch + 1);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        refresh();
        restore();
        setForegroundEpoch((epoch) => epoch + 1);
      }
    };
    window.addEventListener('shantu:floating-navigation', onNativeState);
    document.addEventListener('visibilitychange', onVisibility);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, 2000);
    return () => {
      window.removeEventListener('shantu:floating-navigation', onNativeState);
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(timer);
    };
  }, [options.observe, refresh, restore]);

  const start = useCallback((nextMode = status.mode) => {
    return send('start', nextMode);
  }, [send, status]);

  const stop = useCallback(() => {
    if (typeof window === 'undefined') return;
    try {
      window.ShantuFloatingNavigation?.stop();
      requestedRoute.current = false;
      lastSent.current = null;
      setLocalMessage('');
    } catch {
      setLocalMessage('关闭悬浮地图失败');
    }
    refresh();
  }, [refresh]);

  const setMode = useCallback((nextMode: FloatingNavigationMode) => {
    const bridge = typeof window === 'undefined' ? undefined : window.ShantuFloatingNavigation;
    if (!bridge) { setLocalMessage('此平台不支持跨App悬浮地图'); return; }
    try {
      if (bridge.setOptions) {
        bridge.setOptions(serializeFloatingNavigationOptions({ mode: nextMode }));
      } else if (status.enabled) {
        send('update', nextMode);
      } else {
        setLocalMessage('当前原生桥接不支持保存未运行时的方向设置');
        return;
      }
      setLocalMessage('');
      refresh();
    } catch (error) {
      setLocalMessage(error instanceof Error ? error.message : '方向设置保存失败');
    }
  }, [refresh, send, status]);

  const setBooleanOption = useCallback((key: 'windowEnabled' | 'lockscreenEnabled' | 'energySaving' | 'lockscreenKeepOn', enabled: boolean) => {
    const bridge = typeof window === 'undefined' ? undefined : window.ShantuFloatingNavigation;
    if (!bridge) { setLocalMessage('此平台不支持跨App悬浮地图'); return; }
    const changed = { [key]: enabled } as Pick<FloatingNavigationOptions, typeof key>;
    try {
      if (bridge.setOptions) {
        bridge.setOptions(serializeFloatingNavigationOptions(changed));
        setLocalMessage('');
        refresh();
      } else if (enabled && (key === 'windowEnabled' || key === 'lockscreenEnabled')) {
        send('start', status.mode);
        setLocalMessage('此原生版本不支持保存此项悬浮地图设置');
        return;
      } else {
        setLocalMessage('当前原生桥接不支持保存此项悬浮地图设置');
        return;
      }
    } catch (error) {
      setLocalMessage(error instanceof Error ? error.message : '显示设置保存失败');
    }
    if ((key === 'windowEnabled' || key === 'lockscreenEnabled') && enabled && !status.enabled) send('start', status.mode);
  }, [refresh, send, status]);

  // Follow the live session automatically. Ending navigation changes the payload to position mode;
  // it never stops the independent native window/lockscreen service.
  useEffect(() => {
    if (options.manageSession === false || !status.enabled || document.visibilityState !== 'visible') return;
    const kind = session ? 'route' : 'position';
    const label = session ? session.route.stops?.at(-1)?.name?.trim() || '导航路线' : '定位小地图';
    const color = session ? session.route.style?.color?.toUpperCase() ?? '' : '';
    const coordinates = session ? session.route.coordinates : null;
    const previous = lastSent.current;
    if (previous?.coordinates === coordinates && previous.label === label && previous.color === color &&
        previous.mode === status.mode && previous.kind === kind) return;
    send('update', status.mode);
  }, [foregroundEpoch, options.manageSession, send, session, session?.route.coordinates, session?.route.stops, session?.route.style?.color, status]);

  // A permission sheet can outlive navigation. Cancel only an unstarted route request; a running
  // native service remains active and is switched to position mode by the live-session effect.
  useEffect(() => {
    if (options.manageSession === false || session || status.enabled || !requestedRoute.current) return;
    try { window.ShantuFloatingNavigation?.stop(); } catch { /* status remains native-owned */ }
    requestedRoute.current = false;
    lastSent.current = null;
    refresh();
  }, [options.manageSession, refresh, session, status.enabled]);

  return {
    enabled: status.enabled,
    supported: status.available,
    visible: status.visible,
    windowEnabled: status.windowEnabled,
    lockscreenEnabled: status.lockscreenEnabled,
    energySaving: status.energySaving,
    lockscreenKeepOn: status.lockscreenKeepOn,
    mode: status.mode,
    kind: session ? 'route' as const : 'position' as const,
    hasRoute: session !== null,
    zoom: status.zoom,
    widthDp: status.widthDp,
    heightDp: status.heightDp,
    message: localMessage || status.message,
    start,
    stop,
    setMode,
    setWindowEnabled: (enabled: boolean) => setBooleanOption('windowEnabled', enabled),
    setLockscreenEnabled: (enabled: boolean) => setBooleanOption('lockscreenEnabled', enabled),
    setEnergySaving: (enabled: boolean) => setBooleanOption('energySaving', enabled),
    setLockscreenKeepOn: (enabled: boolean) => setBooleanOption('lockscreenKeepOn', enabled),
  };
}
