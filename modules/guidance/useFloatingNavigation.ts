import { useCallback, useEffect, useRef, useState } from 'react';
import type { GuidanceSession } from './session';
import {
  buildFloatingNavigationPayload,
  parseFloatingNavigationStatus,
  serializeFloatingNavigationPayload,
  type FloatingNavigationMode,
  type FloatingNavigationKind,
  type FloatingNavigationStatus,
} from './floatingNavigation';

const emptyStatus: FloatingNavigationStatus = {
  available: false, enabled: false, visible: false, mode: 'north', kind: 'position', message: '',
};

/** Browser UI for the native, cross-app floating navigation service. It never fabricates support. */
export function useFloatingNavigation(
  session: GuidanceSession | null,
  options: { manageSession?: boolean; observe?: boolean } = {},
) {
  const [status, setStatus] = useState(emptyStatus);
  const [mode, setModeState] = useState<FloatingNavigationMode>('north');
  const [selectedKind, setKindState] = useState<FloatingNavigationKind | null>(null);
  const kind = selectedKind ?? (session ? 'route' : 'position');
  const [localMessage, setLocalMessage] = useState('');
  const [foregroundEpoch, setForegroundEpoch] = useState(0);
  const lastSent = useRef<{ coordinates: GuidanceSession['route']['coordinates'] | null; label: string; color: string; mode: FloatingNavigationMode; kind: FloatingNavigationKind } | null>(null);
  const stopRequested = useRef(false);
  const requestedKind = useRef<FloatingNavigationKind | null>(null);
  const observedNativeChoice = useRef('');

  const refresh = useCallback(() => {
    if (typeof window === 'undefined') return;
    const bridge = window.ShantuFloatingNavigation;
    if (!bridge) { setStatus(emptyStatus); return; }
    try {
      const next = parseFloatingNavigationStatus(bridge.status());
      setStatus(next ?? { ...emptyStatus, message: '悬浮导航状态暂不可读' });
      if (next?.enabled) {
        const choice = `${next.kind}/${next.mode}`;
        if (choice !== observedNativeChoice.current) {
          observedNativeChoice.current = choice;
          setModeState(next.mode);
          setKindState(next.kind);
        }
      } else {
        observedNativeChoice.current = '';
      }
    } catch {
      setStatus({ ...emptyStatus, message: '无法读取悬浮导航状态' });
    }
  }, []);

  useEffect(() => {
    if (options.observe === false) return;
    refresh();
    const onNativeState = () => {
      refresh();
      if (document.visibilityState === 'visible') setForegroundEpoch((epoch) => epoch + 1);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        refresh();
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
  }, [options.observe, refresh]);

  const send = useCallback((action: 'start' | 'update', nextMode = mode, nextKind = kind) => {
    if (typeof window === 'undefined') return false;
    const bridge = window.ShantuFloatingNavigation;
    if (!bridge) { setLocalMessage('此平台不支持跨App悬浮导航'); return false; }
    try {
      const payload = buildFloatingNavigationPayload(session, nextMode, nextKind);
      const serialized = serializeFloatingNavigationPayload(payload);
      bridge[action](serialized);
      requestedKind.current = nextKind;
      lastSent.current = { coordinates: nextKind === 'route' ? session!.route.coordinates : null, label: payload.label, color: payload.color ?? '', mode: nextMode, kind: nextKind };
      setModeState(nextMode);
      setKindState(nextKind);
      setLocalMessage('');
      refresh();
      return true;
    } catch (error) {
      setLocalMessage(error instanceof Error ? error.message : '悬浮导航操作失败');
      refresh();
      return false;
    }
  }, [kind, mode, refresh, session]);

  const start = useCallback((nextMode = mode) => {
    stopRequested.current = false;
    return send('start', nextMode);
  }, [mode, send]);
  const stop = useCallback(() => {
    stopRequested.current = true;
    try { window.ShantuFloatingNavigation?.stop(); }
    catch { setLocalMessage('关闭悬浮导航失败'); }
    lastSent.current = null;
    requestedKind.current = null;
    refresh();
  }, [refresh]);
  const setMode = useCallback((nextMode: FloatingNavigationMode) => {
    setModeState(nextMode);
    setLocalMessage('');
    if (status.enabled) send('update', nextMode);
  }, [send, status.enabled]);
  const setKind = useCallback((nextKind: FloatingNavigationKind) => {
    if (nextKind === 'route' && !session) return;
    setKindState(nextKind);
    setLocalMessage('');
    if (status.enabled) send('update', mode, nextKind);
  }, [mode, send, session, status.enabled]);

  // Route edits/reroutes refresh the overlay, while location fixes never trigger route resends.
  useEffect(() => {
    if (options.manageSession === false || !status.enabled || (kind === 'route' && !session) || document.visibilityState !== 'visible') return;
    const label = kind === 'route' ? session!.route.stops?.at(-1)?.name?.trim() || '导航路线' : '定位小地图';
    const color = kind === 'route' ? session!.route.style?.color?.toUpperCase() ?? '' : '';
    const previous = lastSent.current;
    if (previous?.coordinates === (kind === 'route' ? session!.route.coordinates : null) && previous.label === label && previous.color === color && previous.mode === mode && previous.kind === kind) return;
    send('update', mode);
  }, [foregroundEpoch, kind, mode, options.manageSession, send, session, status.enabled, session?.route.coordinates, session?.route.stops, session?.route.style?.color]);

  // A null session means navigation ended. Component unmount alone intentionally does not stop it,
  // because the card can temporarily disappear while panels are open or the app is backgrounded.
  useEffect(() => {
    if (session || options.manageSession === false) return;
    if (requestedKind.current === 'route' || (status.enabled && status.kind === 'route')) {
      if (!stopRequested.current) {
        stop();
        setKindState(null);
      }
    }
  }, [options.manageSession, session, status.enabled, status.kind, stop]);

  return {
    enabled: status.enabled,
    supported: status.available,
    visible: status.visible,
    mode,
    kind,
    hasRoute: session !== null,
    zoom: status.zoom,
    widthDp: status.widthDp,
    heightDp: status.heightDp,
    message: localMessage || status.message,
    start,
    stop,
    setMode,
    setKind,
  };
}
