import type { TerrainPrintRecordMeta } from './modelStore';

export type TerrainFbxInput = {
  stl: ArrayBuffer;
  options: TerrainPrintRecordMeta['options'];
  texture?: { filename: string; bytes: ArrayBuffer; mime: 'image/png' | 'image/jpeg' };
};

export function buildTerrainPrintFbx(stl: ArrayBuffer, options: TerrainFbxInput['options'], texture: TerrainFbxInput['texture'], signal: AbortSignal): Promise<ArrayBuffer> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./fbx.worker.ts', import.meta.url), { type: 'module' });
    const cleanup = () => {
      worker.terminate();
      signal.removeEventListener('abort', abort);
    };
    const abort = () => { cleanup(); reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = ({ data }: MessageEvent<{ fbx?: ArrayBuffer; error?: string }>) => {
      cleanup();
      if (data.fbx) resolve(data.fbx);
      else reject(new Error(data.error || 'FBX 导出失败。'));
    };
    worker.onerror = () => { cleanup(); reject(new Error('无法启动 FBX 导出。')); };
    try {
      const copy = stl.slice(0);
      worker.postMessage({ stl: copy, options, texture } satisfies TerrainFbxInput,
        texture ? [copy, texture.bytes] : [copy]);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}
