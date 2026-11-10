import { ANNOTATION_STORAGE, parseAnnotations } from '../annotations/data.ts';
import { COLLECTION_STORAGE, parseLayout, validateLayout, type CollectionLayout } from '../collections/data.ts';
import type { PhotoDraft } from './import.ts';
import { planGpsPhotoMarkers } from './gpsMarkers.ts';
import { readPhotos, writePhotos } from './storage.ts';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Existing folders, including a user-renamed/reorganized photo folder, retain their identity. */
export function fileGpsPhotoMarkers(layout: CollectionLayout, markerIds: string[]): CollectionLayout {
  const groups = layout.groups.slice();
  let folder = groups.find(g => g.id === 'photos' && g.name === '照片')
    ?? groups.find(g => g.name === '照片' && !g.parentId);
  if (!folder) {
    let id = 'photos';
    for (let n = 2; groups.some(g => g.id === id); n++) id = `photos-${n}`;
    folder = { id, name: '照片', color: '#76b7b2' };
    groups.push(folder);
  }
  return validateLayout({ ...layout, groups, assignments: {
    ...layout.assignments,
    ...Object.fromEntries(markerIds.map(id => [`annotation:${id}`, folder.id])),
  } });
}

async function commitGpsPhotos(drafts: PhotoDraft[], storage: Store) {
  const annotationRaw = storage.getItem(ANNOTATION_STORAGE);
  const collectionRaw = storage.getItem(COLLECTION_STORAGE);
  const annotations = parseAnnotations(annotationRaw);
  const existingPhotos = await readPhotos();
  const plan = planGpsPhotoMarkers(drafts, annotations, existingPhotos);
  const groupIds = new Set([...plan.photos, ...existingPhotos.filter(p =>
    drafts.some(d => p.id === `gps-photo:${d.hash}`))].flatMap(p => p.annotationId ? [p.annotationId] : []));
  const coordinates = [...annotations, ...plan.annotations]
    .filter(a => groupIds.has(a.id)).map(a => a.coordinates);
  if (!plan.photos.length) return { ...plan, coordinates };
  const nextAnnotations = parseAnnotations(JSON.stringify([...annotations, ...plan.annotations]));
  const nextCollections = fileGpsPhotoMarkers(parseLayout(collectionRaw), plan.annotations.map(a => a.id));
  if (storage.getItem(ANNOTATION_STORAGE) !== annotationRaw || storage.getItem(COLLECTION_STORAGE) !== collectionRaw)
    throw new Error('标记或收藏已在其他操作中更新，本次未覆盖，请重试。');
  const writes = [
    { key: ANNOTATION_STORAGE, old: annotationRaw, next: JSON.stringify(nextAnnotations) },
    { key: COLLECTION_STORAGE, old: collectionRaw, next: JSON.stringify(nextCollections) },
  ].filter(w => w.old !== w.next);
  const written: typeof writes = [];
  try {
    // No await between conflict check and local writes. The IDB photo write is one transaction.
    for (const write of writes) { storage.setItem(write.key, write.next); written.push(write); }
    await writePhotos(plan.photos);
  } catch (error) {
    let restored = true;
    for (const write of written.reverse()) {
      try {
        // Never undo a later change made while the photo transaction was pending.
        if (storage.getItem(write.key) !== write.next) { restored = false; continue; }
        if (write.old === null) storage.removeItem(write.key);
        else storage.setItem(write.key, write.old);
      } catch { restored = false; }
    }
    throw new Error(`${error instanceof Error ? error.message : '照片标记保存失败'}${restored ? '；本次标记和收藏改动已撤回。' : '；部分改动未能恢复，请先导出备份。'}`);
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('guanyun-data-changed'));
  return { ...plan, coordinates };
}

let pending = Promise.resolve();
/** Serialize imports across tabs when Web Locks are supported; always serialize this app instance. */
export function saveGpsPhotoMarkers(drafts: PhotoDraft[], storage: Store = localStorage) {
  const run = async () => {
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    return locks ? await locks.request('shantu-gps-photo-markers', () => commitGpsPhotos(drafts, storage))
      : await commitGpsPhotos(drafts, storage);
  };
  const result = pending.then(() => run());
  pending = result.then(() => {}, () => {});
  return result;
}
