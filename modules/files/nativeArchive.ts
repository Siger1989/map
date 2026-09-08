import { ARCHIVE_LIMIT } from './archive.ts';

export type ArchiveBridge = {
  archiveBegin(name: string, size: number): string;
  archiveAppend(token: string, offset: number, encoded: string): string;
  archiveFinish(token: string, share: boolean): string;
  archiveCancel(token: string): void;
};
/** One small base64 message per chunk, including for archives larger than 8 MB. */
export async function sendArchive(
  file: File,
  share: boolean,
  bridge: ArchiveBridge,
  signal?: AbortSignal,
) {
  if (file.size > ARCHIVE_LIMIT)
    throw new Error('压缩包超过 256 MB，请分批导出');
  signal?.throwIfAborted();
  const begun = bridge.archiveBegin(file.name, file.size);
  if (!begun.startsWith('ok:')) throw new Error(begun || '无法开始压缩包输出');
  const token = begun.slice(3);
  try {
    for (let offset = 0; offset < file.size; offset += 192 * 1024) {
      signal?.throwIfAborted();
      const bytes = new Uint8Array(
        await file.slice(offset, offset + 192 * 1024).arrayBuffer(),
      );
      let raw = '';
      for (let i = 0; i < bytes.length; i += 8192)
        raw += String.fromCharCode(...bytes.subarray(i, i + 8192));
      const result = bridge.archiveAppend(token, offset, btoa(raw));
      if (result !== 'ok') throw new Error(result || '压缩包传输失败');
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    signal?.throwIfAborted();
    const result = bridge.archiveFinish(token, share);
    if (result !== 'ok') throw new Error(result || '压缩包输出失败');
    return '已请求打开系统选择器';
  } finally {
    bridge.archiveCancel(token);
  }
}
