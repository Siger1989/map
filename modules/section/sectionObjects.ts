import type { SectionSettings } from './types';
import { readSavedSection } from './savedSection.ts';
import { validSection } from './profileNotes.ts';
export const SECTION_OBJECTS_KEY = 'shantu.section-objects.v1';
export const MAX_SECTIONS = 20;
export type SectionObject = {
  id: string;
  name: string;
  settings: SectionSettings;
};
export function validateSectionObjects(value: unknown): SectionObject[] {
  if (
    !Array.isArray(value) ||
    value.length > MAX_SECTIONS ||
    value.some(
      (s) =>
        !s ||
        typeof s.id !== 'string' ||
        !/^[a-zA-Z0-9-]{1,80}$/.test(s.id) ||
        typeof s.name !== 'string' ||
        !s.name.trim() ||
        s.name.length > 60 ||
        !validSection(s.settings) ||
        (s.settings.objectId !== undefined && s.settings.objectId !== s.id) ||
        typeof s.settings.enabled !== 'boolean',
    ) ||
    new Set(value.map((s) => s.id)).size !== value.length
  )
    throw new Error('剖面列表无法读取，原数据已保留。');
  return value;
}
/** Migration is deterministic and never removes the legacy storage or its measurement notes. */
export function readSectionObjects(
  raw: string | null,
  legacy: string | null = null,
) {
  if (raw !== null) return validateSectionObjects(JSON.parse(raw));
  const settings = readSavedSection(legacy);
  return settings.plane
    ? [{ id: 'legacy-section', name: '剖面1', settings }]
    : [];
}
export function replaceSection(
  items: SectionObject[],
  id: string,
  settings: SectionSettings,
) {
  return validateSectionObjects(
    items.map((item) => (item.id === id ? { ...item, settings } : item)),
  );
}
export function sectionName(items: SectionObject[]) {
  let index = 1;
  while (items.some((s) => s.name === `剖面${index}`)) index++;
  return `剖面${index}`;
}
