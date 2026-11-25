import type { TerrainPrintGrid } from './mesh.ts';
import type { PrintSelection } from './selection.tsx';

type TerrainPrintOptions = {
  shape: PrintSelection['shape'];
  widthMm: number;
  baseMm: number;
  rimMm: number;
};

export type TerrainPrintRecordMeta = {
  id: string;
  name: string;
  createdAt: number;
  selection: PrintSelection;
  options: TerrainPrintOptions;
};

export type TerrainPrintRecord = TerrainPrintRecordMeta & { stl: ArrayBuffer; grid?: TerrainPrintGrid };

type ModelBytes = Pick<TerrainPrintRecord, 'id' | 'stl' | 'grid'>;
const maxGridSamples = 250_000;
const maxTerrainExtent = 40_100_000;
const maxAbsoluteElevation = 12_000;

const databaseName = 'shantu-terrain-print-models';
const metadataStore = 'metadata';
const modelStore = 'models';
let database: Promise<IDBDatabase> | undefined;

function openDatabase() {
  if (!database) {
    const pending = new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open(databaseName, 1);
      let blocked = false;
      opening.onupgradeneeded = () => {
        const db = opening.result;
        db.createObjectStore(metadataStore, { keyPath: 'id' });
        db.createObjectStore(modelStore, { keyPath: 'id' });
      };
      opening.onblocked = () => {
        blocked = true;
        reject(new Error('地形模型收藏正在被其他窗口占用。'));
      };
      opening.onerror = () => reject(opening.error ?? new Error("无法打开地形模型收藏。"));
      opening.onsuccess = () => {
        const db = opening.result;
        if (blocked) {
          db.close();
          return;
        }
        const reset = () => { if (database === pending) database = undefined; };
        db.onclose = reset;
        db.onversionchange = () => {
          db.close();
          reset();
        };
        resolve(db);
      };
    });
    database = pending;
    void pending.catch(() => { if (database === pending) database = undefined; });
  }
  return database;
}

function read<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('未能更新地形模型收藏。'));
  });
}

function recentFirst(a: TerrainPrintRecordMeta, b: TerrainPrintRecordMeta) {
  return b.createdAt - a.createdAt || a.id.localeCompare(b.id);
}

function attachModel(metadata: TerrainPrintRecordMeta, { stl, grid }: ModelBytes): TerrainPrintRecord {
  return grid ? { ...metadata, stl, grid } : { ...metadata, stl };
}

function modelGrid(grid: TerrainPrintGrid): TerrainPrintGrid {
  const { width, height, eastWestMeters, northSouthMeters, elevations } = grid;
  const count = width * height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2 ||
      count > maxGridSamples ||
      ![eastWestMeters, northSouthMeters].every(value => Number.isFinite(value) && value > 0 && value <= maxTerrainExtent) ||
      !Array.isArray(elevations) || elevations.length !== count) {
    throw new Error('地形模型高程网格无效。');
  }
  let hasElevation = false;
  for (const value of elevations) {
    if (value === null) continue;
    if (!Number.isFinite(value) || Math.abs(value) > maxAbsoluteElevation)
      throw new Error('地形模型存在无效高程。');
    hasElevation = true;
  }
  if (!hasElevation) throw new Error('地形模型缺少有效高程。');
  return { width, height, eastWestMeters, northSouthMeters, elevations };
}

export async function listTerrainPrintModelMetas(): Promise<TerrainPrintRecordMeta[]> {
  const db = await openDatabase();
  const transaction = db.transaction(metadataStore, 'readonly');
  const result = read<TerrainPrintRecordMeta[]>(transaction.objectStore(metadataStore).getAll());
  const [items] = await Promise.all([result, done(transaction)]);
  return items.sort(recentFirst);
}

export async function listTerrainPrintModels(): Promise<TerrainPrintRecord[]> {
  const db = await openDatabase();
  const transaction = db.transaction([metadataStore, modelStore], 'readonly');
  const [metadata, bodies] = await Promise.all([
    read<TerrainPrintRecordMeta[]>(transaction.objectStore(metadataStore).getAll()),
    read<ModelBytes[]>(transaction.objectStore(modelStore).getAll()),
    done(transaction),
  ]);
  const modelById = new Map(bodies.map(body => [body.id, body]));
  return metadata.sort(recentFirst).flatMap(item => {
    const body = modelById.get(item.id);
    return body ? [attachModel(item, body)] : [];
  });
}

export async function loadTerrainPrintModel(id: string): Promise<TerrainPrintRecord | null> {
  const db = await openDatabase();
  const transaction = db.transaction([metadataStore, modelStore], 'readonly');
  const [metadata, body] = await Promise.all([
    read<TerrainPrintRecordMeta | undefined>(transaction.objectStore(metadataStore).get(id)),
    read<ModelBytes | undefined>(transaction.objectStore(modelStore).get(id)),
    done(transaction),
  ]);
  return metadata && body ? attachModel(metadata, body) : null;
}

export async function saveTerrainPrintModel(record: TerrainPrintRecord): Promise<void> {
  const db = await openDatabase();
  const { id, name, createdAt, selection, options, stl } = record;
  const { west, south, east, north } = selection.bounds;
  const { shape, widthMm, baseMm, rimMm } = options;
  if (!id || id.length > 200 || !name.trim() || name.length > 200 || !Number.isFinite(createdAt) ||
      (shape !== 'rectangle' && shape !== 'circle') || selection.shape !== shape ||
      ![west, south, east, north, widthMm, baseMm, rimMm].every(Number.isFinite) ||
      west >= east || south >= north || west < -180 || east > 180 || south < -90 || north > 90 ||
      widthMm <= 0 || baseMm <= 0 || rimMm < 0 ||
      !(stl instanceof ArrayBuffer) || stl.byteLength < 134 || stl.byteLength > 32 * 1024 * 1024) {
    throw new Error('地形模型收藏数据无效。');
  }
  const triangles = new DataView(stl).getUint32(80, true);
  if (84 + triangles * 50 !== stl.byteLength) throw new Error('无法收藏不完整的 STL 模型。');
  const grid = record.grid === undefined ? undefined : modelGrid(record.grid);
  const transaction = db.transaction([metadataStore, modelStore], 'readwrite');
  transaction.objectStore(metadataStore).put({
    id, name, createdAt, selection: { shape, bounds: { west, south, east, north } },
    options: { shape, widthMm, baseMm, rimMm },
  } satisfies TerrainPrintRecordMeta);
  transaction.objectStore(modelStore).put((grid ? { id, stl, grid } : { id, stl }) satisfies ModelBytes);
  await done(transaction);
}

export async function deleteTerrainPrintModel(id: string): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction([metadataStore, modelStore], 'readwrite');
  transaction.objectStore(metadataStore).delete(id);
  transaction.objectStore(modelStore).delete(id);
  await done(transaction);
}
