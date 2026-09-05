import { XMLParser, XMLValidator } from 'fast-xml-parser';

export type TileMatrix = {
  id: string; resolution: number; origin: [number, number];
  tileWidth: number; tileHeight: number; width: number; height: number;
  limits?: { minRow: number; maxRow: number; minCol: number; maxCol: number };
};
export type WmtsMetadata = {
  title: string; layer: string; style: string; format: string; matrixSet: string;
  projection: 'geographic' | 'mercator'; matrices: TileMatrix[];
  legendUrl?: string;
};
const list = <T>(value: T | T[] | undefined): T[] => value === undefined ? [] : Array.isArray(value) ? value : [value];
const value = (input: unknown) => typeof input === 'string' || typeof input === 'number' ? String(input) : '';
const finite = (input: unknown) => { const number = Number(input); if (!Number.isFinite(number)) throw new Error('地图矩阵参数无效'); return number; };
const integer = (input: unknown) => { const number = finite(input); if (!Number.isSafeInteger(number) || number <= 0) throw new Error('地图矩阵尺寸无效'); return number; };
const is200k = (title: string) => {
  const scales = [...title.matchAll(/1\s*[:：∶/]\s*([\d\s,]+)(万)?/g)]
    .map((match) => Number(match[1].replace(/[\s,]/g, '')) * (match[2] ? 10000 : 1));
  return scales.length > 0 && scales.every((scale) => scale === 200000) && /地质/.test(title) && !/地球化学|水文/.test(title);
};

/** Parse the provider's matrix definition; never infer a WMTS grid from XYZ zoom. */
export function parseCapabilities(xml: string, layerId = ''): WmtsMetadata {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new Error('服务未返回有效 WMTS 元数据');
  const doc = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false, processEntities: false }).parse(xml);
  const root = doc.Capabilities;
  if (!root?.Contents) throw new Error('服务未返回 WMTS 图层，可能需要重新授权');
  const serviceTitle = value(root.ServiceIdentification?.Title);
  const layers = list<Record<string, any>>(root.Contents.Layer);
  const layer = layerId ? layers.find((item) => value(item.Identifier) === layerId)
    : layers.find((item) => is200k(value(item.Title))) ?? (layers.length === 1 ? layers[0] : undefined);
  if (!layer) throw new Error('服务未提供所配置的地质图层');
  const title = value(layer.Title) || serviceTitle;
  if (!is200k(title) && !(layers.length === 1 && is200k(serviceTitle))) throw new Error('元数据未确认这是 1∶20 万地质图，已停止加载');
  const format = list<string>(layer.Format).find((item) => item === 'image/png') ?? list<string>(layer.Format).find((item) => item === 'image/jpeg');
  if (!format) throw new Error('服务不支持 PNG/JPEG 地图瓦片');
  if (layer.Dimension) throw new Error('该服务需要额外维度参数，暂不支持');
  const links = list<Record<string, any>>(layer.TileMatrixSetLink);
  const sets = list<Record<string, any>>(root.Contents.TileMatrixSet);
  const choices = sets.filter((set) => links.some((link) => value(link.TileMatrixSet) === value(set.Identifier)));
  const crs = (set: Record<string, any>) => value(set.SupportedCRS);
  const selected = choices.find((set) => /(?:3857|900913)(?:\D*$)/.test(crs(set)))
    ?? choices.find((set) => /(?:4326|4490|CRS84)(?:\D*$)/i.test(crs(set)));
  if (!selected) throw new Error('暂不支持该地图坐标系，需要 EPSG:3857、4326 或 4490');
  const projection = /3857|900913/.test(crs(selected)) ? 'mercator' : 'geographic';
  const link = links.find((item) => value(item.TileMatrixSet) === value(selected.Identifier))!;
  const limits = list<Record<string, any>>(link.TileMatrixSetLimits?.TileMatrixLimits);
  const matrices = list<Record<string, any>>(selected.TileMatrix).map((matrix): TileMatrix => {
    const coordinates = value(matrix.TopLeftCorner).trim().split(/\s+/).map(finite);
    if (coordinates.length !== 2) throw new Error('瓦片原点无效');
    // EPSG geographic axes are latitude/longitude. Some legacy MapGIS servers
    // publish an unmistakable longitude-first global origin (-180, 90).
    const lonFirst = projection === 'mercator' || /CRS84/i.test(crs(selected)) || Math.abs(coordinates[0]) > 90;
    const origin: [number, number] = lonFirst ? [coordinates[0], coordinates[1]] : [coordinates[1], coordinates[0]];
    const resolution = finite(matrix.ScaleDenominator) * 0.00028 / (projection === 'geographic' ? 111319.49079327358 : 1);
    if (resolution <= 0) throw new Error('地图分辨率无效');
    const limit = limits.find((item) => value(item.TileMatrix) === value(matrix.Identifier));
    const result: TileMatrix = {
      id: value(matrix.Identifier), resolution, origin,
      tileWidth: integer(matrix.TileWidth), tileHeight: integer(matrix.TileHeight),
      width: integer(matrix.MatrixWidth), height: integer(matrix.MatrixHeight),
    };
    if (result.tileWidth > 1024 || result.tileHeight > 1024) throw new Error('地图瓦片尺寸过大');
    if (limit) {
      const values = [limit.MinTileRow, limit.MaxTileRow, limit.MinTileCol, limit.MaxTileCol].map(finite);
      if (values.some((n) => !Number.isSafeInteger(n) || n < 0) || values[0] > values[1] || values[2] > values[3]
        || values[1] >= result.height || values[3] >= result.width) throw new Error('瓦片覆盖范围无效');
      result.limits = { minRow: values[0], maxRow: values[1], minCol: values[2], maxCol: values[3] };
    }
    return result;
  }).sort((a, b) => b.resolution - a.resolution);
  if (!matrices.length || matrices.length > 32) throw new Error('服务未提供可用的缩放级别');
  if (matrices.some((matrix) => !matrix.id) || new Set(matrices.map((matrix) => matrix.id)).size !== matrices.length) throw new Error('地图矩阵标识无效或重复');
  const styles = list<Record<string, any>>(layer.Style);
  const style = styles.find((item) => item['@_isDefault'] === 'true') ?? styles[0];
  const legend = list<Record<string, any>>(style?.LegendURL)[0];
  return {
    title: is200k(title) ? title : serviceTitle, layer: value(layer.Identifier), style: value(style?.Identifier) || 'default',
    format, matrixSet: value(selected.Identifier), projection, matrices,
    legendUrl: value(legend?.['@_href']) || undefined,
  };
}
