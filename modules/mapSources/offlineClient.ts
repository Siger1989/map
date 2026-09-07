import type { MapDraft } from './types';
import workerUrl from './offline.worker.ts?worker&url';

export class OfflineClient {
  private worker = new Worker(new URL(workerUrl, window.location.href), {
    type: 'module',
  });
  private serial = 0;
  private closed?: Error;
  private pending = new Map<
    number,
    {
      resolve: (result: unknown) => void;
      reject: (error: Error) => void;
      cleanup: () => void;
    }
  >();
  constructor() {
    this.worker.onmessage = ({ data }) => {
      const p = this.pending.get(data.id);
      if (!p) return;
      this.pending.delete(data.id);
      p.cleanup();
      if (data.error) p.reject(new Error(data.error));
      else p.resolve(data.result);
    };
    this.worker.onerror = () =>
      this.close(new Error('离线地图模块加载失败，请重新打开应用后重试'));
  }
  request<T>(data: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
      if (this.closed) return reject(this.closed);
      if (signal?.aborted)
        return reject(new DOMException('已取消', 'AbortError'));
      const id = ++this.serial;
      const timeout = setTimeout(
        () => this.close(new Error('离线地图读取超时，请重新选择')),
        60000,
      );
      const abort = () => {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(new DOMException('已取消', 'AbortError'));
      };
      this.pending.set(id, {
        resolve: (result) => resolve(result as T),
        reject,
        cleanup: () => {
          clearTimeout(timeout);
          signal?.removeEventListener('abort', abort);
        },
      });
      signal?.addEventListener('abort', abort, { once: true });
      this.worker.postMessage(
        { ...data, id },
        data.bytes instanceof ArrayBuffer ? [data.bytes] : [],
      );
    });
  }
  close(error: Error = new DOMException('已取消', 'AbortError')) {
    this.closed = error;
    this.worker.terminate();
    for (const p of this.pending.values()) {
      p.cleanup();
      p.reject(error);
    }
    this.pending.clear();
  }
}

export async function inspectOffline(
  file: File,
  signal: AbortSignal,
): Promise<{ draft: MapDraft; blob: Blob }> {
  const client = new OfflineClient();
  const cancel = () => client.close();
  signal.addEventListener('abort', cancel, { once: true });
  const timeout = setTimeout(cancel, 60000);
  try {
    const bytes = await file.arrayBuffer();
    const name = file.name.replace(/\.(mbtiles|tiff?)$/i, '').slice(0, 80);
    if (/\.mbtiles$/i.test(file.name)) {
      const draft = await client.request<MapDraft>(
        { op: 'mbtiles', bytes, name },
        signal,
      );
      return { draft, blob: file };
    }
    return await client.request<{ draft: MapDraft; blob: Blob }>(
      { op: 'geotiff', bytes, name },
      signal,
    );
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', cancel);
    client.close();
  }
}
