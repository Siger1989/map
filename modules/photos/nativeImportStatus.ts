export type NativePhotoImportInfo = {
  id: number;
  status: 'idle' | 'selecting' | 'preparing' | 'complete' | 'cancelled' | 'failed';
  message: string;
  selected: number;
  prepared: number;
  notes: string[];
  failures: string[];
};

/** Read-only preparation diagnostics. GPS parsing and saved-marker results remain authoritative. */
export function parseNativePhotoImportInfo(raw: string): NativePhotoImportInfo | null {
  try {
    if (raw.length > 256_000) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    const item = value as Record<string, unknown>;
    if (!Number.isSafeInteger(item.id) || (item.id as number) < 1) return null;
    if (!['selecting', 'preparing', 'complete', 'cancelled', 'failed'].includes(String(item.status))) return null;
    if (typeof item.message !== 'string' || item.message.length > 2048) return null;
    for (const key of ['selected', 'prepared']) {
      if (!Number.isSafeInteger(item[key]) || (item[key] as number) < 0 || (item[key] as number) > 200) return null;
    }
    if ((item.prepared as number) > (item.selected as number)) return null;
    for (const key of ['notes', 'failures']) {
      if (!Array.isArray(item[key]) || item[key].length > 200 ||
        !item[key].every((text) => typeof text === 'string' && text.length <= 2048)) return null;
    }
    return item as NativePhotoImportInfo;
  } catch {
    return null;
  }
}
