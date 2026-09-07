import { useCallback, useEffect, useRef, useState } from 'react';
import {
  readPhotos,
  writePhotos,
  type TripPhoto,
  type VisiblePhoto,
} from './storage';
export function useTripPhotos() {
  const [items, setItems] = useState<VisiblePhoto[]>([]),
    [error, setError] = useState('');
  const [visible, setVisible] = useState(true),
    [selected, setSelected] = useState<string | null>(null);
  const urls = useRef<string[]>([]),
    mounted = useRef(false),
    revision = useRef(0);
  const refresh = useCallback(async () => {
    const serial = ++revision.current;
    try {
      const data = await readPhotos();
      if (!mounted.current || serial !== revision.current) return;
      urls.current.forEach(URL.revokeObjectURL);
      const next = data.map((p) => ({
        ...p,
        url: URL.createObjectURL(p.preview),
      }));
      urls.current = next.map((p) => p.url);
      setItems(next);
      setError('');
    } catch {
      if (mounted.current) setError('本机照片存储暂不可用，未改动已有预览');
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
      revision.current++;
      urls.current.forEach(URL.revokeObjectURL);
    };
  }, [refresh]);
  return {
    items,
    error,
    visible,
    setVisible,
    selected,
    setSelected,
    save: async (photos: TripPhoto[]) => {
      await writePhotos(photos);
      await refresh();
    },
    remove: async (id: string) => {
      await writePhotos([], id);
      setSelected(null);
      await refresh();
    },
  };
}
