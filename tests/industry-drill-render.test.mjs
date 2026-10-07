import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import { renderDrill, sampleLanes } from '../modules/industry/renderDrill.ts';

const source = (sheet, row) => ({ sheet, row, cells: { record: `${sheet}!A${row}:D${row}` } });
function drill({ endpoint = 50, layers = [], turns = [], samples = [], structures = [] } = {}) {
  return {
    drawing_type: 'drill', schema_version: 'drill-1.0',
    project: { name: 'render fixture', hole_id: 'BH-test', analysis_units: { Au: 'ppm', Pb: 'mg/kg', Zn: '' } },
    meta: { hole_id: 'BH-test', endpoint_m: endpoint, depth_basis: '原始沿孔深' },
    layers, turns, samples, structures,
    summary: { layers: layers.length, turns: turns.length, samples: samples.length, endpoint_m: endpoint, pending_patterns: layers.filter(row => !row.material_code).length },
  };
}
const layer = (id, top_m, bottom_m, extra = {}) => ({
  id, top_m, bottom_m, thickness_m: bottom_m - top_m, core_m: null,
  recovery_percent: null, lithology_name: '待配置岩性', description: '',
  material_code: '', pattern_id: null, source: source('分层', 2), ...extra,
});
const sample = (id, top_m, bottom_m, extra = {}) => ({
  id, top_m, bottom_m, length_m: bottom_m - top_m, core_m: null,
  recovery_percent: null, assays: { Au: null, Pb: null, Zn: null }, source: source('样品', 2), ...extra,
});
function svgText(svg) {
  const { document } = parseHTML(`<html><body>${svg}</body></html>`);
  return [...document.querySelectorAll('text')].map(node => node.textContent ?? '').join('');
}

test('7 m短孔保留薄层原始几何，不把缺失岩心长当作0', () => {
  const data = drill({ endpoint: 7, layers: [layer('thin', 0, 0.001), layer('rest', 0.001, 7)] });
  const { svg, audit } = renderDrill(data);
  const thin = audit.full.layers.find(row => row.id === 'thin');
  assert.equal(audit.scale_px_per_m, 100);
  assert.equal(thin.top_m, 0);
  assert.equal(thin.bottom_m, 0.001);
  assert.ok(Math.abs((thin.bottom_y - thin.top_y) - 0.1) < 1e-8);
  assert.equal(thin.core_m, null);
  assert.match(svgText(svg), /岩心长 未提供 m/);
  assert.deepEqual(thin.source, data.layers[0].source);
});

test('12个完全重叠样品分配12轨，样品标签和后续列不会被固定画布截断', () => {
  const samples = Array.from({ length: 12 }, (_, index) => sample(`S-${index + 1}`, 1, 3 + index / 100));
  const { svg, audit } = renderDrill(drill({ samples }));
  const tracks = audit.track_layout;
  assert.equal(sampleLanes(samples).count, 12);
  assert.equal(tracks.sample_lane_count, 12);
  assert.ok(tracks.sample_label_x > tracks.last_sample_lane_x + 6);
  assert.ok(tracks.assay_x > tracks.sample_label_x);
  assert.ok(tracks.canvas_width > 2200);
  assert.ok(Number(svg.match(/<svg[^>]*width="(\d+)"/)?.[1]) >= tracks.canvas_width);
  assert.deepEqual(new Set(audit.full.samples.map(row => row.lane)).size, 12);
  assert.ok(audit.full.samples.every(row => row.source.sheet === '样品'));
});

test('岩性名称空白但明确D003仍使用D003模板，不被名称查找覆盖成pending', () => {
  const explicit = layer('L-D003', 0, 50, { lithology_name: '', material_code: 'D003', pattern_id: 'point-dash-ellipse-bands' });
  const { svg, audit } = renderDrill(drill({ layers: [explicit] }));
  assert.match(svg, /fill="url\(#drill-point-dash-ellipse-bands\)"/);
  assert.equal(audit.full.layers[0].material_code, 'D003');
  assert.equal(audit.full.layers[0].pattern_id, 'point-dash-ellipse-bands');
});

