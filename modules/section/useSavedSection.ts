import { useEffect, useRef, useState, type SetStateAction } from 'react';
import { EMPTY_SECTION, SAVED_SECTION_KEY } from './savedSection';
import {
  SECTION_OBJECTS_KEY,
  MAX_SECTIONS,
  readSectionObjects,
  validateSectionObjects,
  replaceSection,
  sectionName,
  type SectionObject,
} from './sectionObjects';
import type { SectionSettings } from './types';
/** Collection persistence owns stable identity. Selection, previews and gizmos stay transient. */
export function useSavedSection() {
  const [items, setItems] = useState<SectionObject[]>([]),
    [selectedId, selectId] = useState<string | null>(null),
    [error, setError] = useState(''),
    [ready, setReady] = useState(false),
    [deleted, setDeleted] = useState<{
      item: SectionObject;
      index: number;
    } | null>(null);
  const current = useRef(items),
    selected = useRef(selectedId),
    loaded = useRef(false);
  const select = (id: string | null) => {
    selected.current = id;
    selectId(id);
  };
  useEffect(() => {
    const read = () => {
      try {
        const saved = readSectionObjects(
          localStorage.getItem(SECTION_OBJECTS_KEY),
          localStorage.getItem(SAVED_SECTION_KEY),
        );
        current.current = saved;
        setItems(saved);
        select(
          saved.some((s) => s.id === selected.current)
            ? selected.current
            : (saved[0]?.id ?? null),
        );
        loaded.current = true;
        setReady(true);
        setError('');
      } catch (e) {
        loaded.current = false;
        setReady(false);
        setError(e instanceof Error ? e.message : '剖面读取失败');
      }
    };
    const changed = (e: StorageEvent) => {
      if (e.key === SECTION_OBJECTS_KEY || e.key === null) read();
    };
    read();
    window.addEventListener('guanyun-data-changed', read);
    window.addEventListener('storage', changed);
    return () => {
      window.removeEventListener('guanyun-data-changed', read);
      window.removeEventListener('storage', changed);
    };
  }, []);
  const persist = (next: SectionObject[]) => {
    if (!loaded.current) return false;
    try {
      validateSectionObjects(next);
      localStorage.setItem(SECTION_OBJECTS_KEY, JSON.stringify(next));
      current.current = next;
      setItems(next);
      setError('');
      if (!next.some((s) => s.id === selected.current)) select(null);
      return true;
    } catch {
      setError(`剖面未保存，请检查参数、本机空间或${MAX_SECTIONS}条数量上限。`);
      return false;
    }
  };
  const create = (settings: SectionSettings) => {
    const id = crypto.randomUUID();
    const item = {
      id,
      name: sectionName(current.current),
      settings: { ...settings, objectId: id },
    };
    if (!persist([...current.current, item])) return false;
    select(item.id);
    return true;
  };
  const remove = (id: string) => {
    const index = current.current.findIndex((s) => s.id === id),
      item = current.current[index];
    if (!item) return false;
    if (!persist(current.current.filter((s) => s.id !== id))) return false;
    setDeleted({ item, index });
    return true;
  };
  const set = (action: SetStateAction<SectionSettings>) => {
    const previous =
      current.current.find((s) => s.id === selected.current)?.settings ??
      EMPTY_SECTION;
    const next = typeof action === 'function' ? action(previous) : action;
    if (!next.plane) return selected.current ? remove(selected.current) : true;
    if (!selected.current) return create(next);
    try {
      return persist(
        replaceSection(current.current, selected.current, {
          ...next,
          objectId: previous.objectId,
        }),
      );
    } catch {
      setError('剖面参数无效，已保留原数据。');
      return false;
    }
  };
  return {
    items,
    selectedId,
    select,
    settings: items.find((s) => s.id === selectedId)?.settings ?? EMPTY_SECTION,
    set,
    create,
    restore: (settings: SectionSettings) => {
      const existing = current.current.find(
        (s) => s.settings.objectId === settings.objectId,
      );
      if (existing) {
        if (!persist(replaceSection(current.current, existing.id, settings)))
          return false;
        select(existing.id);
        return true;
      }
      const item = {
        id: settings.objectId ?? crypto.randomUUID(),
        name: sectionName(current.current),
        settings,
      };
      if (!persist([...current.current, item])) return false;
      select(item.id);
      return true;
    },
    remove,
    ready,
    error,
    rename: (id: string, name: string) => {
      const trimmed = name.trim().slice(0, 60);
      if (!trimmed) {
        setError('剖面名称不能为空。');
        return false;
      }
      return persist(
        current.current.map((s) => (s.id === id ? { ...s, name: trimmed } : s)),
      );
    },
    toggle: (id: string) =>
      persist(
        current.current.map((s) =>
          s.id === id
            ? {
                ...s,
                settings: { ...s.settings, enabled: !s.settings.enabled },
              }
            : s,
        ),
      ),
    canUndoDelete: Boolean(deleted),
    undoDelete: () => {
      if (!deleted) return;
      const next = [...current.current];
      next.splice(deleted.index, 0, deleted.item);
      if (persist(next)) setDeleted(null);
    },
  };
}
export type SectionObjectsState = ReturnType<typeof useSavedSection>;
