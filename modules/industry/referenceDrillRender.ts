import { drillDefs, drillPattern, esc, fmt, text } from './patterns.ts';
import patternCatalog from './templates/drill-patterns.json' with { type: 'json' };

const LEFT = 28;
const HEADER_TOP = 272;
const HEADER_HEIGHT = 158;
const BODY_TOP = HEADER_TOP + HEADER_HEIGHT;
const DEPTH_SCALE_AT_100 = 80 / 3;
const FONT = "SimSun,'宋体','Microsoft YaHei',serif";

type Column = { key: string; width: number };
type Cell = { x: number; y: number; width: number; height: number; label: string; vertical?: boolean; size?: number; weight?: string };

function safeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isFinite(parsed) ? parsed : null;
}
function scaleValue(value: unknown): number | null {
  const numeric = safeNumber(value);
  if (numeric != null) return numeric;
  const match = text(value).match(/(?:1\s*[:：]\s*)?([\d,]+(?:\.\d+)?)/);
  if (!match) return null;
  const parsed = Number(match[1].replaceAll(',', ''));
  return Number.isFinite(parsed) ? parsed : null;
}
function valueText(value: unknown, digits = 2): string {
  const n = safeNumber(value);
  if (n !== null) return n.toFixed(digits);
  return value == null ? '' : String(value).trim();
}
function bodyFont(value: unknown, width: number, base = 14): number {
  const label = value == null ? '' : String(value);
  const units = [...label].reduce((sum, char) => sum + (/[^\u0000-\u00ff]/.test(char) ? 1 : 0.58), 0);
  return Math.max(11, Math.min(base, (width - 6) / Math.max(units, 1)));
}
function friendlyDate(value: unknown): string {
  const raw = text(value).trim();
  const match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  return match ? `${match[1]}年${Number(match[2])}月${Number(match[3])}日` : raw;
}
function cell(x: number, y: number, width: number, height: number, label = '', options: Partial<Cell> = {}): string {
  const { vertical = false, size = 11, weight = 'normal' } = options;
  const box = `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="white" stroke="#222" stroke-width="0.7"/>`;
  if (!label) return box;
  if (vertical) {
    const tokens = [...label.matchAll(/（[^）]*）|\([^)]*\)|./gu)].map(match => match[0]);
    const topBaseline = y + 25 + size * 0.78;
    const bottomBaseline = y + height - 25;
    const step = tokens.length > 1 ? (bottomBaseline - topBaseline) / (tokens.length - 1) : size;
    const fontSize = tokens.length > 1 ? Math.min(size, step * 0.9) : size;
    const positions = tokens.length === 1
      ? [y + height / 2 + size * 0.34]
      : tokens.map((_, index) => topBaseline + (bottomBaseline - topBaseline) * index / (tokens.length - 1));
    return box + tokens.map((token, index) => `<text x="${x + width / 2}" y="${positions[index]}" text-anchor="middle" font-size="${fontSize}" font-weight="${weight}">${esc(token)}</text>`).join('');
  }
  return box + `<text x="${x + width / 2}" y="${y + height / 2 + size * 0.34}" text-anchor="middle" font-size="${size}" font-weight="${weight}">${esc(label)}</text>`;
}
function cellLines(x: number, y: number, width: number, height: number, labels: string[], size = 20): string {
  const box = `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="white" stroke="#222" stroke-width="0.7"/>`;
  const step = size * 1.3, start = y + height / 2 - (labels.length - 1) * step / 2 + size * 0.34;
  return box + labels.map((label, index) => `<text x="${x + width / 2}" y="${start + index * step}" text-anchor="middle" font-size="${size}">${esc(label)}</text>`).join('');
}
function textAt(x: number, y: number, value: unknown, size = 11, anchor = 'start', weight = 'normal'): string {
  if (value == null || value === '') return '';
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${size}" font-weight="${weight}">${esc(value)}</text>`;
}
function line(x1: number, y1: number, x2: number, y2: number, width = 0.6): string {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#222" stroke-width="${width}"/>`;
}
function patternId(layer: any): string {
  const data = patternCatalog as any;
  const patterns = data.patterns as Record<string, unknown>;
  const codes = data.codes as Record<string, string>;
  const id = text(layer.pattern_id);
  if (id && Object.hasOwn(patterns, id)) return `drill-${id}`;
  const material = text(layer.material_code), mapped = material && codes[material];
  if (mapped && Object.hasOwn(patterns, mapped)) return `drill-${mapped}`;
  return drillPattern(layer.lithology_name);
}
function displayElements(data: Record<string, any>): any[] {
  const source = Array.isArray(data.analysis_items) ? data.analysis_items : data.project?.analysis_items;
  if (!Array.isArray(source)) return [];
  const units = data.project?.analysis_units ?? {};
  return source
    .filter((item: any) => item?.show !== false)
    .map((item: any) => ({ ...item, unit: item?.unit ?? units[text(item?.code)] }))
    .sort((a: any, b: any) => Number(a.order ?? 0) - Number(b.order ?? 0) || text(a.code).localeCompare(text(b.code)));
}
function wrap(value: string, max: number): string[] {
  const output: string[] = [];
  for (const paragraph of value.split(/\r?\n/)) {
    if (!paragraph) { output.push(''); continue; }
    for (let offset = 0; offset < paragraph.length; offset += max) output.push(paragraph.slice(offset, offset + max));
  }
  return output;
}
function buildColumns(elements: any[]): { columns: Column[]; x: Record<string, number>; width: number } {
  const columns: Column[] = [
    { key: 'turn', width: 54 },
    { key: 'round_from', width: 54 }, { key: 'round_to', width: 54 }, { key: 'round_advance', width: 54 },
    { key: 'round_core', width: 54 }, { key: 'round_rate', width: 54 },
    { key: 'layer_id', width: 54 }, { key: 'layer_bottom', width: 54 }, { key: 'layer_thickness', width: 54 },
    { key: 'layer_core', width: 54 }, { key: 'layer_rate', width: 54 },
    { key: 'plot_margin', width: 27 }, { key: 'plot_pattern', width: 98 }, { key: 'plot_samples', width: 37 },
    { key: 'description', width: 486 }, { key: 'angle', width: 54 },
    { key: 'sample_id', width: 54 }, { key: 'sample_from', width: 54 }, { key: 'sample_to', width: 54 }, { key: 'sample_length', width: 54 },
    { key: 'sample_core', width: 54 }, { key: 'sample_rate', width: 54 },
    ...elements.map((item, index) => ({ key: `assay:${text(item.code) || index}`, width: 54 })),
    { key: 'structure', width: 108 }, { key: 'remarks', width: 108 },
  ];
  const x: Record<string, number> = {};
  let cursor = LEFT;
  for (const column of columns) { x[column.key] = cursor; cursor += column.width; }
  return { columns, x, width: cursor - LEFT };
}
function cellRange(x: Record<string, number>, columns: Column[], start: string, end: string): [number, number] {
  const startX = x[start], endX = x[end] + (columns.find(column => column.key === end)?.width ?? 0);
  return [startX, endX - startX];
}
function headerSvg(columns: Column[], x: Record<string, number>, elements: any[]): string {
  const out: string[] = [];
  const top = HEADER_TOP, groupH = 38, middleH = 42, lowY = top + groupH + middleH, lowH = HEADER_HEIGHT - groupH - middleH;
  const addCell = (start: string, end: string, y: number, h: number, label: string, vertical = false, size = 20) => {
    const [cx, width] = cellRange(x, columns, start, end);
    out.push(cell(cx, y, width, h, label, { vertical, size, weight: 'normal' }));
  };
  addCell('turn', 'turn', top, HEADER_HEIGHT, '回次', true);
  addCell('round_from', 'round_advance', top, groupH, '回次进尺（米）');
  for (const [key, label] of [['round_from','自'], ['round_to','至'], ['round_advance','进尺（米）']]) addCell(key, key, top + groupH, HEADER_HEIGHT - groupH, label, true, 20);
  addCell('round_core', 'round_rate', top, groupH, '岩芯采取');
  addCell('round_core', 'round_core', top + groupH, HEADER_HEIGHT - groupH, '岩芯长（米）', true, 20);
  addCell('round_rate', 'round_rate', top + groupH, HEADER_HEIGHT - groupH, '采取率（%）', true, 20);
  addCell('layer_id', 'layer_id', top, HEADER_HEIGHT, '层位', true);
  addCell('layer_bottom', 'layer_bottom', top, HEADER_HEIGHT, '换层深度（米）', true, 20);
  addCell('layer_thickness', 'layer_thickness', top, HEADER_HEIGHT, '分层厚度（米）', true, 20);
  addCell('layer_core', 'layer_core', top, HEADER_HEIGHT, '岩芯长（米）', true, 20);
  addCell('layer_rate', 'layer_rate', top, HEADER_HEIGHT, '分层采取率（%）', true, 20);
  addCell('plot_margin', 'plot_samples', top, HEADER_HEIGHT, '柱状图');
  addCell('description', 'description', top, HEADER_HEIGHT, '岩性描述');
  addCell('angle', 'angle', top, HEADER_HEIGHT, '标志面与岩芯轴的夹角', true, 18);
  addCell('sample_id', 'sample_length', top, groupH, '采样情况');
  addCell('sample_id', 'sample_id', top + groupH, HEADER_HEIGHT - groupH, '样品编号', true, 20);
  addCell('sample_from', 'sample_length', top + groupH, middleH, '采样位置（米）');
  for (const [key, label] of [['sample_from','自'], ['sample_to','至'], ['sample_length','样长']]) addCell(key, key, lowY, lowH, label, true, 20);
  addCell('sample_core', 'sample_core', top, HEADER_HEIGHT, '岩矿芯长', true, 20);
  addCell('sample_rate', 'sample_rate', top, HEADER_HEIGHT, '采取率（%）', true, 20);
  if (elements.length) {
    addCell(`assay:${text(elements[0].code) || 0}`, `assay:${text(elements.at(-1).code) || elements.length - 1}`, top, groupH, '分析结果');
    elements.forEach((item, index) => {
      const key = `assay:${text(item.code) || index}`;
      const y = top + groupH;
      const h = HEADER_HEIGHT - groupH;
      addCell(key, key, y, h, text(item.code) || text(item.name), false, 20);
      const unit = text(item.unit).trim();
      if (unit) out.push(textAt(x[key] + 27, y + h - 8, unit, 11, 'middle'));
    });
  }
  out.push(cellLines(x.structure, top, columns.find(item => item.key === 'structure')!.width, HEADER_HEIGHT, ['钻 孔','结 构']));
  out.push(cellLines(x.remarks, top, columns.find(item => item.key === 'remarks')!.width, HEADER_HEIGHT, ['备 注']));
  // Header outline and body column guides are drawn independently to keep the table grid continuous.
  out.push(`<rect x="${LEFT}" y="${top}" width="${columns.reduce((sum, column) => sum + column.width, 0)}" height="${HEADER_HEIGHT}" fill="none" stroke="#222" stroke-width="0.9"/>`);
  void lowH;
  return out.join('');
}
function footerSvg(data: Record<string, any>, x: number, y: number, width: number, denominator: number): { svg: string; height: number; audit: Record<string, unknown> } {
  const records = Array.isArray(data.depth_measurements?.records) ? data.depth_measurements.records : [];
  const fields = data.title_block?.fields ?? {};
  const leftWidth = width * 0.365, middleWidth = width * 0.31, rightWidth = width * 0.243;
  const leftGap = width * 0.014, rightGap = width - leftWidth - middleWidth - rightWidth - leftGap;
  const middleX = x + leftWidth + leftGap, rightX = x + width - rightWidth;
  const rowH = 32, titleY = y - 20, headerH = 64, maxRows = Math.max(records.length, 1);
  const bodyHeight = maxRows * rowH, titleBodyH = 7 * rowH;
  const out: string[] = [];
  out.push(textAt(x + leftWidth / 2, titleY, '孔深校正记录表', 20, 'middle'));
  out.push(textAt(middleX + middleWidth / 2, titleY, '弯曲度测量表', 20, 'middle'));
  const fittedSize = (value: string, maxWidth: number, base = 16) => {
    const units = [...value].reduce((sum, char) => sum + (/[\u0000-\u00ff]/.test(char) ? 0.58 : 1), 0);
    return Math.max(9, Math.min(base, (maxWidth - 8) / Math.max(units, 1)));
  };
  const drawHeaderCell = (cx: number, cy: number, cw: number, ch: number, label: string, size = 16) => {
    out.push(cell(cx, cy, cw, ch));
    out.push(textAt(cx + cw / 2, cy + ch / 2 + size * 0.34, label, fittedSize(label, cw, size), 'middle'));
  };
  const drawDataTable = (tx: number, tw: number, labels: string[], widths: number[], rows: string[][], headerRows: 1 | 2) => {
    let cx = tx;
    const headerTop = y, dataTop = y + headerH;
    if (headerRows === 1) {
      labels.forEach((label, index) => {
        const w = widths[index]; drawHeaderCell(cx, headerTop, w, 32, label); cx += w;
      });
    } else {
      const [sequenceW, recordW, correctedW, errorW, rateW] = widths;
      drawHeaderCell(tx, headerTop, sequenceW, headerH, labels[0]);
      drawHeaderCell(tx + sequenceW, headerTop, recordW + correctedW, 32, '孔深校正');
      drawHeaderCell(tx + sequenceW + recordW + correctedW, headerTop, errorW, headerH, labels[3]);
      drawHeaderCell(tx + sequenceW + recordW + correctedW + errorW, headerTop, rateW, headerH, labels[4]);
      drawHeaderCell(tx + sequenceW, headerTop + 32, recordW, 32, labels[1]);
      drawHeaderCell(tx + sequenceW + recordW, headerTop + 32, correctedW, 32, labels[2]);
    }
    const dataHeaderHeight = headerRows === 1 ? 32 : headerH;
    for (let r = 0; r < maxRows; r++) {
      cx = tx;
      const values = rows[r] ?? labels.map(() => '');
      values.forEach((value, index) => {
        const w = widths[index], cy = dataTop - (headerH - dataHeaderHeight) + r * rowH;
        out.push(cell(cx, cy, w, rowH));
        out.push(textAt(cx + w / 2, cy + rowH * 0.66, value, fittedSize(value, w, 16), 'middle')); cx += w;
      });
    }
  };
  const leftLabels = ['序号','记录孔深（米）','校正孔深（米）','误差（米）','误差率（‰）'];
  const leftWidths = [leftWidth * .13,leftWidth * .25,leftWidth * .25,leftWidth * .2,leftWidth * .17];
  const leftRows = records.map((record: any, index: number) => [
    valueText(record.sequence ?? index + 1, 0), valueText(record.recorded_depth_m, 2), valueText(record.checked_depth_m, 3), valueText(record.error_m, 3),
    record.error_percent == null ? '' : valueText(Number(record.error_percent) * 10, 3),
  ]);
  drawDataTable(x, leftWidth, leftLabels, leftWidths, leftRows, 2);
  const middleLabels = ['序号','校正孔深（米）','方位角（°）','倾角（°）','天顶角（°）'];
  const middleWidths = [middleWidth * .12,middleWidth * .28,middleWidth * .22,middleWidth * .2,middleWidth * .18];
  const middleRows = records.map((record: any, index: number) => [
    valueText(record.sequence ?? index + 1, 0), valueText(record.checked_depth_m, 3), valueText(record.azimuth_deg, 2),
    record.zenith_deg == null ? '' : valueText(90 - Number(record.zenith_deg), 2), valueText(record.zenith_deg, 2),
  ]);
  drawDataTable(middleX, middleWidth, middleLabels, middleWidths, middleRows, 1);
  const titleRowY = y;
  const leftLabelW = rightWidth * .18, leftValueW = rightWidth * .32, rightLabelW = rightWidth * .18, rightValueW = rightWidth * .32;
  const fullTitle = (row: number, value: unknown) => {
    const ry = titleRowY + row * rowH, label = value == null ? '' : String(value);
    out.push(cell(rightX, ry, rightWidth, rowH));
    out.push(textAt(rightX + rightWidth / 2, ry + rowH * .66, label, fittedSize(label, rightWidth, 16), 'middle'));
  };
  fullTitle(0, fields['项目/单位']);
  fullTitle(1, fields['图名']);
  const titlePairs: Array<[string, unknown, string, unknown]> = [
    ['拟编', fields['拟编'], '顺序号', fields['顺序号']],
    ['审核', fields['审核'], '图号', fields['图号']],
    ['制图', fields['制图'], '比例尺', `1:${denominator}`],
    ['项目负责', fields['项目负责'], '日期', friendlyDate(fields['日期'])],
    ['单位负责', fields['单位负责'], '资料来源', fields['资料来源']],
  ];
  titlePairs.forEach(([leftLabel, leftValue, rightLabel, rightValue], index) => {
    const ry = titleRowY + (index + 2) * rowH;
    const leftText = leftValue == null ? '' : String(leftValue), rightText = rightValue == null ? '' : String(rightValue);
    drawHeaderCell(rightX, ry, leftLabelW, rowH, leftLabel);
    drawHeaderCell(rightX + leftLabelW, ry, leftValueW, rowH, leftText);
    drawHeaderCell(rightX + leftLabelW + leftValueW, ry, rightLabelW, rowH, rightLabel);
    drawHeaderCell(rightX + leftLabelW + leftValueW + rightLabelW, ry, rightValueW, rowH, rightText);
  });
  const leftBottom = y + headerH + bodyHeight, middleBottom = y + 32 + bodyHeight, titleBottom = titleRowY + titleBodyH;
  const footerBottom = Math.max(leftBottom, middleBottom, titleBottom);
  const footerHeight = footerBottom - y + 8;
  return { svg: out.join(''), height: footerHeight, audit: {
    measurement_rows: records.length, measurement_columns: 10, title_block_fields: Object.keys(fields).length,
    derived_tilt_note: '*倾角=90°−天顶角，由原测量值派生；原天顶角保留。',
    footer_bottom_y: y + footerHeight,
    geometry: { left_x: x, left_width: leftWidth, left_gap: leftGap, middle_x: middleX, middle_width: middleWidth, right_gap: rightGap, right_x: rightX, right_width: rightWidth, header_y: y, title_y: titleY, row_height: rowH },
  } };
}
function build(data: Record<string, any>, detail: boolean, scale: number, denominator: number, defaulted: boolean) {
  const endpoint = Number(data.meta?.endpoint_m);
  const viewDepth = detail ? Math.min(endpoint, 45) : endpoint;
  const elements = displayElements(data);
  const { columns, x, width } = buildColumns(elements);
  const bodyBottom = BODY_TOP + viewDepth * scale;
  const layers = (data.layers ?? []).filter((row: any) => Number(row.bottom_m) >= 0 && Number(row.top_m) <= viewDepth);
  const turns = (data.turns ?? []).filter((row: any) => Number(row.bottom_m) >= 0 && Number(row.top_m) <= viewDepth);
  const orderedSamples = [...(data.samples ?? [])].sort((a: any, b: any) => Number(a.top_m) - Number(b.top_m) || Number(a.bottom_m) - Number(b.bottom_m));
  const sampleOrders = new Map(orderedSamples.map((row: any, index: number) => [row, index]));
  const samples = orderedSamples.filter((row: any) => Number(row.bottom_m) > 0 && Number(row.top_m) < viewDepth);
  const structures = (data.structures ?? []).filter((row: any) => Number(row.depth_m) >= 0 && Number(row.depth_m) <= viewDepth);
  const yDepth = (depth: number) => BODY_TOP + depth * scale;
  const footerTop = bodyBottom + 90;
  const footer = footerSvg(data, LEFT, footerTop, width, denominator);
  const height = Math.ceil(footerTop + footer.height + 24);
  const out: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width + LEFT * 2}" height="${Math.ceil(height)}" viewBox="0 0 ${width + LEFT * 2} ${height}" role="img" aria-label="固定参考样式钻孔柱状图"><defs>${drillDefs()}</defs><style>text{font-family:${FONT};fill:#111}.grid{stroke:#222;stroke-width:.55}.rule{stroke:#111;stroke-width:.7}</style><rect width="100%" height="100%" fill="white"/>`];
  const info = data.basic_info?.fields ?? {};
  const title = text(data.title_block?.fields?.图名) || [info.矿区, data.project?.name, data.meta?.hole_id].filter(Boolean).join(' ') + '钻孔柱状图';
  out.push(textAt(LEFT + width / 2, 55, title, 48, 'middle'));
  out.push(textAt(LEFT + width / 2, 93, `比例尺 1:${denominator}`, 20, 'middle'));
  const leftInfo = [`开孔日期：${friendlyDate(info['开孔日期'])}`, `终孔日期：${friendlyDate(info['终孔日期'])}`, `孔　深：${valueText(info['终孔深度_m'] ?? data.meta?.endpoint_m)}m`];
  const midInfo = [`孔口坐标：X=${valueText(info['X坐标_m'])}`, `Y=${valueText(info['Y坐标_m'])}`, `H=${valueText(info['孔口标高_m'])}m`];
  const rightInfo = [`钻孔方位：${valueText(info['设计方位角_deg'])}°`, `钻孔倾角：${valueText(info['倾角_deg'])}°`];
  leftInfo.forEach((value, index) => out.push(textAt(LEFT + 4, 154 + index * 36, value, 20)));
  midInfo.forEach((value, index) => out.push(textAt(LEFT + width / 2, 154 + index * 36, value, 20, 'middle')));
  rightInfo.forEach((value, index) => out.push(textAt(LEFT + width - 4, 154 + index * 44, value, 20, 'end')));
  out.push(headerSvg(columns, x, elements));
  // Merged header cells own their grid; body dividers begin below the header.
  out.push(line(LEFT, BODY_TOP, LEFT + width, BODY_TOP, 0.9));
  let cx = LEFT;
  for (const column of columns) { out.push(line(cx, BODY_TOP, cx, bodyBottom)); cx += column.width; }
  out.push(line(LEFT + width, BODY_TOP, LEFT + width, bodyBottom));
  out.push(line(LEFT, bodyBottom, LEFT + width, bodyBottom, 0.9));

  const rangeLine = (start: string, end: string, depth: number, weight = 0.45) => {
    const [sx, sw] = cellRange(x, columns, start, end); out.push(line(sx, yDepth(depth), sx + sw, yDepth(depth), weight));
  };
  for (const turn of turns) {
    const top = Math.max(0, Number(turn.top_m)), bottom = Math.min(viewDepth, Number(turn.bottom_m));
    rangeLine('turn', 'round_rate', top); rangeLine('turn', 'round_rate', bottom);
    const mid = yDepth((top + bottom) / 2), values = [text(turn.id), valueText(turn.top_m), valueText(turn.bottom_m), valueText(turn.advance_m), valueText(turn.core_m), valueText(turn.recovery_percent)];
    ['turn','round_from','round_to','round_advance','round_core','round_rate'].forEach((key, index) => {
      const col = columns.find(item => item.key === key)!; out.push(textAt(x[key] + col.width / 2, mid + 5, values[index], bodyFont(values[index], col.width), 'middle'));
    });
  }
  for (const layer of layers) {
    const top = Math.max(0, Number(layer.top_m)), bottom = Math.min(viewDepth, Number(layer.bottom_m));
    rangeLine('layer_id', 'description', bottom);
    const bottomY = yDepth(bottom), topY = yDepth(top), midY = (topY + bottomY) / 2;
    const layerValues: Array<[string, unknown, number]> = [
      ['layer_id', layer.id, 14], ['layer_bottom', layer.bottom_m, 14], ['layer_thickness', layer.thickness_m, 14], ['layer_core', layer.core_m, 14], ['layer_rate', layer.recovery_percent, 14],
    ];
    for (const [key, value, size] of layerValues) {
      const col = columns.find(item => item.key === key)!;
      const rendered = key === 'layer_id' ? text(value) : valueText(value);
      out.push(textAt(x[key] + col.width / 2, bottomY - 2, rendered, bodyFont(rendered, col.width, size), 'middle'));
    }
    const patternX = x.plot_pattern, patternW = columns.find(item => item.key === 'plot_pattern')!.width;
    out.push(`<rect x="${patternX}" y="${topY}" width="${patternW}" height="${Math.max(0, bottomY - topY)}" fill="url(#${patternId(layer)})"/>`);
    const lithology = text(layer.lithology_name), notes = text(layer.description);
    const description = [lithology ? `${text(layer.id) ? `${text(layer.id)}、` : ''}${lithology}` : '', notes].filter(Boolean).join('\n');
    if (description) wrap(description, 34).forEach((line, index) => out.push(textAt(x.description + 5, topY + 16 + index * 18, line, 14)));
    if (layer.mean_axis_angle_deg != null) out.push(textAt(x.angle + 27, midY + 5, valueText(layer.mean_axis_angle_deg), 14, 'middle'));
  }
  for (const sample of samples) {
    const top = Math.max(0, Number(sample.top_m)), bottom = Math.min(viewDepth, Number(sample.bottom_m));
    rangeLine('sample_id', elements.length ? `assay:${text(elements.at(-1).code) || elements.length - 1}` : 'sample_rate', top);
    rangeLine('sample_id', elements.length ? `assay:${text(elements.at(-1).code) || elements.length - 1}` : 'sample_rate', bottom);
    const midY = yDepth((top + bottom) / 2), plotSampleX = x.plot_samples + 1;
    const segmentFill = Number(sampleOrders.get(sample)) % 2 === 0 ? '#fff' : '#111';
    out.push(`<rect class="sample-segment" data-sample-id="${esc(sample.id)}" x="${plotSampleX}" y="${yDepth(top)}" width="5" height="${yDepth(bottom) - yDepth(top)}" fill="${segmentFill}" stroke="#111" stroke-width="0.6"/>`);
    const sampleLaneWidth = columns.find(item => item.key === 'plot_samples')!.width;
    // Reserve the strip and clearance on both sides; centering in the whole rail overlaps the strip.
    const sampleLabelWidth = Math.max(1, sampleLaneWidth - 12);
    const labelUnits = [...text(sample.id)].reduce((sum, ch) => sum + (ch.charCodeAt(0) > 255 ? 1 : 0.56), 0);
    const idFont = Math.min(labelUnits * 14 > sampleLabelWidth ? 11 : 14, Math.max(0.1, (yDepth(bottom) - yDepth(top)) * 0.65));
    const labelFit = labelUnits * idFont > sampleLabelWidth ? ` textLength="${sampleLabelWidth}" lengthAdjust="spacingAndGlyphs"` : '';
    out.push(`<text class="sample-rail-label" data-sample-id="${esc(sample.id)}" x="${plotSampleX + 8}" y="${midY + idFont * 0.32}" text-anchor="start" font-size="${idFont}"${labelFit}>${esc(sample.id)}</text>`);
    const sampleCells: Array<[string, unknown]> = [['sample_id', sample.id], ['sample_from', sample.top_m], ['sample_to', sample.bottom_m], ['sample_length', sample.length_m], ['sample_core', sample.core_m], ['sample_rate', sample.recovery_percent]];
    for (const [key, value] of sampleCells) {
      const col = columns.find(item => item.key === key)!;
      const rendered = valueText(value);
      out.push(textAt(x[key] + col.width / 2, midY + 5, rendered, bodyFont(rendered, col.width), 'middle'));
    }
    for (const item of elements) {
      const code = text(item.code), raw = sample.assay_raw?.[code], number = sample.assays?.[code];
      const rendered = raw !== null && raw !== undefined && String(raw) !== '' ? String(raw) : number === null || number === undefined || number === '' ? '' : valueText(number, 4);
      const key = `assay:${code}`;
      out.push(textAt(x[key] + 27, midY + 5, rendered, bodyFont(rendered, 54), 'middle'));
    }
  }
  for (const structure of structures) {
    const depthY = yDepth(Number(structure.depth_m));
    const label = `${valueText(structure.depth_m)}m / ${valueText(structure.diameter_mm)}mm`;
    out.push(textAt(x.structure + 4, depthY - 2, label, bodyFont(label, 108)));
  }
  if (detail && viewDepth < endpoint) out.push(textAt(LEFT + width - 5, bodyBottom - 5, `0–${valueText(viewDepth, 0)}m局部详图；按比例连续显示`, 8, 'end'));
  out.push(footer.svg, '</svg>');
  const geometry = (rows: any[], kind: string) => rows.map(row => ({
    kind, id: row.id, top_m: Number(row.top_m), bottom_m: Number(row.bottom_m),
    top_y: yDepth(Number(row.top_m)), bottom_y: yDepth(Number(row.bottom_m)),
    source: row.source ?? {},
  }));
  return {
    svg: out.join(''), width: width + LEFT * 2, height, scale, viewDepth, endpoint, bodyTop: BODY_TOP, bodyBottom, columns, x,
    layers, turns, samples, structures, footer,
    auditRows: { layers: geometry(layers, 'layer'), samples: geometry(samples, 'sample'), turns: geometry(turns, 'turn') },
    defaultScale: defaulted,
  };
}

