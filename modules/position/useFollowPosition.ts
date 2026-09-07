import { useCallback, useEffect, useRef, useState } from 'react';
import type { Recording } from '../outdoor/recording';
import type { Coordinate } from '../navigation/types';
import type { PositionFix } from './types';
import { canFollow } from './follow';

export function useFollowPosition({
  fix,
  phase,
  blocked,
  onFollow,
}: {
  fix: PositionFix | null;
  phase: Recording['phase'];
  blocked: boolean;
  onFollow: (point: Coordinate) => boolean;
}) {
  const [following, setFollowing] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const current = useRef({ fix, blocked, onFollow });
  current.current = { fix, blocked, onFollow };
  const previousPhase = useRef(phase);
  const delivered = useRef('');
  const pause = useCallback(() => setFollowing(false), []);
  const resume = useCallback(() => {
    if (current.current.blocked) return;
    delivered.current = '';
    setFollowing(true);
  }, []);

  useEffect(() => {
    if (phase === 'recording') resume();
    else if (previousPhase.current === 'recording') pause();
    previousPhase.current = phase;
  }, [phase, pause, resume]);
  useEffect(() => {
    if (blocked) pause();
  }, [blocked, following, pause]);

  useEffect(() => {
    if (!following || blocked) return;
    const update = () => {
      if (document.hidden || current.current.blocked) return;
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
      // Retry after map loading; a native poll may repeat the same checkpoint.
      if (current.current.onFollow(value.coordinates)) {
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
