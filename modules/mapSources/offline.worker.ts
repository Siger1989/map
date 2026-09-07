import initSqlJs, { type Database } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { openMbtiles, mbtilesInfo, mbtile, rasterMime } from './mbtiles';
import { decodeGeoTiff } from './geotiff';
import { MAX_FILE_BYTES } from './types';

const sql = () => (sqlPromise ??= initSqlJs({ locateFile: () => wasmUrl }));
let sqlPromise: ReturnType<typeof initSqlJs> | undefined;
let active: Database | undefined;
let queue = Promise.resolve();
// Serialize database access. Import jobs have their own worker and can be terminated.
self.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    try {
      let result: unknown;
      if (data.op === 'tile')
        result = active ? mbtile(active, data.z, data.x, data.y) : undefined;
      else {
        const bytes: ArrayBuffer = data.bytes;
        if (!bytes || bytes.byteLength > MAX_FILE_BYTES)
          throw new Error('离线文件不能超过 64 MB');
        if (data.op === 'open') {
          active?.close();
          active = openMbtiles(await sql(), bytes);
          result = true;
        } else if (data.op === 'mbtiles') {
          const db = openMbtiles(await sql(), bytes);
          try {
            const info = mbtilesInfo(db, data.name);
            const bitmap = await createImageBitmap(
              new Blob([info.sample.slice().buffer], {
                type: rasterMime(info.sample),
              }),
            );
            try {
              if (
                bitmap.width !== bitmap.height ||
                ![256, 512].includes(bitmap.width)
              )
                throw new Error('MBTiles 瓦片须为 256 或 512 像素的正方形');
              result = { ...info.draft, tileSize: bitmap.width };
            } finally {
              bitmap.close();
            }
          } finally {
            db.close();
          }
        } else if (data.op === 'geotiff') {
          const decoded = await decodeGeoTiff(bytes, data.name);
          const canvas = new OffscreenCanvas(decoded.width, decoded.height);
          const context = canvas.getContext('2d');
          if (!context) throw new Error('此设备无法转换 GeoTIFF 影像');
          context.putImageData(
            new ImageData(decoded.pixels, decoded.width, decoded.height),
            0,
            0,
          );
          result = {
            draft: decoded.draft,
            blob: await canvas.convertToBlob({ type: 'image/png' }),
          };
        } else throw new Error('未知离线地图操作');
      }
      self.postMessage({ id: data.id, result });
    } catch (error) {
      self.postMessage({
        id: data.id,
        error: error instanceof Error ? error.message : '离线地图读取失败',
      });
    }
  });
};
