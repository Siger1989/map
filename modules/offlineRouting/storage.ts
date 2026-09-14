import { validateGraph } from './engine.ts';
import {
  GRAPH_LIMITS,
  type OfflineGraph,
  type GraphManifest,
} from './types.ts';
const DB = 'shantu-offline-routing-v1';
const open = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('graphs', { keyPath: 'id' });
      request.result.createObjectStore('manifests', { keyPath: 'id' });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
export async function listGraphs(): Promise<GraphManifest[]> {
  if (typeof indexedDB === 'undefined') return [];
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const r = db.transaction('manifests').objectStore('manifests').getAll();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  } finally {
    db.close();
  }
}
export async function loadGraph(id: string): Promise<OfflineGraph> {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const r = db.transaction('graphs').objectStore('graphs').get(id);
      r.onsuccess = () => {
        try {
          resolve(validateGraph(r.result));
        } catch (e) {
          reject(e);
        }
      };
      r.onerror = () => reject(r.error);
    });
  } finally {
    db.close();
  }
}
export async function saveGraph(input: OfflineGraph) {
  const graph = validateGraph(input),
    bytes = new TextEncoder().encode(JSON.stringify(graph));
  if (bytes.length > GRAPH_LIMITS.bytes)
    throw new Error('单个离线路网不能超过24MB');
  const existing = await listGraphs();
  if (
    existing.length >= GRAPH_LIMITS.packages &&
    !existing.some((g) => g.id === graph.id)
  )
    throw new Error('最多8个离线路网，请移除不用的区域');
  const digest = [
    ...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
  ]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const manifest: GraphManifest = {
    id: graph.id,
    name: graph.name,
    bounds: graph.bounds,
    createdAt: graph.createdAt,
    attribution: graph.attribution,
    profile: graph.profile,
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    bytes: bytes.length,
    digest,
  };
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['graphs', 'manifests'], 'readwrite');
      tx.objectStore('graphs').put(graph);
      tx.objectStore('manifests').put(manifest);
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error('路网未保存'));
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
  window.dispatchEvent(new Event('shantu-offline-graphs-changed'));
  return manifest;
}
export async function deleteGraph(id: string) {
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['graphs', 'manifests'], 'readwrite');
      tx.objectStore('graphs').delete(id);
      tx.objectStore('manifests').delete(id);
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
  window.dispatchEvent(new Event('shantu-offline-graphs-changed'));
}
export async function verifyGraph(manifest: GraphManifest) {
  const graph = await loadGraph(manifest.id),
    bytes = new TextEncoder().encode(JSON.stringify(graph));
  const digest = [
    ...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
  ]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  if (digest !== manifest.digest || bytes.length !== manifest.bytes)
    throw new Error('路网完整性检查失败，请重新导入或下载');
  return graph;
}
