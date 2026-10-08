import { Dwg_File_Type, LibreDwg, type DwgEntity, type DwgInsertEntity } from '@mlightcad/libredwg-web';
import { appendBulgeSegment, IDENTITY, insertMatrix, lineFeature, mapPoints, multiply, polygonFeature, sampleArc, transformPoint, type Matrix4, type Vec3 } from './geometry.ts';
import { CAD_LIMITS, type CadDecoded, type CadFeature } from './types.ts';

type Pair = { code: number; value: string };
type RecordData = { type: string; pairs: Pair[]; vertices?: RecordData[] };
type DxfDoc = { entities: RecordData[]; blocks: Map<string, { base: Vec3; entities: RecordData[] }>; layers: { name: string; color?: string }[]; units?: number; crsHint?: string; crsWarning?: string };

function pairValue(record: RecordData, code: number, fallback = 0): number {
  const raw = record.pairs.find((item) => item.code === code)?.value;
  const parsed = raw == null ? fallback : Number(raw.trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

function allValues(record: RecordData, code: number): string[] { return record.pairs.filter((item) => item.code === code).map((item) => item.value); }
function stringValue(record: RecordData, code: number, fallback = ''): string { return allValues(record, code)[0] ?? fallback; }
function vec(record: RecordData, x: number, y: number, z: number): Vec3 { return [pairValue(record, x), pairValue(record, y), pairValue(record, z)]; }
function layerOf(record: RecordData): string { return stringValue(record, 8, '0'); }
function handleOf(record: RecordData, fallback: string): string { return stringValue(record, 5, fallback); }

function aciColor(index: number): string | undefined {
  const basic: Record<number, string> = { 1: '#ff0000', 2: '#ffff00', 3: '#00ff00', 4: '#00ffff', 5: '#0000ff', 6: '#ff00ff', 7: '#ffffff', 8: '#808080', 9: '#c0c0c0' };
  return basic[index];
}

function trueColor(record: RecordData): string | undefined {
  const raw = record.pairs.find((item) => item.code === 420)?.value;
  if (raw != null) return `#${Math.max(0, Number(raw)).toString(16).padStart(6, '0').slice(-6)}`;
  return aciColor(Math.abs(pairValue(record, 62, 256)));
}

function parseDxf(buffer: ArrayBuffer): DxfDoc {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0 || bytes[1] === 0) throw new Error('二进制 DXF 暂不支持；请另存为 ASCII DXF。');
  const prefix = new TextDecoder('windows-1252').decode(bytes.slice(0, Math.min(bytes.length, 64 * 1024)));
  const codePage = prefix.match(/\$DWGCODEPAGE\s*\r?\n\s*3\s*\r?\n\s*([A-Z0-9_-]+)/i)?.[1]?.toUpperCase();
  const encoding = ({ ANSI_932: 'shift_jis', ANSI_936: 'gbk', ANSI_949: 'euc-kr', ANSI_950: 'big5', ANSI_1250: 'windows-1250', ANSI_1251: 'windows-1251', ANSI_1252: 'windows-1252', ANSI_1253: 'windows-1253', ANSI_1254: 'windows-1254', ANSI_1255: 'windows-1255', ANSI_1256: 'windows-1256', ANSI_1257: 'windows-1257', ANSI_1258: 'windows-1258', UTF8: 'utf-8' })[codePage ?? ''] ?? 'utf-8';
  const text = new TextDecoder(encoding).decode(bytes).replace(/^\uFEFF/, '');
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines.length < 4) throw new Error('DXF 内容为空或格式无效。');
  const pairs: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i].trim());
    if (Number.isInteger(code)) pairs.push({ code, value: lines[i + 1] ?? '' });
  }
  const doc: DxfDoc = { entities: [], blocks: new Map(), layers: [] };
  let section = '', activeBlock: { name: string; base: Vec3; entities: RecordData[] } | undefined;
  let currentPolyline: RecordData | undefined;
  let record: RecordData | undefined;
  const finish = () => {
    if (!record) return;
    if (record.type === 'VERTEX' && currentPolyline) currentPolyline.vertices!.push(record);
    else if (record.type === 'SEQEND') currentPolyline = undefined;
    else if (record.type === 'POLYLINE') {
      record.vertices = [];
      currentPolyline = record;
      if (section === 'BLOCKS' && activeBlock) activeBlock.entities.push(record);
      else if (section === 'ENTITIES') doc.entities.push(record);
    } else if (record.type === 'ENDBLK') {
      if (activeBlock) doc.blocks.set(activeBlock.name.toUpperCase(), { base: activeBlock.base, entities: activeBlock.entities });
      activeBlock = undefined;
    } else if (record.type === 'BLOCK') {
      activeBlock = { name: stringValue(record, 2, stringValue(record, 3)), base: vec(record, 10, 20, 30), entities: [] };
    } else if (record.type === 'LAYER') {
      const name = stringValue(record, 2, '0');
      if (!doc.layers.some((layer) => layer.name === name)) doc.layers.push({ name, color: trueColor(record) });
    } else if (!['SECTION', 'ENDSEC', 'EOF', 'TABLE', 'ENDTAB', 'SEQEND', 'VERTEX', 'BLOCK'].includes(record.type)) {
      if (section === 'BLOCKS' && activeBlock) activeBlock.entities.push(record);
      else if (section === 'ENTITIES') doc.entities.push(record);
    }
    record = undefined;
  };
  for (const pair of pairs) {
    if (pair.code === 0) {
      finish();
      record = { type: pair.value.trim().toUpperCase(), pairs: [] };
      if (record.type === 'SECTION') section = '';
      else if (record.type === 'ENDSEC') section = '';
      continue;
    }
    if (!record) continue;
    record.pairs.push(pair);
    if (record.type === 'SECTION' && pair.code === 2) section = pair.value.trim().toUpperCase();
  }
  finish();
  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i];
    if (pair.code === 9 && pair.value.trim().toUpperCase() === '$INSUNITS' && pairs[i + 1]?.code === 70) doc.units = Number(pairs[i + 1].value.trim());
    if (pair.code === 9 && pair.value.trim().toUpperCase().includes('CRS')) {
      const value = pairs[i + 1]?.value ?? '';
      doc.crsHint = explicitCrs(value) ?? doc.crsHint;
      if (isWkt(value) && value.trim().length > 8192) doc.crsWarning = 'CAD 文件中的 WKT 坐标系定义超过 8192 字符，已忽略；请在导入时手动选择坐标系。';
    }
  }
  const metadataValues = pairs.map((item) => item.value);
  const wktMetadata = metadataValues.find(isWkt);
  const explicitMetadata = wktMetadata ?? metadataValues.find((value) => /EPSG\s*[:=]\s*\d{4,6}/i.test(value));
  if (!doc.crsHint && explicitMetadata) {
    doc.crsHint = explicitCrs(explicitMetadata);
    if (!doc.crsHint && isWkt(explicitMetadata) && explicitMetadata.trim().length > 8192) doc.crsWarning = 'CAD 文件中的 WKT 坐标系定义超过 8192 字符，已忽略；请在导入时手动选择坐标系。';
  }
  return doc;
}

