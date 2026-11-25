import type { TerrainPrintGrid } from './mesh';
import type { PrintSelection } from './selection';

type ResponseData = TerrainPrintGrid & { error?: string; code?: string };

export async function requestTerrainPrintDem(selection: PrintSelection, token: string, signal: AbortSignal): Promise<TerrainPrintGrid> {
  if (typeof window !== 'undefined' && window.GuanyunNative) {
    const { loadNativeTerrainPrintDem } = await import('./nativeDem');
    return loadNativeTerrainPrintDem(selection, token, signal);
  }
  const response = await fetch('/api/terrain-print', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...selection, token: token || undefined }),
    signal,
  });
  const data = await response.json().catch(() => null) as ResponseData | null;
  if (!response.ok || !data) {
    throw Object.assign(new Error(data?.error || '高程服务暂时无法完成，请稍后重试。'), { code: data?.code });
  }
  return data;
}
