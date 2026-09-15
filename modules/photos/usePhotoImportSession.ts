import { useRef, useState } from 'react';
import type { PhotoMetadata } from './metadata';
export type PendingPhoto = { file: File; meta: PhotoMetadata; reason: string };
/** In-memory selection session survives closing the dock or placing a pending photo on the map. */
export function usePhotoImportSession() {
  const [target, setTarget] = useState(''),
    [pending, setPending] = useState<PendingPhoto[]>([]);
  const [tolerance, setTolerance] = useState(100),
    [shift, setShift] = useState(0),
    [message, setMessage] = useState('');
  const files = useRef<File[]>([]);
  return {
    target,
    setTarget,
    pending,
    setPending,
    tolerance,
    setTolerance,
    shift,
    setShift,
    message,
    setMessage,
    files,
  };
}
