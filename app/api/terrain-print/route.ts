import { fromFile } from 'geotiff';
import { resolve } from 'node:path';
import { getTerrainPrintDem, TerrainPrintDemError } from '../../../modules/terrainPrint/dem.ts';

export const runtime = 'nodejs';

const MAX_BODY_BYTES = 8192;
const NO_STORE = { 'Cache-Control': 'no-store' };

async function readInput(request: Request): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) {
    throw new TerrainPrintDemError('INVALID_SELECTION', 415, '请求需使用 JSON。');
  }
  const reader = request.body?.getReader();
  if (!reader) throw new TerrainPrintDemError('INVALID_SELECTION', 400, '缺少选区。');
  const decoder = new TextDecoder();
  let size = 0;
  let body = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new TerrainPrintDemError('INVALID_SELECTION', 413, '选区请求过大。');
      }
      body += decoder.decode(value, { stream: true });
    }
    return JSON.parse(body + decoder.decode()) as unknown;
  } catch (error) {
    if (error instanceof TerrainPrintDemError) throw error;
    throw new TerrainPrintDemError('INVALID_SELECTION', 400, '无法读取选区请求。');
  } finally {
    reader.releaseLock();
  }
}

export async function POST(request: Request) {
  try {
    const input = await readInput(request);
    const cacheDir = process.env.SHANTU_HMA_DEM_CACHE_DIR;
    const result = await getTerrainPrintDem(input, {
      signal: request.signal,
      token: process.env.SHANTU_EARTHDATA_TOKEN,
      cachedTile: cacheDir ? async (filename, signal) => {
        try {
          return await fromFile(resolve(cacheDir, filename), signal);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
          throw error;
        }
      } : undefined,
    });
    return Response.json(result, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof TerrainPrintDemError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status, headers: NO_STORE });
    }
    return Response.json({ error: '生成地形高程网格失败。', code: 'DEM_UNAVAILABLE' }, { status: 502, headers: NO_STORE });
  }
}