function isWkt(raw: string): boolean { return /(?:PROJCS|GEOGCS|PROJCRS|GEOGCRS)\s*\[/i.test(raw); }
function explicitCrs(raw: string): string | undefined {
  if (isWkt(raw)) return raw.trim().length <= 8192 ? raw.trim() : undefined;
  const epsg = raw.match(/EPSG\s*[:=]\s*(\d{4,6})/i)?.[1];
  if (epsg) return `EPSG:${epsg}`;
  return undefined;
}

function dxfPoint(record: RecordData, x: number, y: number, z: number, matrix: Matrix4): Vec3 { return transformPoint(matrix, vec(record, x, y, z)); }
function unsupportedOcs(record: RecordData): boolean {
  const extrusion = [pairValue(record, 210, 0), pairValue(record, 220, 0), pairValue(record, 230, 1)];
  return Math.abs(extrusion[0]) > 1e-9 || Math.abs(extrusion[1]) > 1e-9 || Math.abs(extrusion[2] - 1) > 1e-9;
}

function dxfVertices(record: RecordData): { points: Vec3[]; bulges: number[] } {
  const vertices: { p: Vec3; bulge: number }[] = [];
  let current: { x?: number; y?: number; bulge: number } | undefined;
  for (const pair of record.pairs) {
    if (pair.code === 10) { if (current?.x != null && current.y != null) vertices.push({ p: [current.x, current.y, pairValue(record, 38)], bulge: current.bulge }); current = { x: Number(pair.value), bulge: 0 }; }
    else if (pair.code === 20 && current) current.y = Number(pair.value);
    else if (pair.code === 42 && current) current.bulge = Number(pair.value) || 0;
  }
  if (current?.x != null && current.y != null) vertices.push({ p: [current.x, current.y, pairValue(record, 38)], bulge: current.bulge });
  if (record.type === 'POLYLINE') {
    for (const vertex of record.vertices ?? []) vertices.push({ p: vec(vertex, 10, 20, 30), bulge: pairValue(vertex, 42) });
  }
  return { points: vertices.map((v) => v.p), bulges: vertices.map((v) => v.bulge) };
}

function dxfFeature(record: RecordData, id: string, matrix: Matrix4, warnings: string[]): CadFeature | undefined {
  const type = record.type, layer = layerOf(record), color = trueColor(record);
  if (unsupportedOcs(record) && ['POINT', 'CIRCLE', 'ARC', 'LWPOLYLINE', 'POLYLINE', 'TEXT', 'MTEXT', 'ATTRIB', 'INSERT'].includes(type)) {
    warnings.push(`${type} ${handleOf(record, id)} 使用非默认 OCS，已跳过以避免坐标偏移。`); return undefined;
  }
  let feature: CadFeature | undefined;
  if (type === 'LINE') feature = lineFeature(id, layer, [dxfPoint(record, 10, 20, 30, matrix), dxfPoint(record, 11, 21, 31, matrix)], type);
  else if (type === 'POINT') feature = { id, layer, entityType: type, geometry: { type: 'Point', coordinates: dxfPoint(record, 10, 20, 30, matrix) } };
  else if (type === 'LWPOLYLINE' || type === 'POLYLINE') {
    const { points: localPoints, bulges } = dxfVertices(record), closed = (pairValue(record, 70) & 1) !== 0;
    const points = localPoints;
    if (points.length > 1) {
      const expanded: Vec3[] = [points[0]];
      const segmentCount = closed ? points.length : points.length - 1;
      for (let i = 0; i < segmentCount; i++) appendBulgeSegment(expanded, points[i], points[(i + 1) % points.length], bulges[i] ?? 0);
      const transformed = mapPoints(expanded, matrix);
      feature = closed ? polygonFeature(id, layer, transformed, type) : lineFeature(id, layer, transformed, type);
      if (bulges.some((v) => Math.abs(v) > 1e-10)) warnings.push(`${type} ${handleOf(record, id)} 的 bulge 曲线已离散近似。`);
    }
  } else if (type === 'CIRCLE' || type === 'ARC') {
    const center = vec(record, 10, 20, 30), radius = pairValue(record, 40);
    const points = mapPoints(sampleArc(center, radius, type === 'ARC' ? pairValue(record, 50) * Math.PI / 180 : 0, type === 'ARC' ? pairValue(record, 51) * Math.PI / 180 : 0, type === 'CIRCLE'), matrix);
    feature = type === 'CIRCLE' ? polygonFeature(id, layer, points, type) : lineFeature(id, layer, points, type);
    warnings.push(`${type} ${handleOf(record, id)} 已离散近似。`);
  } else if (type === 'TEXT' || type === 'MTEXT') {
    const p = dxfPoint(record, 10, 20, 30, matrix); let text = type === 'TEXT' ? stringValue(record, 1) : allValues(record, 3).join('') + stringValue(record, 1);
    text = text.replace(/\\P/g, '\n').replace(/\\[A-Za-z][^;]*;/g, '').trim();
    if (text) feature = { id, layer, entityType: type, text, geometry: { type: 'Point', coordinates: p } };
  } else if (type === 'ATTRIB') {
    const p = dxfPoint(record, 10, 20, 30, matrix), text = stringValue(record, 1).trim();
    if (text) feature = { id, layer, entityType: type, text, geometry: { type: 'Point', coordinates: p } };
  }
  if (feature && color) feature.color = color;
  return feature;
}

function unitInfo(code?: number): { units?: string; scale?: number } {
  const units: Record<number, [string, number]> = { 1: ['inches', 0.0254], 2: ['feet', 0.3048], 3: ['miles', 1609.344], 4: ['millimeters', 0.001], 5: ['centimeters', 0.01], 6: ['meters', 1], 7: ['kilometers', 1000], 8: ['microinches', 2.54e-8], 9: ['mils', 2.54e-5], 10: ['yards', 0.9144], 11: ['angstroms', 1e-10], 12: ['nanometers', 1e-9], 13: ['microns', 1e-6], 14: ['decimeters', 0.1], 15: ['decameters', 10], 16: ['hectometers', 100], 17: ['gigameters', 1e9], 18: ['astronomical units', 149597870700], 19: ['light years', 9.460730472e15], 20: ['parsecs', 3.085677581491367e16], 21: ['US survey feet', 1200 / 3937], 22: ['US survey inches', 100 / 3937], 23: ['US survey yards', 3600 / 3937], 24: ['US survey miles', 6336000 / 3937] };
  const found = code == null ? undefined : units[code]; return found ? { units: found[0], scale: found[1] } : {};
}

function decodeDxf(buffer: ArrayBuffer, name: string): CadDecoded {
  const doc = parseDxf(buffer), warnings: string[] = [];
  let entityCount = 0, vertexCount = 0;
  const features: CadFeature[] = [], blockRefs = new Map<string, { base: Vec3; entities: RecordData[] }>();
  for (const [key, block] of doc.blocks) blockRefs.set(key, block);
  const emit = (records: RecordData[], matrix: Matrix4, depth: number, ancestry: string[]) => {
    if (depth > CAD_LIMITS.blockDepth) { warnings.push('块引用超过递归上限，已停止展开。'); return; }
    for (let i = 0; i < records.length; i++) {
      if (++entityCount > CAD_LIMITS.entities) throw new Error(`CAD 图元超过 ${CAD_LIMITS.entities} 个上限。`);
      const record = records[i], id = handleOf(record, `${ancestry.join('/')}${i + 1}`);
      if (record.type === 'INSERT') {
        const name = stringValue(record, 2), block = blockRefs.get(name.toUpperCase());
        if (!block) { warnings.push(`块 ${name || '(unknown)'} 未找到定义，已跳过。`); continue; }
        if (ancestry.some((path) => path.split('@')[0] === name.toUpperCase())) { warnings.push(`检测到循环块引用 ${name}，已停止展开。`); continue; }
        const local = insertMatrix(block.base, vec(record, 10, 20, 30), [pairValue(record, 41, 1), pairValue(record, 42, 1), pairValue(record, 43, 1)], pairValue(record, 50) * Math.PI / 180);
        emit(block.entities, multiply(matrix, local), depth + 1, [...ancestry, `${name.toUpperCase()}@${id}`]); continue;
      }
      const f = dxfFeature(record, id, matrix, warnings);
      if (f) { features.push(f); vertexCount += geometryVertexCount(f); }
      if (features.length > CAD_LIMITS.entities || vertexCount > CAD_LIMITS.vertices) throw new Error('CAD 图元或顶点数超过安全上限。');
    }
  };
  emit(doc.entities, IDENTITY, 0, []);
  const layerColors = new Map(doc.layers.map((layer) => [layer.name, layer.color]));
  for (const feature of features) feature.color ??= layerColors.get(feature.layer);
  const unit = unitInfo(doc.units);
  if (doc.crsWarning) warnings.push(doc.crsWarning);
  return { name, format: 'dxf', features, layers: doc.layers, ...(unit.units ? { units: unit.units, unitScale: unit.scale } : {}), ...(doc.crsHint ? { crsHint: doc.crsHint } : {}), warnings };
}

function geometryVertexCount(feature: CadFeature): number {
  const geometry = feature.geometry;
  if (geometry.type === 'Point') return 1;
  if (geometry.type === 'LineString') return geometry.coordinates.length;
  return geometry.coordinates.reduce((sum, ring) => sum + ring.length, 0);
}

function dwgColor(rgb?: number): string | undefined {
  if (rgb == null) return undefined;
  return `#${((rgb >> 16) & 255).toString(16).padStart(2, '0')}${((rgb >> 8) & 255).toString(16).padStart(2, '0')}${(rgb & 255).toString(16).padStart(2, '0')}`;
}

function xyz(p: { x: number; y: number; z?: number }): Vec3 { return [p.x, p.y, p.z ?? 0]; }
function extrusionUnsupported(entity: { extrusionDirection?: { x: number; y: number; z: number } }): boolean {
  const d = entity.extrusionDirection;
  return !!d && (Math.abs(d.x) > 1e-8 || Math.abs(d.y) > 1e-8 || Math.abs(d.z - 1) > 1e-8);
}

function decodeDwgDatabase(db: Awaited<ReturnType<LibreDwg['convert']>>, name: string, unknownCount: number): CadDecoded {
  const warnings: string[] = [];
  let featureCount = 0, vertexCount = 0;
  const features: CadFeature[] = [];
  const layerColors = new Map(db.tables.LAYER.entries.map((layer) => [layer.name, dwgColor(layer.color)]));
  const blockMap = new Map(db.tables.BLOCK_RECORD.entries.map((entry) => [entry.name.toUpperCase(), entry]));
  const emit = (entities: DwgEntity[], matrix: Matrix4, depth: number, ancestry: string[]) => {
    if (depth > CAD_LIMITS.blockDepth) { warnings.push('块引用超过递归上限，已停止展开。'); return; }
    for (const entity of entities) {
      if (++featureCount > CAD_LIMITS.entities) throw new Error(`CAD 图元超过 ${CAD_LIMITS.entities} 个上限。`);
      const id = entity.handle || `entity-${featureCount}`, layer = entity.layer || '0';
      if (entity.type === 'INSERT') {
        const insert = entity as DwgEntity & DwgInsertEntity;
        if (extrusionUnsupported(insert)) { warnings.push(`INSERT ${id} 使用非默认 OCS，已跳过以避免坐标偏移。`); continue; }
        const block = blockMap.get(insert.name.toUpperCase());
        if (!block) { warnings.push(`块 ${insert.name} 未找到定义，已跳过。`); continue; }
        if (ancestry.some((path) => path.split('@')[0] === insert.name.toUpperCase())) { warnings.push(`检测到循环块引用 ${insert.name}，已停止展开。`); continue; }
        const local = insertMatrix(xyz(block.basePoint), xyz(insert.insertionPoint), [insert.xScale || 1, insert.yScale || 1, insert.zScale || 1], insert.rotation || 0);
        emit(block.entities, multiply(matrix, local), depth + 1, [...ancestry, `${insert.name.toUpperCase()}@${id}`]);
        for (const attribute of insert.attribs ?? []) {
          const text = attribute.text?.text?.trim();
          if (!text) continue;
          const point = attribute.text.startPoint;
          const f: CadFeature = { id: `${id}/ATTRIB:${attribute.handle || attribute.tag}`, layer: attribute.layer || layer, entityType: 'ATTRIB', text, geometry: { type: 'Point', coordinates: transformPoint(matrix, [point.x, point.y, 0]) } };
          f.color = dwgColor(attribute.color) ?? layerColors.get(f.layer);
          features.push(f); vertexCount++;
        }
        continue;
      }
      if (['CIRCLE', 'ARC', 'LWPOLYLINE', 'POLYLINE2D', 'TEXT', 'MTEXT'].includes(entity.type) && extrusionUnsupported(entity as never)) { warnings.push(`${entity.type} ${id} 使用非默认 OCS，已跳过以避免坐标偏移。`); continue; }
      let f: CadFeature | undefined;
      const e = entity as DwgEntity & Record<string, any>;
      if (entity.type === 'LINE') f = lineFeature(id, layer, [transformPoint(matrix, xyz(e.startPoint)), transformPoint(matrix, xyz(e.endPoint))], entity.type);
      else if (entity.type === 'POINT') f = { id, layer, entityType: entity.type, geometry: { type: 'Point', coordinates: transformPoint(matrix, xyz(e.position)) } };
      else if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE2D' || entity.type === 'POLYLINE3D') {
        const verts = e.vertices ?? [], points: Vec3[] = [];
        if (entity.type === 'LWPOLYLINE') {
          for (let i = 0; i < verts.length; i++) {
            const current = verts[i], next = verts[(i + 1) % verts.length];
            if (points.length === 0) points.push(transformPoint(matrix, [current.x, current.y, e.elevation ?? 0]));
            const isClosed = (e.flag & 1) !== 0;
            if (i < verts.length - 1 || isClosed) {
              const segment: Vec3[] = [];
              appendBulgeSegment(segment, [current.x, current.y, e.elevation ?? 0], [next.x, next.y, e.elevation ?? 0], current.bulge ?? 0);
              points.push(...mapPoints(segment, matrix));
              if (Math.abs(current.bulge ?? 0) > 1e-10) warnings.push(`LWPOLYLINE ${id} 的 bulge 曲线已离散近似。`);
            }
          }
        } else {
          for (const vertex of verts) points.push(transformPoint(matrix, xyz(vertex)));
          if ((e.smoothType ?? 0) !== 0) warnings.push(`${entity.type} ${id} 的拟合曲线未展开，按顶点直线近似。`);
        }
        f = (e.flag & 1) !== 0 ? polygonFeature(id, layer, points, entity.type) : lineFeature(id, layer, points, entity.type);
      } else if (entity.type === 'CIRCLE' || entity.type === 'ARC') {
        const pts = mapPoints(sampleArc(xyz(e.center), e.radius, entity.type === 'ARC' ? e.startAngle : 0, entity.type === 'ARC' ? e.endAngle : 0, entity.type === 'CIRCLE'), matrix);
        f = entity.type === 'CIRCLE' ? polygonFeature(id, layer, pts, entity.type) : lineFeature(id, layer, pts, entity.type);
        warnings.push(`${entity.type} ${id} 已离散近似。`);
      } else if (entity.type === 'TEXT') {
        f = { id, layer, entityType: entity.type, text: e.text, geometry: { type: 'Point', coordinates: transformPoint(matrix, [e.startPoint.x, e.startPoint.y, 0]) } };
      } else if (entity.type === 'MTEXT') {
        f = { id, layer, entityType: entity.type, text: e.text, geometry: { type: 'Point', coordinates: transformPoint(matrix, xyz(e.insertionPoint)) } };
      } else warnings.push(`不支持图元 ${entity.type} (${id})，已忽略。`);
      if (f) {
        f.color = dwgColor(entity.color) ?? layerColors.get(f.layer);
        if (ancestry.length) f.id = `${ancestry.join('/')}/${f.id}`;
        features.push(f); vertexCount += geometryVertexCount(f);
      }
      if (features.length > CAD_LIMITS.entities || vertexCount > CAD_LIMITS.vertices) throw new Error('CAD 图元或顶点数超过安全上限。');
    }
  };
  emit(db.entities, IDENTITY, 0, []);
  const unit = unitInfo(db.header.INSUNITS);
  const crsHint = findExplicitCrs(db.objects);
  if (unknownCount) warnings.push(`解码器报告 ${unknownCount} 个未识别实体，已忽略。`);
  return { name, format: 'dwg', features, layers: db.tables.LAYER.entries.map((layer) => ({ name: layer.name, color: dwgColor(layer.color) })), ...(unit.units ? { units: unit.units, unitScale: unit.scale } : {}), ...(crsHint ? { crsHint } : {}), warnings };
}

