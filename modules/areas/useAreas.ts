import { useEffect, useRef, useState } from 'react';
import type { Coordinate } from '../navigation/types';
import {
  ATTRIBUTE_TEMPLATE_KEY,
  blankAttributes,
  readAttributeTemplate,
} from '../annotations/attributes';
import {
  AREA_STORAGE,
  MAX_AREAS,
  closeBoundary,
  moveAreaPoint,
  parseAreas,
  type MapArea,
} from './data';
export function useAreas() {
  const [items, setItems] = useState<MapArea[]>([]),
    [selected, select] = useState<string | null>(null),
    [drawing, setDrawing] = useState(false);
  const [draft, setDraft] = useState<Coordinate[]>([]),
    [history, setHistory] = useState<Coordinate[][]>([]),
    [undo, setUndo] = useState<MapArea | null>(null);
  const [error, setError] = useState(''),
    [roadSnapping, setRoadSnapping] = useState(true);
  const current = useRef(items);
  current.current = items;
  const writable = useRef(false);
  useEffect(() => {
    const read = () => {
      try {
        const v = parseAreas(localStorage.getItem(AREA_STORAGE));
        current.current = v;
        setItems(v);
        writable.current = true;
      } catch {
        writable.current = false;
        setError('区域存档无法读取，原数据已保留');
      }
    };
    read();
    window.addEventListener('guanyun-data-changed', read);
    return () => window.removeEventListener('guanyun-data-changed', read);
  }, []);
  const persist = (next: MapArea[]) => {
    if (!writable.current) {
      setError('区域存档不可写，请先检查原数据');
      return false;
    }
    try {
      const valid = parseAreas(JSON.stringify(next));
      localStorage.setItem(AREA_STORAGE, JSON.stringify(valid));
      current.current = valid;
      setItems(valid);
      setError('');
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : '区域保存失败');
      return false;
    }
  };
  const finish = (points = draft) => {
    try {
      if (current.current.length >= MAX_AREAS)
        throw new Error(`最多保存 ${MAX_AREAS} 个区域`);
      const item: MapArea = {
        id: crypto.randomUUID(),
        name: `区域 ${current.current.length + 1}`,
        note: '',
        color: '#66cfa2',
        visible: true,
        boundary: closeBoundary(points),
        createdAt: Date.now(),
      };
      try {
        item.attributes = blankAttributes(
          readAttributeTemplate(localStorage.getItem(ATTRIBUTE_TEMPLATE_KEY)),
        );
      } catch {
        /* A broken optional template must not discard the newly drawn boundary. */
      }
      if (!persist([...current.current, item])) return false;
      select(item.id);
      setDraft([]);
      setHistory([]);
      setDrawing(false);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : '区域无法闭合');
      return false;
    }
  };
  return {
    items,
    selected,
    select,
    drawing,
    draft,
    error,
    roadSnapping,
    setRoadSnapping,
    start: () => {
      setDrawing(true);
      select(null);
      setError('');
    },
    pause: () => setDrawing(false),
    cancel: () => {
      setDraft([]);
      setHistory([]);
      setDrawing(false);
      setError('');
    },
    add: (p: Coordinate, section?: Coordinate[]) => {
      const extra = section?.length ? section : [p];
      const next = [
        ...draft,
        ...extra.filter(
          (p, i) =>
            !(
              !i &&
              draft.length &&
              p[0] === draft.at(-1)![0] &&
              p[1] === draft.at(-1)![1]
            ),
        ),
      ];
      if (next.length > 6000) {
        setError('最多 6000 个边界点，请先闭合或撤销');
        return;
      }
      setHistory((h) => [...h, draft]);
      setDraft(next);
      setError('');
      if (next.length >= 4 && p[0] === next[0][0] && p[1] === next[0][1])
        finish(next);
    },
    undoDraft: () => {
      const prev = history.at(-1);
      if (prev) {
        setDraft(prev);
        setHistory((h) => h.slice(0, -1));
        setError('');
      }
    },
    finish,
    update: (id: string, patch: Partial<MapArea>) =>
      persist(
        current.current.map((a) => (a.id === id ? { ...a, ...patch, id } : a)),
      ),
    move: (id: string, index: number, p: Coordinate) => {
      const old = current.current.find((a) => a.id === id);
      if (!old) return;
      try {
        const next = moveAreaPoint(old, index, p);
        if (persist(current.current.map((a) => (a.id === id ? next : a))))
          setUndo(old);
      } catch (e) {
        setError(e instanceof Error ? e.message : '边界点调整失败');
      }
    },
    canUndo: undo?.id === selected,
    undoMove: () => {
      if (
        undo &&
        persist(current.current.map((a) => (a.id === undo.id ? undo : a)))
      )
        setUndo(null);
    },
    remove: (id: string) => {
      if (persist(current.current.filter((a) => a.id !== id))) select(null);
    },
  };
}
export type AreasState = ReturnType<typeof useAreas>;
