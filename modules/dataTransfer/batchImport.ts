import { parseFile } from './fileImport.ts';
import { collectData, mergeData } from './storage.ts';
import type { Transfer } from './types.ts';

export const BATCH_LIMITS = { files: 10, bytes: 32 * 1024 * 1024 } as const;
export type ImportBatch = {
  data: Transfer;
  files: { name: string; tracks: number; annotations: number }[];
};

/** Validate the complete selection in isolated memory before the user confirms one real merge. */
export async function parseFiles(
  files: File[],
  parse: (file: File) => Promise<Transfer> = parseFile,
): Promise<ImportBatch> {
  if (!files.length || files.length > BATCH_LIMITS.files)
    throw new Error('每批请选择1–10个文件');
  if (files.reduce((total, file) => total + file.size, 0) > BATCH_LIMITS.bytes)
    throw new Error('每批文件合计不能超过32 MB');
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  const entries: ImportBatch['files'] = [];
  for (const file of files) {
    try {
      const data = await parse(file);
      // ID collisions and bound marker remapping use the same transaction as ordinary import.
      mergeData(data, storage, false);
      entries.push({
        name: file.name,
        tracks: data.tracks.length,
        annotations: data.annotations.length,
      });
    } catch (error) {
      throw new Error(
        `${file.name}：${error instanceof Error ? error.message : '解析失败'}；本批未导入`,
      );
    }
  }
  return { data: collectData(storage), files: entries };
}
