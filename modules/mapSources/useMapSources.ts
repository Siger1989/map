import { useCallback, useEffect, useMemo, useState } from 'react';
import { addMaps, ensureDefaultMaps, listMaps, removeMap } from './storage';
import type { MapDraft, MapSource, StoredMap } from './types';
import { freeMap } from './presets';
import { resolveAvailableMapSelection, resolveInitialMapSelection } from './selection';
import { loadDefaultSeedBundle, seedThenList } from './defaultSeeds';
import { LAYER_PREFERENCES_KEY } from '../map/layerPreferences';

const SELECTED = 'shantu-selected-map';
export { resolveAvailableMapSelection } from './selection';
export function useMapSources(restoreSelection = true) {
  const [maps, setMaps] = useState<MapSource[]>([]);
  const [selected, setSelected] = useState('');
  const [status, setStatus] = useState('');
  const [ready, setReady] = useState(false);
  const [revision, setRevision] = useState(0);
  // Read before the main map writes its initial layer settings on first mount.
  const [hasLayerPreferences] = useState(() => {
    try { return localStorage.getItem(LAYER_PREFERENCES_KEY) !== null; }
    catch { return true; }
  });
  useEffect(() => {
    let alive = true;
    const changed = () => { void listMaps().then(items => {
      if (!alive) return;
      setMaps(items);
      if (restoreSelection) setSelected(resolveAvailableMapSelection(localStorage.getItem(SELECTED), items));
      setRevision(n=>n+1);
    }).catch(()=>{ if(alive)setStatus('工作区图源刷新失败，请重新打开'); }); };
    window.addEventListener('guanyun-data-changed', changed);
    return () => { alive=false; window.removeEventListener('guanyun-data-changed', changed); };
  }, [restoreSelection]);
  useEffect(() => {
    let alive = true;
    try {
      const id = localStorage.getItem(SELECTED);
      if (restoreSelection && freeMap(id)) setSelected(id!);
    } catch {}
    seedThenList(loadDefaultSeedBundle, ensureDefaultMaps, listMaps, (message) => {
      if (alive) setStatus(`内置图源初始化未完成：${message}`);
    })
      .then((items) => {
        if (!alive) return;
        setMaps(items);
        try {
          const id = localStorage.getItem(SELECTED);
          if (restoreSelection) {
            const available = resolveInitialMapSelection(id, items, hasLayerPreferences);
            setSelected(available);
            if (id === null && available) localStorage.setItem(SELECTED, available);
            if (!available && id) localStorage.removeItem(SELECTED);
          }
        } catch {}
      })
      .catch(() => {
        if (alive) setStatus('本机地图库或内置图源暂不可用');
      })
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, [hasLayerPreferences, restoreSelection]);
  const select = useCallback((id: string) => {
    setSelected(id);
    setRevision((n) => n + 1);
    setStatus('');
    try {
      // An empty value is an explicit selection of the provider in layer settings.
      localStorage.setItem(SELECTED, id);
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
    const item = freeMap(selected) ?? maps.find((m) => m.id === selected);
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
