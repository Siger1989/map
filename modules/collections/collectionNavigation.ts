import type { CatalogEntry } from './catalog';
export function openCatalogEntry(
  entry: CatalogEntry,
  actions: {
    onLeave: () => void;
    onRoute: (route: Extract<CatalogEntry, { kind: 'route' }>['route']) => void;
    onTrack: (id: string) => void;
    onSection: (id: string) => void;
    onArea: (id: string) => void;
    onMeasurement: (id: string) => void;
    onAnnotation: (id: string) => void;
  },
) {
  actions.onLeave();
  if (entry.kind === 'route') actions.onRoute(entry.route);
  else if (entry.kind === 'track') actions.onTrack(entry.track.id);
  else if (entry.kind === 'section') actions.onSection(entry.section.id);
  else if (entry.kind === 'area') actions.onArea(entry.area.id);
  else if (entry.kind === 'measurement')
    actions.onMeasurement(entry.measurement.id);
  else actions.onAnnotation(entry.annotation.id);
}
