import { useCallback, useEffect, useRef, useState } from 'react';
import {
  readPhotos,
  writePhotos,
  patchPhoto,
  remapPhotoTrack,
  type TripPhoto,
  type VisiblePhoto,
} from './storage';
import type { PhotoDetails } from './details';

export function useTripPhotos() {
  const [items, setItems] = useState<VisiblePhoto[]>([]),
    [error, setError] = useState('');
  const [visible, setVisible] = useState(true),
    [selected, setSelected] = useState<string | null>(null);
  const urls = useRef<string[]>([]),
    mounted = useRef(false),
    revision = useRef(0);


  const visibleCache = useRef(new Map<string, VisiblePhoto>());

  const publish = useCallback((data: TripPhoto[]) => {
    const next = data.map((p) => {
      const old = visibleCache.current.get(p.id);
      const same =
        old &&
        old.preview.size === p.preview.size &&
        old.detail?.size === p.detail?.size;
      return {
        ...p,
        preview: same ? old.preview : p.preview,
        detail: same ? old.detail : p.detail,
        url: same ? old.url : URL.createObjectURL(p.preview),
      };
    });
    const keep = new Set(next.map((p) => p.url));
    urls.current.filter((url) => !keep.has(url)).forEach(URL.revokeObjectURL);
    visibleCache.current = new Map(next.map((p) => [p.id, p]));
    urls.current = next.map((p) => p.url);
    setItems(next);
    setError('');
  }, []);
  const refresh = useCallback(async () => {
    const serial = ++revision.current;
    try {
      const data = await readPhotos();
      if (!mounted.current || serial !== revision.current) return;
      publish(data);
    } catch {
      if (mounted.current) setError('本机照片存储暂不可用，未改动已有预览');
    }
  }, [publish]);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const changed = () => { visibleCache.current.clear(); void refresh(); };
    window.addEventListener('guanyun-data-changed', changed);
    return () => {
      window.removeEventListener('guanyun-data-changed', changed);
      mounted.current = false;


      revision.current++;
      urls.current.forEach(URL.revokeObjectURL);
      visibleCache.current.clear();
    };
  }, [refresh]);
  const update = useCallback(
    async (id: string, patch: Omit<PhotoDetails, 'detail'>) => {

      await patchPhoto(id, patch);
      await refresh();
    },
    [refresh],
  );
  return {
    items,
    error,
    visible,
    setVisible,
    selected,
    setSelected,
    update,
    save: async (photos: TripPhoto[]) => {
      const committed = await writePhotos(photos);
      revision.current++;
      if (mounted.current) publish(committed);
    },
    remapTrack: async (from: string, to: string) => {
      await remapPhotoTrack(from, to);
      revision.current++;
      if (mounted.current) await refresh();
    },
    remove: async (id: string) => {
      await writePhotos([], id);
      setSelected(null);
      await refresh();
    },
  };
}
