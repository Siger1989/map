import { zipSync } from 'fflate';
import { deliverFile } from '../files/delivery.ts';
import { formatIndustryCell, industryDataSections } from './dataTable.ts';

export type IndustryKind = 'section' | 'drill';
export type IndustryResult = {
  kind: IndustryKind;
  title: string;
  svg: string;
  detailSvg: string | null;
  normalized: Record<string, unknown>;
  audit: Record<string, unknown>;
  issues: Array<{ severity: string; code: string; message: string; cells?: string[] }>;
};

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const SVG_MIME = 'image/svg+xml;charset=utf-8';

function stamp() { return String(Date.now()); }
function localName(value: string) { return value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 80) || '地质图件'; }

export async function downloadIndustryTemplate(kind: IndustryKind, example = false) {
  const prefix = kind === 'section' ? 'section' : 'drill';
  const sourceName = `${prefix}-${example ? 'example' : 'template'}.xlsx`;
  const response = await fetch(`/industry/${sourceName}`, { cache: 'force-cache' });
  if (!response.ok) throw new Error(`本地${kind === 'section' ? '剖面' : '钻孔'}${example ? '示例' : '模板'}暂不可用`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength < 4 || new Uint8Array(bytes, 0, 4)[0] !== 0x50 || new Uint8Array(bytes, 0, 4)[1] !== 0x4b)
    throw new Error('本地表格资源格式无效');
  const file = new File([bytes], sourceName, { type: XLSX_MIME });
  if (window.GuanyunNative) {
    const nativeFile = new File([bytes], `Shantu-collection-${stamp()}.xlsx`, { type: XLSX_MIME });
    await deliverFile(nativeFile, false);
    return `已请求保存${kind === 'section' ? '剖面' : '钻孔'}${example ? '示例' : '模板'}到设备`;
  }
  await deliverFile(file, false);
  return `已下载${kind === 'section' ? '剖面' : '钻孔'}${example ? '示例' : '模板'}`;
}

function svgSize(svg: string) {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = doc.documentElement;
  const view = root.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
  const parse = (raw: string | null) => raw ? Number.parseFloat(raw) : NaN;
  const width = parse(root.getAttribute('width')) || (view?.length === 4 ? view[2] : NaN);
  const height = parse(root.getAttribute('height')) || (view?.length === 4 ? view[3] : NaN);
  if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height)))
    throw new Error('图件尺寸无效，暂不能生成 PNG');
  return { width, height };
}

/** Rasterize the SVG master directly; the canvas remains under the phone's pixel budget. */
export async function rasterizeIndustrySvg(svg: string, name = '地质图件.png', maxPixels = 24_000_000) {
  const { width, height } = svgSize(svg);
  const scale = Math.min(2, Math.sqrt(maxPixels / (width * height)), 12_000 / Math.max(width, height));
  const canvasWidth = Math.max(1, Math.floor(width * scale));
  const canvasHeight = Math.max(1, Math.floor(height * scale));
  const source = new Blob([svg], { type: SVG_MIME });
  const url = URL.createObjectURL(source);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('无法创建 PNG 画布');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvasWidth, canvasHeight);
    context.drawImage(image, 0, 0, canvasWidth, canvasHeight);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('PNG 编码失败')), 'image/png'));
    if (canvasWidth * canvasHeight > maxPixels) throw new Error('PNG 像素数超过设备上限');
    return new File([blob], localName(name), { type: 'image/png' });
  } catch (error) {
    throw new Error(`PNG生成失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function downloadSvg(svg: string, name: string) {
  const file = new File([svg], localName(name.endsWith('.svg') ? name : `${name}.svg`), { type: SVG_MIME });
  if (window.GuanyunNative) throw new Error('设备端请使用“保存图件包”，其中包含 SVG、PNG 和附表');
  await deliverFile(file, false);
  return 'SVG 已下载';
}

export async function downloadPng(png: File) {
  if (window.GuanyunNative) throw new Error('设备端请使用“保存图件包”，其中包含 SVG、PNG 和附表');
  await deliverFile(png, false);
  return 'PNG 已下载';
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

export function createIndustryAppendixHtml(result: IndustryResult) {
  const sections = industryDataSections(result.kind, result.normalized);
  const tables = sections.map(section => `<section><h2>${escapeHtml(section.title)}（${section.rows.length} 条）</h2>${section.rows.length ? `<table><thead><tr>${section.columns.map(column => `<th>${escapeHtml(column.label)}${column.unit ? `（${escapeHtml(column.unit)}）` : ''}</th>`).join('')}</tr></thead><tbody>${section.rows.map(row => `<tr>${section.columns.map(column => `<td>${escapeHtml(formatIndustryCell(column.key === 'source_display' ? row.source_display : row[column.key]))}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '<p>无记录</p>'}</section>`).join('');
  const trace = JSON.stringify({ audit: result.audit, issues: result.issues }, null, 2);
  const normalized = JSON.stringify(result.normalized, null, 2);
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(result.title)}</title><style>body{font:14px/1.5 system-ui,"Microsoft YaHei",sans-serif;color:#17251f;margin:24px}table{border-collapse:collapse;width:100%;margin-bottom:24px}th,td{border:1px solid #aab9ae;padding:6px;text-align:left;vertical-align:top;white-space:pre-wrap;overflow-wrap:anywhere}th{background:#e7efe8}h1{font-size:22px}h2{font-size:17px}details{margin:16px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f2f5f2;padding:12px}</style><h1>${escapeHtml(result.title)}</h1><p>附表按输入记录逐行整理；原始数值和来源信息见折叠追溯数据。</p>${tables}<details><summary>校验与来源追溯</summary><pre>${escapeHtml(trace)}</pre></details><details><summary>标准化原始字段</summary><pre>${escapeHtml(normalized)}</pre></details></html>`;
}

export async function createIndustryBundleFile(result: IndustryResult, png: File) {
  const stem = localName(result.title);
  const files: Record<string, Uint8Array> = {
    '主图.svg': new TextEncoder().encode(result.svg),
    ...(result.detailSvg ? { '详图.svg': new TextEncoder().encode(result.detailSvg) } : {}),
    '主图.png': new Uint8Array(await png.arrayBuffer()),
    '附表.html': new TextEncoder().encode(createIndustryAppendixHtml(result)),
    '附表数据.json': new TextEncoder().encode(JSON.stringify(result.normalized, null, 2)),
    '来源追溯.json': new TextEncoder().encode(JSON.stringify({ audit: result.audit, issues: result.issues }, null, 2)),
    '说明.txt': new TextEncoder().encode(`${result.title}\nSVG为矢量主图，PNG由主图SVG重新栅格化。附表数据保留原始字段与来源信息。`),
  };
  const archive = zipSync(files, { level: 6 });
  return new File([archive], `Shantu-collection-${stamp()}.zip`, { type: 'application/zip' });
}

export async function downloadIndustryBundle(result: IndustryResult, png: File) {
  const stem = localName(result.title);
  const file = await createIndustryBundleFile(result, png);
  await deliverFile(file, false);
  return window.GuanyunNative ? `已请求系统保存${stem}图件包` : `${stem}图件包已下载`;
}
