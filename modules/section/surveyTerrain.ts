import { SectionTerrainStore } from './elevation';
import { mercator } from './planeMath';
import type { Coordinate } from '../navigation/types';
import {
  surveyBasis,
  surveyCoordinate,
  surveyKey,
  surveyRange,
  type SurveyLine,
  type SurveyTerrain,
} from './surveyLine';

/** One DEM grid supplies both the centre profile and plan contours. No fill across missing tiles. */
export async function sampleSurveyTerrain(
  line: SurveyLine,
  signal: AbortSignal,
  groundElevation?: (point: Coordinate) => number | null,
): Promise<SurveyTerrain> {
  const range = surveyRange(line),
    columns = 257,
    rows = 49,
    basis = surveyBasis(line);
  const spacing = Math.max(
    (range.end - range.start) / (columns - 1),
    (line.halfWidth * 2) / (rows - 1),
  );
  const zoom = Math.max(
    6,
    Math.min(
      12,
      Math.floor(Math.log2(1 / (basis.unit * 256 * Math.max(4, spacing)))),
    ),
  );
  const n = 2 ** zoom,
    tiles = new Map<string, { z: number; x: number; y: number }>();
  const cells: { x: number; y: number; point: Coordinate }[] = [];
  const key = (px: number, py: number) => {
    const x = ((Math.floor(px / 256) % n) + n) % n,
      y = Math.floor(py / 256);
    return { key: `${x}/${y}`, x, y, z: zoom };
  };
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < columns; col++) {
      const p = surveyCoordinate(
        line,
        range.start + (col / (columns - 1)) * (range.end - range.start),
        -line.halfWidth + (row / (rows - 1)) * line.halfWidth * 2,
      );
      const m = mercator(p),
        x = m.x * n * 256 - 0.5,
        y = m.y * n * 256 - 0.5;
      cells.push({ x, y, point: p });
      for (const dx of [0, 1])
        for (const dy of [0, 1]) {
          const t = key(Math.floor(x) + dx, Math.floor(y) + dy);
          if (t.y >= 0 && t.y < n) tiles.set(t.key, t);
        }
    }
  if (tiles.size > 80)
    throw new Error('剖面范围过大，请缩短勘探线或平面图带宽');
  const store = new SectionTerrainStore(),
    heights = new Map<string, Float32Array>(),
    failures: unknown[] = [];
  try {
    await Promise.all(
      [...tiles].map(async ([k, tile]) => {
        try {
          heights.set(k, await store.read(tile, signal));
        } catch (error) {
          signal.throwIfAborted();
          failures.push(error);
        }
      }),
    );
    signal.throwIfAborted();
    const pixel = (x: number, y: number) => {
      const t = key(x, y),
        data = heights.get(t.key);
      return (
        data?.[(((y % 256) + 256) % 256) * 256 + (((x % 256) + 256) % 256)] ??
        NaN
      );
    };
    let loadedSamples = 0,
      networkSamples = 0;
    const samples = cells.map((p) => {
      const x = Math.floor(p.x),
        y = Math.floor(p.y),
        fx = p.x - x,
        fy = p.y - y;
      const a = pixel(x, y),
        b = pixel(x + 1, y),
        c = pixel(x, y + 1),
        d = pixel(x + 1, y + 1);
      const value = [a, b, c, d].every(Number.isFinite)
        ? (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy
        : NaN;
      if (value >= -12000 && value <= 10000) {
        networkSamples++;
        return Math.round(value * 100) / 100;
      }
      let loaded: number | null = null;
      try {
        loaded = groundElevation?.(p.point) ?? null;
      } catch {
        loaded = null;
      }
      if (
        loaded !== null &&
        Number.isFinite(loaded) &&
        loaded >= -12000 &&
        loaded <= 10000
      ) {
        loadedSamples++;
        return Math.round(loaded * 100) / 100;
      }
      return null;
    });
    if (samples.every((v) => v === null) && !heights.size && failures.length) {
      if (
        failures.some(
          (error) => (error as { name?: string })?.name === 'TimeoutError',
        )
      )
        throw new Error('地形加载超时，请检查网络后重试');
      throw new Error('地形瓦片读取失败，请联网后重试');
    }
    if (samples.every((v) => v === null))
      throw new Error('当前范围没有可用地形，请联网后重试');
    return {
      key: surveyKey(line),
      columns,
      rows,
      ...range,
      halfWidth: line.halfWidth,
      heights: samples,
      zoom,
      sampledAt: Date.now(),
      source: loadedSamples
        ? networkSamples
          ? '网络 DEM：成都区域 FABDEM V1-2（CC BY-NC-SA 4.0）；其他区域 Mapzen/SRTM；网络缺测处由当前地图已加载 DEM 补充'
          : '当前地图已加载 DEM（网络采样无有效点）'
        : '成都区域 FABDEM V1-2（CC BY-NC-SA 4.0）；其他区域 Mapzen/SRTM',
    };
  } finally {
    store.clear();
  }
}
