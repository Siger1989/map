import proj4 from 'proj4';

export type ProjectPoint = readonly [number, number] | readonly [number, number, number];
export type DatumParameters =
  | readonly [number, number, number]
  | readonly [number, number, number, number, number, number, number];

export type ProjectCrs = {
  id: string;
  name: string;
  definition?: string;
  /** PROJ towgs84 values: translations in metres, rotations in arc-seconds, scale in ppm. */
  datumParameters?: DatumParameters;
};

const WGS84_DEFINITION = '+proj=longlat +datum=WGS84 +no_defs +type=crs';
const CGCS2000_DEFINITION = '+proj=longlat +ellps=GRS80 +towgs84=0,0,0 +no_defs +type=crs';
const BEIJING54_DEFINITION = '+proj=longlat +ellps=krass +no_defs +type=crs';
const XIAN80_DEFINITION = '+proj=longlat +a=6378140 +rf=298.257 +no_defs +type=crs';

export const WGS84_CRS: ProjectCrs = {
  id: 'EPSG:4326',
  name: 'WGS 84',
  definition: WGS84_DEFINITION,
};
export const CGCS2000_CRS: ProjectCrs = {
  id: 'EPSG:4490',
  name: 'CGCS2000',
  definition: CGCS2000_DEFINITION,
};
export const BEIJING54_CRS: ProjectCrs = {
  id: 'EPSG:4214',
  name: '北京54（地理坐标）',
  definition: BEIJING54_DEFINITION,
};
export const XIAN80_CRS: ProjectCrs = {
  id: 'EPSG:4610',
  name: '西安80（地理坐标）',
  definition: XIAN80_DEFINITION,
};
export const WEB_MERCATOR_CRS: ProjectCrs = {
  id: 'EPSG:3857',
  name: 'Web Mercator',
  definition: '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +no_defs +type=crs',
};

const STORAGE_KEY = 'shantu.project-crs.v1';
const MAX_DEFINITION_LENGTH = 8192;
const MAX_PROJECT_MAGNITUDE = 50_000_000;
const DATUM_PARAMETER_LIMITS = [1_000_000, 1_000_000, 1_000_000, 3_600, 3_600, 3_600, 10_000] as const;
const KNOWN: Record<string, ProjectCrs> = {
  'EPSG:4326': WGS84_CRS,
  'EPSG:4490': CGCS2000_CRS,
  'EPSG:4214': BEIJING54_CRS,
  'EPSG:4610': XIAN80_CRS,
  'EPSG:3857': WEB_MERCATOR_CRS,
};

function knownCrs(id: string): ProjectCrs | undefined {
  const fixed = KNOWN[id];
  if (fixed) return fixed;
  const code = /^EPSG:(\d+)$/.exec(id)?.[1];
  if (!code) return undefined;
  const epsg = Number(code);
  if (epsg >= 32601 && epsg <= 32660) return utmDefinition(epsg - 32600, 'N');
  if (epsg >= 32701 && epsg <= 32760) return utmDefinition(epsg - 32700, 'S');
  if (epsg >= 4491 && epsg <= 4501) return gaussDefinition('GAUSS6', epsg - 4478, (epsg - 4478) * 6 - 3, (epsg - 4478) * 1_000_000 + 500_000, id);
  if (epsg >= 4502 && epsg <= 4512) {
    const meridian = 75 + (epsg - 4502) * 6;
    return gaussDefinition('GAUSS6', meridian / 6 + 0.5, meridian, 500_000, id);
  }
  if (epsg >= 4513 && epsg <= 4533) return gaussDefinition('GAUSS3', epsg - 4488, (epsg - 4488) * 3, (epsg - 4488) * 1_000_000 + 500_000, id);
  if (epsg >= 4534 && epsg <= 4554) {
    const meridian = 75 + (epsg - 4534) * 3;
    return gaussDefinition('GAUSS3', meridian / 3, meridian, 500_000, id);
  }
  return undefined;
}

