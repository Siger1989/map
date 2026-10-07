import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { test } from 'node:test';
import { unzipSync, zipSync } from 'fflate';
import { parseXlsx } from '../modules/industry/xlsx.ts';
import { importSection } from '../modules/industry/importSection.ts';
import { importDrill } from '../modules/industry/importDrill.ts';
import { generateGeology, geometryAuditIssues } from '../modules/industry/engine.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const assets = path.join(repo, 'public/industry');
const fixtures = path.join(here, 'fixtures/industry');
const close = (a, b, tolerance = 1e-9) => Math.abs(a - b) <= tolerance;

async function workbook(file) {
  const bytes = await readFile(file);
  return { bytes, book: await parseXlsx(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), path.basename(file)) };
}

function projectForCompare(value) {
  const copy = structuredClone(value);
  if (copy.source) delete copy.source.filename;
  copy.issues = [];
  return copy;
}

function comparePc(actual, expected, where = '$', diffs = []) {
  if (typeof actual === 'number' && typeof expected === 'number') {
    const sourceNumber = /\.raw(?:\.|\[)|\.source_cells(?:\.|\[)|\.source\./.test(where);
    if (sourceNumber ? actual !== expected : !close(actual, expected)) diffs.push(`${where}: ${actual} != ${expected}`);
    return diffs;
  }
  if (Array.isArray(actual) && Array.isArray(expected)) {
    if (actual.length !== expected.length) { diffs.push(`${where}: length ${actual.length} != ${expected.length}`); return diffs; }
    actual.forEach((v, i) => comparePc(v, expected[i], `${where}[${i}]`, diffs));
    return diffs;
  }
  if (actual && expected && typeof actual === 'object' && typeof expected === 'object') {
    const ak = Object.keys(actual).sort(), ek = Object.keys(expected).sort();
    if (JSON.stringify(ak) !== JSON.stringify(ek)) { diffs.push(`${where}: keys ${ak.join(',')} != ${ek.join(',')}`); return diffs; }
    for (const key of ak) comparePc(actual[key], expected[key], `${where}.${key}`, diffs);
    return diffs;
  }
  if (actual !== expected) diffs.push(`${where}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
  return diffs;
}

function compareIssues(actual, expected) {
  const pick = list => list.map(({ severity, code, cells = [] }) => ({ severity, code, cells }));
  assert.deepEqual(pick(actual), pick(expected));
}

async function importFixture(file, kind, goldenFile) {
  const { book } = await workbook(file);
  const imported = (kind === 'section' ? importSection : importDrill)(book);
  const expected = JSON.parse(await readFile(goldenFile, 'utf8'));
  assert.equal(imported.normalized.source.sha256, expected.source.sha256, 'PC-golden source hash must match workbook bytes');
  const diffs = comparePc(projectForCompare(imported.normalized), projectForCompare(expected));
  assert.deepEqual(diffs, [], diffs.slice(0, 12).join('\n'));
  compareIssues(imported.issues, expected.issues);
  return imported.normalized;
}

test('public blank templates are valid XLSX containers and have no data records', async () => {
  const section = await workbook(path.join(assets, 'section-template.xlsx'));
  assert.ok(section.book.sheets.has('项目') && section.book.sheets.has('测段'));
  assert.equal(section.book.sheets.get('测段').rows.length, 1, 'header row only');
  const drill = await workbook(path.join(assets, 'drill-template.xlsx'));
  assert.ok(drill.book.sheets.has('项目') && drill.book.sheets.has('分层'));
  for (const name of ['分层', '回次', '样品', '孔径']) assert.equal(drill.book.sheets.get(name).rows.length, 1, `${name} header row only`);
});

test('PM01 section example matches complete PC normalized source and geometry', async () => {
  const n = await importFixture(path.join(assets, 'section-example.xlsx'), 'section', path.join(fixtures, 'pc-section-example.json'));
  assert.deepEqual([n.summary.records, n.summary.intervals, n.summary.stations, n.summary.samples], [43, 26, 20, 14]);
  assert.equal(n.nodes.length, 44);
  assert.equal(n.records.length, 43);
  assert.equal(n.intervals.length, 26);
  assert.equal(n.stations.length, 20);
  assert.equal(n.samples.length, 14);
  assert.ok(n.records.some(r => Object.keys(r.raw).length && r.source_cells.length_m));
});

test('ZK0003 drill example matches PC normalized layers, turns, samples, units, and source cells', async () => {
  const n = await importFixture(path.join(assets, 'drill-example.xlsx'), 'drill', path.join(fixtures, 'pc-drill-example.json'));
  assert.deepEqual([n.summary.turns, n.summary.layers, n.summary.samples, n.summary.endpoint_m], [131, 23, 97, 382.79]);
  assert.deepEqual(n.project.analysis_units, { Au: '', Pb: '', Zn: '' });
  assert.ok(n.layers.every(layer => layer.source.sheet === '分层' && layer.source.cells['顶深_m']));
  assert.ok(n.turns.every(turn => turn.source.sheet === '回次' && turn.source.cells['岩心长_m']));
  assert.ok(n.samples.every(sample => sample.source.sheet === '样品' && sample.source.cells.Au));
  assert.ok(n.samples.every(sample => sample.assays.Au === null && sample.assays.Pb === null && sample.assays.Zn === null));
});

test('short section alt matches PC output and retains the independent two-leg geometry', async () => {
  const n = await importFixture(path.join(fixtures, 'section_alt.xlsx'), 'section', path.join(fixtures, 'pc-section-alt.json'));
  assert.ok(close(n.nodes.at(-1).x_m, 14.330127018922195));
  assert.ok(close(n.nodes.at(-1).z_m, 2.5));
  assert.equal(n.samples[0].id, 'T1');
  assert.equal(n.samples[0].location_status, 'explicit_offset');
});

test('geometry issues retain source severity and cells; lithology conflict points to both source cells', async () => {
  assert.deepEqual(geometryAuditIssues({ issues: [{
    severity: 'error', code: 'layer_geometry_input_missing', message: '几何缺失', cells: ['测段!C2', '测段!K3'],
  }] }), [{
    severity: 'error', code: 'GEOMETRY_LAYER_GEOMETRY_INPUT_MISSING', message: '几何缺失', cells: ['测段!C2', '测段!K3'],
  }]);

  const { book } = await workbook(path.join(fixtures, 'section_alt.xlsx'));
  book.sheets.get('测段').rows[2].cells.C3 = 'L1';
  assert.throws(() => importSection(book), error => {
    const conflict = error.issues?.find(issue => issue.code === 'LITHOLOGY_CONFLICT');
    assert.deepEqual(conflict?.cells, ['测段!K2', '测段!K3']);
    assert.equal(conflict?.severity, 'error');
    return true;
  });
});

test('short drill alt matches PC output, keeps thin layer, overlap lanes, assay units and nulls', async () => {
  const n = await importFixture(path.join(fixtures, 'drill_alt.xlsx'), 'drill', path.join(fixtures, 'pc-drill-alt.json'));
  assert.deepEqual([n.summary.turns, n.summary.layers, n.summary.samples, n.meta.endpoint_m], [2, 3, 3, 7]);
  assert.ok(close(n.layers[1].thickness_m, 0.02));
  assert.deepEqual(n.samples.map(s => s.id), ['S1', 'S2', 'S3']);
  assert.equal(n.samples[0].assays.Au, 0.15);
  assert.equal(n.samples[0].source.sheet, '样品');
  assert.equal(n.samples[1].assays.Au, null);
  assert.ok(n.issues.some(i => i.code === 'OVERLAPPING_SAMPLES'));
  assert.equal(n.meta.depth_basis, '原始沿孔深');
});

async function mutate(file, part, transform) {
  const source = new Uint8Array(await readFile(file));
  const files = unzipSync(source);
  const xml = new TextDecoder().decode(files[part]);
  files[part] = new TextEncoder().encode(transform(xml));
  const changed = zipSync(files);
  return changed.buffer.slice(changed.byteOffset, changed.byteOffset + changed.byteLength);
}

async function rejectsWorkbook(buffer, filename, kind, fragment) {
  await assert.rejects(async () => {
    const book = await parseXlsx(buffer, filename);
    (kind === 'section' ? importSection : importDrill)(book);
  }, error => error instanceof Error && error.message.includes(fragment));
}

test('rejects formulas and missing section geometry with Chinese source-cell location', async () => {
  const base = path.join(assets, 'section-example.xlsx');
  const formula = await mutate(base, 'xl/worksheets/sheet2.xml', xml => xml.replace(/(<x:c\b[^>]*\br="F2"[^>]*>)([\s\S]*?)(<\/x:c>)/, (_m, a, b, c) => `${a}${b.replace('<x:v>', '<x:f>1+1</x:f><x:v>')}${c}`));
  await rejectsWorkbook(formula, 'formula.xlsx', 'section', '测段!F2');
  const empty = await mutate(base, 'xl/worksheets/sheet2.xml', xml => xml.replace(/<x:c\b[^>]*\br="F2"[^>]*>[\s\S]*?<\/x:c>/, ''));
  await rejectsWorkbook(empty, 'empty.xlsx', 'section', '测段!F2');
});

test('rejects duplicate section ids and drill interval boundary conflicts', async () => {
  const section = await mutate(path.join(assets, 'section-example.xlsx'), 'xl/worksheets/sheet2.xml', xml => xml.replace('R0002', 'R0001'));
  await rejectsWorkbook(section, 'duplicate-id.xlsx', 'section', '记录号“R0001”重复');
  const drill = await mutate(path.join(fixtures, 'drill_alt.xlsx'), 'xl/worksheets/sheet2.xml', xml => xml.replace(/(<x:c\b[^>]*\br="B3"[^>]*>[\s\S]*?<x:v>)1\.5(<\/x:v>)/, '$11.4$2'));
  await rejectsWorkbook(drill, 'boundary.xlsx', 'drill', '分层区间重叠');
});

test('rejects unknown drill pattern, repeated sheet names, rows, and cells', async () => {
  const drillPath = path.join(assets, 'drill-example.xlsx');
  const unknown = await mutate(drillPath, 'xl/worksheets/sheet2.xml', xml => {
    const cell = /<x:c\b(?=[^>]*\br="G2")[^>]*\/>|<x:c\b(?=[^>]*\br="G2")[^>]*>[\s\S]*?<\/x:c>/;
    assert.match(xml, cell);
    return xml.replace(cell, '<x:c r="G2" t="inlineStr"><x:is><x:t>NOT-A-CODE</x:t></x:is></x:c>');
  });
  await rejectsWorkbook(unknown, 'unknown-code.xlsx', 'drill', '未配置花纹代码');
  const repeatedSheet = await mutate(drillPath, 'xl/workbook.xml', xml => xml.replace('name="孔径"', 'name="项目"'));
  await rejectsWorkbook(repeatedSheet, 'duplicate-sheet.xlsx', 'drill', '工作表名称重复');
  const sectionPath = path.join(assets, 'section-example.xlsx');
  const repeatedRow = await mutate(sectionPath, 'xl/worksheets/sheet2.xml', xml => {
    const row = xml.match(/<x:row r="2"[^>]*>[\s\S]*?<\/x:row>/)?.[0];
    assert.ok(row); return xml.replace('</x:sheetData>', `${row}</x:sheetData>`);
  });
  await rejectsWorkbook(repeatedRow, 'duplicate-row.xlsx', 'section', '测段!第2行重复');
  const repeatedCell = await mutate(sectionPath, 'xl/worksheets/sheet2.xml', xml => {
    const row = xml.match(/<x:row r="2"[^>]*>[\s\S]*?<\/x:row>/)?.[0];
    const cell = row?.match(/<x:c r="A2"[^>]*>[\s\S]*?<\/x:c>/)?.[0];
    assert.ok(row && cell); return xml.replace(row, row.replace('</x:row>', `${cell}</x:row>`));
  });
  await rejectsWorkbook(repeatedCell, 'duplicate-cell.xlsx', 'section', '测段!A2 单元格重复');
});

test('engine renders locally without network and returns the documented result shape', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('network forbidden by test'); };
  try {
    const bytes = await readFile(path.join(assets, 'section-example.xlsx'));
    const result = await generateGeology(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), 'section-example.xlsx', 'section');
    assert.equal(result.kind, 'section');
    assert.equal(typeof result.detailSvg, 'string');
    assert.ok(result.svg.includes('<svg') && result.detailSvg.includes('<svg'));
    assert.ok(!/<image\b/i.test(result.svg));
    assert.equal(result.normalized.summary.records, 43);
    const altBytes = await readFile(path.join(fixtures, 'drill_alt.xlsx'));
    const drill = await generateGeology(altBytes.buffer.slice(altBytes.byteOffset, altBytes.byteOffset + altBytes.byteLength), 'drill_alt.xlsx', 'drill');
    assert.equal(drill.normalized.summary.endpoint_m, 7);
    assert.equal(drill.audit.track_layout.sample_lane_count, 2, 'overlapping S1/S2 must be drawn on separate tracks');
    assert.ok(drill.issues.some(issue => issue.code === 'OVERLAPPING_SAMPLES'));
    assert.ok(drill.issues.some(issue => issue.code === 'PENDING_PATTERN'), 'unknown geology stays pending');
  } finally { globalThis.fetch = original; }
});
