import type { MapSource } from '../mapSources/types.ts';
import type { DownloadArea } from './downloadPlan.ts';
import { planImportedRouteDownload, type ImportedRoutePlan } from './importedRouteDownload.ts';

type RouteArea = Extract<DownloadArea, { kind: 'route' }>;
export type ImportedRouteEstimate = { count: number; estimatedBytes: number; bounds: ImportedRoutePlan['bounds'] };
type WorkerReply = { id: number; plan?: ImportedRoutePlan | ImportedRouteEstimate; error?: string };
let requestId = 0;

/** Estimate away from the UI thread when module workers are available. Aborting terminates the worker. */
export function planImportedRouteDownloadAsync(
  area: RouteArea,
  source: MapSource,
  zoom: number,
  options: { signal?: AbortSignal } = {},
): Promise<ImportedRoutePlan> {
  const { signal } = options;
  if (signal?.aborted) return Promise.reject(new DOMException('估算已取消', 'AbortError'));
  if (typeof Worker === 'undefined') {
    return new Promise((resolve, reject) => {
      const abort = () => reject(new DOMException('估算已取消', 'AbortError'));
      signal?.addEventListener('abort', abort, { once: true });
      setTimeout(() => {
        signal?.removeEventListener('abort', abort);
        if (signal?.aborted) return abort();
        try { resolve(planImportedRouteDownload(area, source, zoom)); } catch (error) { reject(error); }
      }, 0);
    });
  }
  return new Promise((resolve, reject) => {
    const id = ++requestId;
    const worker = new Worker(new URL('./routeDownloadWorker.ts', import.meta.url), { type: 'module' });
    const cleanup = () => {
      signal?.removeEventListener('abort', abort);
      worker.terminate();
    };
    const abort = () => { cleanup(); reject(new DOMException('估算已取消', 'AbortError')); };
    signal?.addEventListener('abort', abort, { once: true });
    worker.onerror = (event) => { cleanup(); reject(new Error(event.message || '后台估算失败')); };
    worker.onmessage = (event: MessageEvent<WorkerReply>) => {
      if (event.data.id !== id) return;
      cleanup();
      if (event.data.plan && 'urls' in event.data.plan) resolve(event.data.plan);
      else reject(new Error(event.data.error || '无法估算当前路线缓存量'));
    };
    worker.postMessage({ id, area, source, zoom });
  });
}

/** UI-only variant avoids cloning a large URL array back from the worker. */
export function estimateImportedRouteDownloadAsync(
  area: RouteArea,
  source: MapSource,
  zoom: number,
  options: { signal?: AbortSignal } = {},
): Promise<ImportedRouteEstimate> {
  const { signal } = options;
  if (signal?.aborted) return Promise.reject(new DOMException('估算已取消', 'AbortError'));
  if (typeof Worker === 'undefined') {
    return new Promise((resolve, reject) => setTimeout(() => {
      if (signal?.aborted) return reject(new DOMException('估算已取消', 'AbortError'));
      try {
        const plan = planImportedRouteDownload(area, source, zoom);
        resolve({ count: plan.count, estimatedBytes: plan.estimatedBytes, bounds: plan.bounds });
      } catch (error) { reject(error); }
    }, 0));
  }
  return new Promise((resolve, reject) => {
    const id = ++requestId;
    const worker = new Worker(new URL('./routeDownloadWorker.ts', import.meta.url), { type: 'module' });
    const cleanup = () => { signal?.removeEventListener('abort', abort); worker.terminate(); };
    const abort = () => { cleanup(); reject(new DOMException('估算已取消', 'AbortError')); };
    signal?.addEventListener('abort', abort, { once: true });
    worker.onerror = (event) => { cleanup(); reject(new Error(event.message || '后台估算失败')); };
    worker.onmessage = (event: MessageEvent<WorkerReply>) => {
      if (event.data.id !== id) return;
      cleanup();
      if (event.data.plan) resolve({ count: event.data.plan.count, estimatedBytes: event.data.plan.estimatedBytes, bounds: event.data.plan.bounds });
      else reject(new Error(event.data.error || '无法估算当前路线缓存量'));
    };
    worker.postMessage({ id, area, source, zoom, estimateOnly: true });
  });
}
