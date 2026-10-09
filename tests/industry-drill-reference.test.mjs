import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderDrill } from '../modules/industry/renderDrill.ts';

const items = count => Array.from({ length: count }, (_, index) => ({
  code: ['Au','Pb','Zn','Cu','Ag','Fe'][index], name: ['金','铅','锌','铜','银','铁'][index],
  unit: 'mg/kg', order: index, show: true,
}));
function fixture({ count = 3, denominator = 100, titleDenominator = 500, template = 'v3' } = {}) {
  const analysis = items(count);
  const assays = Object.fromEntries(analysis.map((item, index) => [item.code, index === 0 ? 0 : index + 0.25]));
  const assayRaw = { Au: '0', Pb: '<检出限', Zn: '', Cu: '', Ag: '', Fe: '' };
  return {
    drawing_type: 'drill', schema_version: 'drill-integrated-1.0', template_version: template,
    source: { filename: 'synthetic', template_version: template },
    project: { name: '模拟矿区项目', hole_id: 'BH-01', analysis_units: Object.fromEntries(analysis.map(item => [item.code, item.unit])) },
    meta: { hole_id: 'BH-01', endpoint_m: 300, depth_basis: '原始沿孔深' },
    basic_info: { fields: {
      矿区: '模拟矿区', 项目名称: '模拟项目', 钻孔编号: 'BH-01', 开孔日期: '2026-10-01', 终孔日期: '2026-10-09',
      终孔深度_m: 300, 比例尺分母: denominator, X坐标_m: 500123.45, Y坐标_m: 3456789.01,
      孔口标高_m: 312.4, 设计方位角_deg: 270, 倾角_deg: 75,
    } },
    title_block: { fields: {
      '项目/单位': '测试单位', 图名: '模拟项目钻孔柱状图', 拟编: '甲', 顺序号: '01', 审核: '乙', 图号: 'BH-01', 制图: '丙',
      比例尺分母: titleDenominator, 项目负责: '丁', 日期: '2026-10-09', 单位负责: '戊', 资料来源: '模拟填表数据',
    } },
    analysis_items: analysis,
    turns: [{ id: 'R1', top_m: 0, bottom_m: 10, advance_m: 10, core_m: 8, recovery_percent: 80, source: { sheet: '回次表', row: 6 } }],
    layers: [{ id: 'L1', top_m: 0, bottom_m: 300, thickness_m: 300, core_m: 250, recovery_percent: 83.3,
      lithology_name: '模拟砂岩', description: '模拟层段描述', material_code: '', pattern_id: null, mean_axis_angle_deg: 34, source: { sheet: '分层-原始记录', row: 6 } }],
    samples: [{ id: 'S-001', top_m: 1, bottom_m: 3, length_m: 2, core_m: 1.5, recovery_percent: 75, assays, assay_raw: assayRaw, source: { sheet: '采样', row: 6 } }],
    structures: [{ id: 'D-1', depth_m: 42, diameter_mm: 91, source: { sheet: '钻孔结构', row: 6 } }],
    depth_measurements: { records: [
      { sequence: 1, recorded_depth_m: 50.79, checked_depth_m: 50.818, error_m: 0.028, error_percent: 0.55, measurement_depth_m: 50.82, zenith_deg: 15, azimuth_deg: 270, source: { sheet: '孔深校正及弯曲度', row: 8 } },
    ], summary: {}, signatures: {} },
    summary: { turns: 1, layers: 1, samples: 1, endpoint_m: 300 },
  };
}
const visibleText = svg => [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map(match => match[1].replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&')).join('|');

test('采样格按实际长度分段，连续0.5/1.5/3米格高1:3:6，白黑交替且详图一致', () => {
  const data = fixture();
  const base = data.samples[0];
  data.samples = [[20,20.5],[20.5,22],[22,25]].map(([top_m,bottom_m], i) => ({...base, id:`H${i+1}`,top_m,bottom_m,length_m:bottom_m-top_m}));
  // Source order must not change the depth-based colour sequence.
  data.samples.reverse();
  const result = renderDrill(data);
  const segments = svg => [...svg.matchAll(/<rect class="sample-segment"[^>]*\/>/g)].map(([s]) => Object.fromEntries([...s.matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],m[2]])));
  const full=segments(result.svg),detail=segments(result.detailSvg);
  assert.deepEqual(full.map(s=>s['data-sample-id']),['H1','H2','H3']);
  assert.deepEqual(full.map(s=>s.fill),['#fff','#111','#fff']);
  assert.deepEqual(detail,full);
  for (let i=0;i<3;i++) assert.ok(Math.abs(Number(full[i].height) / Number(full[0].height) - [1,3,6][i])<1e-9);
  for (let i=0;i<2;i++) assert.ok(Math.abs(Number(full[i].y)+Number(full[i].height)-Number(full[i+1].y))<1e-9);
  assert.ok(full.every(s=>s.stroke==='#111'));
  const shortLabel = result.svg.match(/<text class="sample-rail-label" data-sample-id="H3"[^>]*>/)[0];
  assert.doesNotMatch(shortLabel, /textLength=/, '短样号保留自然宽度');
  const shortSegmentLabel = result.svg.match(/<text class="sample-rail-label" data-sample-id="H1"[^>]*>/)[0];
  assert.ok(Number(shortSegmentLabel.match(/font-size="([^"]+)"/)[1]) < Number(full[0].height), '短段字号必须小于真实段高');
  data.samples=[{...base,id:'thin',top_m:1,bottom_m:1.001,length_m:.001}];
  assert.ok(Number(segments(renderDrill(data).svg)[0].height)<1,'薄段不得强制增高到1px');
});

test('3元素固定参考版按共同坐标与1:100深度比例绘制三级表头和沿深度记录', () => {
  const data = fixture({ count: 3 });
  const { svg, detailSvg, audit } = renderDrill(data);
  const layout = audit.track_layout;
  assert.equal(audit.scale_denominator, 100);
  assert.ok(Math.abs(audit.scale_px_per_m - 80 / 3) < 1e-12);
  assert.equal(layout.table_left, 28);
  assert.equal(layout.header_top, 272);
  assert.equal(layout.header_height, 158);
  assert.equal(layout.body_top, 430);
  assert.equal(layout.table_width, 1998);
  assert.equal(layout.canvas_width, 2054);
  assert.doesNotMatch(svg, /<line x1="622" y1="272" x2="622" y2="430"/);
  assert.equal(audit.full.layers[0].top_y, 430);
  assert.ok(Math.abs(audit.full.layers[0].bottom_y - (430 + 300 * (80 / 3))) < 1e-9);
  assert.equal(audit.full.samples[0].top_y, 430 + 80 / 3);
  assert.equal(audit.detail_endpoint_m, 45);
  assert.ok(Math.abs(audit.track_layout.detail_depth_bottom_y - (430 + 45 * (80 / 3))) < 1e-9);
  assert.match(svg, /回次进尺（米）/);
  for (const char of '标志面与岩芯轴的夹角') assert.ok(svg.includes(`>${char}</text>`));
  const angleHeaderFont = Number(svg.match(/<text[^>]*font-size="([0-9.]+)"[^>]*>标<\/text>/)?.[1]);
  assert.ok(angleHeaderFont > 0 && angleHeaderFont < 10, '长纵排表头缩字号避免重叠');
  assert.match(svg, /分析结果/);
  for (const code of ['Au','Pb','Zn']) assert.ok(svg.includes(`>${code}</text>`));
  assert.match(svg, /孔深校正记录表/);
  assert.match(svg, /弯曲度测量表/);
  assert.match(svg, /误差率（‰）/);
  assert.match(svg, /5\.500/);
  assert.equal(layout.integrated_footer.derived_tilt_note.includes('90°−天顶角'), true);
  assert.doesNotMatch(svg, /倾角=90°−天顶角/);
  assert.match(svg, /钻孔倾角：75\.00°/);
  assert.match(svg, /孔口坐标：X=500123\.45/);
  assert.match(svg, /孔深校正/);
  assert.match(svg, /font-size="20"/);
  assert.match(svg, /font-size="48"/);
  assert.match(svg, /2026年10月1日/);
  assert.match(svg, /2026年10月9日/);
  assert.doesNotMatch(svg, /2026年10月1日.*08:30/s);
  assert.match(svg, /50\.818/);
  assert.match(svg, /1:100/);
  assert.match(svg, /1、模拟砂岩/);
  assert.match(svg, /模拟层段描述/);
  assert.match(svg, />（米）</);
  assert.match(visibleText(detailSvg), /模拟项目钻孔柱状图/);
  assert.equal(layout.integrated_footer.measurement_rows, 1);
  const footer = layout.integrated_footer.geometry;
  assert.equal(footer.left_x, 28);
  assert.equal(footer.header_y, audit.full.layers[0].bottom_y + 90);
  assert.equal(footer.title_y, audit.full.layers[0].bottom_y + 70);
  assert.equal(footer.row_height, 32);
  assert.equal(footer.middle_x, 28 + layout.table_width * 0.365 + layout.table_width * 0.014);
  assert.equal(footer.right_x, 28 + layout.table_width - layout.table_width * 0.243);
});

test('6元素横向扩展列宽但不改深度比例，显示原文、真实零和空白', () => {
  const data = fixture({ count: 6, denominator: 100 });
  data.samples[0].id = 'SIM-S002';
  data.samples[0].assay_raw = { Au: '0', Pb: '<检出限', Zn: '', Cu: '', Ag: '', Fe: '' };
  const { svg, audit } = renderDrill(data);
  assert.equal(audit.track_layout.table_width, 2160);
  assert.ok(Math.abs(audit.scale_px_per_m - 80 / 3) < 1e-12, '动态元素列不改变深度比例');
  assert.deepEqual(audit.track_layout.analysis_item_codes, ['Au','Pb','Zn','Cu','Ag','Fe']);
  const text = visibleText(svg);
  for (const code of ['Au','Pb','Zn','Cu','Ag','Fe']) assert.ok(svg.includes(`>${code}</text>`));
  assert.match(text, /<检出限/);
  assert.match(text, /\|0\|/);
  const label = svg.match(/<text class="sample-rail-label" data-sample-id="SIM-S002"[^>]*>/)[0];
  const strip = svg.match(/<rect class="sample-segment" data-sample-id="SIM-S002"[^>]*>/)[0];
  const attr = (tag, name) => Number(tag.match(new RegExp(` ${name}="([^"]+)"`))[1]);
  assert.match(label, /text-anchor="start"/);
  assert.ok(attr(label, 'x') >= attr(strip, 'x') + attr(strip, 'width') + 3);
  const description = audit.track_layout.column_edges.find(column => column.key === 'description');
  assert.ok(attr(label, 'x') + attr(label, 'textLength') <= description.x - 2);
  assert.doesNotMatch(text, /结果标记/);
});

test('比例尺优先基本信息，缺失回退图签，二者皆缺省时记默认100', () => {
  const fromBasic = renderDrill(fixture({ denominator: 100, titleDenominator: 500 }));
  assert.equal(fromBasic.audit.scale_denominator, 100);
  assert.equal(fromBasic.audit.track_layout.integrated_footer.scale_denominator_defaulted, false);
  const fromTitleData = fixture({ denominator: null, titleDenominator: '1:500' });
  const fromTitle = renderDrill(fromTitleData);
  assert.equal(fromTitle.audit.scale_denominator, 500);
  assert.ok(Math.abs(fromTitle.audit.scale_px_per_m - 80 / 3 * 100 / 500) < 1e-12);
  const noValue = fixture({ denominator: null, titleDenominator: null });
  const defaulted = renderDrill(noValue);
  assert.equal(defaulted.audit.scale_denominator, 100);
  assert.equal(defaulted.audit.track_layout.integrated_footer.scale_denominator_defaulted, true);
});

test('分析项目兼容 project.analysis_items 嵌套结构并从 analysis_units 补齐单位', () => {
  const data = fixture({ count: 2 });
  data.project.analysis_items = data.analysis_items;
  delete data.analysis_items;
  const { svg, audit } = renderDrill(data);
  assert.deepEqual(audit.track_layout.analysis_item_codes, ['Au','Pb']);
  assert.match(svg, />mg\/kg</);
});

test('顶栏倾角保留输入负号，弯曲度显示校正孔深而不是另一个测量深度', () => {
  const data = fixture();
  data.basic_info.fields['倾角_deg'] = -75;
  data.basic_info.fields['开孔日期'] = '2026-10-01T08:30:12';
  data.depth_measurements.records[0].checked_depth_m = 30.022;
  data.depth_measurements.records[0].measurement_depth_m = 30;
  const { svg } = renderDrill(data);
  assert.match(svg, /钻孔倾角：-75\.00°/);
  assert.match(svg, /2026年10月1日/);
  assert.doesNotMatch(svg, /2026年10月1日.*08:30/s);
  assert.match(svg, />30\.022</);
  assert.doesNotMatch(svg, />30\.000</);
});

