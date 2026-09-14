import { useEffect, useMemo, useState } from 'react';
import type { ManualTrack } from '../tracks/drawing';
import type { TrackOverlay } from '../tracks/TrackLayer';
import type { RouteOverlay } from '../navigation/types';
import { elevationStats } from '../journey/metrics';
import { useTrackElevation } from '../routeAnalysis/useTrackElevation';
import { analyzeRoute, metricLineParts } from '../routeAnalysis/metrics';
import { routeElevationScale } from '../routeAnalysis/elevationColors';
import { DEFAULT_TRACK_STYLE } from '../tracks/style';
import { DRAFT_ID } from '../tracks/editing';
import { trackHeights } from './elevation';
import { steepWarningMarkers } from './warningMarkers';
import {
  DEFAULT_ROUTE_DISPLAY,
  normalizeRouteDisplay,
  ROUTE_DISPLAY_KEY,
  type RouteDisplayPreferences,
} from './preferences';

/** Preferences and derived display geometry only. Never writes tracks or navigation routes. */
export function useRouteDisplay(
  tracks: TrackOverlay,
  route: RouteOverlay,
  preferredId: string | null,
  blocked: boolean,
) {
  const [preferences, setPreferences] = useState(DEFAULT_ROUTE_DISPLAY);
  const [ready, setReady] = useState(false),
    [error, setError] = useState('');
  const [chosenId, choose] = useState<string | null>(null);
  useEffect(() => {
    try {
      setPreferences(
        normalizeRouteDisplay(
          JSON.parse(localStorage.getItem(ROUTE_DISPLAY_KEY) ?? 'null'),
        ),
      );
    } catch {
      setError('显示设置读取失败，本次使用默认值');
    }
    setReady(true);
  }, []);
  const update = (patch: Partial<RouteDisplayPreferences>) => {
    const next = normalizeRouteDisplay({ ...preferences, ...patch });
    try {
      localStorage.setItem(ROUTE_DISPLAY_KEY, JSON.stringify(next));
      setPreferences(next);
      setError('');
    } catch {
      setError('显示设置未保存，请检查可用存储');
    }
  };
  useEffect(() => {
    if (preferredId) choose(preferredId);
  }, [preferredId]);
  const candidates = useMemo(() => {
    const values: ManualTrack[] = tracks.visible
      ? tracks.saved.filter((t) => !t.hidden)
      : [];
    if (tracks.visible && tracks.draft.some((line) => line.length >= 2))
      values.push({
        id: DRAFT_ID,
        name: '当前绘制路线',
        createdAt: 0,
        segments: tracks.draft,
        style: tracks.style,
      });
    if (route.route)
      values.push({
        id: 'display-planned-route',
        name: '当前规划 / 导航路线',
        createdAt: route.route.createdAt,
        segments: (
          route.route.segments ?? [
            { kind: 'road', coordinates: route.route.coordinates },
          ]
        )
          .filter((s) => s.kind !== 'access')
          .map((s) => s.coordinates),
        style: { ...DEFAULT_TRACK_STYLE, color: '#59dcff', width: 4 },
      });
    return values;
  }, [tracks.saved, tracks.visible, tracks.draft, tracks.style, route.route]);
  const target =
    candidates.find((t) => t.id === chosenId) ??
    candidates.find((t) => t.id === preferredId) ??
    candidates.at(-1) ??
    null;
  const mode =
    preferences.mode === 'original'
      ? (target?.style?.colorMode ?? 'solid')
      : preferences.mode;
  const needHeight =
    ready &&
    (mode === 'elevation' ||
      mode === 'slope' ||
      preferences.profile ||
      preferences.statistics ||
      preferences.steep);
  const elevation = useTrackElevation(target, needHeight);
  const data = elevation.data;
  const profile = elevation.profile;
  const samples = useMemo(
    () => (profile ? trackHeights(profile) : []),
    [profile],
  );
  const stats = useMemo(() => elevationStats(samples), [samples]);
  const metrics = useMemo(
    () => (profile && needHeight ? analyzeRoute(profile) : null),
    [profile, needHeight],
  );
  const warnings = useMemo(() => {
    if (!profile || !metrics || !preferences.steep || blocked) return [];
    return steepWarningMarkers(profile, metrics.slopes);
  }, [profile, metrics, preferences.steep, blocked]);
  const parts = useMemo(
    () =>
      data && profile && mode !== 'solid'
        ? metricLineParts(mode === 'speed' ? data : profile, mode)
        : undefined,
    [data, profile, mode],
  );
  const displayTracks = useMemo(
    () => ({
      ...tracks,
      analysisMarkers: warnings,
      analysisParts: data && parts ? { trackId: data.id, parts } : undefined,
      style:
        data?.id === DRAFT_ID
          ? { ...tracks.style, colorMode: mode }
          : tracks.style,
      saved: !data
        ? tracks.saved
        : tracks.saved.map((t) =>
            t.id === data.id
              ? {
                  ...t,
                  style: {
                    ...(t.style ?? DEFAULT_TRACK_STYLE),
                    colorMode: mode,
                  },
                }
              : t,
          ),
    }),
    [tracks, data, mode, parts, warnings],
  );
  const displayRoute = useMemo(
    () => ({
      ...route,
      displayParts: data?.id === 'display-planned-route' ? parts : undefined,
    }),
    [route, data?.id, parts],
  );
  return {
    preferences,
    update,
    ready,
    error,
    candidates,
    target,
    choose,
    mode,
    data,
    samples,
    stats,
    metrics,
    scale: useMemo(
      () => (profile ? routeElevationScale(profile) : null),
      [profile],
    ),
    loading: elevation.loading,
    estimated: elevation.estimated,
    elevationError: elevation.elevationError,
    refresh: elevation.refresh,
    tracks: displayTracks,
    route: displayRoute,
  };
}
