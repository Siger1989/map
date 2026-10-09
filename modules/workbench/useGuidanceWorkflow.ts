import { useEffect, useRef, useState, type RefObject } from 'react';
import type { useGuidance } from '../guidance/useGuidance';
import type { usePosition } from '../position/usePosition';
import type { useFollowPosition } from '../position/useFollowPosition';
import type { useRecording } from '../outdoor/useRecording';
import type { useNavigation } from '../navigation/useNavigation';
import type { useManualTracks } from '../tracks/useManualTracks';
import type { MapHandle } from '../map/TerrainMap';
import { validFavorite, type RouteFavorite } from '../navigation/favorites';
import { RouteDisconnectedError, RouteEndpointRequiredError, trackNavigation } from '../guidance/savedRoute';
import type { RouteGap } from '../tracks/routeInfo';
import { freshFix } from '../guidance/session';
import type { PositionFix } from '../position/types';
import { resolveTrackConnections } from '../guidance/trackConnections';
import { planRoute } from '../navigation/provider';

/** Navigation workflow owns its UI session and location lifecycle; other tools close through one callback. */
export function useGuidanceWorkflow({
  guidance,
  position,
  follow,
  recorder,
  navigation,
  tracks,
  map,
  activeAlternative,
  onOpenRoute,
  onOpenRouteCard,
  onActivateUi,
  onInvalidRoute,
  initialFix,
}: {
  guidance: ReturnType<typeof useGuidance>;
  position: Pick<
    ReturnType<typeof usePosition>,
    'watching' | 'stopLocation' | 'free' | 'mode' | 'changeMode' | 'locate'
  >;
  follow: Pick<ReturnType<typeof useFollowPosition>, 'pause' | 'resume'>;
  recorder: Pick<
    ReturnType<typeof useRecording>,
    'record' | 'command' | 'sampling'
  >;
  navigation: Pick<
    ReturnType<typeof useNavigation>,
    'route' | 'start' | 'end' | 'restore' | 'adoptRoute'
  >;
  tracks: Pick<ReturnType<typeof useManualTracks>, 'saved' | 'selectedId'>;
  map: RefObject<MapHandle | null>;
  activeAlternative: string;
  onOpenRoute: (id: string) => void;
  onOpenRouteCard?: () => void;
  onActivateUi: () => void;
  onInvalidRoute: () => void;
  /** Last real fix known by the page; absent/stale fixes never become a user origin. */
  initialFix?: PositionFix | null;
}) {
  const guidanceOwnsLocation = useRef(false),
    guidanceFocused = useRef(false);
  const [savedNavigationError, setSavedNavigationErrorState] = useState('');
  const [savedNavigationGap, setSavedNavigationGap] = useState<RouteGap | null>(null);
  const setSavedNavigationError = (error: string) => {
    setSavedNavigationErrorState(error);
    setSavedNavigationGap(null);
  };
  const setDisconnectedNavigationError = (error: RouteDisconnectedError) => {
    setSavedNavigationErrorState(error.message);
    setSavedNavigationGap(error.gap);
  };
  const [navigationTarget, setNavigationTarget] =
    useState<RouteFavorite | null>(null);
  useEffect(() => {
    if (!guidance.active && guidanceOwnsLocation.current) {
      guidanceOwnsLocation.current = false;
      position.stopLocation();
      if (recorder.record.phase !== 'recording') follow.pause();
    }
    const s = guidance.session;
    if (s?.last && !s.quality && !guidanceFocused.current) {
      guidanceFocused.current = true;
      map.current?.focusCenter(s.last.coordinates);
      follow.resume();
    }
  }, [
    guidance.active,
    guidance.session?.last?.timestamp,
    guidance.session?.quality,
  ]);
  const activateGuidance = (route = navigation.route) => {
    if (!guidance.start(route)) {
      onInvalidRoute();
      return;
    }
    if (
      recorder.sampling.policy.recordOnNavigation &&
      recorder.record.phase === 'idle'
    )
      recorder.command('start');
    guidanceOwnsLocation.current =
      guidanceOwnsLocation.current || !position.watching;
    guidanceFocused.current = false;
    const cameraTarget = initialFix && freshFix(initialFix)
      ? initialFix.coordinates
      : route?.coordinates[0];
    if (cameraTarget) map.current?.focusCenter(cameraTarget);
    onActivateUi();
    position.free();
    map.current?.previewRoute(null);
    map.current?.clearRouteGap();
    map.current?.clearRouteIssue();
    if (position.mode === 'network') position.changeMode('auto');
    else position.locate();
  };
  const startRequest = useRef<AbortController | null>(null);
  useEffect(() => () => startRequest.current?.abort(), []);
  const startGuidance = () => {
    const route = navigation.route;
    if (!route || !navigation.start || !navigation.end) {
      onInvalidRoute();
      return;
    }
    setSavedNavigationError('');
    if (route.geometryKind !== 'track') {
      activateGuidance(route);
      return;
    }
    startRequest.current?.abort();
    const abort = new AbortController();
    startRequest.current = abort;
    void resolveTrackConnections(route, planRoute, abort.signal)
      .then((resolved) => {
        if (abort.signal.aborted || startRequest.current !== abort) return;
        navigation.adoptRoute(resolved);
        activateGuidance(resolved);
      })
      .catch((error) => {
        if (!abort.signal.aborted && startRequest.current === abort)
          setSavedNavigationError(error instanceof Error ? error.message : '轨迹接入路线计算失败，请重试。');
      })
      .finally(() => {
        if (startRequest.current === abort) startRequest.current = null;
      });
  };
  const navigateFavorite = (favorite: RouteFavorite) => {
    setSavedNavigationError('');
    if (!validFavorite(favorite)) {
      setSavedNavigationError('收藏路线数据无效，无法导航。');
      return;
    }
    if (!navigation.restore(favorite)) return;
    setNavigationTarget(null);
    onActivateUi();
    onOpenRouteCard?.();
  };
  const beginFavorite = (favorite: RouteFavorite) => {
    navigateFavorite(favorite);
  };
  const onRouteApplied = (route: NonNullable<ReturnType<typeof useNavigation>['route']>) => {
    if (guidance.active) guidance.replaceRoute(route);
  };
  const navigateTrack = (id: string, reversed = false) => {
    setSavedNavigationError('');
    map.current?.clearRouteGap();
    map.current?.clearRouteIssue();
    try {
      const track = tracks.saved.find((item) => item.id === id);
      if (!track) throw new Error('轨迹已不存在，请重新选择。');
      if (tracks.selectedId !== id) onOpenRoute(id);
      navigateFavorite(
        trackNavigation(
          track,
          Date.now(),
          track.navigationMode ?? 'pedestrian',
          tracks.saved,
          activeAlternative,
          reversed,
          true,
        ),
      );
    } catch (error) {
      if (error instanceof RouteDisconnectedError) {
        setDisconnectedNavigationError(error);
        return;
      }
      if (error instanceof RouteEndpointRequiredError) {
        map.current?.focusRouteIssue(error.target, error.targetKind);
        setSavedNavigationError(error.targetKind === 'fork'
          ? '已定位一处分叉点。请在线路编辑中选择目标终点并设为终点。'
          : '路线终点未指定，已定位末端候选节点。请进入线路编辑，点选节点并设为终点。');
        return;
      }
      setSavedNavigationError(
        error instanceof Error ? error.message : '无法开始轨迹导航。',
      );
    }
  };

  return {
    savedNavigationError,
    savedNavigationGap,
    setSavedNavigationError,
    setDisconnectedNavigationError,
    navigationTarget,
    setNavigationTarget,
    startGuidance,
    beginFavorite,
    navigateFavorite,
    navigateTrack,
    onRouteApplied,
  };
}
