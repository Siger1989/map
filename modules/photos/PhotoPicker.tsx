import { useEffect, useState } from 'react';
import { PHOTO_ACCEPT, PHOTO_FOLDER_ACCEPT } from './selection';

export function PhotoPicker({
  disabled,
  folderReady,
  trackId,
  onFiles,
}: {
  disabled: boolean;
  folderReady: boolean;
  trackId?: string;
  onFiles: (files: File[], folder: boolean, capturedAt?: number, trackId?: string) => void;
}) {
  const [native, setNative] = useState(false);
  const [folders, setFolders] = useState(true);
  useEffect(() => {
    const bridge = window.GuanyunNative;
    setNative(!!bridge);
    setFolders(!bridge || bridge.photoFolders?.() === true);
  }, []);
  return (
    <div className="photo-picker">
      <label className="import-file">
        直接拍摄
        <input
          type="file"
          accept="image/jpeg"
          capture="environment"
          aria-label="直接拍摄照片"
          disabled={disabled}
          onClick={(e) => {
            const input = e.currentTarget;
            input.dataset.trackId = trackId ?? '';
          }}
          onChange={(e) => {
            const input = e.currentTarget;
            const file = input.files?.[0];
            const targetTrackId = input.dataset.trackId;
            input.value = '';
            delete input.dataset.trackId;
            if (file) onFiles([file], false, native ? Date.now() : undefined, targetTrackId || undefined);
          }}
        />
      </label>
      <label className="import-file">
        导入照片
        <input
          type="file"
          accept={PHOTO_ACCEPT}
          multiple
          disabled={disabled}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            if (files.length) onFiles(files, false);
          }}
        />
      </label>
      {folderReady && <small>可多选照片；文件夹导入用于记录结束后的整组照片整理。</small>}
      {folderReady && <label className="import-file">
        选择照片文件夹
        <input
          type="file"
          aria-label="选择照片文件夹"
          accept={native ? PHOTO_FOLDER_ACCEPT : PHOTO_ACCEPT}
          {...(native ? {} : { webkitdirectory: '', directory: '' })}
          multiple
          disabled={disabled || !folders || !folderReady}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
          if (files.length) onFiles(files, true);
          }}
        />
      </label>}
      {folderReady && <small>
        {folders
          ? '文件夹含子目录，最多 200 张。请选择具体行程目录。'
          : '当前安装包不支持选文件夹，请升级后使用；也可先多选照片。'}
      </small>}
    </div>
  );
}
