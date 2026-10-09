import assert from 'node:assert/strict';
import { test } from 'node:test';
import { unzipSync, zipSync } from 'fflate';
import { parseXlsx } from '../modules/industry/xlsx.ts';
import { importDrill } from '../modules/industry/importDrill.ts';
import { importIntegratedDrill } from '../modules/industry/importIntegratedDrill.ts';
import { renderDrill } from '../modules/industry/renderDrill.ts';
import { industryDataSections } from '../modules/industry/dataTable.ts';
import { INTEGRATED_DRILL_HEADERS, INTEGRATED_DRILL_HEADERS_V3, INTEGRATED_DRILL_SHEETS } from '../modules/industry/integratedDrillSchema.ts';

const encoder = new TextEncoder();
const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const colName = n => { let out = ''; while (n) { const r = (n - 1) % 26; out = String.fromCharCode(65 + r) + out; n = Math.floor((n - 1) / 26); } return out; };
function cell(address, value, formula = null) {
  if (formula) return `<c r="${address}"><f>${esc(formula)}</f>${value == null ? '' : `<v>${esc(value)}</v>`}</c>`;
  if (value == null || value === '') return '';
  if (typeof value === 'number') return `<c r="${address}"><v>${value}</v></c>`;
  return `<c r="${address}" t="inlineStr"><is><t>${esc(value)}</t></is></c>`;
}
function rowXml(row, entries) { return `<row r="${row}">${entries.map(([col, value, formula]) => cell(`${col}${row}`, value, formula)).join('')}</row>`; }
function worksheet(rows) { return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.join('')}</sheetData></worksheet>`; }
function remapV3Data(name, rowNumber, xml) {
  const maps = {
    '回次表': { drop: 8, shift: 1 },
    '分层-原始记录': { drop: 9, shift: 1 },
    '采样': { drop: 10, shift: 1 },
    '样品测试结果': { drop: 4, shift: 1 },
  };
  const spec = maps[name];
  if (!spec || rowNumber === 5) return xml;
  return xml.replace(/<c\b([^>]*\br="([A-Z]+)(\d+)"[^>]*)>([\s\S]*?)<\/c>/g, (whole, attrsText, letters, rowText, body) => {
    let col = 0;
    for (const char of letters) col = col * 26 + char.charCodeAt(0) - 64;
    col--;
    if (col === spec.drop) return '';
    if (col > spec.drop) col--;
    let next = col + 1, address = '';
    while (next) { const rem = (next - 1) % 26; address = String.fromCharCode(65 + rem) + address; next = Math.floor((next - 1) / 26); }
    return `<c${attrsText.replace(/\br="[A-Z]+\d+"/, `r="${address}${rowText}"`)}>${body}</c>`;
  });
}
function integratedWorkbook({ conflict = false, duplicate = false, addUnknown = false, addLateLayer = false, version = 'v2' } = {}) {
  const sheetXml = {};
  const add = (name, rows) => {
    const xml = worksheet(rows);
    sheetXml[name] = version === 'v3' ? xml.replace(/<row\b[^>]*\br="(\d+)"[^>]*>[\s\S]*?<\/row>/g, (match, row) => remapV3Data(name, Number(row), match)) : xml;
  };
  add('钻孔基本信息', [
    rowXml(4, [['A','矿区'],['B','铜山'],['C','线号'],['D','1'],['E','钻孔编号'],['F','BH-01'],['G','项目名称'],['H','项目甲']]),
    rowXml(5, [['E','终孔深度_m'],['F',12],['G','孔深基准'],['H','原始沿孔深']]),
    rowXml(12, [['A','回次数'],['B',2,'COUNTIF(B6:B25,"<>")'],['C','分层数'],['D',1],['E','样品数'],['G','孔深测点数']]),
  ]);
  for (const [name, v2Spec] of Object.entries(INTEGRATED_DRILL_HEADERS)) {
    const spec = version === 'v3' ? INTEGRATED_DRILL_HEADERS_V3[name] ?? v2Spec : v2Spec;
    const rows = [rowXml(spec.row, spec.headers.map((value, i) => [colName(i + (name === '孔深校正及弯曲度' ? 2 : 1)), value]))];
    if (name === '回次表') rows.push(
      rowXml(6, [['A',1,'IF(B6="","",ROW()-5)'],['B','R1'],['C',5],['D',5],['F',4.8],['H',0],['I',0],['J',0,'IF(OR(D6="",H6=""),"",H6/D6*100)'],['O',73],['Q','', 'IF(D6="","","核对")']]),
      rowXml(7, [['A',2,'IF(B7="","",ROW()-5'],['B','R2'],['C',12],['D',7],['H',6.5],['I',90]]),
      rowXml(8, [['A',3,'IF(B8="","",ROW()-5)']]),
    );
    if (name === '分层-原始记录') rows.push(rowXml(6, [['A',1,'IF(B6="","",ROW()-5)'],['B','L1'],['G',12],['H',12],['I',5.5],['J',88],['K',91,'IF(OR(H6="",I6=""),"",I6/H6*100)'],['L','砂岩'],['M',31],['N',2.3],['O','层描述']]),
      ...(addLateLayer ? [rowXml(26, [['A',21,'IF(B26="","",ROW()-5)'],['B','L1'],['G',12],['H',12],['L','晚填记录']])] : []));
    if (name === '采样') rows.push(rowXml(6, [['A',1,'IF(B6="","",ROW()-5)'],['B','S1'],['G',1],['H',2],['I',1],['J',.92],['K',92],['L',92,'IF(OR(I6="",J6=""),"",J6/I6*100)'],['M',.4],['N','g']]));
    if (name === '自定义测试项目') rows.push(
      rowXml(6, [['A','CU'],['B','铜'],['C','mg/kg'],['D',.1],['E','ICP'],['F','是'],['G',2],['H','主显示']]),
      rowXml(7, [['A','AS'],['B','砷'],['C','mg/kg'],['D',.05],['E','ICP'],['F','否'],['G',1],['H','隐藏但保留']]),
    );
    if (name === '样品测试结果') rows.push(
      rowXml(6, [['A','S1'],['B','CU'],['C','<0.10'],['F', conflict ? 'ppm' : 'mg/kg'],['I',46304],['J','RPT-01']]),
      ...(duplicate ? [rowXml(7, [['A','S1'],['B','CU'],['C','<检出限'],['F','mg/kg']])] : []),
      ...(addUnknown ? [rowXml(8, [['A','MISSING'],['B','CU'],['C','1'],['D',1],['F','mg/kg']])] : []),
    );
    if (name === '孔深校正及弯曲度') rows.push(rowXml(8, [['A',1,'IF(B8="","",ROW()-7)'],['B',4],['C',3.98],['D',.02],['E',.5],['F',4],['G',12],['H',44],['I','磁测'],['J','仪器A']]),
      rowXml(27, [['A','孔深校正次数汇总'],['G','弯曲度测量次数汇总']]),
      rowXml(28, [['A','应测次数'],['C','实测次数'],['E','超差次数'],['G','应测次数'],['I','实测次数'],['K','超差次数']]),
      rowXml(29, [['B',3],['D',1],['F',0],['H',4],['J',1],['L',0]]),
      rowXml(30, [['A','记录人'],['B','张三'],['D','日期'],['E','2026-10-09'],['G','检查人'],['H','李四'],['J','日期'],['K','2026-10-10']]));
    add(name, rows);
  }
  sheetXml['图签'] = worksheet([
    rowXml(4, [['A','项目/单位'],['B','具有较长名称的单位与勘查项目组合名称，用于验证图签内容能够换行显示']]),
    rowXml(5, [['A','图名'],['B','铜山矿区一号勘查线钻孔综合柱状图长标题']]),
    rowXml(9, [['C','比例尺分母'],['D',1000]]),
    rowXml(10, [['C','资料来源'],['D','现场编录、测斜记录和样品测试报告整合资料来源长文本']]),
  ]);
  for (const name of INTEGRATED_DRILL_SHEETS) if (!sheetXml[name]) add(name, [rowXml(1, [['A',name]])]);
  const sheetNames = INTEGRATED_DRILL_SHEETS;
  const sheets = sheetNames.map((name, i) => `<sheet name="${name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('');
  const rels = sheetNames.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('');
  const files = {
    'xl/workbook.xml': encoder.encode(`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets}</sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': encoder.encode(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`),
  };
  sheetNames.forEach((name, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = encoder.encode(sheetXml[name]); });
  return zipSync(files);
}
async function parse(bytes) { return parseXlsx(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), 'integrated.xlsx'); }

