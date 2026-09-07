import { useEffect, useState } from 'react';
import {
  PROFILE_NOTES_KEY,
  PROFILE_NOTES_CHANGED,
  readSavedSections,
  sectionKey,
  updateSavedSection,
  type ProfileNote,
  type SavedSection,
} from './profileNotes';
import type { SectionSettings } from './types';
const EMPTY_NOTES: ProfileNote[] = [];
export function useProfileNotes(settings: SectionSettings) {
  const [records, setRecords] = useState<SavedSection[]>([]),
    [ready, setReady] = useState(false),
    [error, setError] = useState('');
  const key = sectionKey(settings);
  useEffect(() => {
    const read = () => {
      try {
        setRecords(readSavedSections(localStorage.getItem(PROFILE_NOTES_KEY)));
        setReady(true);
        setError('');
      } catch (e) {
        setReady(false);
        setError(e instanceof Error ? e.message : '本机测点读取失败。');
      }
    };
    const changed = (e: StorageEvent) => {
      if (e.key === PROFILE_NOTES_KEY || e.key === null) read();
    };
    read();
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, []);
  const notes =
    records.find((s) => sectionKey(s.settings) === key)?.notes ?? EMPTY_NOTES;
  const save = (id: string, note: ProfileNote | null) => {
    if (!ready) return false;
    try {
      // Merge against disk so another tab's different measurement is retained.
      const latest = readSavedSections(localStorage.getItem(PROFILE_NOTES_KEY));
      const previous =
        latest.find((s) => sectionKey(s.settings) === key)?.notes ?? [];
      const exists = previous.some((n) => n.id === id);
      const next = previous.flatMap((n) =>
        n.id === id ? (note ? [note] : []) : [n],
      );
      if (note && !exists) next.push(note);
      const updated = updateSavedSection(latest, settings, next);
      localStorage.setItem(PROFILE_NOTES_KEY, JSON.stringify(updated));
      setRecords(updated);
      window.dispatchEvent(new Event(PROFILE_NOTES_CHANGED));
      setError('');
      return true;
    } catch {
      setError('测点未保存，请检查本机存储空间后重试；编辑内容仍保留。');
      return false;
    }
  };
  return { notes, records, ready, error, save };
}
