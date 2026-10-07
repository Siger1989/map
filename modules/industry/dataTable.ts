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

function section(title: string, key: string, fields: string[], value: unknown, options: { units?: unknown; flattenAssays?: boolean } = {}): DataTableSection {
  const rawRows = asRows(value);
  const rows = rawRows.map(row => ({
    ...row,
    ...(options.flattenAssays ? row.assays && typeof row.assays === 'object' ? row.assays as Record<string, unknown> : {} : {}),
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
