export type DataTableSection = {
  key: string;
  title: string;
  columns: Array<{ key: string; label: string; unit?: string }>;
  rows: Array<Record<string, unknown>>;
};

const COMMON: Record<string, [string, string?]> = {
  id: ['记录号'], leg_id: ['测段号'], layer_id: ['层段号'], record_id: ['关联记录'],
  lithology_name: ['岩性'], description: ['描述'], material_code: ['材料代码'], pattern_id: ['花纹代码'],
  start_node: ['起点节点'], end_node: ['终点节点'], node: ['节点'], position: ['位置'], location_status: ['定位状态'],
  length_m: ['测段长度', 'm'], slant_m: ['斜距', 'm'], start_m: ['起始里程', 'm'], end_m: ['终止里程', 'm'],
  top_m: ['顶深', 'm'], bottom_m: ['底深', 'm'], thickness_m: ['层段长（沿孔）', 'm'],
  advance_m: ['进尺', 'm'], core_m: ['岩心长', 'm'], recovery_percent: ['采取率', '%'],
  recovery_raw_percent: ['原填采取率', '%'], recovery_original_percent: ['原填采取率（兼容）', '%'],
  slope_deg: ['坡角', '°'], azimuth_deg: ['方位角', '°'], dip_direction_deg: ['倾向', '°'], dip_angle_deg: ['倾角', '°'],
  depth_m: ['深度', 'm'], diameter_mm: ['孔径', 'mm'],
  horizontal_m: ['水平距', 'm'], vertical_m: ['高差', 'm'], east_delta_m: ['东向偏移', 'm'], north_delta_m: ['北向偏移', 'm'], true_thickness_m: ['真厚度', 'm'],
  position_x_m: ['样品位置 X', 'm'], position_z_m: ['样品位置 Z', 'm'],
  sheet: ['来源工作表'], row: ['来源行'], cells: ['来源单元格'], source: ['来源'], source_cells: ['来源单元格'],
  Au: ['Au', '未提供'], Pb: ['Pb', '未提供'], Zn: ['Zn', '未提供'],
};

function displaySource(row: Record<string, unknown>) {
  const source = row.source;
  const cells = row.source_cells;
  if (source && typeof source === 'object' && !Array.isArray(source)) {
    const s = source as Record<string, unknown>;
    const cellText = (value: unknown) => Array.isArray(value) ? value.join('、') : value && typeof value === 'object' ? Object.values(value as Record<string, unknown>).map(String).join('、') : value;
    const items = [s.sheet && `工作表 ${s.sheet}`, s.row && `第 ${s.row} 行`, s.cells && `单元格 ${cellText(s.cells)}`].filter(Boolean);
    if (items.length) return items.join(' · ');
  }
  if (Array.isArray(cells)) return cells.length ? cells.map(value => typeof value === 'string' ? value : JSON.stringify(value)).join('、') : '未提供';
  if (cells && typeof cells === 'object') {
    const values = Object.entries(cells as Record<string, unknown>).map(([label, cell]) => `${label}：${typeof cell === 'string' ? cell : JSON.stringify(cell)}`);
    return values.length ? values.join('、') : '未提供';
  }
  if (cells) return String(cells);
  return '未提供';
}

function asRows(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item)) : [];
}