test('整合模板允许公式缓存但不执行公式，导入手填几何与分析原文并绘完整附表', async () => {
  const workbook = await parse(integratedWorkbook());
  const parsedTurn = workbook.sheets.get('回次表').rows.find(row => row.row === 6);
  assert.equal(parsedTurn.cells.J6, 0, '公式缓存可读取且零值保留');
  assert.match(parsedTurn.formulas.J6, /^IF/);
  const normalized = importDrill(workbook).normalized;
  assert.equal(normalized.schema_version, 'drill-integrated-1.0');
  assert.deepEqual(normalized.project.analysis_units, { CU: 'mg/kg', AS: 'mg/kg' });
  assert.deepEqual(normalized.analysis_items.map(item => [item.code, item.name, item.order, item.show]), [['AS','砷',1,false],['CU','铜',2,true]]);
  assert.equal(normalized.turns.length, 2, 'formula-only placeholder row is ignored');
  assert.deepEqual(normalized.turns.map(row => [row.top_m, row.bottom_m, row.advance_m, row.recovery_percent, row.recovery_original_percent, row.recovery_raw_percent, row.recovery_computed_percent_source]), [[0,5,5,0,0,0,0],[5,12,7,92.85714285714286,90,90,null]]);
  assert.equal(normalized.turns[0].core_m, 0, 'processed hand-entered zero is retained');
  assert.deepEqual(normalized.turns[0].source_metrics, { raw_core_length_m: 4.8, raw_recovery_percent: 0,
    computed_recovery_formula: '=IF(OR(D6="",H6=""),"",H6/D6*100)', depth_correction_m: null, corrected_bottom_depth_m: null, rqd_raw: 73 });
  assert.equal(normalized.turns[0].raw['RQD_pct（原填）'], 73, 'original RQD stays raw');
  assert.deepEqual(normalized.layers.map(row => [row.top_m,row.bottom_m,row.thickness_m,row.recovery_percent,row.recovery_raw_percent]), [[0,12,12,45.83333333333333,88]]);
  assert.equal(normalized.layers[0].recovery_computed_percent_source, 91, 'cached calculated column stays separate from raw input and geometry-derived rate');
  assert.deepEqual(normalized.layers[0].raw_layer_notes, { adjustment: '层描述', stop_run_core_m: null, source_O_unlabeled: null });
  assert.equal(normalized.layers[0].raw['真厚度_m（原填）'], 2.3);
  assert.equal(normalized.layers[0].source.derived.top_m.rule, 'first row 0; subsequent row previous explicit cumulative bottom');
  assert.equal(normalized.samples[0].assays.CU, null);
  assert.equal(normalized.samples[0].assay_raw.CU, '<0.10');
  assert.equal(normalized.samples[0].assays.AS, null);
  assert.equal(normalized.samples[0].assay_raw.AS, '');
  assert.equal(normalized.samples[0].recovery_computed_percent_source, 92);
  assert.equal(normalized.depth_measurements.records[0].sequence, 1);
  assert.equal(normalized.depth_measurements.records[0].source.formulas['序号'].formula, 'IF(B8="","",ROW()-7)');
  assert.equal(normalized.depth_measurements.records.length, 1, '第27行之后是汇总和签名，不当测点导入');
  assert.equal(normalized.depth_measurements.summary['实测次数'].value, 1);
  assert.equal(normalized.depth_measurements.signatures['记录人'].value, '张三');
  assert.equal(normalized.basic_info.fields['钻孔编号'], 'BH-01');
  assert.match(normalized.title_block.fields['项目/单位'], /较长名称/);
  const rendered = renderDrill(normalized);
  assert.match(rendered.svg, /分析结果/);
  assert.match(rendered.svg, /&lt;0\.10/);
  assert.match(rendered.svg, /孔深校正记录表/);
  assert.match(rendered.svg, /弯曲度测量表/);
  assert.match(rendered.svg, />钻 孔</);
  assert.match(rendered.svg, />结 构</);
  assert.match(rendered.svg, />备 注</);
  assert.match(rendered.svg, /1:1000/);
  assert.match(rendered.svg, /资料来源长文本/);
  assert.equal(rendered.audit.track_layout.reference_style, true);
  assert.equal(rendered.audit.track_layout.table_left, 28);
  assert.equal(rendered.audit.track_layout.header_top, 272);
  assert.equal(rendered.audit.track_layout.body_top, 430);
  assert.equal(rendered.audit.track_layout.basic_info_rows, 0);
  assert.equal(rendered.audit.track_layout.integrated_footer.measurement_rows, 1);
  const sections = industryDataSections('drill', normalized);
  const sampleTable = sections.find(section => section.key === 'samples');
  assert.ok(sampleTable.columns.some(column => column.key === 'AS'), 'hidden analysis remains in the full table');
  assert.ok(sampleTable.columns.some(column => column.label === '进尺_m'), 'original sample table fields remain in full table');
  const assayTable = sections.find(section => section.key === 'analysis_results');
  assert.equal(assayTable.rows[0].result_raw, '<0.10');
  assert.equal(assayTable.rows[0].code, 'CU');
  assert.ok(sections.some(section => section.key === 'basic_summary'));
  assert.ok(sections.some(section => section.key === 'depth_measurements'));
  assert.ok(sections.some(section => section.key === 'title_block'));
});

