import { useEffect, useRef, useState } from 'react';
import type { Coordinate } from '../navigation/types';
import { readElevation } from '../terrain/elevation';
import {
  ATTRIBUTE_TEMPLATE_KEY,
  blankAttributes,
  readAttributeTemplate,
  rememberAttributes,
} from './attributes';
import {
  ANNOTATION_STORAGE,
  canAddAnnotation,
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
  useEffect(() => {
    const reload = () => {
      try {
        const saved = parseAnnotations(
          localStorage.getItem(ANNOTATION_STORAGE),
        );
        current.current = saved;
        setItems(saved);
        writable.current = true;
      } catch {
        /* Existing state remains available. */
      }
    };
    window.addEventListener('guanyun-data-changed', reload);
    return () => window.removeEventListener('guanyun-data-changed', reload);
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
    if (
      (patch.placement !== undefined || patch.offset !== undefined) &&
      !Object.hasOwn(patch, 'centerAltitude')
    )
      delete next.centerAltitude;
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
  const add = (
    kind: AnnotationKind,
    coordinates: Coordinate,
    trackAnchor?: Annotation['trackAnchor'],
  ) => {
    if (!canAddAnnotation(current.current, kind)) {
      setError('最多保存 2000 个地点标记、80 个模型。');
      return false;
    }
    const item = newAnnotation(kind, coordinates, null, crypto.randomUUID());
    if (trackAnchor) {
      item.trackAnchor = trackAnchor;
      item.color = '#23bd7e';
      item.name = '行程标记';
    }
    try {
      item.attributes = blankAttributes(
        readAttributeTemplate(localStorage.getItem(ATTRIBUTE_TEMPLATE_KEY)),
      );
    } catch {
      setError('属性模板读取失败，原模板已保留。');
      return false;
    }
    if (!validAnnotation(item)) {
      setError('标记位置或类型无效。');
      return false;
    }
    if (!persist([...current.current, item])) return false;
    setSelected(item.id);
    setPicking(null);
    void refreshElevation(item.id, coordinates);
    return true;
  };
  return {
    addOutline: (
      shape: Pick<
        Annotation,
        | 'coordinates'
        | 'width'
        | 'length'
        | 'height'
        | 'footprint'
        | 'color'
        | 'name'
        | 'attributes'
      >,
    ) => {
      if (!canAddAnnotation(current.current, 'prism')) {
        setError('最多保存 80 个模型');
        return false;
      }
      const item = {
        ...newAnnotation('prism', shape.coordinates, null, crypto.randomUUID()),
        ...shape,
      };
      if (!validAnnotation(item)) {
        setError('轮廓模型参数无效');
        return false;
      }
      if (!persist([...current.current, item])) return false;
      setSelected(item.id);
      setPicking(null);
      void refreshElevation(item.id, item.coordinates);
      return true;
    },
    add,
    items,
    selected,
    picking,
    setPicking,
    error,
    reading,
    moveUndoId: moveHistory.at(-1)?.id ?? null,
    transform: (item: Annotation) => {
      const prior = current.current.find((a) => a.id === item.id);
      if (!prior) return false;
      if (
        !update(item.id, {
          coordinates: item.coordinates,
          centerAltitude: item.centerAltitude,
          width: item.width,
          length: item.length,
          height: item.height,
          heading: item.heading,
          pitch: item.pitch,
          roll: item.roll,
        })
      )
        return false;
      setMoveHistory((history) => [...history.slice(-19), prior]);
      if (prior.coordinates.some((n, i) => n !== item.coordinates[i]))
        void refreshElevation(item.id, item.coordinates);
      return true;
    },
    undoMove: () => {
      const prior = moveHistory.at(-1);
      if (!prior || !current.current.some((a) => a.id === prior.id)) return;
      lookup.current?.abort();
      setReading(false);
      if (
        update(prior.id, {
          coordinates: prior.coordinates,
          groundElevation: prior.groundElevation,
          centerAltitude: prior.centerAltitude,
          width: prior.width,
          length: prior.length,
          height: prior.height,
          heading: prior.heading,
          pitch: prior.pitch,
          roll: prior.roll,
          placement: prior.placement,
          offset: prior.offset,
        })
      )
        setMoveHistory((history) => history.slice(0, -1));
    },
    select: (id: string | null) => {
      setSelected(id);
      setPicking(null);
    },
    update,
    rememberAttributes: (id: string) => {
      const item = current.current.find((a) => a.id === id);
      if (!item) return;
      try {
        const previous = readAttributeTemplate(
          localStorage.getItem(ATTRIBUTE_TEMPLATE_KEY),
        );
        localStorage.setItem(
          ATTRIBUTE_TEMPLATE_KEY,
          JSON.stringify(rememberAttributes(previous, item.attributes ?? [])),
        );
      } catch {
        setError('属性已保存在标记中，但模板保存失败，请释放本机空间后重试。');
      }
    },
    refreshElevation,
    manualElevation: (id: string, value: number) => {
      lookup.current?.abort();
      setReading(false);
      update(id, { groundElevation: value });
    },
    place: (coordinates: Coordinate) => {
      if (!picking) return false;
      if (picking !== 'move') return add(picking, coordinates);
      const id = selected;
      if (!id) return false;
      const okay = update(id, { coordinates, groundElevation: null });
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
      if (!item || !canAddAnnotation(current.current, item.kind)) {
        setError('最多保存 2000 个地点标记、80 个模型。');
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
