import { useRef, useState } from 'react';
import type { ManualTrack } from './drawing';
import { startRouteEdit, type RouteEditSession } from './routeEdit';

export function useRouteEditor() {
  const [session, setSession] = useState<RouteEditSession | null>(null);
  const ref = useRef(session);
  ref.current = session;
  const [error, setError] = useState('');
  const change = (operation: (value: RouteEditSession) => RouteEditSession) => {
    if (!ref.current) return false;
    try {
      const next = operation(ref.current);
      ref.current = next;
      setSession(next);
      setError('');
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : '修改失败，当前编辑已保留。');
      return false;
    }
  };
  return {
    session,
    error,
    setError,
    change,
    start: (track: ManualTrack) => {
      const next = startRouteEdit(track);
      ref.current = next;
      setSession(next);
      setError('');
    },
    close: () => {
      ref.current = null;
      setSession(null);
      setError('');
    },
  };
}
