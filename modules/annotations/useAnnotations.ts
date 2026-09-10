import { useEffect, useRef, useState } from 'react';
import {
  annotationEditItems,
  commitAnnotationEdit,
  editorPose,
  patchAnnotation,
  sameAnnotation,
  type AnnotationEdit,
} from './editorSession';
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
  type AnnotationChoice,
} from './data';

export function useAnnotations() {
  const [moveHistory, setMoveHistory] = useState<Annotation[]>([]);
  const [items, setItems] = useState<Annotation[]>([]);
  const current = useRef(items);
  current.current = items;
  const [selected, setSelected] = useState<string | null>(null);
  const [picking, setPicking] = useState<AnnotationChoice | 'move' | null>(
    null,
  );
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const writable = useRef(false);
  const lookup = useRef<AbortController | null>(null);
  const [edit, setEdit] = useState<AnnotationEdit | null>(null);
  const editing = useRef<AnnotationEdit | null>(null);
  const [selectionRequest, setSelectionRequest] = useState<{
    id: string | null;
  } | null>(null);
  const setEditing = (value: AnnotationEdit | null) => {
    editing.current = value;
    setEdit(value);
  };
  const getItem = (id: string) =>
    editing.current?.draft.id === id
      ? editing.current.draft
      : current.current.find((a) => a.id === id);
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
    const storage = (event: StorageEvent) => {
      if (event.key === ANNOTATION_STORAGE) reload();
    };
    window.addEventListener('storage', storage);
    return () => {
      window.removeEventListener('guanyun-data-changed', reload);
      window.removeEventListener('storage', storage);
    };
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
    const old = getItem(id);
    if (!old) return false;
    let next: Annotation;
    try {
      next = patchAnnotation(old, patch);
    } catch (e) {
      setError(e instanceof Error ? e.message : '参数无效');
      return false;
    }
    if (editing.current?.draft.id === id) {
      setEditing({
        ...editing.current,
        draft: next,
        origin: editing.current.origin ?? editorPose(next),
      });
      setError('');
      return true;
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
      const item = getItem(id);
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
    kind: AnnotationChoice,
    coordinates: Coordinate,
    trackAnchor?: Annotation['trackAnchor'],
  ) => {
    if (
      !canAddAnnotation(current.current, kind === 'borehole' ? 'pin' : kind)
    ) {
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
    items: annotationEditItems(items, edit),
    edit,
    selectionRequest,
    dirty: !!edit && !sameAnnotation(edit.base, edit.draft),
    beginEdit: (id: string) => {
      if (editing.current?.draft.id === id) return;
      const item = current.current.find((a) => a.id === id);
      if (!item) return;
      lookup.current?.abort();
      setReading(false);
      setEditing({
        base: structuredClone(item),
        draft: structuredClone(item),
        origin: editorPose(item),
      });
      setMoveHistory([]);
      setError('');
    },
    saveEdit: () => {
      const session = editing.current;
      if (!session) return true;
      try {
        const saved = parseAnnotations(
          localStorage.getItem(ANNOTATION_STORAGE),
        );
        if (!persist(commitAnnotationEdit(saved, session))) return false;
        lookup.current?.abort();
        setReading(false);
        setEditing(null);
        setMoveHistory([]);
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : '保存失败，草稿已保留');
        return false;
      }
    },
    cancelEdit: () => {
      lookup.current?.abort();
      setReading(false);
      setEditing(null);
      setMoveHistory([]);
      setError('');
    },
    resolveSelection: (proceed: boolean) => {
      if (proceed && selectionRequest) {
        setSelected(selectionRequest.id);
        setPicking(null);
      }
      setSelectionRequest(null);
    },
    selected,
    picking,
    setPicking,
    error,
    reading,
    moveUndoId: moveHistory.at(-1)?.id ?? null,
    transform: (item: Annotation) => {
      const prior = getItem(item.id);
      if (!prior) return false;
      if (
        !update(
          item.id,
          item.kind === 'pin'
            ? {
                coordinates: item.coordinates,
                groundElevation: null,
              }
            : {
                coordinates: item.coordinates,
                centerAltitude: item.centerAltitude,
                width: item.width,
                length: item.length,
                height: item.height,
                heading: item.heading,
                pitch: item.pitch,
                roll: item.roll,
              },
        )
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
      if (editing.current && id !== editing.current.draft.id) {
        if (!sameAnnotation(editing.current.base, editing.current.draft)) {
          setSelectionRequest({ id });
          return false;
        }
        setEditing(null);
      }
      setSelected(id);
      setPicking(null);
      return true;
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
      const prior = getItem(id);
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
      if (!persist(current.current.filter((a) => a.id !== id))) return false;
      if (editing.current?.draft.id === id) setEditing(null);
      setSelectionRequest(null);
      if (selected === id) {
        setSelected(null);
        setMoveHistory((history) => history.filter((a) => a.id !== id));
      }
      return true;
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
