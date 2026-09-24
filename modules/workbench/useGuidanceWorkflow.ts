import { useEffect, useRef, useState, type RefObject } from 'react';
import type { useGuidance } from '../guidance/useGuidance';
import type { usePosition } from '../position/usePosition';
import type { useFollowPosition } from '../position/useFollowPosition';
import type { useRecording } from '../outdoor/useRecording';
import type { useNavigation } from '../navigation/useNavigation';
import type { useManualTracks } from '../tracks/useManualTracks';
import type { MapHandle } from '../map/TerrainMap';
import { validFavorite, type RouteFavorite } from '../navigation/favorites';
import { trackNavigation } from '../guidance/savedRoute';
import { createSession } from '../guidance/session';
import { routeGap } from '../tracks/routeInfo';

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
  onActivateUi,
  onInvalidRoute,
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
    'route' | 'start' | 'end' | 'restore'
  >;
  tracks: Pick<ReturnType<typeof useManualTracks>, 'saved' | 'selectedId'>;
  map: RefObject<MapHandle | null>;
  activeAlternative: string;
  onOpenRoute: (id: string) => void;
  onActivateUi: () => void;
  onInvalidRoute: () => void;
}) {
  const guidanceOwnsLocation = useRef(false),
    guidanceFocused = useRef(false);
  const [savedNavigationError, setSavedNavigationError] = useState('');
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
      map.current?.focusPoint(
        s.last.coordinates,
        s.route.mode === 'auto' ? 16 : 17,
      );
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
    onActivateUi();
    position.free();
    map.current?.previewRoute(null);
    map.current?.clearRouteGap();
    if (position.mode === 'network') position.changeMode('auto');
    else position.locate();
  };
  const startGuidance = () => {
    const route = navigation.route;
    if (route && navigation.start && navigation.end)
      setNavigationTarget({
        id: 'current-route',
        name: `${navigation.start.name} → ${navigation.end.name}`,
        savedAt: Date.now(),
        start: navigation.start,
        end: navigation.end,
        route,
      });
  };
  const navigateFavorite = (favorite: RouteFavorite) =>
    setNavigationTarget(favorite);
  const beginFavorite = (favorite: RouteFavorite) => {
    setSavedNavigationError('');
    try {
      if (!validFavorite(favorite))
        throw new Error('收藏路线数据无效，无法导航。');
      createSession(favorite.route);
      if (!navigation.restore(favorite)) return;
      map.current?.fitRoute(favorite.route.coordinates);
      activateGuidance(favorite.route);
      setNavigationTarget(null);
    } catch (error) {
      setSavedNavigationError(
        error instanceof Error ? error.message : '无法开始导航。',
      );
    }
  };
  const navigateTrack = (id: string, reversed = false) => {
    setSavedNavigationError('');
    map.current?.clearRouteGap();
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
        ),
      );
    } catch (error) {
      // Only geometry failures get a missing-connection marker. Network, data
      // and provider failures must not be misrepresented as a route gap.
      if (
        error instanceof Error &&
        error.message.includes('不相接的线段')
      ) {
        const track = tracks.saved.find((item) => item.id === id);
        const gap = track && routeGap(track);
        if (gap) {
          map.current?.focusRouteGap(gap);
          setSavedNavigationError(`${error.message} 已定位约${Math.max(0.1, Math.round(gap.distance * 10) / 10)}米缺口，红色虚线标出两端。`);
          return;
        }
      }
      setSavedNavigationError(
        error instanceof Error ? error.message : '无法开始轨迹导航。',
      );
    }
  };

  return {
    savedNavigationError,
    setSavedNavigationError,
    navigationTarget,
    setNavigationTarget,
    startGuidance,
    beginFavorite,
    navigateFavorite,
    navigateTrack,
  };
}