test('整合模板拒绝单位冲突、重复样品项目和未知样品，并给空白分层提示', async () => {
  for (const [option, code] of [[{ conflict: true }, 'ANALYSIS_UNIT_CONFLICT'], [{ duplicate: true }, 'DUPLICATE_SAMPLE_ANALYSIS'], [{ addUnknown: true }, 'UNKNOWN_SAMPLE']]) {
    const workbook = await parse(integratedWorkbook(option));
    assert.throws(() => importDrill(workbook), error => error.issues?.some(issue => issue.code === code));
  }
  const workbook = await parse(integratedWorkbook());
  workbook.sheets.get('分层-原始记录').rows = workbook.sheets.get('分层-原始记录').rows.filter(row => row.row <= 5);
  assert.throws(() => importDrill(workbook), error => error.issues?.some(issue => issue.code === 'EMPTY_LAYER_SHEET' && issue.severity === 'error'));
  const lateRow = await parse(integratedWorkbook({ addLateLayer: true }));
  assert.throws(() => importDrill(lateRow), error => error.issues?.some(issue => issue.code === 'DUPLICATE_ID' && issue.cells?.some(cell => cell.endsWith('B26'))), 'row 26 remains part of the dynamic input table');
});

test('v3删除手填采取率与结果标记后按新列坐标导入并自动计算比例', async () => {
  const workbook = await parse(integratedWorkbook({ version: 'v3' }));
  const normalized = importDrill(workbook).normalized;
  assert.equal(normalized.schema_version, 'drill-integrated-1.0');
  assert.equal(normalized.template_version, 'v3');
  assert.equal(normalized.source.template_version, 'v3');
  assert.equal(normalized.turns[0].recovery_percent, 0, '岩心长度0仍是实际0，计算率为0');
  assert.equal(normalized.turns[0].recovery_original_percent, null, 'v3没有手填采取率列');
  assert.equal(normalized.turns[0].recovery_computed_percent_source, 0, '回次计算率列从I列读取');
  assert.equal(normalized.turns[0].source.cells['回次采取率_pct（计算）'], '回次表!I6');
  assert.equal(normalized.layers[0].recovery_percent, 5.5 / 12 * 100);
  assert.equal(normalized.layers[0].recovery_original_percent, null);
  assert.equal(normalized.layers[0].recovery_computed_percent_source, 91, '分层计算率列从J列读取');
  assert.equal(normalized.samples[0].recovery_percent, 92, '采样采取率列从K列读取');
  assert.equal(normalized.samples[0].recovery_original_percent, null);
  assert.equal(normalized.samples[0].recovery_computed_percent_source, 92);
  const assay = normalized.samples[0].assay_records[0];
  assert.equal(assay.flag, '', 'v3没有结果标记列');
  assert.equal(assay.unit, 'mg/kg');
  assert.equal(assay.test_date, '2026-10-09', '检测日期列由I移到H；字段名已识别为日期');
  assert.equal(assay.report_number, 'RPT-01', '报告编号列由J移到I并保留值');
  assert.equal(assay.source.cells['单位'], '样品测试结果!E6');
  assert.equal(assay.source.cells['检测日期'], '样品测试结果!H6');
  assert.equal(normalized.samples[0].assays.CU, null, '<检出限原文仍不伪造数值');
  assert.equal(normalized.samples[0].assay_raw.CU, '<0.10');
});

