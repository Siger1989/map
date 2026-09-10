import type { CatalogEntry } from './catalog';
import { dimensions } from '../annotations/data.ts';
import type { Coordinate } from '../navigation/types';
import { surveyCoordinate, surveyRange } from '../section/surveyLine.ts';

/** Conservative footprint also contains rotated/elevated models, not only their anchor. */
export function collectionPreviewPoints(entry: CatalogEntry): Coordinate[] {
  if (entry.kind === 'route') return entry.route.route.coordinates;
  if (entry.kind === 'track') return entry.track.segments.flat();
  if (entry.kind === 'area') return entry.area.boundary;
  if (entry.kind === 'measurement')
    return entry.measurement.points.map((p) => p.coordinates);
  if (entry.kind === 'section' && entry.section.settings.survey) {
    const line = entry.section.settings.survey,
      r = surveyRange(line);
    return [surveyCoordinate(line, r.start), surveyCoordinate(line, r.end)];
  }
  let radius = 30;
  if (entry.kind === 'model') {
    const a = entry.annotation;
    const footprintScale = Math.max(
      1,
      ...(a.footprint ?? []).flat().map(Math.abs),
    );
    radius = Math.max(
      radius,
      Math.hypot(...dimensions(a)) * footprintScale +
        a.offset +
        Math.abs(
          (a.centerAltitude ?? a.groundElevation ?? 0) -
            (a.groundElevation ?? 0),
        ),
    );
  } else if (entry.kind === 'section' && entry.section.settings.plane) {
    const p = entry.section.settings.plane;
    radius = Math.max(radius, Math.hypot(p.width, p.height));
  }
  const [lng, lat] = entry.coordinates;
  const dy = radius / 111195,
    dx = dy / Math.max(0.087, Math.cos((lat * Math.PI) / 180));
  return [
    [lng - dx, Math.max(-85, lat - dy)],
    [lng + dx, Math.min(85, lat + dy)],
  ];
}
