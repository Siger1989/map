import { unzipSync } from 'fflate';
import { decodeRouteText, identifyRouteFile } from './fileFormat.ts';
import { parseGeoJson } from './geoJsonImport.ts';
import { parseCsv } from './csvImport.ts';
import { parseOviJson } from './oviJsonImport.ts';
import type { Transfer } from './types.ts';
import { validateTransfer } from './validation.ts';
import { parseXml } from './xmlImport.ts';
import {
  importCoordinate,
  type ImportCoordinates,
} from './coordinateSystem.ts';
const MAX_BYTES = 8 * 1024 * 1024;
export async function parseFile(
  file: File,
  system: ImportCoordinates = 'auto',
): Promise<Transfer> {
  if (file.size > MAX_BYTES) throw new Error('文件超过 8 MB，请先拆分');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = identifyRouteFile(bytes, file.name);
  if (kind === 'ovobj') return (await import('./ovobjImport.ts')).parseOvobj(bytes,file.name,system);
  if (kind === 'fit') return (await import('./fitImport.ts')).parseFit(bytes, file.name);
  if (/\.(csv|tsv)$/i.test(file.name)) return parseCsv(decodeRouteText(bytes, true),file.name);
  let text: string;
  let ovi = /\.ovk(?:ml|mz)$/i.test(file.name);
  if (kind === 'zip') {
    let size = 0,
      count = 0;
    const files = unzipSync(bytes, {
      filter: (f) => {
        if (!/\.(kml|ovkml)$/i.test(f.name)) return false;
        size += f.originalSize;
        count++;
        if (size > MAX_BYTES || count > 10)
          throw new Error('KMZ 内的 KML 超过大小限制');
        return true;
      },
    });
    const names = Object.keys(files);
    if (names.length !== 1) throw new Error('请选择只含一个 KML 文档的 KMZ');
    if (files[names[0]].length > MAX_BYTES)
      throw new Error('解压后的 KML 过大');
    ovi ||= /\.ovkml$/i.test(names[0]);
    text = decodeRouteText(files[names[0]]);
  } else text = decodeRouteText(bytes);
  // Content takes precedence over a renamed extension. Coordinate conversion is separate.
  if (/^\s*[\[{]/.test(text)) {
    let value: unknown;
    try { value = JSON.parse(text); }
    catch { throw new Error('JSON 文件内容不完整或语法错误'); }
    if (value && typeof value === 'object' && 'type' in value) return parseGeoJson(value, file.name);
    if (value && typeof value === 'object' && 'ObjItems' in value) return parseOviJson(value,file.name,system);
    return validateTransfer(value);
  }
  ovi ||= /<(?:[\w.-]+:)?OvCoordType\b/i.test(text);
  // Never infer coordinate systems from numerical ranges or free-form descriptions.
  if (ovi && system === 'auto') importCoordinate([0, 0], system);
  return parseXml(
    text,
    file.name,
    ovi ? (p) => importCoordinate(p, system) : undefined,
  );
}
