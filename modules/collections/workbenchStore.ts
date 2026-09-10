import {
  collectData,
  DATA_CHANGED,
  validateTransfer,
  type Transfer,
} from '../outdoor/exchange.ts';
import { TRACK_STORAGE } from '../tracks/drawing.ts';
import { ANNOTATION_STORAGE } from '../annotations/data.ts';
import { FAVORITES_STORAGE } from '../navigation/favorites.ts';
import { COLLECTION_STORAGE } from './data.ts';
import { REGION_STORAGE } from './regions.ts';
import { SECTION_OBJECTS_KEY } from '../section/sectionObjects.ts';
import { PROFILE_NOTES_KEY } from '../section/profileNotes.ts';
import { AREA_STORAGE } from '../areas/data.ts';
import { SAVED_MEASUREMENTS_KEY } from '../measurement/saved.ts';
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Compare before writing; rollback quota failures. Undo uses the same conflict check. */
export function saveWorkbench(
  before: Transfer,
  value: Transfer,
  storage: Store = localStorage,
) {
  if (JSON.stringify(collectData(storage)) !== JSON.stringify(before))
    throw new Error('收藏已在其他操作中更新，本次未覆盖，请重试。');
  const next = validateTransfer(value);
  const measurements =
    next.measurements === undefined
      ? undefined
      : { version: 1, items: next.measurements };
  const pairs: [string, unknown][] = [
    [TRACK_STORAGE, next.tracks],
    [ANNOTATION_STORAGE, next.annotations],
    [FAVORITES_STORAGE, next.favorites],
    [COLLECTION_STORAGE, next.collections],
    [REGION_STORAGE, next.regions],
    [SECTION_OBJECTS_KEY, next.sections],
    [PROFILE_NOTES_KEY, next.sectionNotes],
    [AREA_STORAGE, next.areas],
  ];
  pairs.push([SAVED_MEASUREMENTS_KEY, measurements]);
  const writes = pairs
    .map(([key, value]) => ({
      key,
      old: storage.getItem(key),
      raw: value === undefined ? null : JSON.stringify(value),
    }))
    .filter((p) => p.old !== p.raw);
  try {
    for (const p of writes)
      p.raw === null
        ? storage.removeItem(p.key)
        : storage.setItem(p.key, p.raw);
  } catch {
    let restored = true;
    for (const p of writes)
      try {
        p.old === null
          ? storage.removeItem(p.key)
          : storage.setItem(p.key, p.old);
      } catch {
        restored = false;
      }
    throw new Error(
      restored
        ? '存储空间不足，修改未保存。'
        : '存储写入失败，恢复未全部完成，请先导出备份。',
    );
  }
  if (typeof window !== 'undefined')
    window.dispatchEvent(new Event(DATA_CHANGED));
  return collectData(storage);
}
