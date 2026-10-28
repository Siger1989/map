import { readMap } from '../../mapSources/storage.ts';
import type { MapSource } from '../../mapSources/types.ts';
import type { NativeMapBridgeClient } from './client.ts';

const CHUNK_BYTES = 256 * 1024;
export type NativeMapSourceRecord = MapSource & { nativeAssetId?: string };

/** Materialize a local source without changing its IndexedDB row or putting a 64 MiB file in one RPC. */
export async function prepareNativeMapSource(
  client: NativeMapBridgeClient, mapId: string, source: MapSource | null,
  signal?: AbortSignal,
): Promise<NativeMapSourceRecord | null> {
  if (!source || source.kind === 'online') return source;
  signal?.throwIfAborted();
  const stored = await readMap(source.id);
  if (!(stored?.blob instanceof Blob) || !stored.blob.size) throw new Error('离线图源文件缺失，请重新导入原文件');
  const blob = stored.blob;
  if (blob.size > 64 * 1024 * 1024) throw new Error('离线图源超过64 MiB限制');
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())),
    byte => byte.toString(16).padStart(2, '0')).join('');
  signal?.throwIfAborted();
  const cached = await client.request<{ found: boolean; nativeAssetId?: string; sha256: string; size?: number }>(
    mapId, 'mapAssetLookup', { sourceId: source.id, sha256, metadata: source }, { signal });
  if (cached.found && cached.nativeAssetId && cached.sha256 === sha256 && cached.size === blob.size) {
    return { ...source, nativeAssetId: cached.nativeAssetId };
  }
  const transferId = crypto.randomUUID();
  await client.request(mapId, 'mapAssetBegin', { transferId, sourceId: source.id, size: blob.size, sha256, metadata: source, blobMime: blob.type }, { signal });
  try {
    for (let offset = 0, index = 0; offset < blob.size; offset += CHUNK_BYTES, index++) {
      signal?.throwIfAborted();
      const base64 = await blobBase64(blob.slice(offset, offset + CHUNK_BYTES));
      await client.request(mapId, 'mapAssetChunk', { transferId, index, base64 }, { signal });
    }
    const result = await client.request<{ nativeAssetId: string; sha256: string; size: number }>(
      mapId, 'mapAssetCommit', { transferId }, { signal, timeoutMs: 60_000 });
    if (!result.nativeAssetId || result.sha256 !== sha256 || result.size !== blob.size) throw new Error('离线地图原生副本校验失败');
    return { ...source, nativeAssetId: result.nativeAssetId };
  } catch (error) {
    if (client.isReady) client.notify(mapId, 'mapAssetAbort', { transferId });
    throw error;
  }
}

function blobBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result ?? '');
      const comma = value.indexOf(',');
      if (comma < 0) reject(new Error('离线地图分片读取失败'));
      else resolve(value.slice(comma + 1));
    };
    reader.onerror = () => reject(new Error('离线地图分片读取失败'));
    reader.readAsDataURL(blob);
  });
}