test('v3结果表日期和报告字段必须使用完整规范表头', async () => {
  const workbook = await parse(integratedWorkbook({ version: 'v3' }));
  const header = workbook.sheets.get('样品测试结果').rows.find(row => row.row === 5).cells;
  assert.equal(header.H5, '检测日期');
  assert.equal(header.I5, '报告编号');
  header.H5 = '日期';
  header.I5 = '报告';
  assert.throws(() => importIntegratedDrill(workbook), /字段表头不匹配/);
});

test('v3采取率按手填进尺计算，几何继续按深度边界，进尺空值不回退', async () => {
  const workbook = await parse(integratedWorkbook({ version: 'v3' }));
  const turnsSheet = workbook.sheets.get('回次表');
  turnsSheet.rows.find(row => row.row === 7).cells.D7 = 13;
  turnsSheet.rows.find(row => row.row === 6).cells.D6 = null;
  const layersSheet = workbook.sheets.get('分层-原始记录');
  layersSheet.rows.find(row => row.row === 6).cells.H6 = 24;
  const samplesSheet = workbook.sheets.get('采样');
  samplesSheet.rows.find(row => row.row === 6).cells.I6 = 2;
  const result = importDrill(workbook);
  const normalized = result.normalized;
  assert.equal(normalized.turns[0].advance_m, 5, '回次几何仍按连续底深推导');
  assert.equal(normalized.turns[0].recovery_percent, null, 'v3分母空白不回退到底深差值');
  assert.equal(normalized.turns[1].advance_m, 7);
  assert.equal(normalized.turns[1].recovery_percent, 50, '6.5/13*100来自表内进尺，不是几何7m');
  assert.equal(normalized.turns[0].source_metrics.raw_core_length_m, 4.8);
  assert.equal(normalized.turns[1].source.raw['回次进尺_m'], 13);
  assert.equal(normalized.turns[1].recovery_computed_percent_source, null, '缓存计算列不覆盖主结果');
  assert.equal(normalized.layers[0].thickness_m, 12, '分层几何仍按换层累计深度');
  assert.equal(normalized.layers[0].recovery_percent, 5.5 / 24 * 100, '分层率按H列进尺');
  assert.equal(normalized.layers[0].raw_layer_notes.stop_run_core_m, null);
  assert.equal(normalized.layers[0].raw_layer_notes.source_O_unlabeled, null);
  assert.equal(normalized.layers[0].source.raw['分层进尺_m'], 24, '源数据按字段名与实际列坐标保留');
  assert.equal(normalized.samples[0].length_m, 1, '样品几何仍按深度区间');
  assert.equal(normalized.samples[0].recovery_percent, 46, '采样率按I列手填进尺');
  assert.ok(result.issues.some(item => item.code === 'ROUND_ADVANCE_MISMATCH'));
  assert.ok(result.issues.some(item => item.code === 'LAYER_ADVANCE_MISMATCH'));
  assert.ok(result.issues.some(item => item.code === 'SAMPLE_ADVANCE_MISMATCH'));
});

