import { RouteBuilder, type ImportPoint } from '../dataTransfer/routeBuilder.ts';
import type { Transfer } from '../dataTransfer/types.ts';
import { fromWgs84, toWgs84, resolveCrs, type ProjectCrs, type ProjectPoint } from './index.ts';

export type ExchangeGeometryType = 'Point' | 'LineString' | 'MultiLineString' | 'Polygon';
export type ExchangeFeature = {
  featureID: string;
  name: string;
  type: ExchangeGeometryType;
  properties?: Record<string, unknown>;
  geometry: { type: ExchangeGeometryType; coordinates: unknown };
};
export type CoordinateExchange = {
  schema: 'shantu-coordinate-exchange';
  version: 1;
  crs: ProjectCrs;
  axisOrder: ['x', 'y'];
  features: ExchangeFeature[];
};
export type CoordinateImport = { data: Transfer; crs: ProjectCrs; featureCount: number };

const MAX_FEATURES = 2_200;
const MAX_VERTICES = 250_000;
const CSV_TITLE = '# 山兔工程坐标交换 CSV v1';
const CSV_HEADER = ['featureID', 'name', 'type', 'part', 'vertex', 'x', 'y', 'z', 'propertiesJSON'];

function projectPoints(points: readonly (readonly [number, number])[], crs: ProjectCrs, altitudes?: readonly (number | null | undefined)[]): ProjectPoint[] {
  return points.map((point, index) => {
    const altitude = altitudes?.[index];
    return fromWgs84(altitude === null || altitude === undefined ? point : [point[0], point[1], altitude], crs);
  });
}

