import { useEffect, useMemo, useState } from 'react';
import type { ManualTrack } from '../tracks/drawing';
import type { TrackOverlay } from '../tracks/TrackLayer';
import type { RouteOverlay } from '../navigation/types';
import { elevationStats } from '../journey/metrics';
import { useTrackElevation } from '../routeAnalysis/useTrackElevation';
import { analyzeRoute, metricLineParts } from '../routeAnalysis/metrics';
import {
  routeElevationScale,
} from '../routeAnalysis/elevationColors';
import { DEFAULT_TRACK_STYLE } from '../tracks/style';
import { trackHeights } from './elevation';
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
  }, [tracks.saved, tracks.visible, route.route]);
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
  const samples = useMemo(() => (data ? trackHeights(data) : []), [data]);
  const stats = useMemo(() => elevationStats(samples), [samples]);
  const metrics = useMemo(
    () => (data && needHeight ? analyzeRoute(data) : null),
    [data, needHeight],
  );
  const warnings = useMemo(() => {
    if (!data || !metrics || !preferences.steep || blocked) return [];
    return metrics.slopes
      .flatMap((line, part) => {
        const marks: {
          coordinate: ManualTrack['segments'][number][number];
          label: string;
        }[] = [];
        let peak: number | null = null;
        line.forEach((grade, i) => {
          if (grade === null || Math.abs(grade) < 20) {
            peak = null;
            return;
          }
          if (peak === null) {
            marks.push({
              coordinate: data.segments[part][i],
              label: `坡 ${Math.round(Math.abs(grade))}%`,
            });
            peak = Math.abs(grade);
          } else if (Math.abs(grade) > peak) {
            peak = Math.abs(grade);
            marks[marks.length - 1] = {
              coordinate: data.segments[part][i],
              label: `坡 ${Math.round(peak)}%`,
            };
          }
        });
        return marks;
      })
      .slice(0, 12);
  }, [data, metrics, preferences.steep, blocked]);
  const parts = useMemo(
    () =>
      data && mode !== 'solid' && !blocked
        ? metricLineParts(data, mode)
        : undefined,
    [data, mode, blocked],
  );
  const displayTracks = useMemo(
    () => ({
      ...tracks,
      analysisMarkers: warnings,
      saved:
        !data || blocked
          ? tracks.saved
          : tracks.saved.map((t) =>
              t.id === data.id
                ? {
                    ...t,
                    samples: data.samples,
                    style: {
                      ...(t.style ?? DEFAULT_TRACK_STYLE),
                      colorMode: mode,
                    },
                  }
                : t,
            ),
    }),
    [tracks, data, mode, blocked, warnings],
  );
  const displayRoute = useMemo(
    () => ({
      ...route,
      displayParts:
        data?.id === 'display-planned-route' && !blocked ? parts : undefined,
    }),
    [route, data?.id, parts, blocked],
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
    scale: useMemo(() => (data ? routeElevationScale(data) : null), [data]),
    loading: elevation.loading,
    estimated: elevation.estimated,
    elevationError: elevation.elevationError,
    refresh: elevation.refresh,
    tracks: displayTracks,
    route: displayRoute,
  };
}
