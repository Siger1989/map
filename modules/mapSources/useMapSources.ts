import { useCallback, useEffect, useMemo, useState } from 'react';
import { addMaps, listMaps, removeMap } from './storage';
import type { MapDraft, MapSource, StoredMap } from './types';

const SELECTED = 'shantu-selected-map';
export function useMapSources() {
  const [maps, setMaps] = useState<MapSource[]>([]);
  const [selected, setSelected] = useState('');
  const [status, setStatus] = useState('');
  const [ready, setReady] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let alive = true;
    listMaps()
      .then((items) => {
        if (!alive) return;
        setMaps(items);
        try {
          const id = localStorage.getItem(SELECTED);
          if (items.some((m) => m.id === id)) setSelected(id!);
        } catch {}
      })
      .catch(() => {
        if (alive) setStatus('本机地图库暂不可用');
      })
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);
  const select = useCallback((id: string) => {
    setSelected(id);
    setRevision((n) => n + 1);
    setStatus('');
    try {
      if (id) localStorage.setItem(SELECTED, id);
      else localStorage.removeItem(SELECTED);
    } catch {
      setStatus('当前选择未能保存，重启后需重新选择');
    }
  }, []);
  const add = async (drafts: { draft: MapDraft; blob?: Blob }[]) => {
    const records: StoredMap[] = drafts.map(({ draft, blob }) => ({
      ...draft,
      id: crypto.randomUUID(),
      bytes:
        blob?.size ?? new TextEncoder().encode(JSON.stringify(draft)).length,
      ...(blob ? { blob } : {}),
    }));
    await addMaps(records);
    const next = await listMaps();
    setMaps(next);
    select(records[0].id);
    return records[0];
  };
  const remove = async (id: string) => {
    await removeMap(id);
    setMaps(await listMaps());
    if (selected === id) select('');
  };
  const source = useMemo(() => {
    const item = maps.find((m) => m.id === selected);
    return item ? { ...item } : null;
  }, [maps, selected, revision]);
  return {
    maps,
    selected,
    source,
    ready,
    status,
    setStatus,
    select,
    add,
    remove,
  };
}
