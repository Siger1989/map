import { rowsByHeader, projectParameters } from './xlsx.ts';
import type { GeologyIssue, ImportResult, XlsxRow, XlsxValue, XlsxWorkbook } from './types.ts';

export const SECTION_PARAMETERS = ['项目名称', '剖面编号', '剖面方位角_deg', '长度单位', '角度单位'];
export const SECTION_COLUMNS = ['记录号', '导线段号', '层号', '起读数_m', '止读数_m', '斜距_m', '坡角_deg', '方位角_deg', '倾向_deg', '倾角_deg', '岩性名称', '岩性描述', '样品编号', '样品距测段起点_m', '原表平距_m', '原表高差_m', '原表累计高差_m', '原表累计北_m', '原表累计东_m', '实测真厚度_m'];

const blank = (v: unknown): boolean => v == null || (typeof v === 'string' && !v.trim());
const text = (v: unknown): string => v == null ? '' : String(v).trim();
const reprFloat = (n: number): string => Number.isInteger(n) ? `${n}.0` : String(n);
const cell = (row: XlsxRow, field: string, col: Record<string, string>): string => col[field] ?? `测段!A${row.row}`;
function issue(severity: GeologyIssue['severity'], code: string, message: string, cells: string[] = []): GeologyIssue {
  return { severity, code, message, ...(cells.length ? { cells } : {}) };
}
function number(v: XlsxValue, at: string, issues: GeologyIssue[], required = false): number | null {
  if (blank(v)) { if (required) issues.push(issue('error', 'MISSING_GEOMETRY', `${at} 缺少必需几何值`, [at])); return null; }
  if (typeof v === 'boolean') { issues.push(issue('error', 'INVALID_NUMBER', `${at} 的 TRUE/FALSE 不是有效数字`, [at])); return null; }
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  if (!Number.isFinite(n)) { issues.push(issue('error', 'INVALID_NUMBER', `${at} 不是有效数字`, [at])); return null; }
  return n;
}
function cacheWarning(issues: GeologyIssue[], at: string, label: string, raw: XlsxValue, calculated: number): void {
  if (blank(raw)) return;
  const n = number(raw, at, []);
  if (n == null) { issues.push(issue('warning', 'INVALID_CACHE_VALUE', `${at} 的${label}缓存不是数字，已保留原值`, [at])); return; }
  const residual = n - calculated;
  if (Math.abs(residual) > 1e-6) issues.push(issue('warning', 'CACHE_MISMATCH', `${label}缓存 ${reprFloat(n)} 与独立计算 ${reprFloat(calculated)} 的残差为 ${reprFloat(residual)}`, [at]));
}
function failIfErrors(issues: GeologyIssue[]): void {
  if (issues.some(i => i.severity === 'error')) {
    const error = new Error(issues.filter(i => i.severity === 'error').slice(0, 5).map(i => `${i.cells?.join(',') || ''} ${i.message}`).join('；')) as Error & { issues: GeologyIssue[] };
    error.issues = issues; throw error;
  }
}
function parseLeg(value: string): [string, string] | null {
  const match = value.match(/^\s*([^\s\-—–]+)\s*[\-—–]\s*([^\s\-—–]+)\s*$/);
  return match ? [match[1], match[2]] : null;
}

