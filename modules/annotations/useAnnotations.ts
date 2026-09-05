import { useEffect, useRef, useState } from 'react';
import type { Coordinate } from '../navigation/types';
import { readElevation } from '../terrain/elevation';
import {
  ANNOTATION_STORAGE,
  MAX_ANNOTATIONS,
  newAnnotation,
  parseAnnotations,
  validAnnotation,
  type Annotation,
  type AnnotationKind,
} from './data';

export function useAnnotations() {
  const [moveHistory, setMoveHistory] = useState<Annotation[]>([]);
  const [items, setItems] = useState<Annotation[]>([]);
  const current = useRef(items);
  current.current = items;
  const [selected, setSelected] = useState<string | null>(null);
  const [picking, setPicking] = useState<AnnotationKind | 'move' | null>(null);
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const writable = useRef(false);
  const lookup = useRef<AbortController | null>(null);
  useEffect(() => {
    try {
      const saved = parseAnnotations(localStorage.getItem(ANNOTATION_STORAGE));
      current.current = saved;
      setItems(saved);
      writable.current = true;
    } catch {
      setError('本机标记存档无法读取，已保留原数据。');
    }
    return () => lookup.current?.abort();
  }, []);
  const persist = (next: Annotation[]) => {
    if (!writable.current) {
      setError('标记存档不可写，请先备份原数据。');
      return false;
    }
    try {
      localStorage.setItem(ANNOTATION_STORAGE, JSON.stringify(next));
      current.current = next;
      setItems(next);
      setError('');
      return true;
    } catch {
      setError('本机空间不足，修改尚未保存。');
      return false;
    }
  };
  const update = (id: string, patch: Partial<Annotation>) => {
    const old = current.current.find((a) => a.id === id);
    if (!old) return false;
    const next = { ...old, ...patch, id: old.id, kind: old.kind };
    if (!validAnnotation(next)) {
      setError('参数无效：尺寸应为 0.1–10000 米，请检查数值。');
      return false;
    }
    return persist(current.current.map((a) => (a.id === id ? next : a)));
  };
  const refreshElevation = async (id: string, coordinates: Coordinate) => {
    lookup.current?.abort();
    const controller = new AbortController();
    lookup.current = controller;
    setReading(true);
    try {
      const elevation = await readElevation(
        ...coordinates,
        AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      );
      const item = current.current.find((a) => a.id === id);
      if (
        !controller.signal.aborted &&
        item &&
        item.coordinates[0] === coordinates[0] &&
        item.coordinates[1] === coordinates[1]
      ) {
        if (elevation === null)
          setError('未取得地面海拔。可重试或手动输入；模型暂不按零海拔绘制。');
        else update(id, { groundElevation: Math.round(elevation * 100) / 100 });
      }
    } catch {
      if (!controller.signal.aborted)
        setError('地面海拔读取失败，可手动填写。');
    } finally {
      if (!controller.signal.aborted) setReading(false);
    }
  };
  return {
    items,
    selected,
    picking,
    setPicking,
    error,
    reading,
    moveUndoId: moveHistory.at(-1)?.id ?? null,
    undoMove: () => {
      const prior = moveHistory.at(-1);
      if (!prior || !current.current.some((a) => a.id === prior.id)) return;
      lookup.current?.abort();
      setReading(false);
      if (
        update(prior.id, {
          coordinates: prior.coordinates,
          groundElevation: prior.groundElevation,
        })
      )
        setMoveHistory((history) => history.slice(0, -1));
    },
    select: (id: string | null) => {
      setSelected(id);
      setPicking(null);
    },
    update,
    refreshElevation,
    manualElevation: (id: string, value: number) => {
      lookup.current?.abort();
      setReading(false);
      update(id, { groundElevation: value });
    },
    place: (coordinates: Coordinate) => {
      if (!picking) return false;
      const id = picking === 'move' ? selected : crypto.randomUUID();
      if (!id) return false;
      if (picking !== 'move' && current.current.length >= MAX_ANNOTATIONS) {
        setError(`最多保存 ${MAX_ANNOTATIONS} 个标记。`);
        return false;
      }
      const okay =
        picking === 'move'
          ? update(id, { coordinates, groundElevation: null })
          : persist([
              ...current.current,
              newAnnotation(picking, coordinates, null, id),
            ]);
      if (!okay) return false;
      // A map re-pick starts a new position-edit sequence.
      if (picking === 'move') setMoveHistory([]);
      setSelected(id);
      setPicking(null);
      void refreshElevation(id, coordinates);
      return true;
    },
    move: (id: string, coordinates: Coordinate) => {
      const prior = current.current.find((a) => a.id === id);
      if (!prior || prior.coordinates.every((n, i) => n === coordinates[i]))
        return false;
      if (update(id, { coordinates, groundElevation: null })) {
        setMoveHistory((history) => [...history.slice(-19), prior]);
        void refreshElevation(id, coordinates);
        return true;
      }
      return false;
    },
    remove: (id: string) => {
      if (
        persist(current.current.filter((a) => a.id !== id)) &&
        selected === id
      ) {
        setSelected(null);
        setMoveHistory((history) => history.filter((a) => a.id !== id));
      }
    },
    duplicate: (id: string) => {
      const item = current.current.find((a) => a.id === id);
      if (!item || current.current.length >= MAX_ANNOTATIONS) {
        setError(`最多保存 ${MAX_ANNOTATIONS} 个标记。`);
        return;
      }
      const copy = {
        ...item,
        id: crypto.randomUUID(),
        name: `${item.name.slice(0, 55)} 副本`,
      };
      if (persist([...current.current, copy])) setSelected(copy.id);
    },
  };
}
export type AnnotationsState = ReturnType<typeof useAnnotations>;
