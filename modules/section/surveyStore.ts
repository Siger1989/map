import { collectData, type Transfer } from '../outdoor/exchange.ts';
import { saveWorkbench } from '../collections/workbenchStore.ts';
import { newAnnotation, type Annotation } from '../annotations/data.ts';
import type { SectionSettings } from './types.ts';
import {
  addSurveyStation,
  surveyCoordinate,
  surveyHeight,
  surveySettings,
} from './surveyLine.ts';
import type { Coordinate } from '../navigation/types.ts';

/** Survey/marker edits form one transaction; changing a line never moves unrelated map markers. */
export function withSurveySettings(
  before: Transfer,
  id: string,
  settings: SectionSettings,
): Transfer {
  const line = settings.survey;
  if (!line || !before.sections?.some((s) => s.id === id))
    throw new Error('剖面已变化，请重新打开');
  const stationById = new Map(line.stations.map((s) => [s.id, s]));
  const previous = before.sections.find((s) => s.id === id)!.settings.survey;
  return {
    ...before,
    sections: before.sections.map((s) =>
      s.id === id ? { ...s, settings: { ...settings, objectId: id } } : s,
    ),
    annotations: before.annotations.map((a) => {
      if (a.sectionAnchor?.sectionId !== id) return a;
      const station = stationById.get(a.id);
      if (!station) {
        const { sectionAnchor: _anchor, ...detached } = a;
        return detached;
      }
      const coordinates = surveyCoordinate(line, station.distance),
        changed = coordinates.some(
          (v, i) => Math.abs(v - a.coordinates[i]) > 1e-10,
        );
      const point = line.pointData?.[a.id],
        updated =
          point &&
          JSON.stringify(point) !== JSON.stringify(previous?.pointData?.[a.id]);
      return {
        ...a,
        coordinates,
        sectionAnchor: { sectionId: id, distance: station.distance },
        ...(updated ? { name: point.name, note: point.note } : {}),
        groundElevation: settings.surveyTerrain
          ? surveyHeight(settings.surveyTerrain, station.distance)
          : changed
            ? null
            : a.groundElevation,
      };
    }),
  };
}
export function commitSurveySettings(
  id: string,
  expected: SectionSettings,
  next: SectionSettings,
) {
  const before = collectData(),
    current = before.sections?.find((s) => s.id === id);
  if (!current || JSON.stringify(current.settings) !== JSON.stringify(expected))
    throw new Error('剖面已被其他操作更新，本次未覆盖，请重试');
  saveWorkbench(before, withSurveySettings(before, id, next));
}
export function addSurveyMarker(id: string, point: Coordinate): Annotation {
  const before = collectData(),
    object = before.sections?.find((s) => s.id === id);
  if (!object?.settings.survey) throw new Error('请先选择一条勘探线');
  const markerId = crypto.randomUUID(),
    line = addSurveyStation(object.settings.survey, point, markerId),
    station = line.stations.at(-1)!;
  const settings = surveySettings(line, object.settings),
    annotation = newAnnotation(
      'pin',
      surveyCoordinate(line, station.distance),
      settings.surveyTerrain
        ? surveyHeight(settings.surveyTerrain, station.distance)
        : null,
      markerId,
    );
  annotation.sectionAnchor = { sectionId: id, distance: station.distance };
  annotation.name = `${object.name} · ${station.label}`;
  annotation.color = '#bc5430';
  const next = withSurveySettings(before, id, settings);
  next.annotations.push(annotation);
  saveWorkbench(before, next);
  return annotation;
}
