import { useCallback, useEffect, useRef, useState } from 'react';
import type { GuidanceSession } from './session';
import {
  buildFloatingNavigationPayload,
  parseFloatingNavigationStatus,
  serializeFloatingNavigationPayload,
  type FloatingNavigationMode,
  type FloatingNavigationStatus,
} from './floatingNavigation';

const emptyStatus: FloatingNavigationStatus = {
  available: false, enabled: false, visible: false, mode: 'north', message: '',
};

/** Browser UI for the native, cross-app floating navigation service. It never fabricates support. */
export function useFloatingNavigation(
  session: GuidanceSession | null,
  options: { manageSession?: boolean; observe?: boolean } = {},
) {
  const [status, setStatus] = useState(emptyStatus);
  const [mode, setModeState] = useState<FloatingNavigationMode>('north');
  const [localMessage, setLocalMessage] = useState('');
  const [foregroundEpoch, setForegroundEpoch] = useState(0);
  const lastSent = useRef<{ coordinates: GuidanceSession['route']['coordinates']; label: string; mode: FloatingNavigationMode } | null>(null);
  const stopRequested = useRef(false);
  const hadSession = useRef(session !== null);

  const refresh = useCallback(() => {
    if (typeof window === 'undefined') return;
    const bridge = window.ShantuFloatingNavigation;
    if (!bridge) { setStatus(emptyStatus); return; }
    try {
      const next = parseFloatingNavigationStatus(bridge.status());
      setStatus(next ?? { ...emptyStatus, message: '悬浮导航状态暂不可读' });
      if (next?.enabled) setModeState(next.mode);
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

  const send = useCallback((kind: 'start' | 'update', nextMode = mode) => {
    if (!session || typeof window === 'undefined') return false;
    const bridge = window.ShantuFloatingNavigation;
    if (!bridge) { setLocalMessage('此平台不支持跨App悬浮导航'); return false; }
    try {
      const payload = buildFloatingNavigationPayload(session, nextMode);
      const serialized = serializeFloatingNavigationPayload(payload);
      bridge[kind](serialized);
      lastSent.current = { coordinates: session.route.coordinates, label: payload.label, mode: nextMode };
      setModeState(nextMode);
      setLocalMessage('');
      refresh();
      return true;
    } catch (error) {
      setLocalMessage(error instanceof Error ? error.message : '悬浮导航操作失败');
      refresh();
      return false;
    }
  }, [mode, refresh, session]);

  const start = useCallback((nextMode = mode) => {
    stopRequested.current = false;
    return send('start', nextMode);
  }, [mode, send]);
  const stop = useCallback(() => {
    stopRequested.current = true;
    try { window.ShantuFloatingNavigation?.stop(); }
    catch { setLocalMessage('关闭悬浮导航失败'); }
    lastSent.current = null;
    refresh();
  }, [refresh]);
  const setMode = useCallback((nextMode: FloatingNavigationMode) => {
    setModeState(nextMode);
    setLocalMessage('');
    if (status.enabled && session) send('update', nextMode);
  }, [send, session, status.enabled]);

  // Route edits/reroutes refresh the overlay, while location fixes never trigger route resends.
  useEffect(() => {
    if (options.manageSession === false || !status.enabled || !session || document.visibilityState !== 'visible') return;
    const label = session.route.stops?.at(-1)?.name?.trim() || '导航路线';
    const previous = lastSent.current;
    if (previous?.coordinates === session.route.coordinates && previous.label === label && previous.mode === mode) return;
    send('update', mode);
  }, [foregroundEpoch, mode, options.manageSession, send, session, status.enabled, session?.route.coordinates, session?.route.stops]);

  // A null session means navigation ended. Component unmount alone intentionally does not stop it,
  // because the card can temporarily disappear while panels are open or the app is backgrounded.
  useEffect(() => {
    if (session) {
      hadSession.current = true;
      return;
    }
    if (options.manageSession !== false && hadSession.current) {
      hadSession.current = false;
      if (!stopRequested.current) stop();
    }
  }, [options.manageSession, session, stop]);

  return {
    enabled: status.enabled,
    supported: status.available,
    visible: status.visible,
    mode,
    message: localMessage || status.message,
    start,
    stop,
    setMode,
  };
}
