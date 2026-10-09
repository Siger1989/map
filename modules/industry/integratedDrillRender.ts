import { esc, fmt, text } from './patterns.ts';

const wrap = (value: string, max: number): string[] => {
  const lines: string[] = [];
  for (const paragraph of value.split(/\r?\n/)) {
    let current = '';
    for (const ch of paragraph) { if (current.length >= max) { lines.push(current); current = ''; } current += ch; }
    lines.push(current);
  }
  return lines;
};
const itemsForFigure = (data: Record<string, any>) => (Array.isArray(data.analysis_items)
  ? data.analysis_items.filter((item: any) => item?.show !== false).sort((a: any, b: any) => Number(a.order ?? 0) - Number(b.order ?? 0) || text(a.code).localeCompare(text(b.code)))
  : ['Au','Pb','Zn'].map(code => ({ code, name: code, unit: data.project?.analysis_units?.[code] ?? '', show: true, order: 0 })));

export function drillAssayLines(sample: Record<string, any>, data: Record<string, any>, max = 48): string[] {
  const items = itemsForFigure(data);
  if (!items.length) return ['未配置分析项目'];
  if (!Array.isArray(data.analysis_items)) {
    const values = items.map((item: any) => {
      const code = text(item.code), value = sample.assays?.[code];
      const rendered = value !== null && value !== undefined && value !== '' ? fmt(value, 4) : '未提供';
      return `${code}:${rendered}${item.unit ? ` ${text(item.unit)}` : ''}`;
    }).join('  ');
    return wrap(values, max);
  }
  return items.map((item: any) => {
    const code = text(item.code), raw = sample.assay_raw?.[code], value = sample.assays?.[code];
    const rendered = value !== null && value !== undefined && value !== '' ? fmt(value, 4) : raw !== null && raw !== undefined && raw !== '' ? String(raw) : '未提供';
    const label = text(item.name) || code;
    return `${label} [${code}]：${rendered}${item.unit ? ` ${text(item.unit)}` : ''}`;
  }).flatMap(line => wrap(line, max));
}

export function integratedBasicInfoRows(data: Record<string, any>, maxValueChars = 38) {
  const fields = data.basic_info?.fields && typeof data.basic_info.fields === 'object' ? data.basic_info.fields : {};
  const summary = data.basic_info?.summary && typeof data.basic_info.summary === 'object' ? data.basic_info.summary : {};
  const labels = [
    ...Object.entries(fields),
    ...Object.entries(summary).map(([label, item]: [string, any]) => [label, item?.value] as [string, unknown]),
  ];
  const rows: Array<Array<{ label: string; labelLines: string[]; value: string[] }>> = [];
  for (let i = 0; i < labels.length; i += 4) {
    rows.push(labels.slice(i, i + 4).map(([label, value]) => ({
      label,
      labelLines: wrap(label, 12),
      value: wrap(value == null || value === '' ? '未提供' : String(value), maxValueChars),
    })));
  }
  return rows;
}

export function integratedBasicInfoHeight(data: Record<string, any>) {
  return integratedBasicInfoRows(data).reduce((sum, row) => sum + Math.max(28, ...row.map(cell => Math.max(cell.value.length, cell.labelLines.length) * 13 + 8)), 25) + 15;
}

export function renderIntegratedBasicInfo(data: Record<string, any>, width: number, startY: number) {
  const rows = integratedBasicInfoRows(data);
  const x0 = 28, tableWidth = width - 56, columnWidth = tableWidth / 4, labelWidth = 110;
  let y = startY + 20;
  let svg = `<g class="integrated-basic-info"><text x="${x0}" y="${startY + 12}" font-size="12" font-weight="bold">钻孔基本信息</text>`;
  for (const row of rows) {
    const rowHeight = Math.max(28, ...row.map(cell => Math.max(cell.value.length, cell.labelLines.length) * 13 + 8));
    for (let i = 0; i < 4; i++) {
      const x = x0 + i * columnWidth;
      const cell = row[i];
      svg += rect(x, y, labelWidth, rowHeight, '#eeeae0');
      svg += rect(x + labelWidth, y, columnWidth - labelWidth, rowHeight);
      if (cell) svg += cell.labelLines.map((line, n) => xmlText(x + 3, y + 13 + n * 13, line, 10, 'bold')).join('') + cell.value.map((line, n) => xmlText(x + labelWidth + 3, y + 13 + n * 13, line, 10)).join('');
    }
    y += rowHeight;
  }
  svg += '</g>';
  return { svg, height: y - startY + 15, rows: rows.length };
}