test('45 m详图裁切跨界分层时保留原始区间，但不画假层界端帽', () => {
  const data = drill({ layers: [layer('L-1', 0, 40), layer('L-cross', 40, 50)] });
  const { audit, detailSvg } = renderDrill(data);
  const detail = audit.detail.layers.find(row => row.id === 'L-cross');
  assert.equal(detail.top_m, 40);
  assert.equal(detail.bottom_m, 50);
  assert.equal(detail.plotted_bottom_m, 45);
  assert.ok(detail.bottom_y > detail.plotted_bottom_y);
  const boundaries = [...detailSvg.matchAll(/<line class="layer-boundary"[^>]*y1="([0-9.]+)"[^>]*y2="([0-9.]+)"/g)];
  const yValues = boundaries.map(match => Number(match[1]));
  assert.ok(yValues.includes(1096)); // y(40) at this view scale
  assert.ok(!yValues.includes(1221)); // y(45) is a crop edge, not a measured contact
  assert.deepEqual(detail.source, data.layers[1].source);
});

test('长层号、样品号与描述换行后完整保留，缺失芯长仍明确未提供', () => {
  const longLayerId = `LAYER-${'ID'.repeat(30)}`;
  const longSampleId = `SAMPLE-${'NO'.repeat(30)}`;
  const longDescription = '原始描述'.repeat(80);
  const data = drill({
    layers: [layer(longLayerId, 0, 50, { description: longDescription })],
    samples: [sample(longSampleId, 5, 8)],
  });
  const { svg, audit } = renderDrill(data);
  const text = svgText(svg);
  assert.ok(text.includes(longLayerId));
  assert.ok(text.includes(longSampleId));
  assert.ok(text.includes(longDescription));
  assert.ok(text.includes('岩心长 未提供 m'));
  assert.equal(audit.full.layers[0].description, longDescription);
  assert.deepEqual(audit.full.layers[0].source, data.layers[0].source);
  assert.deepEqual(audit.full.samples[0].assays, data.samples[0].assays);
});

test('PC实测23层、131回次、97样品数据完整保留原始几何与逐项来源', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const data = JSON.parse(fs.readFileSync(path.join(here, 'fixtures/industry/pc-drill-example.json'), 'utf8'));
  const { audit, svg } = renderDrill(data);
  assert.deepEqual(
    [audit.full.layers.length, audit.full.turns.length, audit.full.samples.length],
    [23, 131, 97],
  );
  for (const kind of ['layers', 'turns', 'samples']) {
    assert.equal(audit.full[kind].length, data[kind].length);
    for (let i = 0; i < data[kind].length; i++) {
      const input = data[kind][i];
      const output = audit.full[kind][i];
      assert.equal(output.id, input.id);
      assert.equal(output.top_m, input.top_m);
      assert.equal(output.bottom_m, input.bottom_m);
      assert.deepEqual(output.source, input.source);
      assert.equal(output.top_y, 96 + input.top_m * audit.scale_px_per_m);
      assert.equal(output.bottom_y, 96 + input.bottom_m * audit.scale_px_per_m);
    }
  }
  assert.equal(audit.full.layers.at(-1).bottom_m, data.meta.endpoint_m);
  assert.equal(audit.full.samples.at(-1).bottom_m, data.samples.at(-1).bottom_m);
  const depthBottomY = 96 + data.meta.endpoint_m * audit.scale_px_per_m;
  assert.ok(svg.includes('>0.00–36.88 m</text>'), '分层顶底深作为完整数字绘制在同一行');
  assert.ok(audit.track_layout.sample_list_bottom_y <= depthBottomY);
  assert.ok(audit.track_layout.turn_list_bottom_y <= depthBottomY);
  assert.ok(Number(svg.match(/height="([0-9.]+)/)?.[1]) <= depthBottomY + 150);
  const sampleLeaders = [...svg.matchAll(/<path class="sample-leader" d="([^"]+)"\/>/g)];
  assert.equal(sampleLeaders.length, data.samples.length);
  assert.ok(sampleLeaders.every(([, d]) => /^M[\d.]+,[\d.]+H[\d.]+V[\d.]+H[\d.]+$/.test(d)));
  assert.match(svg, /样品列表（按深度）/);
  assert.match(svg, /回次记录列表/);
  const { document } = parseHTML(`<html><body>${svg}</body></html>`);
  const footerRows = [...document.querySelectorAll('text')]
    .map((node) => ({ text: node.textContent ?? '', y: Number(node.getAttribute('y')) }))
    .filter((row) => /^(全孔汇总：|全孔视图显示范围|符号按本项目)/.test(row.text));
  assert.equal(footerRows.length, 3);
  assert.ok(footerRows[1].y - footerRows[0].y >= 16);
  assert.ok(footerRows[2].y - footerRows[1].y >= 16);
});
