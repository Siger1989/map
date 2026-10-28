import { PROFILE_NOTES_KEY, readSavedSections, sectionKey, type ProfileNote } from '../../section/profileNotes.ts';
import type { SectionSettings } from '../../section/types.ts';

export type NativeProfileNotesPreview = { key: string; notes: ProfileNote[] } | null;
export type SectionSettingsWithNotes = SectionSettings & { notes: ProfileNote[] };

/** Clone a section's settings and attach its existing notes without mutating application state. */
export function sectionSettingsWithNativeNotes(
  settings: SectionSettings,
  raw: string | null,
  preview: NativeProfileNotesPreview = null,
): SectionSettingsWithNotes {
  let notes: ProfileNote[] = [];
  try {
    notes = readSavedSections(raw).find((saved) => sectionKey(saved.settings) === sectionKey(settings))?.notes ?? [];
  } catch {
    // The original web renderer also excludes malformed note records from the map.
  }
  if (preview?.key === sectionKey(settings)) notes = preview.notes;
  return { ...settings, notes: [...notes] };
}

export function readNativeProfileNotesRaw(): string | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage.getItem(PROFILE_NOTES_KEY); }
  catch { return null; }
}
