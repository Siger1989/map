import { entriesFor } from './data.ts';
import type { RouteFavorite } from '../navigation/favorites';
import type { ManualTrack } from '../tracks/drawing';
import { KINDS, type Annotation } from '../annotations/data.ts';
import type { SectionObject } from '../section/sectionObjects';
import { coordinateKey, type CollectionRegions } from './regions.ts';
import { areaMetrics, type MapArea } from '../areas/data.ts';
import type { SavedMeasurement } from '../measurement/saved.ts';
import { measurementMetrics } from '../measurement/data.ts';
import { surveyRange } from '../section/surveyLine.ts';
export type CatalogEntry = {
  key: string;
  name: string;
  detail: string;
  coordinates: [number, number];
} & (
  | { kind: 'route'; route: RouteFavorite }
  | { kind: 'track'; track: ManualTrack }
  | { kind: 'pin' | 'model'; annotation: Annotation }
  | { kind: 'section'; section: SectionObject }
  | { kind: 'area'; area: MapArea }
  | { kind: 'measurement'; measurement: SavedMeasurement }
);
export const CATALOG_TYPES = {
  all: '全部',
  pin: '地点',
  model: '模型',
  area: '区域',
  section: '剖面',
  route: '路线',
  track: '轨迹',
  measurement: '测量',
} as const;
export function catalogEntries(
  routes: RouteFavorite[],
  tracks: ManualTrack[],
  annotations: Annotation[],
  sections: SectionObject[],
  areas: MapArea[] = [],
  measurements: SavedMeasurement[] = [],
): CatalogEntry[] {
  return [
    ...measurements.map((measurement) => ({
      key: `measurement:${measurement.id}`,
      kind: 'measurement' as const,
      measurement,
      name: measurement.name,
      coordinates: measurement.points[0].coordinates,
      detail: `${measurement.points.length} 点 · 水平距离 ${measurementMetrics(
        measurement.points,
      )
        .segments.reduce((sum, s) => sum + s.horizontal, 0)
        .toFixed(1)} m`,
    })),
    ...areas.map((area) => ({
      key: `area:${area.id}`,
      kind: 'area' as const,
      area,
      name: area.name,
      coordinates: area.boundary[0],
      detail: `面积约 ${areaMetrics(area.boundary).area.toFixed(0)} m²`,
    })),
    ...annotations.map((a) => ({
      key: `annotation:${a.id}`,
      kind: a.kind === 'pin' ? ('pin' as const) : ('model' as const),
      annotation: a,
      name: a.name || '未命名',
      detail: `${KINDS[a.kind]} · ${a.attributes?.length ?? 0} 项属性`,
      coordinates: a.coordinates,
    })),
    ...sections
      .filter((s) => s.settings.plane)
      .map((s) => ({
        key: `section:${s.id}`,
        kind: 'section' as const,
        section: s,
        name: s.name,
        detail: s.settings.survey
          ? `勘探线 ${(surveyRange(s.settings.survey).end - surveyRange(s.settings.survey).start).toFixed(0)} m · ${s.settings.survey.stations.length + 2} 点`
          : `${s.settings.plane!.width.toFixed(0)} × ${s.settings.plane!.height.toFixed(0)} m`,
        coordinates: s.settings.plane!.center,
      })),
    ...entriesFor(routes, tracks).flatMap((e) => {
      const coordinates =
        e.kind === 'route'
          ? e.route.route.coordinates[0]
          : e.track.segments.find((s) => s.length)?.[0];
      return coordinates ? [{ ...e, coordinates }] : [];
    }),
  ];
}
export function regionFor(entry: CatalogEntry, regions: CollectionRegions) {
  const r = regions[entry.key];
  return r?.coordinateKey === coordinateKey(entry.coordinates) ? r : undefined;
}
export function groupCatalog(
  entries: CatalogEntry[],
  regions: CollectionRegions,
) {
  const provinces = new Map<
    string,
    { name: string; cities: Map<string, CatalogEntry[]> }
  >();
  for (const e of entries) {
    const r = regionFor(e, regions),
      province = r?.province || '待归类';
    const key = JSON.stringify([r?.country || '', province]);
    let group = provinces.get(key);
    if (!group) {
      group = {
        name: r?.country ? `${province} · ${r.country}` : province,
        cities: new Map(),
      };
      provinces.set(key, group);
    }
    const city = r?.city || '城市待归类';
    group.cities.set(city, [...(group.cities.get(city) ?? []), e]);
  }
  return [...provinces.entries()]
    .sort((a, b) => a[1].name.localeCompare(b[1].name, 'zh-CN'))
    .map(([key, g]) => ({
      key,
      name: g.name,
      cities: [...g.cities.entries()].sort((a, b) =>
        a[0].localeCompare(b[0], 'zh-CN'),
      ),
    }));
}
