import { sendArchive, type ArchiveBridge } from './nativeArchive.ts';
const streamedText = (name: string) => /^(Shantu-workspace\.json|Shantu-(route-coordinates-\d{1,16}|coordinates-\d{4}-\d{2}-\d{2})\.(json|csv))$/.test(name);
/** Shared generated-file boundary; Android retains explicit read-only picker/share grants. */
export function canShareGeneratedFile(name: string, mime: string) {
  if (typeof window !== 'undefined' && window.GuanyunNative) {
    const native = window.GuanyunNative;
    return name.endsWith('.zip') || streamedText(name)
      ? !!(native.archiveBegin && native.archiveAppend && native.archiveFinish && native.archiveCancel)
      : !!native.routeOutput;
  }
  if (typeof navigator === 'undefined' || !navigator.canShare) return false;
  try {
    const file = new File([], name, { type: mime });
    return navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

export async function deliverFile(
  file: File,
  share: boolean,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  if (window.GuanyunNative) {
    if (file.name.endsWith('.zip') || streamedText(file.name)) {
      const native = window.GuanyunNative;
      if (
        !native.archiveBegin ||
        !native.archiveAppend ||
        !native.archiveFinish ||
        !native.archiveCancel
      )
        throw new Error('此 APK 尚不支持完整文件输出，请安装新版');
      if (streamedText(file.name) && file.size > 100 * 1024 * 1024)
        throw new Error('工程文件超过 100 MB');
      return sendArchive(file, share, native as ArchiveBridge, signal);
    }
    if (file.size > 8 * 1024 * 1024)
      throw new Error('单个文件超过 8 MB，请选择 ZIP 打包导出');
    if (!window.GuanyunNative.routeOutput)
      throw new Error('此 APK 不支持该文件输出，请安装新版');
    const encoded = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsDataURL(file);
    });
    const result = window.GuanyunNative.routeOutput(file.name, encoded, share);
    if (result !== 'ok') throw new Error(result || '无法打开系统选择器');
    return '已请求打开系统选择器';
  }
  if (share) {
    if (!navigator.canShare?.({ files: [file] }))
      throw new Error('此浏览器不支持文件分享，请保存后分享');
    await navigator.share({ files: [file], title: '山兔收藏' });
    return '已交给系统分享';
  }
  const url = URL.createObjectURL(file),
    anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return '已下载文件副本';
}