const xmlText = (x: number, y: number, value: string, size = 8, weight = '') => `<text x="${x}" y="${y}" font-size="${size}"${weight ? ` font-weight="${weight}"` : ''}>${esc(value)}</text>`;
const rect = (x: number, y: number, w: number, h: number, fill = '#fff') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="#777" stroke-width=".6"/>`;

/** Appends the complete template measurement table and title block below the SVG body. */
export function renderIntegratedDrillFooter(data: Record<string, any>, width: number, startY: number) {
  const measurements = data.depth_measurements ?? {}, records = Array.isArray(measurements.records) ? measurements.records : [];
  const columns = [
    ['序号', 'sequence', 48], ['记录孔深_m', 'recorded_depth_m', 110], ['校测孔深_m', 'checked_depth_m', 110], ['误差_m', 'error_m', 86],
    ['误差率_pct', 'error_percent', 90], ['测量孔深_m', 'measurement_depth_m', 110], ['测量天顶角_deg', 'zenith_deg', 122],
    ['实测方位角_deg', 'azimuth_deg', 122], ['测量方法', 'method', 180], ['测量仪器', 'instrument', 180],
  ] as const;
  const tableWidth = Math.min(width - 56, columns.reduce((sum, column) => sum + column[2], 0));
  const scale = tableWidth / columns.reduce((sum, column) => sum + column[2], 0);
  const widths = columns.map(column => column[2] * scale);
  const x0 = 28, titleY = startY + 14, headerY = titleY + 8, rowStart = headerY + 22;
  let svg = `<g class="integrated-depth-table"><text x="${x0}" y="${titleY}" font-size="12" font-weight="bold">孔深校正及弯曲度（原始记录）</text>`;
  let x = x0;
  columns.forEach((column, i) => { svg += rect(x, headerY, widths[i], 22, '#eef0ed') + xmlText(x + 3, headerY + 14, column[0], 7, 'bold'); x += widths[i]; });
  let y = rowStart;
  const rowHeights: number[] = [];
  for (const record of records) {
    const cellLines = columns.map((column, i) => {
      const value = record[column[1]];
      const string = value == null || value === '' ? '未提供' : typeof value === 'number' ? fmt(value, 2) : String(value);
      return wrap(string, Math.max(4, Math.floor((widths[i] - 8) / 5.2)));
    });
    const rowHeight = Math.max(20, ...cellLines.map(lines => lines.length * 10 + 6));
    rowHeights.push(rowHeight); x = x0;
    columns.forEach((_, i) => { svg += rect(x, y, widths[i], rowHeight) + cellLines[i].map((line, n) => xmlText(x + 3, y + 10 + n * 10, line, 7)).join(''); x += widths[i]; });
    y += rowHeight;
  }
  if (!records.length) {
    svg += rect(x0, y, tableWidth, 22) + xmlText(x0 + 4, y + 14, '无孔深校正或弯曲度记录', 8);
    y += 22;
  }
  const summary = measurements.summary && typeof measurements.summary === 'object' ? measurements.summary : {};
  const summaryItems = Object.entries(summary) as Array<[string, any]>;
  const summaryText = summaryItems.map(([label, item]) => `${label}：${item?.value == null || item.value === '' ? '未提供' : String(item.value)}`).join('　　') || '测点汇总：未提供';
  svg += rect(x0, y, tableWidth, 24, '#f7f7f4') + xmlText(x0 + 5, y + 15, summaryText, 8);
  y += 24;
  const signatures = measurements.signatures && typeof measurements.signatures === 'object' ? measurements.signatures : {};
  const signatureText = Object.entries(signatures).map(([label, value]: [string, any]) => `${label}：${value?.value ?? '未提供'}`).join('　　') || '记录签名：未提供';
  svg += rect(x0, y, tableWidth, 24) + xmlText(x0 + 5, y + 15, signatureText, 8);
  y += 32;

  const fields = data.title_block?.fields && typeof data.title_block.fields === 'object' ? data.title_block.fields : {};
  const titleRows: Array<[string, string, 'full' | 'pair']> = [
    ['项目/单位', '', 'full'], ['图名', '', 'full'],
    ['拟编', '顺序号', 'pair'], ['审核', '图号', 'pair'], ['制图', '比例尺分母', 'pair'],
    ['项目负责', '日期', 'pair'], ['单位负责', '资料来源', 'pair'],
  ];
  const blockWidth = Math.min(tableWidth, Math.max(600, Math.min(1100, width - 56))), bx = width - blockWidth - 28;
  svg += `<text x="${bx}" y="${y}" font-size="12" font-weight="bold">图签</text>`;
  y += 8;
  const labelWidth = blockWidth * .16;
  const titleCell = (x: number, top: number, w: number, h: number, value: unknown, fill: string, size = 9, weight = '') => {
    const string = value == null || value === '' ? '未提供' : String(value);
    const charsPerLine = Math.max(3, Math.floor((w - 8) / (size * .95)));
    const lines = wrap(string, charsPerLine);
    return { svg: rect(x, top, w, h, fill) + lines.map((line, i) => xmlText(x + 4, top + Math.min(h - 5, 14 + i * (size + 2)), line, size, weight)).join(''), lines };
  };
  for (const [left, right, mode] of titleRows) {
    const half = blockWidth / 2, pairLabelWidth = labelWidth / 2, pairValueWidth = half - pairLabelWidth;
    const leftValue = left === '比例尺分母' && fields[left] != null && fields[left] !== '' ? `1:${fields[left]}` : fields[left];
    const rightValue = right === '比例尺分母' && fields[right] != null && fields[right] !== '' ? `1:${fields[right]}` : fields[right] ? fields[right] : undefined;
    const rightLabel = right === '比例尺分母' ? '比例尺' : right;
    const cells = mode === 'full'
      ? [titleCell(bx, y, labelWidth, 24, left, '#eeeae0', 9, 'bold'), titleCell(bx + labelWidth, y, blockWidth - labelWidth, 24, fields[left], '#fff')]
      : [titleCell(bx, y, pairLabelWidth, 24, left, '#eeeae0', 9, 'bold'), titleCell(bx + pairLabelWidth, y, pairValueWidth, 24, leftValue, '#fff'), titleCell(bx + half, y, pairLabelWidth, 24, rightLabel, '#eeeae0', 9, 'bold'), titleCell(bx + half + pairLabelWidth, y, pairValueWidth, 24, rightValue, '#fff')];
    const rowHeight = Math.max(24, ...cells.map(cell => cell.lines.length * 11 + 8));
    let cellX = bx;
    if (mode === 'full') {
      svg += titleCell(bx, y, labelWidth, rowHeight, left, '#eeeae0', 9, 'bold').svg;
      svg += titleCell(bx + labelWidth, y, blockWidth - labelWidth, rowHeight, fields[left], '#fff').svg;
    } else {
      for (const [index, cell] of cells.entries()) {
        const cellWidth = index % 2 === 0 ? pairLabelWidth : pairValueWidth;
        svg += titleCell(cellX, y, cellWidth, rowHeight, (index === 0 ? left : index === 1 ? leftValue : index === 2 ? rightLabel : rightValue), index % 2 === 0 ? '#eeeae0' : '#fff', 9, index % 2 === 0 ? 'bold' : '').svg;
        cellX += cellWidth;
        if (index === 1) cellX = bx + half;
      }
    }
    y += rowHeight;
  }
  svg += '</g>';
  return { svg, height: y - startY + 12, audit: { measurement_rows: records.length, measurement_columns: columns.length, measurement_row_heights: rowHeights, title_block_fields: Object.keys(fields).length, title_block_width: blockWidth, footer_bottom_y: y } };
}
