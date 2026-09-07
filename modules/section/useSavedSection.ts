import { useEffect, useRef, useState, type SetStateAction } from 'react';
import {
  EMPTY_SECTION,
  SAVED_SECTION_KEY,
  readSavedSection,
} from './savedSection';
import type { SectionSettings } from './types';
/** Saved geometry/visibility are separate from the transient selection and drag preview. */
export function useSavedSection() {
  const [settings, update] = useState(EMPTY_SECTION),
    [error, setError] = useState(''),
    [ready, setReady] = useState(false);
  const current = useRef(settings),
    loaded = useRef(false);
  useEffect(() => {
    try {
      current.current = readSavedSection(
        localStorage.getItem(SAVED_SECTION_KEY),
      );
      update(current.current);
      loaded.current = true;
      setReady(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : '剖面读取失败');
    }
  }, []);
  const set = (action: SetStateAction<SectionSettings>) => {
    if (!loaded.current) return;
    const next =
      typeof action === 'function' ? action(current.current) : action;
    try {
      if (next.plane)
        localStorage.setItem(
          SAVED_SECTION_KEY,
          JSON.stringify(readSavedSection(JSON.stringify(next))),
        );
      else localStorage.removeItem(SAVED_SECTION_KEY);
      current.current = next;
      update(next);
      setError('');
    } catch {
      setError('剖面未保存，请检查本机存储空间后重试。');
    }
  };
  return { settings, set, error, ready };
}
