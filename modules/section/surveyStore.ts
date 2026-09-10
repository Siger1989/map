import { collectData, type Transfer } from '../outdoor/exchange.ts';
import { saveWorkbench } from '../collections/workbenchStore.ts';
import {
  newAnnotation,
  type Annotation,
  type AnnotationChoice,
} from '../annotations/data.ts';
import {
  ATTRIBUTE_TEMPLATE_KEY,
  blankAttributes,
  readAttributeTemplate,
} from '../annotations/attributes.ts';
import type { SectionSettings } from './types.ts';
import {
  addSurveyStation,
  surveyCoordinate,
  surveyHeight,
  surveySettings,
  surveyStations,
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
  const stationById = new Map(surveyStations(line).map((s) => [s.id, s]));
  const previous = before.sections.find((s) => s.id === id)!.settings.survey;
  return {
    ...before,
    sections: before.sections.map((s) =>
      s.id === id ? { ...s, settings: { ...settings, objectId: id } } : s,
    ),
    annotations: before.annotations.map((a) => {
      if (a.sectionAnchor?.sectionId !== id) return a;
      const station = stationById.get(a.sectionAnchor.stationId ?? a.id);
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
        sectionAnchor: {
          ...a.sectionAnchor,
          sectionId: id,
          distance: station.distance,
        },
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
export function withSurveyMarker(
  before: Transfer,
  id: string,
  point: Coordinate,
  choice: AnnotationChoice,
  markerId: string,
  stationId?: string,
) {
  const object = before.sections?.find((s) => s.id === id);
  if (!object?.settings.survey) throw new Error('请先选择一条勘探线');
  const existing = stationId
    ? surveyStations(object.settings.survey).find((s) => s.id === stationId)
    : undefined;
  if (stationId && !existing) throw new Error('选中的剖面点已变化，请重新选择');
  const line = existing
      ? object.settings.survey
      : addSurveyStation(object.settings.survey, point, markerId),
    station = existing ?? line.stations.at(-1)!;
  const settings = surveySettings(line, object.settings),
    annotation = newAnnotation(
      choice,
      surveyCoordinate(line, station.distance),
      settings.surveyTerrain
        ? surveyHeight(settings.surveyTerrain, station.distance)
        : null,
      markerId,
    );
  annotation.sectionAnchor = {
    sectionId: id,
    distance: station.distance,
    ...(existing ? { stationId: existing.id } : {}),
  };
  annotation.name =
    `${object.name} · ${station.label}${choice === 'borehole' ? ' · 钻井' : ''}`.slice(
      0,
      60,
    );
  annotation.color = '#bc5430';
  const next = withSurveySettings(before, id, settings);
  next.annotations.push(annotation);
  return { next, annotation };
}
export function addSurveyMarker(
  id: string,
  point: Coordinate,
  choice: AnnotationChoice = 'pin',
  stationId?: string,
): Annotation {
  const before = collectData();
  const { next, annotation } = withSurveyMarker(
    before,
    id,
    point,
    choice,
    crypto.randomUUID(),
    stationId,
  );
  annotation.attributes = blankAttributes(
    readAttributeTemplate(localStorage.getItem(ATTRIBUTE_TEMPLATE_KEY)),
  );
  saveWorkbench(before, next);
  return annotation;
}
