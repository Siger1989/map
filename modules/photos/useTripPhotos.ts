import { useCallback, useEffect, useRef, useState } from 'react';
import {
  readPhotos,
  writePhotos,
  patchPhoto,
  type TripPhoto,
  type VisiblePhoto,
} from './storage';
import type { PhotoDetails } from './details';
import { fetchPhotoWeather } from './weather';
export function useTripPhotos() {
  const [items, setItems] = useState<VisiblePhoto[]>([]),
    [error, setError] = useState('');
  const [visible, setVisible] = useState(true),
    [selected, setSelected] = useState<string | null>(null);
  const urls = useRef<string[]>([]),
    mounted = useRef(false),
    revision = useRef(0);
  const requests = useRef(new Map<string, AbortController>());
  const failedWrites = useRef(new Set<string>());
  const visibleCache = useRef(new Map<string, VisiblePhoto>());
  const [pendingWeather, setPendingWeather] = useState(0);
  const refresh = useCallback(async () => {
    const serial = ++revision.current;
    try {
      const data = await readPhotos();
      if (!mounted.current || serial !== revision.current) return;
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
    } catch {
      if (mounted.current) setError('本机照片存储暂不可用，未改动已有预览');
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
      requests.current.forEach((c) => c.abort());
      requests.current.clear();
      revision.current++;
      urls.current.forEach(URL.revokeObjectURL);
      visibleCache.current.clear();
    };
  }, [refresh]);
  const update = useCallback(
    async (id: string, patch: Omit<PhotoDetails, 'detail'>) => {
      failedWrites.current.delete(id);
      await patchPhoto(id, patch);
      await refresh();
    },
    [refresh],
  );
  useEffect(() => {
    const pending = items.filter(
      (p) =>
        !p.weather &&
        p.weatherError === undefined &&
        !requests.current.has(p.id) &&
        !failedWrites.current.has(p.id),
    );
    for (const p of pending.slice(0, Math.max(0, 2 - requests.current.size))) {
      const controller = new AbortController();
      requests.current.set(p.id, controller);
      void (async () => {
        try {
          let patch: Pick<PhotoDetails, 'weather' | 'weatherError'>;
          try {
            patch = {
              weather: await fetchPhotoWeather(
                p.time,
                p.coordinates,
                controller.signal,
              ),
              weatherError: undefined,
            };
          } catch (e) {
            if (controller.signal.aborted) return;
            patch = {
              weatherError:
                e instanceof Error && e.name !== 'TimeoutError'
                  ? e.message.slice(0, 200)
                  : '天气查询超时，可稍后重试',
            };
          }
          await patchPhoto(p.id, patch, p);
        } catch {
          failedWrites.current.add(p.id);
          if (mounted.current) setError('天气信息未能保存，请检查本机存储');
        } finally {
          if (requests.current.get(p.id) === controller)
            requests.current.delete(p.id);
          if (mounted.current) {
            await refresh();
            setPendingWeather((n) => n + 1);
          }
        }
      })();
    }
  }, [items, pendingWeather, refresh]);
  return {
    items,
    error,
    visible,
    setVisible,
    selected,
    setSelected,
    update,
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