function section(title: string, key: string, fields: string[], value: unknown, options: { units?: unknown; flattenAssays?: boolean; analytes?: Array<Record<string, unknown>>; includeRaw?: boolean } = {}): DataTableSection {
  const rawRows = asRows(value);
  const rows = rawRows.map(row => ({
    ...row,
    ...(options.flattenAssays ? row.assays && typeof row.assays === 'object' ? row.assays as Record<string, unknown> : {} : {}),
    ...(options.includeRaw && row.raw && typeof row.raw === 'object' && !Array.isArray(row.raw)
      ? Object.fromEntries(Object.entries(row.raw as Record<string, unknown>).map(([key, value]) => [`原表字段：${key}`, value]))
      : {}),
    ...(row.position && typeof row.position === 'object' && !Array.isArray(row.position) ? Object.fromEntries(Object.entries(row.position as Record<string, unknown>).map(([key, value]) => [`position_${key}`, value])) : {}),
  }));
  const units = options.units;
  const unitFor = (field: string) => {
    if (units && typeof units === 'object' && !Array.isArray(units)) return (units as Record<string, unknown>)[field];
    if (Array.isArray(units)) {
      const row = units.find(item => item && typeof item === 'object' && [((item as any).analyte), ((item as any).element), ((item as any).name)].includes(field));
      return row && typeof row === 'object' ? (row as Record<string, unknown>).unit : undefined;
    }
    return undefined;
  };
  const columns = fields.map(field => {
    const [label, defaultUnit] = COMMON[field] ?? [field];
    const assayValue = ['Au', 'Pb', 'Zn'].includes(field) ? unitFor(field) : undefined;
    const assayUnit = typeof assayValue === 'string' ? assayValue : undefined;
    const unit = assayUnit ?? defaultUnit;
    return { key: field, label, ...(unit ? { unit } : {}) };
  });
  for (const item of options.analytes ?? []) {
    const code = String(item.code ?? '');
    if (!code || columns.some(column => column.key === code)) continue;
    columns.push({ key: code, label: `${String(item.name || code)} [${code}]`, ...(item.unit ? { unit: String(item.unit) } : {}) });
  }
  if (options.includeRaw) {
    const rawKeys = [...new Set(rawRows.flatMap(row => row.raw && typeof row.raw === 'object' && !Array.isArray(row.raw)
      ? Object.keys(row.raw as Record<string, unknown>).map(name => `原表字段：${name}`) : []))];
    for (const rawKey of rawKeys) if (!columns.some(column => column.key === rawKey)) columns.push({ key: rawKey, label: rawKey.replace(/^原表字段：/, '') });
  }
  columns.push({ key: 'source_display', label: '来源位置' });
  return { key, title, columns, rows: rows.map(row => ({ ...row, source_display: displaySource(row) })) };
}

