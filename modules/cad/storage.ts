import type { CadDecoded, CadFeature } from './types';
import { resolveCrs, type ProjectCrs } from '../coordinates/index.ts';

export type CadDocument = CadDecoded & {
  id: string; sourceBase64: string; sourceCrs: ProjectCrs;
  mapFeatures: CadFeature[]; visible: boolean; createdAt: number;
  axisOrder: 'xy' | 'yx'; unitScale: number;
};
export const CAD_CHANGED = 'shantu-cad-changed';
let opening: Promise<IDBDatabase> | undefined;
function database() {
  return opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open('shantu-cad-workspace', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('documents', { keyPath: 'id' });
    r.onsuccess = () => { r.result.onversionchange = () => { r.result.close(); opening = undefined; }; resolve(r.result); };
    r.onerror = () => { opening = undefined; reject(new Error('无法打开 CAD 存档')); };
  });
}
function checkFeatures(value: unknown, geographic: boolean): asserts value is CadFeature[] {
  if (!Array.isArray(value) || value.length > 20000) throw new Error('CAD 图元数量无效');
  let vertices = 0;
  const ids = new Set<string>();
  const point = (p: unknown) => {
    if (!Array.isArray(p) || p.length < 2 || p.length > 3 || !p.every(n => typeof n === 'number' && Number.isFinite(n)) || ++vertices > 100000)
      throw new Error('CAD 坐标无效或超过十万顶点');
    if (geographic && (Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90)) throw new Error('CAD 地图坐标超出范围');
  };
  for (const item of value) {
    if (!item || typeof item.id !== 'string' || !item.id || item.id.length > 250 || ids.has(item.id) || typeof item.layer !== 'string' || item.layer.length > 250 || typeof item.entityType !== 'string') throw new Error('CAD 图元标识无效');
    ids.add(item.id);
    if (item.color !== undefined && !/^#[0-9a-f]{6}$/i.test(item.color)) throw new Error('CAD 颜色无效');
    if (item.text !== undefined && (typeof item.text !== 'string' || item.text.length > 20000)) throw new Error('CAD 文字无效');
    const g = item.geometry;
    if (!g || !['Point', 'LineString', 'Polygon'].includes(g.type)) throw new Error('不支持的 CAD 几何');
    if (g.type === 'Point') point(g.coordinates);
    else if (g.type === 'LineString') { if (!Array.isArray(g.coordinates) || g.coordinates.length < 2) throw new Error('CAD 线无效'); g.coordinates.forEach(point); }
    else { if (!Array.isArray(g.coordinates) || !g.coordinates.length) throw new Error('CAD 面无效'); for (const ring of g.coordinates) { if (!Array.isArray(ring) || ring.length < 4 || JSON.stringify(ring[0]) !== JSON.stringify(ring.at(-1))) throw new Error('CAD 面未闭合'); ring.forEach(point); } }
  }
}
export function validateCadDocuments(value: unknown): CadDocument[] {
  if (!Array.isArray(value) || value.length > 20) throw new Error('CAD 文档最多20份');
  let bytes = 0;
  const ids = new Set<string>();
  for (const doc of value) {
    if (!doc || typeof doc.id !== 'string' || !doc.id || doc.id.length > 250 || ids.has(doc.id) || typeof doc.name !== 'string' || doc.name.length > 250 || !['dwg', 'dxf'].includes(doc.format)) throw new Error('CAD 文档无效或编号重复');
    ids.add(doc.id);
    if (typeof doc.sourceBase64 !== 'string' || doc.sourceBase64.length > 28_000_000 || doc.sourceBase64.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(doc.sourceBase64)) throw new Error('CAD 原文件编码无效或超过20MB');
    bytes += doc.sourceBase64.length;
    if (bytes > 100 * 1024 * 1024) throw new Error('CAD 原文件总量超过限制');
    resolveCrs(doc.sourceCrs);
    if (typeof doc.visible !== 'boolean' || !Number.isFinite(doc.createdAt) || !['xy', 'yx'].includes(doc.axisOrder) || !Number.isFinite(doc.unitScale) || doc.unitScale <= 0 || doc.unitScale > 1000000) throw new Error('CAD 放置参数无效');
    if (!Array.isArray(doc.layers) || doc.layers.length > 20000 || doc.layers.some((l: { name?: unknown }) => !l || typeof l.name !== 'string')) throw new Error('CAD 图层无效');
    if (!Array.isArray(doc.warnings) || doc.warnings.some((s: unknown) => typeof s !== 'string')) throw new Error('CAD 提示无效');
    checkFeatures(doc.features, false); checkFeatures(doc.mapFeatures, true);
    if (doc.features.length !== doc.mapFeatures.length) throw new Error('CAD 原图与地图图元数量不一致');
  }
  return value as CadDocument[];
}
export async function readCadDocuments(): Promise<CadDocument[]> {
  const db = await database();
  return new Promise((resolve, reject) => { const r = db.transaction('documents').objectStore('documents').getAll(); r.onsuccess = () => { try { resolve(validateCadDocuments(r.result)); } catch (e) { reject(e); } }; r.onerror = () => reject(new Error('读取 CAD 存档失败')); });
}
async function write(documents: CadDocument[], replace: boolean) {
  validateCadDocuments(documents);
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('documents', 'readwrite'), store = tx.objectStore('documents');
    let reason = 'CAD 保存失败，原存档已保留';
    const r = store.getAll();
    r.onsuccess = () => {
      try {
        const merged = new Map<string, CadDocument>(replace ? [] : r.result.map((d: CadDocument) => [d.id, d]));
        for (const d of documents) merged.set(d.id, d);
        validateCadDocuments([...merged.values()]);
        if (replace) store.clear();
        for (const d of documents) store.put(d);
      } catch (e) { reason = e instanceof Error ? e.message : reason; tx.abort(); }
    };
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(new Error(reason)); tx.onerror = () => {};
  });
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CAD_CHANGED));
}
export const syncCadDocuments = (documents: CadDocument[]) => write(documents, false);
export const replaceCadDocuments = (documents: CadDocument[]) => write(documents, true);
