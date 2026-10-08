export type IndustryProject = {
  id: string;
  name: string;
  kind: 'section' | 'drill';
  sourceBase64: string;
  createdAt: number;
};

export const INDUSTRY_PROJECT_MAX_SOURCE_BYTES = 20 * 1024 * 1024;
export const INDUSTRY_PROJECT_MAX_TOTAL_BYTES = 40 * 1024 * 1024;
export const INDUSTRY_PROJECT_MAX_COUNT = 100;

let opening: Promise<IDBDatabase> | undefined;
function database(): Promise<IDBDatabase> {
  if (!opening) opening = new Promise((resolve, reject) => {
    const request = indexedDB.open('shantu-industry-projects', 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('projects')) request.result.createObjectStore('projects', { keyPath: 'id' });
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); opening = undefined; };
      resolve(request.result);
    };
    request.onerror = () => { opening = undefined; reject(new Error('无法打开本机行业项目库')); };
  });
  return opening;
}

function decodedBytes(sourceBase64: string): number {
  if (sourceBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(sourceBase64)) throw new Error('行业项目原文件编码无效');
  return sourceBase64.length * 3 / 4 - (sourceBase64.endsWith('==') ? 2 : sourceBase64.endsWith('=') ? 1 : 0);
}

export function validateIndustryProjects(value: unknown): IndustryProject[] {
  if (!Array.isArray(value)) throw new Error('行业项目清单格式无效');
  if (value.length > INDUSTRY_PROJECT_MAX_COUNT) throw new Error(`行业项目最多 ${INDUSTRY_PROJECT_MAX_COUNT} 项`);
  const ids = new Set<string>();
  let total = 0;
  const result = value.map((raw): IndustryProject => {
    if (!raw || typeof raw !== 'object') throw new Error('行业项目记录格式无效');
    const item = raw as Record<string, unknown>;
    if (typeof item.id !== 'string' || !item.id.trim() || item.id.length > 200 || ids.has(item.id)) throw new Error('行业项目编号缺失或重复');
    ids.add(item.id);
    if (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 240) throw new Error('行业项目名称无效');
    if (item.kind !== 'section' && item.kind !== 'drill') throw new Error('行业项目图种无效');
    if (typeof item.sourceBase64 !== 'string') throw new Error('行业项目缺少原始工作簿');
    const bytes = decodedBytes(item.sourceBase64);
    if (bytes <= 0 || bytes > INDUSTRY_PROJECT_MAX_SOURCE_BYTES) throw new Error('单个行业工作簿不得超过 20 MB');
    total += bytes;
    if (total > INDUSTRY_PROJECT_MAX_TOTAL_BYTES) throw new Error('行业项目原文件合计不得超过 40 MB');
    if (!Number.isSafeInteger(item.createdAt) || Number(item.createdAt) < 0) throw new Error('行业项目创建时间无效');
    return { id: item.id, name: item.name, kind: item.kind, sourceBase64: item.sourceBase64, createdAt: Number(item.createdAt) };
  });
  return result;
}

export async function readIndustryProjects(): Promise<IndustryProject[]> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction('projects', 'readonly').objectStore('projects').getAll();
    request.onsuccess = () => { try { resolve(validateIndustryProjects(request.result)); } catch (error) { reject(error); } };
    request.onerror = () => reject(new Error('读取本机行业项目失败'));
  });
}

/** Same-ID records from the incoming snapshot replace local copies; all other local projects remain. */
export async function syncIndustryProjects(projects: IndustryProject[]): Promise<IndustryProject[]> {
  const incoming = validateIndustryProjects(projects);
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('projects', 'readwrite');
    const store = tx.objectStore('projects');
    let output: IndustryProject[] = [];
    let reason = '同步行业项目失败';
    const request = store.getAll();
    request.onsuccess = () => {
      try {
        const merged = new Map<string, IndustryProject>((request.result as IndustryProject[]).map((item) => [item.id, item]));
        for (const project of incoming) merged.set(project.id, project);
        output = validateIndustryProjects([...merged.values()]);
        for (const project of incoming) store.put(project);
      } catch (error) { reason = error instanceof Error ? error.message : reason; tx.abort(); }
    };
    request.onerror = () => { reason = '读取本机行业项目失败'; tx.abort(); };
    tx.oncomplete = () => resolve(output);
    tx.onabort = tx.onerror = () => reject(new Error(reason));
  });
}

/** Restore an exact snapshot; IndexedDB rolls back if writing any record fails. */
export async function replaceIndustryProjects(projects: IndustryProject[]): Promise<void> {
  const validated = validateIndustryProjects(projects);
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('projects', 'readwrite');
    const store = tx.objectStore('projects');
    let reason = '恢复行业项目失败';
    const request = store.clear();
    request.onsuccess = () => { for (const project of validated) store.put(project); };
    request.onerror = () => { reason = '清理行业项目恢复目标失败'; tx.abort(); };
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(new Error(reason));
  });
}
