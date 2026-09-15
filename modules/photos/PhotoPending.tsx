import { useEffect, useState } from 'react';
import type { PhotoMetadata } from './metadata';
import { localPhotoInput } from './matching';
import { readPhoto } from './import';
export function PhotoPending({
  file,
  meta,
  reason,
  disabled,
  onConfirm,
  onPlace,
}: {
  file: File;
  meta: PhotoMetadata;
  reason: string;
  disabled: boolean;
  onConfirm: (time: number | null) => void;
  onPlace?: (time: number | null) => void;
}) {
  const [time, setTime] = useState(meta.time),
    [url, setUrl] = useState(''),
    [error, setError] = useState('');
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  return (
    <details className="photo-pending">
      <summary>
        {file.name} · {reason}
      </summary>
      <label>
        拍摄时间
        <input
          type="datetime-local"
          step={1}
          value={localPhotoInput(time)}
          disabled={disabled}
          onChange={(e) =>
            setTime(e.target.value ? new Date(e.target.value).getTime() : null)
          }
        />
      </label>
      <small>{meta.zone}</small>
      {url ? (
        <img
          src={url}
          alt={file.name}
          style={{ maxWidth: 120, maxHeight: 80 }}
        />
      ) : (
        <button
          disabled={disabled}
          onClick={async () => {
            try {
              const draft = await readPhoto(file, () => {}, meta);
              setUrl(URL.createObjectURL(draft.preview));
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          按需查看预览
        </button>
      )}
      <button
        disabled={disabled || time === null}
        onClick={() => onConfirm(time)}
      >
        确认使用时间估算位置
      </button>
      {onPlace && (
        <button disabled={disabled} onClick={() => onPlace(time)}>
          在地图上选点
        </button>
      )}
      {error && <small role="alert">{error}</small>}
    </details>
  );
}
