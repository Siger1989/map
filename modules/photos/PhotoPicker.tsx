import { useEffect, useState } from 'react';
import { PHOTO_ACCEPT, PHOTO_FOLDER_ACCEPT } from './selection';

export function PhotoPicker({
  disabled,
  onFiles,
}: {
  disabled: boolean;
  onFiles: (files: File[], folder: boolean) => void;
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
        选择行程照片
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
      <label className="import-file">
        选择照片文件夹
        <input
          type="file"
          aria-label="选择照片文件夹"
          accept={native ? PHOTO_FOLDER_ACCEPT : PHOTO_ACCEPT}
          {...(native ? {} : { webkitdirectory: '', directory: '' })}
          multiple
          disabled={disabled || !folders}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            if (files.length) onFiles(files, true);
          }}
        />
      </label>
      <small>
        {folders
          ? '文件夹含子目录，最多 200 张。请选择具体行程目录。'
          : '当前安装包不支持选文件夹，请升级后使用；也可先多选照片。'}
      </small>
    </div>
  );
}
