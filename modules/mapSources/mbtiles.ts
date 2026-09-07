import type { Database, SqlJsStatic } from 'sql.js';
import { plainText, validBounds, type MapDraft, type Bounds } from './types.ts';

export function rasterMime(data: Uint8Array): string {
  if (data[0] === 137 && data[1] === 80 && data[2] === 78 && data[3] === 71)
    return 'image/png';
  if (data[0] === 255 && data[1] === 216 && data[2] === 255)
    return 'image/jpeg';
  if (
    new TextDecoder().decode(data.slice(0, 4)) === 'RIFF' &&
    new TextDecoder().decode(data.slice(8, 12)) === 'WEBP'
  )
    return 'image/webp';
  throw new Error(
    'MBTiles 仅支持 PNG / JPEG / WebP 栅格瓦片，暂不支持 PBF 矢量或加密瓦片',
  );
}
export function openMbtiles(SQL: SqlJsStatic, bytes: ArrayBuffer): Database {
  if (new TextDecoder().decode(bytes.slice(0, 16)) !== 'SQLite format 3\0')
    throw new Error('文件不是有效的 SQLite / MBTiles');
  return new SQL.Database(new Uint8Array(bytes));
}
function latitude(y: number, n: number): number {
  return (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
}
export function mbtilesInfo(
  db: Database,
  name: string,
): { draft: MapDraft; sample: Uint8Array } {
  try {
    const meta: Record<string, string> = {};
    for (const row of db.exec('SELECT name, value FROM metadata LIMIT 101')[0]
      ?.values ?? [])
      meta[String(row[0])] = String(row[1]);
    if (
      meta.format &&
      !['png', 'jpg', 'jpeg', 'webp', 'mixed'].includes(
        meta.format.toLowerCase(),
      )
    )
      throw new Error('MBTiles 仅支持栅格影像，暂不支持矢量瓦片');
    if (meta.scheme && meta.scheme !== 'tms')
      throw new Error('MBTiles 必须遵循标准 TMS 行号');
    const levels = db.exec(
      'SELECT min(zoom_level), max(zoom_level), count(*) FROM tiles',
    )[0]?.values[0];
    if (!levels || Number(levels[2]) < 1 || Number(levels[2]) > 100000)
      throw new Error('MBTiles 需要包含 1–100000 张瓦片');
    const [minzoom, maxzoom] = levels.map(Number);
    if (
      !Number.isInteger(minzoom) ||
      !Number.isInteger(maxzoom) ||
      minzoom < 0 ||
      maxzoom > 22
    )
      throw new Error('MBTiles 支持 0–22 级缩放');
    const invalid = db.exec(
      'SELECT 1 FROM tiles WHERE zoom_level != CAST(zoom_level AS INTEGER) OR tile_column < 0 OR tile_row < 0 OR tile_column >= (1 << zoom_level) OR tile_row >= (1 << zoom_level) OR tile_column != CAST(tile_column AS INTEGER) OR tile_row != CAST(tile_row AS INTEGER) OR length(tile_data) > 4194304 LIMIT 1',
    );
    if (invalid.length)
      throw new Error('MBTiles 含无效编号或超大瓦片（单张最多 4 MB）');
    const sample = db.exec('SELECT tile_data FROM tiles LIMIT 1')[0]
      ?.values[0]?.[0];
    if (!(sample instanceof Uint8Array))
      throw new Error('MBTiles 缺少瓦片数据');
    rasterMime(sample);
    let bounds = meta.bounds
      ? validBounds(meta.bounds.split(',').map(Number))
      : undefined;
    if (meta.bounds && !bounds)
      throw new Error('MBTiles 地理范围无效或跨日期变更线');
    if (!bounds) {
      const row = db
        .exec(
          `SELECT min(tile_column), max(tile_column), min(tile_row), max(tile_row) FROM tiles WHERE zoom_level=${minzoom}`,
        )[0]
        .values[0].map(Number);
      const n = 2 ** minzoom;
      bounds = [
        (row[0] / n) * 360 - 180,
        latitude(n - row[2], n),
        ((row[1] + 1) / n) * 360 - 180,
        latitude(n - 1 - row[3], n),
      ] as Bounds;
    }
    return {
      draft: {
        kind: 'mbtiles',
        name: plainText(meta.name, name),
        format: 'MBTiles',
        attribution: plainText(meta.attribution, '用户导入的离线地图'),
        bounds,
        minzoom,
        maxzoom,
        tileSize: 256,
        detail: `${levels[2]} 张离线瓦片 · Web Mercator`,
      },
      sample,
    };
  } catch (error) {
    if (error instanceof Error && /MBTiles/.test(error.message)) throw error;
    throw new Error('MBTiles 结构无效，需要 metadata 和 tiles 标准表');
  }
}
export function mbtile(
  db: Database,
  z: number,
  x: number,
  y: number,
): Uint8Array | undefined {
  if (
    ![z, x, y].every(Number.isInteger) ||
    z < 0 ||
    z > 22 ||
    x < 0 ||
    y < 0 ||
    x >= 2 ** z ||
    y >= 2 ** z
  )
    throw new Error('离线瓦片编号无效');
  const statement = db.prepare(
    'SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=? LIMIT 1',
  );
  try {
    statement.bind([z, x, 2 ** z - 1 - y]);
    if (!statement.step()) return;
    const bytes = statement.get()[0];
    if (!(bytes instanceof Uint8Array) || bytes.length > 4 * 1024 * 1024)
      throw new Error('离线瓦片无效');
    rasterMime(bytes);
    return bytes.slice();
  } finally {
    statement.free();
  }
}
