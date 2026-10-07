import test from 'node:test';
import assert from 'node:assert/strict';
import { formatIndustryCell, industryDataSections } from '../modules/industry/dataTable.ts';
import { focusLockVisibility } from '../modules/controls/focusLockVisibility.ts';
import { mountIndustryToolsPanel, showIndustryToolsEntry } from '../config/features.ts';
import { createIndustryBundleFile, createIndustryAppendixHtml } from '../modules/industry/export.ts';
import { unzipSync } from 'fflate';

test('剖面附表按中文工程列显示原始测段值及逐项来源单元格', () => {
  const tables = industryDataSections('section', {
    records: [{ id: 'R1', leg_id: 'L1', layer_id: 'A', length_m: 12.345, slope_deg: 8.25, dip_direction_deg: 35, lithology_name: '砂岩', source_cells: { length_m: '测段!D3', slope_deg: '测段!E3' } }],
    intervals: [{ id: 'I1', layer_id: 'A', start_node: 0, end_node: 1, lithology_name: '砂岩' }],
    stations: [{ id: 'S1', node: 0 }], attitudes: [], samples: [{ id: 'Y1', record_id: 'R1', position: { x_m: 1.25 } }],
  });
  const records = tables.find(table => table.key === 'records');
  assert.equal(records.title, '测段记录');
  assert.equal(records.columns.find(column => column.key === 'length_m').label, '测段长度');
  assert.equal(records.rows[0].length_m, 12.345);
  assert.equal(records.rows[0].dip_direction_deg, 35);
  assert.equal(records.rows[0].source_display, 'length_m：测段!D3、slope_deg：测段!E3');
  assert.equal(tables.find(table => table.key === 'samples').rows.length, 1);
});

test('钻孔附表将化验元素拆成独立列并读取项目单位，缺失值保留为未提供', () => {
  const tables = industryDataSections('drill', {
    project: { analysis_units: { Au: 'mg/kg', Pb: 'ppm' } },
    layers: [{ id: '1', top_m: 0, bottom_m: 1.25, thickness_m: 1.25, lithology_name: '黏土', source: { sheet: '分层', row: 3, cells: { depth: 'B3:C3' } } }],
    turns: [{ id: 'H1', top_m: 0, bottom_m: 1, advance_m: 1, core_m: 0.8 }],
    samples: [{ id: 'Y1', top_m: 0.2, bottom_m: 0.3, assays: { Au: 2.5 } }], structures: [{ depth_m: 0.6, diameter_mm: 76 }],
  });
  const layers = tables.find(table => table.key === 'layers');
  assert.equal(layers.columns.find(column => column.key === 'thickness_m').label, '层段长（沿孔）');
  assert.equal(layers.rows[0].source_display, '工作表 分层 · 第 3 行 · 单元格 B3:C3');
  const samples = tables.find(table => table.key === 'samples');
  assert.deepEqual(samples.columns.filter(column => ['Au', 'Pb', 'Zn'].includes(column.key)).map(column => [column.key, column.unit]), [['Au', 'mg/kg'], ['Pb', 'ppm'], ['Zn', '未提供']]);
  assert.equal(formatIndustryCell(samples.rows[0].Au), '2.5');
  assert.equal(formatIndustryCell(samples.rows[0].Pb), '未提供');
});

test('行业工具面板按真实活动面板阻止 focus lock 进入，不依赖保留的结果数据', () => {
  const empty = Object.fromEntries(['drawing','areaDrawing','areaEditing','routeEditor','measurement','survey','markerPicking','routePicking','movingFeature','quickAdd','sectionEditing','navigation','recording','comparison','boxSelection','sectionList','annotationDetails','photoDetails','rally','routeCard','navigationTarget','sharing','sourcePicker'].map(key => [key, false]));
  const active = focusLockVisibility(false, 'industry', empty);
  assert.equal(active.visible, false);
  assert.deepEqual(active.reasons, ['panel']);
  assert.equal(focusLockVisibility(false, null, empty).visible, true);
});

test('独立功能关闭时工具菜单入口与行业面板挂载同时关闭', () => {
  assert.equal(showIndustryToolsEntry(false), false);
  assert.equal(mountIndustryToolsPanel(false, 'industry'), false);
  assert.equal(showIndustryToolsEntry(true), true);
  assert.equal(mountIndustryToolsPanel(true, 'industry'), true);
  assert.equal(mountIndustryToolsPanel(true, 'tools'), false);
});

test('完整图件包含可读中文附表、源SVG、重栅PNG和追溯数据', async () => {
  const result = {
    kind: 'drill', title: '测试孔', svg: '<svg width="20" height="30"/>', detailSvg: null,
    normalized: { project: { analysis_units: { Au: 'mg/kg' } }, layers: [{ id: 'L1', top_m: 0, bottom_m: 2, thickness_m: 2, lithology_name: '砂岩', source: { sheet: '分层', row: 2, cells: { top_m: 'B2' } } }], turns: [], samples: [{ id: 'Y1', top_m: 0.1, bottom_m: 0.2, assays: { Au: 3.25 } }], structures: [] },
    audit: { source: { filename: 'input.xlsx' } }, issues: [],
  };
  const html = createIndustryAppendixHtml(result);
  assert.match(html, /地层分层/);
  assert.match(html, /来源位置/);
  assert.match(html, /Au（mg\/kg）/);
  assert.match(html, /砂岩/);
  const pngBytes = Uint8Array.from([137, 80, 78, 71, 1, 2, 3]);
  const archiveFile = await createIndustryBundleFile(result, new File([pngBytes], 'drawing.png', { type: 'image/png' }));
  assert.match(archiveFile.name, /^Shantu-collection-\d+\.zip$/);
  const entries = unzipSync(new Uint8Array(await archiveFile.arrayBuffer()));
  assert.deepEqual([...entries['主图.png']], [...pngBytes]);
  assert.equal(new TextDecoder().decode(entries['主图.svg']), result.svg);
  assert.match(new TextDecoder().decode(entries['附表.html']), /样品记录/);
  assert.match(new TextDecoder().decode(entries['来源追溯.json']), /input.xlsx/);
});
