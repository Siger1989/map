import type { Feature, FeatureCollection, Geometry } from 'geojson';
import type { Coordinate } from '../../navigation/types.ts';
import type { RouteGap } from '../../tracks/routeInfo.ts';
import type { TripPackage } from '../../outdoor/offline.ts';
import { coverageGeometry } from '../../outdoor/offlineCoverage.ts';
import { cachePackagePreview } from '../../outdoor/cachePackagePreview.ts';

type Properties = Record<string, string | number | boolean | readonly number[] | null | undefined>;
const collection = (features: Feature[] = []): FeatureCollection => ({ type: 'FeatureCollection', features });
const feature = (geometry: Geometry, properties: Properties): Feature => ({ type: 'Feature', geometry, properties });
const validCoordinate = (value: Coordinate | null | undefined): value is Coordinate => !!value &&
  value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1]) && value[1] >= -90 && value[1] <= 90;

/** Temporary native-map counterparts of the existing preview, gap, issue and offline coverage layers. */
export class NativeTransientGeometry {
  private readonly roles = new Map<'previewRoute' | 'routeGap' | 'routeIssue' | 'offlineCoverage' | 'collectionSelection', Feature[]>();
  private selectionTimer: ReturnType<typeof setTimeout> | null = null;
  private coverageTimer: ReturnType<typeof setTimeout> | null = null;
  private coverageGeneration = 0;
  private readonly onCoverageExpired?: () => void;

  constructor(onCoverageExpired?: () => void) { this.onCoverageExpired = onCoverageExpired; }

  collectionSelection(data: FeatureCollection, durationMs = 760): FeatureCollection {
    if (this.selectionTimer) clearTimeout(this.selectionTimer);
    this.roles.set('collectionSelection', data.features.map(item => ({ ...item, properties: { ...item.properties } })));
    this.selectionTimer = setTimeout(() => {
      this.selectionTimer = null; this.roles.delete('collectionSelection'); this.onCoverageExpired?.();
    }, durationMs);
    return this.snapshot();
  }

  previewRoute(coordinate: Coordinate | null): FeatureCollection {
    if (!validCoordinate(coordinate)) this.roles.delete('previewRoute');
    else this.roles.set('previewRoute', [feature({ type: 'Point', coordinates: [...coordinate] }, {
      role: 'previewRoute', color: '#217987', pointSize: 22, label: '览',
    })]);
    return this.snapshot();
  }

  routeGap(gap: RouteGap | null): FeatureCollection {
    if (!gap || !validCoordinate(gap.from) || !validCoordinate(gap.to) || !Number.isFinite(gap.distance) || gap.distance < 0) {
      this.roles.delete('routeGap');
      return this.snapshot();
    }
    const distance = Math.max(0.1, Math.round(gap.distance * 10) / 10);
    const midpoint: Coordinate = [gap.from[0] + wrappedLongitudeDelta(gap.from[0], gap.to[0]) / 2, (gap.from[1] + gap.to[1]) / 2];
    this.roles.set('routeGap', [
      feature({ type: 'LineString', coordinates: [gap.from, gap.to] }, {
        role: 'routeGap', color: '#e55332', width: 4, dash: [1.5, 1.5],
      }),
      feature({ type: 'Point', coordinates: [...gap.from] }, { role: 'routeGap', color: '#e55332', fillColor: '#fff4ed', pointSize: 16, label: '断点 A' }),
      feature({ type: 'Point', coordinates: [...gap.to] }, { role: 'routeGap', color: '#e55332', fillColor: '#fff4ed', pointSize: 16, label: '断点 B' }),
      feature({ type: 'Point', coordinates: midpoint }, { role: 'routeGap', color: '#e55332', pointSize: 2, label: `断开约 ${distance} 米` }),
    ]);
    return this.snapshot();
  }

  routeIssue(point: Coordinate | null, kind: 'fork' | 'candidate' = 'fork'): FeatureCollection {
    if (!validCoordinate(point)) this.roles.delete('routeIssue');
    else this.roles.set('routeIssue', [feature({ type: 'Point', coordinates: [...point] }, {
      role: 'routeIssue', color: '#ffb020', pointSize: 12,
      label: kind === 'fork' ? '分叉点 · 待设终点' : '末端候选 · 待设终点',
    })]);
    return this.snapshot();
  }

  /** Show the original coverageGeometry result temporarily; no cache or trip record is changed. */
  offlineCoverage(trip: TripPackage, durationMs = 3000): FeatureCollection {
    this.cancelCoverageTimer();
    const generation = ++this.coverageGeneration;
    const coverage = coverageGeometry(trip);
    const preview = cachePackagePreview(trip);
    const areaFeatures = preview.geojson.features.filter(item => item.properties.role === 'area-range');
    const coverageLabel = areaFeatures.length ? `${trip.name} · 所选区域规划边界` : coverage.label;
    const features = (areaFeatures.length ? areaFeatures : coverage.data.features).map((item) => ({
      ...item,
      properties: {
        ...(item.properties ?? {}), role: 'offlineCoverage', color: '#16a34a',
        fillColor: '#20c565', fillOpacity: coverage.filled ? 0.22 : 0.04, width: 2,
        filled: coverage.filled, label: coverageLabel,
      },
    } as Feature));
    for (const route of preview.geojson.features.filter(item => item.properties.role === 'route')) {
      features.push({ ...route, properties: { role: 'cacheRoute', color: '#20b978', width: 9, opacity: 0.22 } } as Feature);
      features.push({ ...route, properties: { role: 'cacheRoute', color: '#d0f76b', width: 3, opacity: 1 } } as Feature);
    }
    if (preview.plannedBounds) {
      const [west, south, east, north] = trip.bounds;
      features.push(feature({ type: 'Point', coordinates: [(west + east) / 2, (south + north) / 2] }, {
        role: 'offlineCoverageLabel', color: '#d0f76b', pointSize: 2,
        label: `${coverageLabel} · ${preview.progress.done}/${preview.progress.total}项${preview.routeGeometry === 'available' || areaFeatures.length ? '' : ' · 无原路线几何'}`,
      }));
    }
    this.roles.set('offlineCoverage', features);
    this.coverageTimer = setTimeout(() => {
      if (generation !== this.coverageGeneration) return;
      this.coverageTimer = null;
      this.roles.delete('offlineCoverage');
      this.onCoverageExpired?.();
    }, Math.max(0, durationMs));
    return this.snapshot();
  }

  clearOfflineCoverage(): FeatureCollection {
    this.cancelCoverageTimer();
    this.roles.delete('offlineCoverage');
    return this.snapshot();
  }

  clear(): FeatureCollection {
    this.cancelCoverageTimer();
    if (this.selectionTimer) clearTimeout(this.selectionTimer);
    this.selectionTimer = null;
    this.roles.clear();
    return collection();
  }

  snapshot(): FeatureCollection {
    return collection([...this.roles.values()].flat().map((item) => ({ ...item, properties: { ...(item.properties ?? {}) } })));
  }

  private cancelCoverageTimer() {
    this.coverageGeneration++;
    if (this.coverageTimer !== null) clearTimeout(this.coverageTimer);
    this.coverageTimer = null;
  }
}

function wrappedLongitudeDelta(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}