export function renderReferenceDrill(data: Record<string, any>): { svg: string; detailSvg: string; audit: Record<string, any> } {
  const endpoint = Number(data.meta?.endpoint_m);
  const basicDenominator = scaleValue(data.basic_info?.fields?.比例尺分母);
  const titleDenominator = scaleValue(data.title_block?.fields?.比例尺分母);
  const denominator = basicDenominator && basicDenominator > 0 ? basicDenominator : titleDenominator && titleDenominator > 0 ? titleDenominator : 100;
  const defaulted = !(basicDenominator && basicDenominator > 0) && !(titleDenominator && titleDenominator > 0);
  const scale = DEPTH_SCALE_AT_100 * 100 / denominator;
  const full = build(data, false, scale, denominator, defaulted);
  const detail = build(data, true, scale, denominator, defaulted);
  const elements = displayElements(data);
  return {
    svg: full.svg,
    detailSvg: detail.svg,
    audit: {
      scale_px_per_m: scale,
      scale_denominator: denominator,
      scale_defaulted: defaulted,
      full_endpoint_m: endpoint,
      detail_endpoint_m: detail.viewDepth,
      track_layout: {
        reference_style: true,
        table_left: LEFT,
        header_top: HEADER_TOP,
        header_height: HEADER_HEIGHT,
        body_top: BODY_TOP,
        depth_bottom_y: full.bodyBottom,
        detail_depth_bottom_y: detail.bodyBottom,
        canvas_width: full.width,
        table_width: full.width - LEFT * 2,
        column_edges: full.columns.map((column: Column) => ({ key: column.key, x: full.x[column.key], width: column.width })),
        sample_lane_count: 1,
        sample_list_bottom_y: full.bodyBottom,
        basic_info_rows: 0,
        integrated_footer: { ...full.footer.audit, scale_denominator_defaulted: defaulted },
        visible_analysis_items: elements.length,
        analysis_item_codes: elements.map(item => text(item.code)),
      },
      full: { ...full.auditRows, structures: full.structures.map((row: any) => ({ ...row, y: BODY_TOP + Number(row.depth_m) * scale })) },
      detail: { ...detail.auditRows, structures: detail.structures.map((row: any) => ({ ...row, y: BODY_TOP + Number(row.depth_m) * scale })) },
    },
  };
}

