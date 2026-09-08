import { useEffect, useRef, useState } from 'react';
import type { PlannedRoute } from '../navigation/types';
import type { PositionFix } from '../position/types';
import {
  createSession,
  deviationLimit,
  freshFix,
  rejoinTarget,
  type GuidanceSession,
} from './session';
import { calculateRejoin, type Rejoin } from './rejoin';
import { nextInstruction, project, pathOf } from './geometry';
import { planRoute } from '../navigation/provider';
import { atStart, connectDeparture } from './departure';
import { routeOnNetwork } from './network';
import { advanceNetwork } from './networkSession';

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
  const departureRequest = useRef<AbortController | null>(null);
  const stop = () => {
    generation.current++;
    request.current?.abort();
    departureRequest.current?.abort();
    departureRequest.current = null;
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
      departureRequest.current?.abort();
      window.removeEventListener('online', network);
      window.removeEventListener('offline', network);
    };
  }, []);
  useEffect(() => {
    if (session && session.originalRoute !== route) stop();
  }, [route, session?.originalRoute]);
  useEffect(() => {
    if (
      !session?.departurePending ||
      !freshFix(fix) ||
      !fix ||
      locationError ||
      document.hidden ||
      departureRequest.current ||
      Date.now() < nextRequest.current
    )
      return;
    const original = session.originalRoute;
    const nearest = original.trackNetwork
      ? routeOnNetwork(original, fix.coordinates)
      : null;
    const departureTarget =
      nearest && nearest.route.distance >= 20 ? nearest.route : original;
    if (
      atStart(departureTarget, fix) ||
      (nearest && nearest.offset <= Math.max(20, Math.min(35, fix.accuracy)))
    ) {
      setSession((s) =>
        s?.originalRoute === original
          ? {
              ...createSession(departureTarget),
              originalRoute: original,
              departurePending: false,
            }
          : s,
      );
      setError('');
      return;
    }
    if (!online) return;
    const abort = new AbortController();
    departureRequest.current = abort;
    nextRequest.current = Date.now() + 30000;
    setLoading(true);
    setError('');
    void planRoute(
      { name: '当前位置', coordinates: fix.coordinates },
      {
        name: nearest ? '最近接入点' : '主体起点',
        coordinates: departureTarget.coordinates[0],
      },
      original.mode,
      abort.signal,
    )
      .then((approach) => {
        if (
          abort.signal.aborted ||
          current.current.session?.originalRoute !== original
        )
          return;
        const latestFix = current.current.fix;
        if (
          !latestFix ||
          !freshFix(latestFix) ||
          project(pathOf(approach.coordinates), latestFix.coordinates).offset >
            deviationLimit(latestFix)
        )
          throw new Error('位置已变化或过期，请重新计算到起点的路线。');
        const result = connectDeparture(departureTarget, approach, fix);
        setSession({
          ...createSession(result.route),
          originalRoute: original,
          departureLength: result.length,
          departureRoute: approach,
        });
      })
      .catch((e) => {
        if (!abort.signal.aborted)
          setError(
            e instanceof Error ? e.message : '到起点的路线计算失败，请重试',
          );
      })
      .finally(() => {
        if (!abort.signal.aborted) {
          departureRequest.current = null;
          setLoading(false);
        }
      });
  }, [session, fix, locationError, online, retry]);
  useEffect(() => {
    if (!session) return;
    const update = () =>
      setSession((s) =>
        s && !s.departurePending
          ? advanceNetwork(
              s,
              current.current.fix,
              Date.now(),
              document.hidden
                ? '应用在后台，等待返回后更新定位'
                : current.current.locationError,
            )
          : s,
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
      session.originalRoute !== route ||
      session.departurePending ||
      session.arrived ||
      !session.offRoute ||
      session.quality ||
      !online ||
      document.hidden
    ) {
      generation.current++;
      request.current?.abort();
      request.current = null;
      if (!session?.departurePending) setLoading(false);
      if (
        (!session?.offRoute || session?.arrived) &&
        !session?.departurePending
      ) {
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
  const active = !!session && session.originalRoute === route;
  let remaining = session
    ? Math.max(0, session.path.length - session.progress)
    : 0;
  let instruction = session
    ? nextInstruction(session.route, session.progress, session.path.length)
    : null;
  if (session?.departureRoute && session.nextCheckpoint === 0) {
    const next = nextInstruction(
      session.departureRoute,
      session.progress,
      session.departureLength,
      true,
    );
    instruction = {
      ...next,
      text:
        next.text === '接回原路线'
          ? session.originalRoute.trackNetwork
            ? '到达最近接入点'
            : '到达主体起点'
          : next.text,
    };
  }
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
    departureMessage:
      locationError ||
      (!fix
        ? '等待当前位置…'
        : !freshFix(fix)
          ? fix.accuracy > 50
            ? `定位精度约±${Math.round(fix.accuracy)}米，等待准确位置`
            : '定位已过期，等待更新'
          : !online
            ? '请联网后计算接入路线'
            : route?.trackNetwork
              ? '前往最近相连路段'
              : '先前往主体起点'),
    active,
    session: active ? session : null,
    rejoin: active ? rejoin : null,
    loading,
    error,
    online,
    remaining,
    instruction,
    start: (target = route) => {
      stop();
      nextRequest.current = 0;
      if (!target) return false;
      try {
        setSession({ ...createSession(target), departurePending: true });
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : '请重新规划路线');
        return false;
      }
    },
    stop,
    retry: () => {
      if (request.current || departureRequest.current) return;
      nextRequest.current = 0;
      setRejoin(null);
      detourSince.current = null;
      setRetry((n) => n + 1);
    },
  };
}
export type GuidanceState = ReturnType<typeof useGuidance>;