export function importSection(workbook: XlsxWorkbook): ImportResult {
  const issues: GeologyIssue[] = [...workbook.warnings];
  const project = workbook.sheets.get('项目'), segment = workbook.sheets.get('测段');
  if (!project || !segment) throw new Error('工作簿必须包含“项目”和“测段”工作表');
  const { params, cells: paramCells } = projectParameters(project);
  for (const key of SECTION_PARAMETERS) if (!Object.hasOwn(params, key)) issues.push(issue('error', 'MISSING_PROJECT_PARAMETER', `项目表缺少参数：${key}`, ['项目!A:A']));
  if (text(params['长度单位']) !== 'm') issues.push(issue('error', 'INVALID_LENGTH_UNIT', '长度单位必须为 m', [paramCells['长度单位'] ?? '项目!B:B']));
  if (text(params['角度单位']) !== 'deg') issues.push(issue('error', 'INVALID_ANGLE_UNIT', '角度单位必须为 deg', [paramCells['角度单位'] ?? '项目!B:B']));
  const table = rowsByHeader(segment, '测段');
  const duplicates = [...new Set(table.headers.filter(h => h && table.headers.filter(x => x === h).length > 1))];
  const missing = SECTION_COLUMNS.filter(name => !table.headers.includes(name));
  if (duplicates.length) issues.push(issue('error', 'DUPLICATE_COLUMN', `测段表存在重复列名：${duplicates.join(', ')}`, ['测段!1:1']));
  if (missing.length) issues.push(issue('error', 'MISSING_COLUMN', `测段表缺少列：${missing.join(', ')}`, ['测段!1:1']));
  if (issues.some(i => i.severity === 'error')) failIfErrors(issues);

  const input = table.rows;
  if (!input.length) issues.push(issue('error', 'NO_RECORDS', '工作簿没有测段记录', []));
  let previousLeg = '', previousLayer = '', previousDescription = '', previousLithology = '';
  let previousLegCell = '', previousLayerCell = '', previousDescriptionCell = '', previousLithologyCell = '';
  const records: any[] = [];
  let east = 0, north = 0, z = 0, horizontalChainage = 0, slantChainage = 0;
  input.forEach((row, index) => {
    const v = row.values, c = row.cells;
    const explicitLeg = text(v['导线段号']), explicitLayer = text(v['层号']);
    const legCell = cell(row, '导线段号', c), layerCell = cell(row, '层号', c);
    const leg = explicitLeg || previousLeg, layer = explicitLayer || previousLayer;
    const legSource = explicitLeg ? legCell : previousLegCell;
    const layerSource = explicitLayer ? layerCell : previousLayerCell;
    if (explicitLeg) { previousLeg = explicitLeg; previousLegCell = legCell; }
    if (explicitLayer) { previousLayer = explicitLayer; previousLayerCell = layerCell; }
    const ref = (field: string): string => cell(row, field, c);
    if (!leg) issues.push(issue('error', 'MISSING_LEG_ID', '测量行缺少导线段号且无法继承', [legCell]));
    if (!layer) issues.push(issue('error', 'MISSING_LAYER_ID', '测量行缺少层号且无法继承', [layerCell]));
    const length = number(v['斜距_m'], ref('斜距_m'), issues, true);
    const slope = number(v['坡角_deg'], ref('坡角_deg'), issues, true);
    const azimuth = number(v['方位角_deg'], ref('方位角_deg'), issues, true);
    const dipDirection = blank(v['倾向_deg']) ? null : number(v['倾向_deg'], ref('倾向_deg'), issues);
    const dipAngle = blank(v['倾角_deg']) ? null : number(v['倾角_deg'], ref('倾角_deg'), issues);
    if (length != null && length <= 0) issues.push(issue('error', 'INVALID_LENGTH', '斜距必须大于 0', [ref('斜距_m')]));
    if (slope != null && (slope < -90 || slope > 90)) issues.push(issue('error', 'INVALID_SLOPE', '坡角必须在 [-90, 90]', [ref('坡角_deg')]));
    if (azimuth != null && (azimuth < 0 || azimuth >= 360)) issues.push(issue('error', 'INVALID_AZIMUTH', '方位角必须在 [0, 360)', [ref('方位角_deg')]));
    if ((dipDirection == null) !== (dipAngle == null)) issues.push(issue('error', 'INCOMPLETE_ATTITUDE', '倾向和倾角必须同时提供或同时留空', [ref('倾向_deg'), ref('倾角_deg')]));
    if (dipDirection != null && (dipDirection < 0 || dipDirection >= 360)) issues.push(issue('error', 'INVALID_DIP_DIRECTION', '倾向必须在 [0, 360)', [ref('倾向_deg')]));
    if (dipAngle != null && (dipAngle < 0 || dipAngle > 90)) issues.push(issue('error', 'INVALID_DIP_ANGLE', '倾角必须在 [0, 90]', [ref('倾角_deg')]));
    const thickness = blank(v['实测真厚度_m']) ? null : number(v['实测真厚度_m'], ref('实测真厚度_m'), issues);
    if (thickness != null && thickness < 0) issues.push(issue('error', 'INVALID_TRUE_THICKNESS', '实测真厚度不得小于 0', [ref('实测真厚度_m')]));
    if (length == null || slope == null || azimuth == null || length <= 0 || slope < -90 || slope > 90 || azimuth < 0 || azimuth >= 360) return;
    const startRaw = v['起读数_m'], endRaw = v['止读数_m'];
    if (blank(startRaw) !== blank(endRaw)) issues.push(issue('warning', 'INCOMPLETE_READING_PAIR', '起读数和止读数只提供了一项，已保留原值且不推断另一项', [blank(startRaw) ? ref('止读数_m') : ref('起读数_m')]));
    else if (!blank(startRaw)) {
      const start = number(startRaw, ref('起读数_m'), []), end = number(endRaw, ref('止读数_m'), []);
      if (start == null || end == null) issues.push(issue('warning', 'INVALID_READING_CACHE', '起止读数必须是有限数字，已保留原值', [ref('起读数_m'), ref('止读数_m')]));
      else if (Math.abs((end - start) - length) > 1e-6) issues.push(issue('warning', 'READING_LENGTH_MISMATCH', `止读数减起读数与斜距的残差为 ${reprFloat((end - start) - length)}，保留原值并采用斜距计算`, [ref('起读数_m'), ref('止读数_m'), ref('斜距_m')]));
    }
    const slopeRad = slope * Math.PI / 180, azimuthRad = azimuth * Math.PI / 180;
    const horizontal = length * Math.cos(slopeRad), vertical = length * Math.sin(slopeRad);
    const eastDelta = horizontal * Math.sin(azimuthRad), northDelta = horizontal * Math.cos(azimuthRad);
    east += eastDelta; north += northDelta; z += vertical; horizontalChainage += horizontal; slantChainage += length;
    const sameLayer = layer === (records.at(-1)?.layer_id ?? '');
    let description = text(v['岩性描述']), lithology = text(v['岩性名称']);
    let descCell = ref('岩性描述'), lithCell = ref('岩性名称');
    if (!description && sameLayer && previousDescription) { description = previousDescription; descCell = previousDescriptionCell; }
    if (!lithology && sameLayer && previousLithology) { lithology = previousLithology; lithCell = previousLithologyCell; }
    if (!sameLayer) { previousDescription = ''; previousLithology = ''; previousDescriptionCell = ''; previousLithologyCell = ''; }
    if (description) { previousDescription = description; previousDescriptionCell = descCell; }
    if (lithology) { previousLithology = lithology; previousLithologyCell = lithCell; }
    const id = text(v['记录号']) || `R${String(index + 1).padStart(4, '0')}`;
    if (records.some(r => r.id === id)) issues.push(issue('error', 'DUPLICATE_RECORD_ID', `记录号“${id}”重复`, [ref('记录号')]));
    const raw: Record<string, XlsxValue> = {};
    for (const [field, value] of Object.entries(v)) if (!blank(value)) raw[ref(field)] = value;
    const sourceCells: Record<string, string> = {
      record_id: ref('记录号'), leg_id: legSource || legCell, layer_id: layerSource || layerCell,
      start_reading_m: ref('起读数_m'), end_reading_m: ref('止读数_m'), length_m: ref('斜距_m'),
      slope_deg: ref('坡角_deg'), azimuth_deg: ref('方位角_deg'), dip_direction_deg: ref('倾向_deg'),
      dip_angle_deg: ref('倾角_deg'), lithology_name: lithCell, description: descCell, sample_id: ref('样品编号'),
      sample_offset_m: ref('样品距测段起点_m'), true_thickness_m: ref('实测真厚度_m'),
      cache_horizontal_m: ref('原表平距_m'), cache_vertical_m: ref('原表高差_m'),
      cache_cumulative_z_m: ref('原表累计高差_m'), cache_cumulative_north_m: ref('原表累计北_m'),
      cache_cumulative_east_m: ref('原表累计东_m'),
    };
    const record = { id, leg_id: leg, layer_id: layer, length_m: length, slope_deg: slope, azimuth_deg: azimuth,
      dip_direction_deg: dipDirection, dip_angle_deg: dipAngle, lithology_name: lithology, description,
      start_node: records.length, end_node: records.length + 1, raw, source_cells: sourceCells,
      computed: { horizontal_m: horizontal, vertical_m: vertical, east_delta_m: eastDelta, north_delta_m: northDelta }, true_thickness_m: thickness };
    records.push(record);
    const cache: Record<string, XlsxValue> = { horizontal_m: v['原表平距_m'], vertical_m: v['原表高差_m'], cumulative_z_m: v['原表累计高差_m'], cumulative_north_m: v['原表累计北_m'], cumulative_east_m: v['原表累计东_m'] };
    for (const [key, label, cellKey, calculated] of [
      ['horizontal_m', '平距', 'cache_horizontal_m', horizontal], ['vertical_m', '高差', 'cache_vertical_m', vertical],
      ['cumulative_z_m', '累计高差', 'cache_cumulative_z_m', z], ['cumulative_north_m', '累计北坐标', 'cache_cumulative_north_m', north],
      ['cumulative_east_m', '累计东坐标', 'cache_cumulative_east_m', east],
    ] as const) cacheWarning(issues, sourceCells[cellKey], label, cache[key], calculated);
  });
  failIfErrors(issues);
  const axisRaw = params['剖面方位角_deg'];
  let axis: number, axisMethod: string;
  if (blank(axisRaw)) {
    if (Math.hypot(east, north) <= 1e-12) throw new Error('首末点重合，必须显式设置剖面方位角');
    axis = Math.atan2(east, north) * 180 / Math.PI % 360; if (axis < 0) axis += 360; axisMethod = 'endpoint';
  } else {
    const n = number(axisRaw, paramCells['剖面方位角_deg'] ?? '项目!B:B', issues);
    if (n == null || n < 0 || n >= 360) { issues.push(issue('error', 'INVALID_AXIS_AZIMUTH', '剖面方位角必须在 [0, 360)', [paramCells['剖面方位角_deg'] ?? '项目!B:B'])); failIfErrors(issues); }
    axis = n as number; axisMethod = 'explicit';
  }
  const axisRad = axis * Math.PI / 180;
  const nodes: any[] = [{ index: 0, east_m: 0, north_m: 0, z_m: 0, x_m: 0, offset_m: 0, chainage_m: 0, slant_chainage_m: 0 }];
  let ce = 0, cn = 0, cz = 0, ch = 0, cs = 0;
  for (const r of records) {
    ce += r.computed.east_delta_m; cn += r.computed.north_delta_m; cz += r.computed.vertical_m; ch += r.computed.horizontal_m; cs += r.length_m;
    nodes.push({ index: nodes.length, east_m: ce, north_m: cn, z_m: cz, x_m: ce * Math.sin(axisRad) + cn * Math.cos(axisRad),
      offset_m: cn * Math.sin(axisRad) - ce * Math.cos(axisRad), chainage_m: ch, slant_chainage_m: cs });
  }
  const intervals: any[] = [];
  for (const r of records) {
    const layerCell = r.source_cells.layer_id, lithCell = r.source_cells.lithology_name, descCell = r.source_cells.description;
    if (!intervals.length || intervals.at(-1).layer_id !== r.layer_id) intervals.push({ id: `I${String(intervals.length + 1).padStart(4, '0')}`, layer_id: r.layer_id,
      start_node: r.start_node, end_node: r.end_node, record_ids: [r.id], lithology_name: r.lithology_name, description: r.description,
      source_cells: { layer_id: [layerCell], lithology_name: [lithCell], description: [descCell] } });
    else {
      const it = intervals.at(-1);
      if (it.lithology_name && r.lithology_name && it.lithology_name !== r.lithology_name) issues.push(issue('error', 'LITHOLOGY_CONFLICT', `连续层段 ${r.layer_id} 内存在不同明确岩性名称，请分层或修正层号`, [it.source_cells.lithology_name[0], lithCell]));
      else if (!it.lithology_name && r.lithology_name) it.lithology_name = r.lithology_name;
      it.end_node = r.end_node; it.record_ids.push(r.id);
      for (const [key, value] of [['layer_id', layerCell], ['description', descCell]] as const) if (!it.source_cells[key].includes(value)) it.source_cells[key].push(value);
    }
  }
  failIfErrors(issues);
  const attitudes: any[] = []; let lastAttitude = '';
  for (const r of records) {
    if (r.dip_direction_deg == null) { lastAttitude = ''; continue; }
    const key = `${r.layer_id}\u0000${r.dip_direction_deg}\u0000${r.dip_angle_deg}`;
    if (key !== lastAttitude) attitudes.push({ id: `A${String(attitudes.length + 1).padStart(4, '0')}`, record_id: r.id, layer_id: r.layer_id,
      node: r.start_node, dip_direction_deg: r.dip_direction_deg, dip_angle_deg: r.dip_angle_deg, location_basis: 'record_start_association' });
    lastAttitude = key;
  }
  const samples: any[] = [];
  input.forEach((row, index) => {
    const r = records[index]; if (!r) return;
    const id = text(row.values['样品编号']), offset = row.values['样品距测段起点_m'];
    if (!id) { if (!blank(offset)) issues.push(issue('warning', 'ORPHAN_SAMPLE_OFFSET', '提供了样品距离但没有样品编号，未创建样品', [row.cells['样品距测段起点_m']])); return; }
    const sourceCells = { sample_id: row.cells['样品编号'], sample_offset_m: row.cells['样品距测段起点_m'] };
    if (blank(offset)) { samples.push({ id, record_id: r.id, layer_id: r.layer_id, position: null, location_status: 'missing', source_cells: sourceCells }); return; }
    const along = number(offset, sourceCells.sample_offset_m, issues);
    if (along == null || along < 0 || along > r.length_m) { issues.push(issue('error', 'INVALID_SAMPLE_OFFSET', '样品距测段起点必须在 [0, 斜距]', [sourceCells.sample_offset_m])); return; }
    const ratio = along / r.length_m, start = nodes[r.start_node], end = nodes[r.end_node];
    const position: Record<string, number> = {};
    for (const k of ['east_m', 'north_m', 'z_m', 'x_m', 'offset_m']) position[k] = start[k] + (end[k] - start[k]) * ratio;
    samples.push({ id, record_id: r.id, layer_id: r.layer_id, position, location_status: 'explicit_offset', source_cells: sourceCells });
  });
  failIfErrors(issues);
  const stations: any[] = []; let currentEnd: string | null = null, prevLeg: string | null = null;
  for (const r of records) {
    if (r.leg_id === prevLeg) continue;
    const parsed = parseLeg(r.leg_id), sourceCell = r.source_cells.leg_id;
    let start: string, end: string;
    if (!parsed) { issues.push(issue('warning', 'UNPARSEABLE_LEG_ID', `导线段号“${r.leg_id}”无法拆为起点-终点，使用自动站号`, [sourceCell])); start = `AUTO-${r.start_node}`; end = `AUTO-${r.end_node}`; currentEnd = null; }
    else { [start, end] = parsed; if (currentEnd != null && start !== currentEnd) issues.push(issue('error', 'DISCONNECTED_STATIONS', `导线段 ${r.leg_id} 与前一可拆导线段不相接`, [sourceCell])); currentEnd = end; }
    if (!stations.length || stations.at(-1).node !== r.start_node) stations.push({ id: start, node: r.start_node, source_cell: sourceCell });
    prevLeg = r.leg_id;
  }
  if (records.length) stations.push({ id: currentEnd ?? `AUTO-${records.length}`, node: records.length, source_cell: records.at(-1).source_cells.leg_id });
  failIfErrors(issues);
  const end = nodes.at(-1);
  const normalized = { schema_version: '1.0', source: { filename: workbook.filename, sha256: workbook.sha256, adapter: 'canonical_xlsx_v1', sheet: '测段' },
    project: { name: text(params['项目名称']), section_id: text(params['剖面编号']) },
    settings: { axis_azimuth_deg: axis, axis_method: axisMethod, coordinate_system: 'local_relative', vertical_exaggeration: 1 },
    records, nodes, intervals, stations, attitudes, samples, issues,
    summary: { records: records.length, intervals: intervals.length, stations: stations.length, samples: samples.length,
      located_samples: samples.filter(s => s.position != null).length, total_slant_m: records.reduce((a, r) => a + r.length_m, 0),
      total_horizontal_m: records.reduce((a, r) => a + r.computed.horizontal_m, 0), total_vertical_m: end.z_m,
      endpoint_east_m: end.east_m, endpoint_north_m: end.north_m, axis_azimuth_deg: axis, projected_endpoint_m: end.x_m } };
  return { normalized, issues };
}
