import { useCallback, useEffect, useRef, useState } from 'react';
import type { Recording } from '../outdoor/recording';
import type { Coordinate } from '../navigation/types';
import type { PositionFix } from './types';
import { canFollow, cameraMoved } from './follow';

export function useFollowPosition({
  fix,
  phase,
  blocked,
  onFollow,
  defer,
}: {
  fix: PositionFix | null;
  phase: Recording['phase'];
  blocked: boolean;
  onFollow: (point: Coordinate, fix: PositionFix, initial: boolean) => boolean;
  /** Defer camera delivery during a gesture without cancelling follow intent. */
  defer?: () => boolean;
}) {
  const [following, setFollowing] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const current = useRef({ fix, blocked, onFollow, defer });
  current.current = { fix, blocked, onFollow, defer };
  const delivered = useRef('');
  const cameraFix = useRef<PositionFix | null>(null);
  const pause = useCallback(() => setFollowing(false), []);
  const resume = useCallback(() => {
    if (current.current.blocked) return;
    delivered.current = '';
    cameraFix.current = null;
    setWaiting(true);
    setFollowing(true);
  }, []);

  useEffect(() => {
    if (phase === 'recording') resume();
  }, [phase, resume]);
  useEffect(() => {
    if (!following || blocked) return;
    const update = () => {
      if (document.hidden || current.current.blocked) return;
      if (current.current.defer?.()) return;
      const value = current.current.fix;
      if (!canFollow(value)) {
        setWaiting(true);
        return;
      }
      const key = `${value.timestamp}/${value.coordinates.join('/')}`;
      if (key === delivered.current) {
        setWaiting(false);
        return;
      }
      if (!cameraMoved(cameraFix.current, value)) {
        setWaiting(false);
        return;
      }
      // Retry after map loading; a native poll may repeat the same checkpoint.
      if (current.current.onFollow(value.coordinates, value, cameraFix.current === null)) {
        cameraFix.current = value;
        delivered.current = key;
        setWaiting(false);
      } else setWaiting(true);
    };
    update();
    const timer = window.setInterval(update, 1000);
    document.addEventListener('visibilitychange', update);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', update);
    };
  }, [
    following,
    blocked,
    fix?.timestamp,
    fix?.coordinates[0],
    fix?.coordinates[1],
    fix?.accuracy,
  ]);
  return { following: following && !blocked, waiting, blocked, pause, resume };
}
