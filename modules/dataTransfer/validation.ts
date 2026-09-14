import { parseSavedMeasurements } from '../measurement/saved.ts';
import { validateSectionObjects } from '../section/sectionObjects.ts';
import { readSavedSections } from '../section/profileNotes.ts';
import { validateRegions } from '../collections/regions.ts';
import { parseAreas } from '../areas/data.ts';
import { validateLayout } from '../collections/data.ts';
import { parseSavedTracks, MAX_SAVED_TRACKS } from '../tracks/drawing.ts';
import { parseAnnotations } from '../annotations/data.ts';
import { validFavorite } from '../navigation/favorites.ts';
import type { Transfer } from './types.ts';
export function validateTransfer(v: unknown): Transfer {
  const data = v as Transfer;
  if (
    !data ||
    data.format !== 'guanyun-backup' ||
    data.version !== 1 ||
    !Array.isArray(data.tracks) ||
    data.tracks.length > MAX_SAVED_TRACKS ||
    !Array.isArray(data.favorites) ||
    data.favorites.length > 20 ||
    !data.favorites.every(validFavorite)
  )
    throw new Error('备份版本或格式不支持');
  if (
    parseSavedTracks(JSON.stringify(data.tracks)).length !== data.tracks.length
  )
    throw new Error('备份含无效轨迹，未导入');
  parseAnnotations(JSON.stringify(data.annotations));
  if (data.collections !== undefined) validateLayout(data.collections);
  if (data.sections !== undefined) validateSectionObjects(data.sections);
  if (data.sectionNotes !== undefined)
    readSavedSections(JSON.stringify(data.sectionNotes));
  if (data.regions !== undefined) validateRegions(data.regions);
  if (data.areas !== undefined) parseAreas(JSON.stringify(data.areas));
  if (data.measurements !== undefined)
    parseSavedMeasurements(
      JSON.stringify({ version: 1, items: data.measurements }),
    );
  for (const items of [data.tracks, data.annotations, data.favorites])
    if (new Set(items.map((i) => i.id)).size !== items.length)
      throw new Error('文件含重复编号');
  return data;
}
