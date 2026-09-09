import type { TripPhoto } from './storage.ts';
import type { ArchiveEntry } from '../files/archive';
import { archiveName } from '../files/archive';

/** Explicitly selected markers only; attachment metadata retains the stable marker id. */
export function markerPhotoArchiveEntries(ids: string[], photos: TripPhoto[]): ArchiveEntry[] {
  const selected = new Set(ids);
  return photos.filter(p => p.kind === 'annotation' && selected.has(p.annotationId!)).flatMap((p, i) => {
    const { preview, detail, ...metadata } = p;
    const stem = `标记照片/${String(i + 1).padStart(3, '0')}-${archiveName(p.title || p.name)}`;
    return [{ path: `${stem}.jpg`, data: detail ?? preview },
      { path: `${stem}.json`, data: JSON.stringify(metadata, null, 2) }];
  });
}
