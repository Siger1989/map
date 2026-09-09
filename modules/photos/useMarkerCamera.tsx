import { useRef, useState } from 'react';
import type { Annotation } from '../annotations/data';
import { readPhoto, type PhotoDraft } from './import';
import { markerPhoto } from './association';
import type { TripPhoto } from './storage';

/** Keep the captured marker identity frozen while the external camera is foreground. */
export function useMarkerCamera(save: (photos: TripPhoto[]) => Promise<void>) {
  const input = useRef<HTMLInputElement>(null),
    target = useRef<{ marker: Annotation; time: number } | null>(null);
  const pending = useRef<{
    file: File;
    marker: Annotation;
    time: number;
    draft?: PhotoDraft;
  } | null>(null);
  const working = useRef(false);
  const [busy, setBusy] = useState(false),
    [status, setStatus] = useState(''),
    [markerId, setMarkerId] = useState(''),
    [retry, setRetry] = useState(false);
  const persist = async () => {
    const request = pending.current;
    if (!request || working.current) return;
    working.current = true;
    setBusy(true);
    setRetry(false);
    setStatus('正在保存照片…');
    try {
      request.draft ??= await readPhoto(request.file, setStatus);
      setStatus('正在写入本机存储…');
      await save([markerPhoto(request.draft, request.marker, request.time)]);
      pending.current = null;
      setStatus('照片已保存到这个标记点');
    } catch (e) {
      setRetry(true);
      setStatus(e instanceof Error ? e.message : '照片尚未保存，请重试');
    } finally {
      working.current = false;
      setBusy(false);
    }
  };
  return {
    busy,
    status,
    markerId,
    retry,
    onRetry: () => void persist(),
    capture: (marker: Annotation) => {
      if (busy) return;
      target.current = { marker: structuredClone(marker), time: Date.now() };
      setMarkerId(marker.id);
      setStatus('');
      setRetry(false);
      if (input.current) {
        input.current.value = '';
        input.current.click();
      }
    },
    input: (
      <input
        ref={input}
        hidden
        type="file"
        accept="image/jpeg"
        capture="environment"
        aria-label="拍摄标记点照片"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0],
            request = target.current;
          event.currentTarget.value = '';
          if (!file || !request) return;
          pending.current = { file, ...request };
          void persist();
        }}
      />
    ),
  };
}