function cloneCrs(crs: ProjectCrs): ProjectCrs {
  return {
    ...crs,
    ...(crs.datumParameters ? { datumParameters: [...crs.datumParameters] as unknown as DatumParameters } : {}),
  };
}

function normalizeId(value: string): string {
  const input = value.trim();
  const compact = input.toUpperCase().replace(/\s+/g, '');
  const aliases: Record<string, string> = {
    '4326': 'EPSG:4326',
    WGS84: 'EPSG:4326',
    'WGS 84': 'EPSG:4326',
    'CRS:84': 'EPSG:4326',
    '4490': 'EPSG:4490',
    CGCS2000: 'EPSG:4490',
    '4214': 'EPSG:4214',
    BJ54: 'EPSG:4214',
    BEIJING54: 'EPSG:4214',
    '4610': 'EPSG:4610',
    XIAN80: 'EPSG:4610',
    '3857': 'EPSG:3857',
    WEBMERCATOR: 'EPSG:3857',
    'WEBMERCATOR3857': 'EPSG:3857',
  };
  return aliases[compact] ?? (/^EPSG:\d+$/.test(compact) ? compact : input);
}

function isDatumParameters(value: unknown): value is DatumParameters {
  if (!Array.isArray(value) || (value.length !== 3 && value.length !== 7)) return false;
  return value.every((item, index) =>
    typeof item === 'number' && Number.isFinite(item) && Math.abs(item) <= DATUM_PARAMETER_LIMITS[index],
  );
}

function validateDefinition(definition: string): void {
  if (!definition.trim() || definition.length > MAX_DEFINITION_LENGTH || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(definition))
    throw new Error('坐标系定义为空、过长或包含非法字符。');
  try {
    // Test the CRS at its false origin when projected. A Gauss-Kruger definition
    // with a million-prefixed easting legitimately maps [0, 0] to infinity.
    const converter = proj4(definition);
    const origin = converter.oProj as { x0?: number; y0?: number };
    const converted = converter.inverse([origin.x0 ?? 0, origin.y0 ?? 0]) as number[];
    if (!Number.isFinite(converted[0]) || !Number.isFinite(converted[1]))
      throw new Error('non-finite');
  } catch {
    throw new Error('坐标系定义无效或不受支持。');
  }
}

function hasExplicitWgs84Datum(definition: string): boolean {
  return /\+datum\s*=\s*wgs84\b/i.test(definition) || /\+ellps\s*=\s*wgs84\b/i.test(definition);
}