function safeProps(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function projectFeature(feature: ExchangeFeature, crs: ProjectCrs): ExchangeFeature {
  const coordinates = feature.geometry.coordinates as unknown;
  const transform = (point: unknown): ProjectPoint => {
    if (!Array.isArray(point) || point.length < 2 || !point.slice(0, 3).every(Number.isFinite)) throw new Error('交换文件中包含无效坐标。');
    return fromWgs84(point.slice(0, 3) as unknown as ProjectPoint, crs);
  };
  let projected: unknown;
  if (feature.type === 'Point') projected = transform(coordinates);
  else if (feature.type === 'LineString') {
    if (!Array.isArray(coordinates)) throw new Error('LineString 坐标格式无效。');
    projected = coordinates.map(transform);
  } else if (feature.type === 'MultiLineString' || feature.type === 'Polygon') {
    if (!Array.isArray(coordinates)) throw new Error(`${feature.type} 坐标格式无效。`);
    projected = coordinates.map((part) => {
      if (!Array.isArray(part)) throw new Error('交换文件分段格式无效。');
      return part.map(transform);
    });
  } else throw new Error('工程交换几何类型不受支持。');
  return { ...feature, geometry: { type: feature.type, coordinates: projected } };
}

function featureFromPoint(id: string, name: string, coordinates: ProjectPoint, properties?: Record<string, unknown>): ExchangeFeature {
  return { featureID: id, name, type: 'Point', ...(properties ? { properties } : {}), geometry: { type: 'Point', coordinates } };
}

function uniqueFeatureId(used: Set<string>, base: string): string {
  let value = base;
  let suffix = 2;
  while (used.has(value)) value = `${base}#${suffix++}`;
  used.add(value);
  return value;
}

function collectFeatures(data: Transfer): ExchangeFeature[] {
  const features: ExchangeFeature[] = [];
  const featureIds = new Set<string>();
  for (const marker of data.annotations ?? []) {
    if (marker.kind !== 'pin') continue;
    const coordinates: ProjectPoint = marker.groundElevation === null
      ? marker.coordinates
      : [marker.coordinates[0], marker.coordinates[1], marker.groundElevation];
    features.push(featureFromPoint(uniqueFeatureId(featureIds, `pin:${marker.id}`), marker.name, coordinates, { type: 'pin', note: marker.note }));
  }
  for (const track of data.tracks ?? []) {
    const lines = track.segments.map((segment, index) => projectPoints(
      segment, { id: 'EPSG:4326', name: 'WGS 84' }, track.samples?.[index]?.map((sample) => sample.altitude),
    ));
    // Coordinates in Transfer are WGS 84; projectFeature applies the selected target.
    features.push({
      featureID: uniqueFeatureId(featureIds, `track:${track.id}`),
      name: track.name,
      type: lines.length === 1 ? 'LineString' : 'MultiLineString',
      properties: { sourceType: 'track', segmentCount: lines.length },
      geometry: { type: lines.length === 1 ? 'LineString' : 'MultiLineString', coordinates: lines.length === 1 ? lines[0] : lines },
    });
  }
  for (const area of data.areas ?? []) {
    features.push({
      featureID: uniqueFeatureId(featureIds, `area:${area.id}`),
      name: area.name,
      type: 'Polygon',
      properties: { sourceType: 'area', note: area.note, color: area.color },
      geometry: { type: 'Polygon', coordinates: [area.boundary] },
    });
  }
  for (const favorite of data.favorites ?? []) {
    const route = favorite.route;
    if (!route.coordinates.length) continue;
    features.push({
      featureID: uniqueFeatureId(featureIds, `favorite-route:${favorite.id}`),
      name: favorite.name,
      type: 'LineString',
      properties: {
        sourceType: 'favorite-route',
        startName: favorite.start.name,
        endName: favorite.end.name,
        mode: route.mode,
      },
      geometry: { type: 'LineString', coordinates: projectPoints(route.coordinates, { id: 'EPSG:4326', name: 'WGS 84' }) },
    });
  }
  if (features.length > MAX_FEATURES) throw new Error(`工程交换最多支持 ${MAX_FEATURES} 个简单空间对象。`);
  return features;
}

export function createCoordinateExchange(data: Transfer, target: string | ProjectCrs): CoordinateExchange {
  const crs = resolveCrs(target);
  const features = collectFeatures(data).map((feature) => projectFeature(feature, crs));
  return { schema: 'shantu-coordinate-exchange', version: 1, crs, axisOrder: ['x', 'y'], features };
}

function csvCell(value: unknown): string {
  const text = value === undefined || value === null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function flattenFeature(feature: ExchangeFeature): { part: number; vertex: number; point: ProjectPoint }[] {
  const result: { part: number; vertex: number; point: ProjectPoint }[] = [];
  const addPart = (part: number, points: unknown) => {
    if (!Array.isArray(points)) throw new Error('交换几何坐标无效。');
    for (let vertex = 0; vertex < points.length; vertex++) {
      const point = points[vertex];
      if (!Array.isArray(point) || point.length < 2 || !point.slice(0, 3).every(Number.isFinite)) throw new Error('交换几何坐标无效。');
      result.push({ part, vertex, point: point.slice(0, 3) as unknown as ProjectPoint });
    }
  };
  if (feature.type === 'Point') addPart(0, [feature.geometry.coordinates]);
  else if (feature.type === 'LineString') addPart(0, feature.geometry.coordinates);
  else if (feature.type === 'MultiLineString' || feature.type === 'Polygon') {
    if (!Array.isArray(feature.geometry.coordinates)) throw new Error('交换几何坐标无效。');
    feature.geometry.coordinates.forEach((part, index) => addPart(index, part));
  }
  return result;
}

export function exportCoordinateExchangeJson(data: Transfer, target: string | ProjectCrs): string {
  return JSON.stringify(createCoordinateExchange(data, target), null, 2);
}

export function exportCoordinateExchangeCsv(data: Transfer, target: string | ProjectCrs): string {
  const exchange = createCoordinateExchange(data, target);
  const rows = [CSV_TITLE, `# CRS_JSON=${encodeURIComponent(JSON.stringify(exchange.crs))}`, CSV_HEADER.join(',')];
  for (const feature of exchange.features) {
    for (const { part, vertex, point } of flattenFeature(feature)) {
      rows.push([
        feature.featureID, feature.name, feature.type, part, vertex, point[0], point[1], point[2], JSON.stringify(feature.properties ?? {}),
      ].map(csvCell).join(','));
    }
  }
  return `${rows.join('\r\n')}\r\n`;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell === '') quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += char;
  }
  if (quoted) throw new Error('CSV 引号未闭合。');
  if (cell || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
  return rows;
}

function parseExchangeCsv(text: string): CoordinateExchange {
  const firstBreak = text.indexOf('\n');
  const secondBreak = text.indexOf('\n', firstBreak + 1);
  if (firstBreak < 0 || secondBreak < 0 || text.slice(0, firstBreak).replace(/\r$/, '') !== CSV_TITLE) throw new Error('不是山兔工程坐标交换 CSV v1。');
  const crsLine = text.slice(firstBreak + 1, secondBreak).replace(/\r$/, '');
  if (!crsLine.startsWith('# CRS_JSON=')) throw new Error('CSV 缺少显式 CRS 元数据。');
  let crs: ProjectCrs;
  try { crs = resolveCrs(JSON.parse(decodeURIComponent(crsLine.slice(11)))); }
  catch { throw new Error('CSV 坐标系元数据无效。'); }
  const rows = parseCsv(text.slice(secondBreak + 1));
  const header = rows.shift();
  if (!header || header.join(',') !== CSV_HEADER.join(',')) throw new Error('CSV 字段不是山兔工程交换格式。');
  const features = new Map<string, ExchangeFeature & { _parts: Map<number, { vertex: number; point: ProjectPoint }[]> }>();
  for (const row of rows.filter((item) => item.some((cell) => cell !== ''))) {
    if (row.length !== CSV_HEADER.length) throw new Error('CSV 行字段数量无效。');
    const [featureID, name, rawType, rawPart, rawVertex, rawX, rawY, rawZ, rawProperties] = row;
    const type = rawType as ExchangeGeometryType;
    if (!['Point', 'LineString', 'MultiLineString', 'Polygon'].includes(type)) throw new Error('CSV 几何类型不受支持。');
    const part = Number(rawPart), vertex = Number(rawVertex), x = Number(rawX), y = Number(rawY);
    const z = rawZ === '' ? undefined : Number(rawZ);
    if (!featureID || !Number.isSafeInteger(part) || part < 0 || !Number.isSafeInteger(vertex) || vertex < 0 || !Number.isFinite(x) || !Number.isFinite(y) || (z !== undefined && !Number.isFinite(z))) throw new Error('CSV 坐标记录无效。');
    let properties: Record<string, unknown> | undefined;
    try { properties = safeProps(JSON.parse(rawProperties)); } catch { throw new Error('CSV 对象属性不是有效 JSON。'); }
    let feature = features.get(featureID);
    if (!feature) {
      feature = { featureID, name, type, ...(properties ? { properties } : {}), geometry: { type, coordinates: [] }, _parts: new Map() };
      features.set(featureID, feature);
    }
    if (feature.type !== type || feature.name !== name) throw new Error('同一 featureID 的 CSV 记录信息不一致。');
    const points = feature._parts.get(part) ?? [];
    points.push({ vertex, point: z === undefined ? [x, y] : [x, y, z] });
    feature._parts.set(part, points);
  }
  const output: ExchangeFeature[] = [];
  for (const feature of features.values()) {
    const parts = [...feature._parts.entries()].sort((a, b) => a[0] - b[0]).map(([, points]) => {
      points.sort((a, b) => a.vertex - b.vertex);
      if (points.some((point, index) => point.vertex !== index)) throw new Error('CSV 顶点序号不连续或重复。');
      return points.map(({ point }) => point);
    });
    let coordinates: unknown;
    if (feature.type === 'Point') {
      if (parts.length !== 1 || parts[0].length !== 1) throw new Error('Point 必须恰有一个顶点。');
      coordinates = parts[0][0];
    } else if (feature.type === 'LineString') {
      if (parts.length !== 1) throw new Error('LineString 必须恰有一个分段。');
      coordinates = parts[0];
    } else if (feature.type === 'Polygon') {
      if (parts.length !== 1) throw new Error('Polygon 当前只支持单一外环，不会丢弃洞或多环。');
      coordinates = parts;
    } else coordinates = parts;
    output.push({ featureID: feature.featureID, name: feature.name, type: feature.type, ...(feature.properties ? { properties: feature.properties } : {}), geometry: { type: feature.type, coordinates } });
  }
  if (!output.length || output.length > MAX_FEATURES) throw new Error('交换文件没有空间对象或对象数量超出限制。');
  return { schema: 'shantu-coordinate-exchange', version: 1, crs, axisOrder: ['x', 'y'], features: output };
}

function validateExchange(value: unknown): CoordinateExchange {
  if (!value || typeof value !== 'object') throw new Error('工程坐标交换文件格式无效。');
  const record = value as Record<string, unknown>;
  if (!record.crs) throw new Error('工程坐标交换文件缺少显式 CRS 元数据。');
  if (record.schema !== 'shantu-coordinate-exchange' || record.version !== 1 || !Array.isArray(record.features) || record.features.length < 1 || record.features.length > MAX_FEATURES)
    throw new Error('工程坐标交换格式或版本不受支持。');
  const crs = resolveCrs(record.crs as ProjectCrs);
  let vertices = 0;
  const features: ExchangeFeature[] = record.features.map((raw) => {
    if (!raw || typeof raw !== 'object') throw new Error('交换要素格式无效。');
    const feature = raw as ExchangeFeature;
    if (typeof feature.featureID !== 'string' || !feature.featureID || feature.featureID.length > 120 || typeof feature.name !== 'string' || feature.name.length > 120 ||
        !['Point', 'LineString', 'MultiLineString', 'Polygon'].includes(feature.type) || !feature.geometry || feature.geometry.type !== feature.type)
      throw new Error('交换要素属性或几何类型无效。');
    const countPoint = (node: unknown): void => {
      if (!Array.isArray(node)) throw new Error('交换坐标数组无效。');
      if ((node.length === 2 || node.length === 3) && node.every(Number.isFinite)) {
        toWgs84(node as unknown as ProjectPoint, crs);
        vertices++;
        return;
      }
      for (const child of node) countPoint(child);
    };
    countPoint(feature.geometry.coordinates);
    return { ...feature, properties: safeProps(feature.properties), geometry: { ...feature.geometry } };
  });
  if (vertices > MAX_VERTICES) throw new Error(`交换文件顶点数超过 ${MAX_VERTICES}。`);
  return { schema: 'shantu-coordinate-exchange', version: 1, crs, axisOrder: ['x', 'y'], features };
}

function parseJson(text: string): CoordinateExchange {
  try { return validateExchange(JSON.parse(text)); }
  catch (error) { if (error instanceof Error) throw error; throw new Error('工程 JSON 解析失败。'); }
}

function buildTransfer(exchange: CoordinateExchange): Transfer {
  const builder = new RouteBuilder('工程坐标交换');
  let totalVertices = 0;
  for (const feature of exchange.features) {
    const props = safeProps(feature.properties) ?? {};
    const raw = feature.geometry.coordinates as unknown;
    const mapPoint = (point: unknown): ImportPoint => {
      if (!Array.isArray(point) || point.length < 2 || !point.slice(0, 3).every(Number.isFinite)) throw new Error('交换文件坐标值无效。');
      totalVertices++;
      const wgs = toWgs84(point.slice(0, 3) as unknown as ProjectPoint, exchange.crs);
      return { coordinates: [wgs[0], wgs[1]], altitude: wgs[2] ?? null, time: null };
    };
    if (feature.type === 'Point') {
      const point = mapPoint(raw);
      builder.pin(feature.name, point, typeof props.note === 'string' ? props.note.slice(0, 500) : '');
    } else if (feature.type === 'LineString') {
      if (!Array.isArray(raw)) throw new Error('LineString 坐标格式无效。');
      builder.track(feature.name, [raw.map(mapPoint)]);
    } else if (feature.type === 'MultiLineString') {
      if (!Array.isArray(raw)) throw new Error('MultiLineString 坐标格式无效。');
      builder.track(feature.name, raw.map((part) => {
        if (!Array.isArray(part)) throw new Error('轨迹分段格式无效。');
        return part.map(mapPoint);
      }));
    } else {
      if (!Array.isArray(raw) || raw.length !== 1 || !Array.isArray(raw[0])) throw new Error('Polygon 当前只支持一个外环；多环对象不会被静默裁掉。');
      builder.area(feature.name, raw[0].map(mapPoint), typeof props.note === 'string' ? props.note.slice(0, 500) : '');
    }
  }
  if (totalVertices > MAX_VERTICES) throw new Error(`交换文件顶点数超过 ${MAX_VERTICES}。`);
  return builder.finish();
}

export function importCoordinateExchange(text: string): CoordinateImport {
  if (typeof text !== 'string' || text.length > 20_000_000) throw new Error('工程交换文件为空或超过20MB限制。');
  const trimmed = text.trim();
  const parsed = trimmed.startsWith(CSV_TITLE) ? parseExchangeCsv(trimmed) : parseJson(trimmed);
  const exchange = validateExchange(parsed);
  return { data: buildTransfer(exchange), crs: exchange.crs, featureCount: exchange.features.length };
}
