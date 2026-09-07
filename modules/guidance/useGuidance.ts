import { useEffect, useRef, useState } from 'react';
import type { PlannedRoute } from '../navigation/types';
import type { PositionFix } from '../position/types';
import {
  advance,
  createSession,
  deviationLimit,
  freshFix,
  rejoinTarget,
  type GuidanceSession,
} from './session';
import { calculateRejoin, type Rejoin } from './rejoin';
import { nextInstruction, project } from './geometry';

export function useGuidance(
  route: PlannedRoute | null,
  fix: PositionFix | null,
  locationError: string,
) {
  const [session, setSession] = useState<GuidanceSession | null>(null),
    [rejoin, setRejoin] = useState<Rejoin | null>(null);
  const [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [online, setOnline] = useState(true),
    [retry, setRetry] = useState(0);
  const current = useRef({ route, fix, locationError, session, rejoin });
  current.current = { route, fix, locationError, session, rejoin };
  const request = useRef<AbortController | null>(null),
    generation = useRef(0),
    nextRequest = useRef(0),
    detourSince = useRef<number | null>(null);
  const stop = () => {
    generation.current++;
    request.current?.abort();
    request.current = null;
    setSession(null);
    setRejoin(null);
    setLoading(false);
    setError('');
    detourSince.current = null;
  };
  useEffect(() => {
    const network = () => setOnline(navigator.onLine);
    network();
    window.addEventListener('online', network);
    window.addEventListener('offline', network);
    return () => {
      generation.current++;
      request.current?.abort();
      window.removeEventListener('online', network);
      window.removeEventListener('offline', network);
    };
  }, []);
  useEffect(() => {
    if (session && session.route !== route) stop();
  }, [route, session?.route]);
  useEffect(() => {
    if (!session) return;
    const update = () =>
      setSession((s) =>
        s
          ? advance(
              s,
              current.current.fix,
              Date.now(),
              document.hidden
                ? '应用在后台，等待返回后更新定位'
                : current.current.locationError,
            )
          : null,
      );
    update();
    const timer = window.setInterval(update, 1000);
    document.addEventListener('visibilitychange', update);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', update);
    };
  }, [!!session, fix, locationError]);
  useEffect(() => {
    if (
      !session ||
      session.route !== route ||
      session.arrived ||
      !session.offRoute ||
      session.quality ||
      !online ||
      document.hidden
    ) {
      generation.current++;
      request.current?.abort();
      request.current = null;
      setLoading(false);
      if (!session?.offRoute || session?.arrived) {
        setRejoin(null);
        setError('');
        detourSince.current = null;
      }
      return;
    }
    if (
      request.current ||
      !session.last ||
      !freshFix(session.last) ||
      Date.now() < nextRequest.current
    )
      return;
    if (rejoin) {
      const hit = project(rejoin.path, session.last.coordinates);
      if (hit.offset <= deviationLimit(session.last)) {
        detourSince.current = null;
        return;
      }
      detourSince.current ??= session.last.timestamp;
      if (session.last.timestamp - detourSince.current < 3000) return;
    }
    const target = rejoinTarget(session);
    if (!target) return;
    const abort = new AbortController(),
      token = ++generation.current;
    request.current = abort;
    nextRequest.current = Date.now() + 30000;
    setLoading(true);
    setError('');
    setRejoin(null);
    void calculateRejoin(session.route, session.last, target, abort.signal)
      .then((value) => {
        const live = current.current.session;
        if (
          token === generation.current &&
          !abort.signal.aborted &&
          live?.offRoute &&
          !live.quality &&
          !live.arrived
        ) {
          if (
            !live.last ||
            project(value.path, live.last.coordinates).offset >
              deviationLimit(live.last)
          ) {
            setError('位置已变化，等待重新计算接回路线。');
            return;
          }
          setRejoin(value);
        }
      })
      .catch((e) => {
        if (token === generation.current && !abort.signal.aborted) {
          nextRequest.current = Date.now() + 60000;
          setError(
            e instanceof Error &&
              !['TypeError', 'TimeoutError'].includes(e.name)
              ? e.message
              : '接回路线计算失败，请检查网络后重试。',
          );
        }
      })
      .finally(() => {
        if (token === generation.current) {
          request.current = null;
          setLoading(false);
        }
      });
  }, [session, route, rejoin, online, retry]);
  const active = !!session && session.route === route;
  let remaining = session
    ? Math.max(0, session.path.length - session.progress)
    : 0;
  let instruction = session
    ? nextInstruction(session.route, session.progress, session.path.length)
    : null;
  if (session?.offRoute && rejoin && session.last) {
    const hit = project(rejoin.path, session.last.coordinates);
    remaining =
      Math.max(0, rejoin.path.length - hit.distance) +
      session.path.length -
      rejoin.target.distance;
    instruction = nextInstruction(
      rejoin.route,
      hit.distance,
      rejoin.path.length,
      true,
    );
  }
  return {
    active,
    session: active ? session : null,
    rejoin: active ? rejoin : null,
    loading,
    error,
    online,
    remaining,
    instruction,
    start: () => {
      stop();
      nextRequest.current = 0;
      if (!route) return false;
      try {
        setSession(createSession(route));
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : '请重新规划路线');
        return false;
      }
    },
    stop,
    retry: () => {
      if (request.current) return;
      nextRequest.current = 0;
      setRejoin(null);
      detourSince.current = null;
      setRetry((n) => n + 1);
    },
  };
}
export type GuidanceState = ReturnType<typeof useGuidance>;
