import type { TerrainFbxInput } from './buildFbx';
import { exportTerrainPrintFbx } from './fbx';

self.onmessage = ({ data }: MessageEvent<TerrainFbxInput>) => {
  try {
    const fbx = exportTerrainPrintFbx(data.stl, data.options, data.texture, data.trackColors);
    self.postMessage({ fbx }, { transfer: [fbx] });
  } catch (err) {
    self.postMessage({ error: err instanceof Error ? err.message : 'FBX 导出失败。' });
  }
};