function findExplicitCrs(metadata: unknown): string | undefined {
  const visited = new Set<object>();
  const visit = (value: unknown, key = '', depth = 0): string | undefined => {
    if (depth > 8 || value == null) return undefined;
    if (typeof value === 'string') {
      if (/epsg/i.test(key) && /^\s*\d{4,6}\s*$/.test(value)) return `EPSG:${value.trim()}`;
      if (/(crs|geodata|wkt|projection|coord)/i.test(key)) return explicitCrs(value);
      return undefined;
    }
    if (typeof value !== 'object' || visited.has(value)) return undefined;
    visited.add(value);
    if (Array.isArray(value)) { for (const item of value) { const found = visit(item, key, depth + 1); if (found) return found; } return undefined; }
    for (const [childKey, child] of Object.entries(value)) { const found = visit(child, childKey, depth + 1); if (found) return found; }
    return undefined;
  };
  return visit(metadata);
}

function detectFormat(name: string, bytes: Uint8Array): 'dwg' | 'dxf' {
  const ext = name.split('.').pop()?.toLowerCase();
  if (ext === 'dwg' || (bytes.length >= 6 && new TextDecoder().decode(bytes.slice(0, 6)).startsWith('AC10'))) return 'dwg';
  if (ext === 'dxf' || bytes[0] !== 0) return 'dxf';
  throw new Error('无法识别 CAD 文件格式；请提供 .dwg 或 ASCII .dxf 文件。');
}