export function industryDataSections(kind: 'section' | 'drill', normalized: Record<string, unknown>): DataTableSection[] {
  if (kind === 'section') return [
    section('测段记录', 'records', ['id', 'leg_id', 'layer_id', 'length_m', 'slope_deg', 'azimuth_deg', 'dip_direction_deg', 'dip_angle_deg', 'lithology_name', 'description'], normalized.records),
    section('地层层段', 'intervals', ['id', 'layer_id', 'start_node', 'end_node', 'lithology_name', 'description'], normalized.intervals),
    section('测站与节点', 'stations', ['id', 'node'], normalized.stations),
    section('产状记录', 'attitudes', ['id', 'node', 'dip_direction_deg', 'dip_angle_deg'], normalized.attitudes),
    section('样品记录', 'samples', ['id', 'record_id', 'layer_id', 'position_x_m', 'position_z_m', 'location_status'], normalized.samples),
  ];
  if (normalized.schema_version === 'drill-integrated-1.0') {
    const autoRecovery = normalized.template_version === 'v3' || (normalized.source as any)?.template_version === 'v3';
    const recoveryColumns = autoRecovery ? [] : ['recovery_raw_percent'];
    const resultFlagColumns = autoRecovery ? [] : ['flag'];
    const items = Array.isArray(normalized.analysis_items) ? normalized.analysis_items as Array<Record<string, unknown>> : [];
    const samples = asRows(normalized.samples);
    const analysisResults = samples.flatMap(sample => asRows(sample.assay_records).map(result => ({ sample_id: sample.id, ...result, raw: result.source && typeof result.source === 'object' ? (result.source as any).raw : {} })));
    const basic = normalized.basic_info as any;
    const basicRows = Object.entries(basic?.fields ?? {}).map(([label, value]) => ({ label, value, source: basic?.source_cells?.[label] }));
    const basicSummaryRows = Object.entries(basic?.summary ?? {}).map(([label, item]: [string, any]) => ({ label, value: item?.value, formula: item?.formula, source: item?.source }));
    const titleBlock = normalized.title_block as any;
    const titleRows = Object.entries(titleBlock?.fields ?? {}).map(([label, value]) => ({ label, value, source: titleBlock?.source_cells?.[label] }));
    const summary = normalized.depth_measurements as any;
    const summaryRows = Object.entries(summary?.summary ?? {}).map(([label, item]: [string, any]) => ({ label, value: item?.value, formula: item?.formula, source: item?.source, label_source: item?.label_source }));
    return [
      section('钻孔基本信息', 'basic_info', ['label', 'value', 'source'], basicRows),
      section('钻孔基本信息汇总', 'basic_summary', ['label', 'value', 'formula', 'source'], basicSummaryRows),
      section('分析项目定义', 'analysis_items', ['code', 'name', 'unit', 'order', 'detection_limit', 'method', 'show', 'notes'], items, { includeRaw: true }),
      section('地层分层', 'layers', ['id', 'top_m', 'bottom_m', 'thickness_m', 'core_m', 'recovery_percent', ...recoveryColumns, 'lithology_name', 'material_code', 'pattern_id', 'description'], normalized.layers, { includeRaw: true }),
      section('钻进回次', 'turns', ['id', 'top_m', 'bottom_m', 'advance_m', 'core_m', 'recovery_percent', ...recoveryColumns], normalized.turns, { includeRaw: true }),
      section('样品记录', 'samples', ['id', 'top_m', 'bottom_m', 'length_m', 'core_m', 'recovery_percent', ...recoveryColumns], normalized.samples, { units: (normalized.project as any)?.analysis_units, flattenAssays: true, analytes: items, includeRaw: true }),
      section('样品测试结果原文与来源', 'analysis_results', ['sample_id', 'code', 'result_raw', 'value', ...resultFlagColumns, 'unit', 'detection_limit', 'method', 'test_date', 'report_number', 'notes'], analysisResults, { includeRaw: true }),
      section('孔深校正及弯曲度记录', 'depth_measurements', ['sequence', 'recorded_depth_m', 'checked_depth_m', 'error_m', 'error_percent', 'measurement_depth_m', 'zenith_deg', 'azimuth_deg', 'method', 'instrument'], summary?.records, { includeRaw: true }),
      section('孔深校正及弯曲度汇总', 'depth_summary', ['label', 'value', 'formula', 'source', 'label_source'], summaryRows),
      section('测点签名', 'depth_signatures', ['label', 'value', 'source'], Object.entries(summary?.signatures ?? {}).map(([label, item]: [string, any]) => ({ label, ...item }))),
      section('图签字段', 'title_block', ['label', 'value', 'source'], titleRows),
      section('图签布局参数', 'title_settings', ['layout_item', 'width_mm', 'height_mm', 'order', 'description'], titleBlock?.settings),
      section('图签布局汇总', 'title_settings_summary', ['label', 'value', 'formula', 'source'], [
        { label: '参考总宽_mm', value: titleBlock?.settings_summary?.reference_total_width_mm, formula: titleBlock?.settings_summary?.reference_total_width_formula, source: titleBlock?.settings_summary?.source_cells?.reference_total_width_mm },
        { label: '字段行高_mm', value: titleBlock?.settings_summary?.row_height_mm, formula: null, source: titleBlock?.settings_summary?.source_cells?.row_height_mm },
      ]),
      section('分层-地质综合原始记录（独立页）', 'synthesis_source', [], (normalized.source_tables as any)?.['分层-地质综合'], { includeRaw: true }),
    ];
  }
  return [
    section('地层分层', 'layers', ['id', 'top_m', 'bottom_m', 'thickness_m', 'core_m', 'recovery_percent', 'lithology_name', 'material_code', 'pattern_id', 'description'], normalized.layers),
    section('钻进回次', 'turns', ['id', 'top_m', 'bottom_m', 'advance_m', 'core_m', 'recovery_percent'], normalized.turns),
    section('样品记录', 'samples', ['id', 'top_m', 'bottom_m', 'length_m', 'core_m', 'recovery_percent', 'Au', 'Pb', 'Zn'], normalized.samples, { units: (normalized.project as any)?.analysis_units, flattenAssays: true }),
    section('孔内结构', 'structures', ['depth_m', 'diameter_mm'], normalized.structures),
  ];
}

export function formatIndustryCell(value: unknown): string {
  if (value === null || value === undefined || value === '') return '未提供';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '未提供';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (Array.isArray(value)) return value.length ? value.map(formatIndustryCell).join('、') : '未提供';
  if (typeof value === 'object') return '详见来源追溯';
  return String(value);
}
