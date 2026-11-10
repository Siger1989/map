import { useEffect, useRef, useState } from 'react';
import { readPhoto, type PhotoDraft } from './import';
import { PHOTO_ACCEPT, PHOTO_FOLDER_ACCEPT, selectPhotoFiles } from './selection';
import './gpsPhotoPanel.css';

type ImportSummary = {
  added: number;
  groups: number;
  duplicates: number;
  missingGps: string[];
};

export function GpsPhotoPanel({
  folderReady = true,
  onImport,
  onShow,
  onOpenFavorites,
  onBusyChange,
}: {
  folderReady?: boolean;
  onImport: (drafts: PhotoDraft[]) => Promise<ImportSummary>;
  onShow: () => void;
  onOpenFavorites: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [native, setNative] = useState(false);
  const [folderSupported, setFolderSupported] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [message, setMessage] = useState('');
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [failures, setFailures] = useState<string[]>([]);
  const active = useRef(true);

  useEffect(() => {
    active.current = true;
    const bridge = window.GuanyunNative;
    setNative(!!bridge);
    setFolderSupported(!bridge || bridge.photoFolders?.() === true);
    return () => { active.current = false; onBusyChange?.(false); };
  }, []);

  const setBusyState = (value: boolean) => {
    setBusy(value);
    onBusyChange?.(value);
  };

  const loadFiles = async (selected: File[], folder: boolean) => {
    let files: File[];
    try {
      files = selectPhotoFiles(selected, folder);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '无法选择这些照片');
      return;
    }
    setSummary(null);
    setFailures([]);
    setProgress('');
    setBusyState(true);
    setMessage('正在读取照片并检查拍摄位置…');
    const drafts: PhotoDraft[] = [];
    const failed: string[] = [];
    for (let index = 0; index < files.length; index++) {
      if (!active.current) return;
      const file = files[index];
      setProgress(`读取中 ${index + 1}/${files.length}：${file.name}`);
      try {
        drafts.push(await readPhoto(file));
      } catch (error) {
        failed.push(`${file.name}：${error instanceof Error ? error.message : '照片读取失败'}`);
      }
    }
    if (!active.current) return;
    setFailures(failed);
    if (!drafts.length) {
      setBusyState(false);
      setProgress('');
      setMessage('没有成功读取的照片。请检查文件格式，或选择原始照片重试。');
      return;
    }
    setMessage('正在保存带有拍摄位置的照片标记…');
    try {
      const saved = await onImport(drafts);
      if (!active.current) return;
      setSummary(saved);
      const noGps = saved.missingGps.length;
      setMessage(`已添加 ${saved.added} 张照片，生成 ${saved.groups} 个标记；无拍摄位置 ${noGps} 张，重复跳过 ${saved.duplicates} 张。`);
    } catch (error) {
      if (!active.current) return;
      setMessage(error instanceof Error ? `保存失败：${error.message}` : '保存失败，请稍后重试。');
      setFailures((items) => [...items, '本批照片未能完成保存。']);
    } finally {
      if (active.current) {
        setBusyState(false);
        setProgress('');
      }
    }
  };

  const handleInput = (event: React.ChangeEvent<HTMLInputElement>, folder: boolean) => {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (files.length) void loadFiles(files, folder);
  };

  return (
    <section className="gps-photo-panel" aria-label="照片标记导入">
      <p className="gps-photo-intro">按照片 GPS 生成标记，存入收藏“照片”；距标记中心50米内合并。没有拍摄位置的照片会跳过。</p>
      <div className="gps-photo-actions">
        <label className="gps-photo-picker">
          导入照片
          <input type="file" accept={PHOTO_ACCEPT} multiple aria-label="导入GPS照片" disabled={busy} onChange={(event) => handleInput(event, false)} />
        </label>
        {folderReady && <label className="gps-photo-picker">
          选择照片文件夹
          <input
            type="file"
            aria-label="选择照片文件夹"
            accept={native ? PHOTO_FOLDER_ACCEPT : PHOTO_ACCEPT}
            {...(native ? {} : { webkitdirectory: '', directory: '' })}
            multiple
            disabled={busy || !folderSupported}
            onChange={(event) => handleInput(event, true)}
          />
        </label>}
      </div>
      {folderReady && !folderSupported && <p className="gps-photo-note">当前安装包不支持文件夹选择；请使用“导入照片”多选。</p>}
      <p className="gps-photo-note">多选最多30张、文件夹最多200张；单张不超过20 MB。请选原图，社交软件可能会移除GPS信息。</p>
      {busy && <p className="gps-photo-status" role="status" aria-live="polite">{progress || message}</p>}
      {!busy && message && <p className="gps-photo-status" role="status" aria-live="polite">{message}</p>}
      {summary && summary.added + summary.duplicates > 0 && <div className="gps-photo-result-actions">
        <button type="button" onClick={onShow}>查看地图</button>
        <button type="button" onClick={onOpenFavorites}>打开照片收藏</button>
      </div>}
      {summary?.missingGps.length ? <>
        <p className="gps-photo-no-gps">{summary.missingGps.length} 张照片没有拍摄位置，已跳过。请选相机原图；不会使用当前定位。</p>
        <details className="gps-photo-failures">
          <summary>没有拍摄位置（{summary.missingGps.length}）</summary>
          <ul>{summary.missingGps.map((name, index) => <li key={`${index}-${name}`}>{name}</li>)}</ul>
        </details>
      </> : null}
      {failures.length > 0 && <details className="gps-photo-failures">
        <summary>读取失败（{failures.length}）</summary>
        <ul>{failures.map((failure, index) => <li key={`${index}-${failure}`}>{failure}</li>)}</ul>
      </details>}
    </section>
  );
}