test('Excel日期仅按日期样式或t=d转换，兼容1900/1904日期系统且普通数值不变', async () => {
  const bytes = integratedWorkbook({ version: 'v3' });
  const files = unzipSync(bytes);
  files['xl/styles.xml'] = encoder.encode('<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="164" applyNumberFormat="1"/></cellXfs></styleSheet>');
  files['xl/workbook.xml'] = encoder.encode(new TextDecoder().decode(files['xl/workbook.xml']).replace('<sheets>', '<workbookPr date1904="1"/><sheets>'));
  const resultFile = `xl/worksheets/sheet${INTEGRATED_DRILL_SHEETS.indexOf('样品测试结果') + 1}.xml`;
  let resultXml = new TextDecoder().decode(files[resultFile]).replace('r="H6"', 'r="H6" s="1"');
  resultXml = resultXml.replace('</sheetData>', '<row r="7"><c r="H7" t="d"><v>2026-10-10</v></c><c r="K7"><v>123</v></c></row></sheetData>');
  files[resultFile] = encoder.encode(resultXml);
  const workbook = await parse(zipSync(files));
  const rows = workbook.sheets.get('样品测试结果').rows;
  assert.equal(rows.find(row => row.row === 6).cells.H6, '2030-10-10', '1904系统序列按1904-01-01纪元处理');
  assert.equal(rows.find(row => row.row === 7).cells.H7, '2026-10-10', 't=d ISO日期按原文保留');
  assert.equal(rows.find(row => row.row === 7).cells.K7, 123, '无日期样式的普通数值不转换');

  files['xl/workbook.xml'] = encoder.encode(new TextDecoder().decode(files['xl/workbook.xml']).replace(' date1904="1"', ''));
  files[resultFile] = encoder.encode(new TextDecoder().decode(files[resultFile]).replace('<row r="7">', '<row r="7">').replace('r="H6" s="1"', 'r="H6" s="1"'));
  const serialTest = await parse(zipSync(files));
  assert.equal(serialTest.sheets.get('样品测试结果').rows.find(row => row.row === 6).cells.H6, '2026-10-09', '1900系统正确修正闰年偏差');
});

test('非整合模板继续拒绝公式单元格', async () => {
  const files = unzipSync(integratedWorkbook());
  const workbookXml = new TextDecoder().decode(files['xl/workbook.xml']).replace('name="图面示意"', 'name="非模板页"');
  files['xl/workbook.xml'] = encoder.encode(workbookXml);
  await assert.rejects(parse(zipSync(files)), /是公式；请粘贴计算后的值/);
});
