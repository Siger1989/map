export type GeologyKind = 'section' | 'drill';

export interface GeologyIssue {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  cells?: string[];
}

export interface GeologyResult {
  kind: GeologyKind;
  title: string;
  svg: string;
  detailSvg: string;
  normalized: Record<string, unknown>;
  audit: Record<string, unknown>;
  issues: GeologyIssue[];
}

export type XlsxValue = string | number | boolean | null;

export interface XlsxRow {
  row: number;
  values: Record<string, XlsxValue>;
  cells: Record<string, XlsxValue>;
}

export interface XlsxSheet {
  name: string;
  rows: XlsxRow[];
}

export interface XlsxWorkbook {
  filename: string;
  sheets: Map<string, XlsxSheet>;
  sha256: string;
  warnings: GeologyIssue[];
}

export interface ImportResult {
  normalized: Record<string, unknown>;
  issues: GeologyIssue[];
}