function hasExplicitTowgs84(definition: string): boolean {
  return /\+towgs84\s*=|TOWGS84\s*\[/i.test(definition);
}

function validateCrsObject(value: ProjectCrs): ProjectCrs {
  if (!value || typeof value !== 'object' || typeof value.id !== 'string' || !value.id.trim() ||
      typeof value.name !== 'string' || !value.name.trim())
    throw new Error('坐标系标识或名称无效。');
  if (value.definition !== undefined && typeof value.definition !== 'string')
    throw new Error('坐标系定义无效。');
  if (value.datumParameters !== undefined && !isDatumParameters(value.datumParameters))
    throw new Error('datum 参数必须为 3 或 7 个有限且在允许范围内的数字。');

  const id = normalizeId(value.id);
  const known = knownCrs(id);
  if (known)
    return { ...cloneCrs(known), ...(value.datumParameters ? { datumParameters: value.datumParameters } : {}) };

  const definition = value.definition?.trim();
  if (!definition) throw new Error('自定义坐标系必须提供 PROJ 或 WKT 定义。');
  validateDefinition(definition);
  if (value.datumParameters?.length && !definition.startsWith('+') && !hasExplicitTowgs84(definition))
    throw new Error('自定义 WKT 请在定义中提供 TOWGS84 参数，避免忽略 datum 转换。');
  return {
    id,
    name: value.name.trim().slice(0, 120),
    definition,
    ...(value.datumParameters ? { datumParameters: [...value.datumParameters] as DatumParameters } : {}),
  };
}

/** Resolve only an explicit CRS identifier or definition; coordinates are never inspected. */
export function resolveCrs(value: string | ProjectCrs): ProjectCrs {
  if (typeof value === 'string') {
    const id = normalizeId(value);
    const known = knownCrs(id);
    if (known) return cloneCrs(known);
    if (/^(\+proj=|GEOGCS\[|PROJCS\[|GEODCRS\[|PROJCRS\[|GEOGCRS\[)/i.test(value.trim())) {
      validateDefinition(value.trim());
      return { id: 'CUSTOM', name: '自定义坐标系', definition: value.trim() };
    }
    throw new Error('不支持该坐标系标识，请提供受支持的 EPSG 标识或 PROJ/WKT 定义。');
  }
  const resolved = validateCrsObject(value);
  if (KNOWN[resolved.id] && !resolved.datumParameters) return cloneCrs(KNOWN[resolved.id]);
  return resolved;
}

/** Detects a CRS only from explicit metadata fields or a definition string. */
export function detectCrs(value: unknown): ProjectCrs | null {
  try {
    if (typeof value === 'string') return resolveCrs(value);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const metadata = value as Record<string, unknown>;
    if (typeof metadata.id === 'string' && typeof metadata.name === 'string')
      return resolveCrs(metadata as unknown as ProjectCrs);
    for (const key of ['crs', 'coordinateReferenceSystem', 'srsName', 'definition']) {
      const explicit = metadata[key];
      if (typeof explicit === 'string') return resolveCrs(explicit);
      if (explicit && typeof explicit === 'object') {
        const detected = detectCrs(explicit);
        if (detected) return detected;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function validateProjectPoint(point: ProjectPoint): [number, number] | [number, number, number] {
  if (!Array.isArray(point) || point.length < 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1]) ||
      Math.abs(point[0]) > MAX_PROJECT_MAGNITUDE || Math.abs(point[1]) > MAX_PROJECT_MAGNITUDE ||
      (point.length > 2 && (!Number.isFinite(point[2]) || Math.abs(point[2]) > MAX_PROJECT_MAGNITUDE)))
    throw new Error('坐标必须是两个或三个有限且在有效范围内的数字。');
  return point.length > 2 ? [point[0], point[1], point[2]] : [point[0], point[1]];
}

function effectiveDefinition(crs: ProjectCrs): string {
  const definition = crs.definition;
  if (!definition) throw new Error('坐标系定义缺失。');
  if (crs.datumParameters) {
    if (!isDatumParameters(crs.datumParameters)) throw new Error('datum 参数超出允许范围。');
    const values = crs.datumParameters.join(',');
    if (definition.startsWith('+'))
      return `${definition.replace(/\s+\+towgs84=[^\s]+/ig, '')} +towgs84=${values}`;
    const towgs = `TOWGS84[${values}]`;
    if (!hasExplicitTowgs84(definition))
      throw new Error('自定义 WKT 缺少明确的 TOWGS84 定义。');
    return definition.replace(/TOWGS84\s*\[[^\]]*\]/i, towgs);
  }
  return definition;
}

function ensureDatumTransformAvailable(crs: ProjectCrs): void {
  const definition = effectiveDefinition(crs);
  const id = normalizeId(crs.id);
  const needsUserTransform = id === 'EPSG:4214' || id === 'EPSG:4610';
  if (needsUserTransform && !crs.datumParameters)
    throw new Error(`${crs.name}跨基准转换需要经核实的 3/7 参数，当前未配置。`);
  if (!needsUserTransform && !knownCrs(id) &&
      !hasExplicitWgs84Datum(definition) && !hasExplicitTowgs84(definition))
    throw new Error('自定义坐标系缺少明确的 WGS84 datum 或 TOWGS84 参数，拒绝猜测转换。');
}

function checkedWgs84(point: number[]): [number, number] | [number, number, number] {
  const [longitude, latitude] = point;
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude) ||
      Math.abs(longitude) > 180 || Math.abs(latitude) > 90)
    throw new Error('坐标转换结果超出有效经纬度范围。');
  return point.length > 2 ? [longitude, latitude, point[2]] : [longitude, latitude];
}

export function toWgs84(point: ProjectPoint, crs: string | ProjectCrs): [number, number] | [number, number, number] {
  const source = resolveCrs(crs);
  const input = validateProjectPoint(point);
  if (source.id === WGS84_CRS.id) return checkedWgs84(input);
  ensureDatumTransformAvailable(source);
  try {
    const transformed = proj4(effectiveDefinition(source), WGS84_DEFINITION, input) as number[];
    const horizontal = checkedWgs84(transformed).slice(0, 2);
    return [...horizontal, ...(input.length > 2 ? [input[2]] : [])] as [number, number] | [number, number, number];
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('自定义坐标系缺少')) throw error;
    throw new Error('无法将该坐标转换为 WGS 84。');
  }
}

export function fromWgs84(point: ProjectPoint, crs: string | ProjectCrs): [number, number] | [number, number, number] {
  const target = resolveCrs(crs);
  const input = checkedWgs84(validateProjectPoint(point));
  if (target.id === WGS84_CRS.id) return input;
  ensureDatumTransformAvailable(target);
  try {
    const result = proj4(WGS84_DEFINITION, effectiveDefinition(target), input) as number[];
    if (!Number.isFinite(result[0]) || !Number.isFinite(result[1]) ||
        Math.abs(result[0]) > MAX_PROJECT_MAGNITUDE || Math.abs(result[1]) > MAX_PROJECT_MAGNITUDE)
      throw new Error('range');
    return [...result.slice(0, 2), ...(input.length > 2 ? [input[2]] : [])] as [number, number] | [number, number, number];
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('自定义坐标系缺少')) throw error;
    throw new Error('无法将 WGS 84 坐标转换到该坐标系。');
  }
}

function validCentralMeridian(value: number): number {
  if (!Number.isInteger(value) || value < 75 || value > 135 || value % 3 !== 0)
    throw new Error('3 度带中央经线必须是 75° 至 135° 之间的 3 的整数倍。');
  return value;
}

function gaussDefinition(name: string, zone: number, centralMeridian: number, falseEasting: number, id: string): ProjectCrs {
  const definition = `+proj=tmerc +lat_0=0 +lon_0=${centralMeridian} +k=1 +x_0=${falseEasting} +y_0=0 +ellps=GRS80 +towgs84=0,0,0 +units=m +no_defs +type=crs`;
  return {
    id,
    name: `CGCS2000 ${name === 'GAUSS3' ? '3 度' : '6 度'}带 ${zone} 带（中央经线 ${centralMeridian}°）`,
    definition,
  };
}

function gaussCrs(name: string, zone: number, centralMeridian: number, withZonePrefix: boolean): ProjectCrs {
  const falseEasting = withZonePrefix ? zone * 1_000_000 + 500_000 : 500_000;
  const id = `CGCS2000:${name}:${withZonePrefix ? 'ZONE' : 'CM'}:${withZonePrefix ? zone : centralMeridian}`;
  return gaussDefinition(name, zone, centralMeridian, falseEasting, id);
}

export function createCgcs2000Gauss3ByCentralMeridian(centralMeridian: number): ProjectCrs {
  const meridian = validCentralMeridian(centralMeridian);
  return gaussCrs('GAUSS3', meridian / 3, meridian, false);
}

export function createCgcs2000Gauss3ByZone(zone: number): ProjectCrs {
  if (!Number.isInteger(zone) || zone < 25 || zone > 45)
    throw new Error('CGCS2000 3 度带号必须是 25 至 45 的整数。');
  return gaussCrs('GAUSS3', zone, zone * 3, true);
}

export function createCgcs2000Gauss6ByZone(zone: number): ProjectCrs {
  if (!Number.isInteger(zone) || zone < 13 || zone > 23)
    throw new Error('CGCS2000 6 度带号必须是 13 至 23 的整数。');
  return gaussCrs('GAUSS6', zone, zone * 6 - 3, true);
}

export function createUtmCrs(zone: number, hemisphere: 'N' | 'S'): ProjectCrs {
  if (!Number.isInteger(zone) || zone < 1 || zone > 60 || !['N', 'S'].includes(hemisphere))
    throw new Error('UTM 分带必须是 1 至 60 的整数，半球为 N 或 S。');
  return utmDefinition(zone, hemisphere);
}

function utmDefinition(zone: number, hemisphere: 'N' | 'S'): ProjectCrs {
  const epsg = hemisphere === 'N' ? 32600 + zone : 32700 + zone;
  return {
    id: `EPSG:${epsg}`,
    name: `WGS 84 / UTM zone ${zone}${hemisphere}`,
    definition: `+proj=utm +zone=${zone} ${hemisphere === 'S' ? '+south ' : ''}+datum=WGS84 +units=m +no_defs +type=crs`,
  };
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function browserStorage(): StorageLike | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function readActiveProjectCrs(storage: StorageLike | undefined = browserStorage()): ProjectCrs {
  if (!storage) return cloneCrs(WGS84_CRS);
  try {
    const text = storage.getItem(STORAGE_KEY);
    if (!text) return cloneCrs(WGS84_CRS);
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return cloneCrs(WGS84_CRS);
    return resolveCrs(parsed as ProjectCrs);
  } catch {
    return cloneCrs(WGS84_CRS);
  }
}

export function writeActiveProjectCrs(crs: string | ProjectCrs, storage: StorageLike | undefined = browserStorage()): void {
  if (!storage) throw new Error('当前环境无法保存工程坐标系设置。');
  const resolved = resolveCrs(crs);
  storage.setItem(STORAGE_KEY, JSON.stringify(resolved));
}

export type ProjectCoordinateEntry = { id?: string; name?: string; coordinates: ProjectPoint };

function escapeCsv(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function exportCoordinateCsv(entries: readonly ProjectCoordinateEntry[], crs: string | ProjectCrs): string {
  const target = resolveCrs(crs);
  const rows = entries.map(({ id = '', name = '', coordinates }) => {
    const [x, y] = fromWgs84(coordinates, target);
    const alt = coordinates.length > 2 ? `,${coordinates[2]}` : '';
    return `${escapeCsv(id)},${escapeCsv(name)},${x},${y}${alt}`;
  });
  return `# CRS=${escapeCsv(target.id)}; name=${escapeCsv(target.name)}\r\nid,name,x,y[,alt]\r\n${rows.join('\r\n')}`;
}

export function exportProjectCoordinatesJson(entries: readonly ProjectCoordinateEntry[], crs: string | ProjectCrs): string {
  const target = resolveCrs(crs);
  return JSON.stringify({
    schema: 'shantu.project-coordinates',
    version: 1,
    crs: target,
    axisOrder: ['x', 'y'],
    coordinates: entries.map(({ id, name, coordinates }) => ({
      ...(id === undefined ? {} : { id }),
      ...(name === undefined ? {} : { name }),
      coordinates: fromWgs84(coordinates, target),
    })),
  }, null, 2);
}

export function toWgs84GeoJson(entries: readonly ProjectCoordinateEntry[]): string {
  return JSON.stringify({
    type: 'FeatureCollection',
    coordinateReferenceSystem: { id: WGS84_CRS.id, name: WGS84_CRS.name },
    features: entries.map(({ name = '', coordinates }) => ({
      type: 'Feature',
      properties: { name },
      geometry: { type: 'Point', coordinates: checkedWgs84(validateProjectPoint(coordinates)) },
    })),
  }, null, 2);
}
