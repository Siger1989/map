import { Zip, ZipDeflate, ZipPassThrough } from 'fflate';

export type ArchiveEntry = { path: string; data: Blob | string | Uint8Array };
export const ARCHIVE_LIMIT = 256 * 1024 * 1024;
export const ZIP_MIME = 'application/zip';
export function archiveName(name: string) {
  return (
    name
      .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
      .replace(/^\.+|[. ]+$/g, '')
      .slice(0, 70) || '未命名'
  );
}
/** Sequential Blob reads bound working memory; JPEG/XLSX are already compressed. */
export async function archiveBlob(
  entries: ArchiveEntry[],
  signal?: AbortSignal,
) {
  const names = new Set<string>();
  if (!entries.length || entries.length > 4000)
    throw new Error('压缩包条目数量无效');
  const inputs = entries.map((e) => {
    if (
      !e.path ||
      e.path.startsWith('/') ||
      /[\\\x00-\x1f]/.test(e.path) ||
      e.path
        .split('/')
        .some((part) => !part || part === '.' || part === '..') ||
      names.has(e.path)
    )
      throw new Error('压缩包文件名冲突或无效');
    names.add(e.path);
    return {
      ...e,
      blob:
        e.data instanceof Blob
          ? e.data
          : new Blob([
              typeof e.data === 'string' ? e.data : new Uint8Array(e.data),
            ]),
    };
  });
  if (inputs.reduce((n, e) => n + e.blob.size, 0) > ARCHIVE_LIMIT - 1024 * 1024)
    throw new Error('压缩包超过 255 MB，请分批选择；尚未导出或删减任何照片');
  const parts: Blob[] = [];
  let failure: Error | null = null,
    size = 0;
  const zip = new Zip((error, bytes) => {
    if (error) {
      failure = error;
      return;
    }
    size += bytes.length;
    if (size > ARCHIVE_LIMIT) {
      failure = new Error('压缩包超过 256 MB，请分批导出');
      return;
    }
    // Blob owns its chunk; do not keep another full uncompressed byte array.
    parts.push(new Blob([new Uint8Array(bytes)]));
  });
  try {
    for (const input of inputs) {
      signal?.throwIfAborted();
      const entry = /\.(jpg|jpeg|png|xlsx|zip)$/i.test(input.path)
        ? new ZipPassThrough(input.path)
        : new ZipDeflate(input.path, { level: 6 });
      zip.add(entry);
      for (let offset = 0; offset < input.blob.size; offset += 256 * 1024) {
        signal?.throwIfAborted();
        entry.push(
          new Uint8Array(
            await input.blob.slice(offset, offset + 256 * 1024).arrayBuffer(),
          ),
          false,
        );
        if (failure) throw failure;
      }
      entry.push(new Uint8Array(), true);
      // Yield between files so progress/cancel remains responsive on a phone.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    zip.end();
    if (failure) throw failure;
    signal?.throwIfAborted();
    return new Blob(parts, { type: ZIP_MIME });
  } catch (e) {
    zip.terminate();
    throw e;
  }
}