export async function decodeCadInline(buffer: ArrayBuffer, name: string): Promise<CadDecoded> {
  if (!(buffer instanceof ArrayBuffer)) throw new TypeError('CAD 文件必须以 ArrayBuffer 传入。');
  if (buffer.byteLength > CAD_LIMITS.inputBytes) throw new Error(`CAD 文件超过 ${CAD_LIMITS.inputBytes / 1024 / 1024} MB 限制。`);
  const format = detectFormat(name, new Uint8Array(buffer));
  if (format === 'dxf') return decodeDxf(buffer, name);
  const isNode = typeof process === 'object' && !!process.versions?.node;
  const wasmDir = isNode
    ? new URL(['..', '..', 'node_modules', '@mlightcad', 'libredwg-web', 'wasm'].join('/'), import.meta.url).href
    : new URL('/cad-runtime', typeof location === 'undefined' ? 'http://localhost/' : location.href).href;
  const lib = await LibreDwg.create(wasmDir);
  let pointer: number | undefined;
  try {
    pointer = lib.dwg_read_data(buffer, Dwg_File_Type.DWG);
    if (!pointer) throw new Error('LibreDWG 无法读取此 DWG 文件。');
    const converted = lib.convertEx(pointer);
    lib.dwg_free(pointer); pointer = undefined;
    return decodeDwgDatabase(converted.database, name, converted.stats.unknownEntityCount);
  } finally {
    if (pointer) lib.dwg_free(pointer);
  }
}

export async function decodeCad(buffer: ArrayBuffer, name: string): Promise<CadDecoded> {
  if (typeof window === 'undefined' || typeof Worker === 'undefined') return decodeCadInline(buffer, name);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<{ result?: CadDecoded; error?: string }>) => {
      worker.terminate();
      if (event.data.result) resolve(event.data.result);
      else reject(new Error(event.data.error || 'CAD 解码失败。'));
    };
    worker.onerror = (event) => { worker.terminate(); reject(new Error(event.message || 'CAD 解码 worker 启动失败。')); };
    const transferable = buffer.slice(0);
    worker.postMessage({ buffer: transferable, name }, [transferable]);
  });
}
