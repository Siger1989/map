import type { SectionSettings } from './types';
import { validSection } from './profileNotes.ts';
export const SAVED_SECTION_KEY = 'shantu.section-object.v1';
export const EMPTY_SECTION: SectionSettings = {
  enabled: false,
  altitude: 1500,
  color: '#ffffff',
};
export function readSavedSection(raw: string | null): SectionSettings {
  if (!raw) return EMPTY_SECTION;
  const value = JSON.parse(raw);
  if (!validSection(value) || typeof value.enabled !== 'boolean')
    throw new Error('已保存剖面无法读取，原数据已保留。');
  return value;
}
