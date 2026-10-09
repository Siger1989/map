import type { XlsxSheet, XlsxValue } from './types.ts';

/** Exact headers and rows from the 2026-10-09 integrated drill workbook. */
export const INTEGRATED_DRILL_SHEETS = [
  '钻孔基本信息', '回次表', '分层-原始记录', '分层-地质综合', '采样',
  '自定义测试项目', '样品测试结果', '孔深校正及弯曲度', '图签', '图面示意', '填写说明',
] as const;

export const INTEGRATED_DRILL_HEADERS_V2: Record<string, { row: number; headers: string[] }> = {
  '回次表': { row: 5, headers: ['序号','回次号','下界记录孔深_m','回次进尺_m','采取块数/原记','岩心长度_m','残留_m','处理后岩心长_m（手填）','回次采取率_pct（原填）','回次采取率_pct（计算）','孔深校正量_m','下界校正孔深_m','≤10cm岩心长度_m','≥10cm岩心长度_m','RQD_pct（原填）','备注','长度核对提示'] },
  '分层-原始记录': { row: 5, headers: ['序号','层号','起回次号','起位置_m','止回次号','止位置_m','换层累计孔深_m','分层进尺_m','分层岩心长_m','分层采取率_pct（原填）','分层采取率_pct（计算）','岩性名称','平均轴夹角_deg','真厚度_m（原填）','调整/说明','止回次岩心长_m','原表O列未命名值'] },
  '分层-地质综合': { row: 5, headers: ['序号','起回次号','起位置_m','止回次号','止位置_m','换层孔深_m','分层进尺_m','分层岩心长_m','分层采取率_pct（原填）','平均轴夹角_deg','真厚度_m（原填）'] },
  '采样': { row: 5, headers: ['序号','样品编号','起回次号','起位置_m','止回次号','止位置_m','孔深自_m','孔深至_m','进尺_m','岩心长度_m','采取率_pct（原填）','采取率_pct（计算）','重量数值（原单位未明）','重量单位（手填）','原表L列值（含义待确认）','原表M列未命名值/附加备注','原表N列未命名值/附加备注'] },
  '自定义测试项目': { row: 5, headers: ['项目代码','项目名称/元素','单位','检出限','分析方法','图中显示','显示顺序','备注'] },
  '样品测试结果': { row: 5, headers: ['样品编号','项目代码','结果原文','数值结果（可空）','结果标记','单位','检出限','分析方法','检测日期','报告编号','备注'] },
  '孔深校正及弯曲度': { row: 7, headers: ['记录孔深_m','校测孔深_m','误差_m','误差率_pct','测量孔深_m','测量天顶角_deg','实测方位角_deg','测量方法','测量仪器'] },
};

/** v3 removes hand-entered recovery percentages and the assay result flag. */
export const INTEGRATED_DRILL_HEADERS_V3: Record<string, { row: number; headers: string[] }> = {
  ...INTEGRATED_DRILL_HEADERS_V2,
  '回次表': { row: 5, headers: ['序号','回次号','下界记录孔深_m','回次进尺_m','采取块数/原记','岩心长度_m','残留_m','处理后岩心长_m（手填）','回次采取率_pct（计算）','孔深校正量_m','下界校正孔深_m','≤10cm岩心长度_m','≥10cm岩心长度_m','RQD_pct（原填）','备注','长度核对提示'] },
  '分层-原始记录': { row: 5, headers: ['序号','层号','起回次号','起位置_m','止回次号','止位置_m','换层累计孔深_m','分层进尺_m','分层岩心长_m','分层采取率_pct（计算）','岩性名称','平均轴夹角_deg','真厚度_m（原填）','调整/说明','止回次岩心长_m','原表O列未命名值'] },
  '分层-地质综合': { row: 5, headers: ['序号','起回次号','起位置_m','止回次号','止位置_m','换层孔深_m','分层进尺_m','分层岩心长_m','分层采取率_pct（计算）','平均轴夹角_deg','真厚度_m（原填）'] },
  '采样': { row: 5, headers: ['序号','样品编号','起回次号','起位置_m','止回次号','止位置_m','孔深自_m','孔深至_m','进尺_m','岩心长度_m','采取率_pct（计算）','重量数值（原单位未明）','重量单位（手填）','原表L列值（含义待确认）','原表M列未命名值/附加备注','原表N列未命名值/附加备注'] },
  '样品测试结果': { row: 5, headers: ['样品编号','项目代码','结果原文','数值结果（可空）','单位','检出限','分析方法','检测日期','报告编号','备注'] },
};

/** @deprecated use version-specific header maps when interpreting rows. */
export const INTEGRATED_DRILL_HEADERS = INTEGRATED_DRILL_HEADERS_V2;

const rowAt = (sheet: XlsxSheet, row: number) => sheet.rows.find(item => item.row === row);
const cellAddress = (column: number, row: number) => {
  let n = column + 1, letters = '';
  while (n) { const rem = (n - 1) % 26; letters = String.fromCharCode(65 + rem) + letters; n = Math.floor((n - 1) / 26); }
  return `${letters}${row}`;
};
const headerValues = (sheet: XlsxSheet, row: number): string[] => {
  const cells = rowAt(sheet, row)?.cells ?? {};
  let max = -1;
  for (const address of Object.keys(cells)) {
    const col = address.match(/^[A-Z]+/)?.[0];
    if (!col) continue;
    let n = 0; for (const c of col) n = n * 26 + c.charCodeAt(0) - 64;
    max = Math.max(max, n - 1);
  }
  return Array.from({ length: max + 1 }, (_, i) => String(cells[cellAddress(i, row)] ?? '').trim());
};

export type IntegratedDrillVersion = 'v2' | 'v3';
export function integratedDrillVersionFromHeaders(headers: Record<string, string[]>): IntegratedDrillVersion | null {
  const matches = (specs: typeof INTEGRATED_DRILL_HEADERS_V2) => Object.entries(specs)
    .every(([name, spec]) => JSON.stringify(headers[name]) === JSON.stringify(spec.headers));
  if (matches(INTEGRATED_DRILL_HEADERS_V3)) return 'v3';
  if (matches(INTEGRATED_DRILL_HEADERS_V2)) return 'v2';
  return null;
}

export function integratedDrillVersion(sheets: Map<string, XlsxSheet>): IntegratedDrillVersion | null {
  if (!INTEGRATED_DRILL_SHEETS.every(name => sheets.has(name))) return null;
  const headers: Record<string, string[]> = {};
  for (const [name, spec] of Object.entries(INTEGRATED_DRILL_HEADERS_V2)) headers[name] = headerValues(sheets.get(name)!, spec.row).filter(Boolean);
  return integratedDrillVersionFromHeaders(headers);
}

export function isIntegratedDrillSheets(sheets: Map<string, XlsxSheet>): boolean {
  return integratedDrillVersion(sheets) !== null;
}

/** Finds the integrated workbook before parsing formula cells; used by XLSX policy. */
export function isIntegratedDrillHeaderSet(names: string[], headers: Record<string, string[]>): boolean {
  return INTEGRATED_DRILL_SHEETS.every(name => names.includes(name)) && integratedDrillVersionFromHeaders(headers) !== null;
}

