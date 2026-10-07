import { importDrill } from './importDrill.ts';
import { importSection } from './importSection.ts';
import { renderDrill } from './renderDrill.ts';
import { renderSection } from './renderSection.ts';
import { parseXlsx } from './xlsx.ts';
import type { GeologyIssue, GeologyKind, GeologyResult } from './types.ts';

export function geometryAuditIssues(geometry: Record<string, unknown> | undefined): GeologyIssue[] {
  const items = geometry?.issues;
  if (!Array.isArray(items)) return [];
  return items.map((value: unknown) => {
    const item = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const severity = ['error', 'warning', 'info'].includes(String(item.severity))
      ? item.severity as GeologyIssue['severity']
      : 'warning';
    const cells = Array.isArray(item.cells)
      ? item.cells.filter((cell): cell is string => typeof cell === 'string')
      : undefined;
    return {
      severity,
      code: `GEOMETRY_${String(item.code ?? 'REVIEW').toUpperCase()}`,
      message: String(item.message ?? '层界几何未完整绘制，具体区域请检查图面'),
      ...(cells?.length ? { cells } : {}),
    };
  });
}

export async function generateGeology(buffer: ArrayBuffer, filename: string, kind: GeologyKind): Promise<GeologyResult> {
  if (kind !== 'section' && kind !== 'drill') throw new Error('请选择剖面或钻孔图类型');
  if (!filename.toLowerCase().endsWith('.xlsx')) throw new Error('仅支持标准 .xlsx 工作簿');
  try {
    const workbook = await parseXlsx(buffer, filename);
    const imported = kind === 'section' ? importSection(workbook) : importDrill(workbook);
    const normalized = imported.normalized;
    const rendered = kind === 'section' ? renderSection(normalized) : renderDrill(normalized);
    const project = (normalized.project ?? {}) as Record<string, unknown>;
    const meta = (normalized.meta ?? {}) as Record<string, unknown>;
    const title = kind === 'section'
      ? [project.name, project.section_id].map(String).filter(x => x && x !== 'undefined').join(' / ') || '实测地层剖面'
      : `${String(meta.hole_id ?? '未命名钻孔')} 钻孔柱状图`;
    const geometry = (rendered.audit as Record<string, any>).geometry;
    const geometryIssues = kind === 'section' ? geometryAuditIssues(geometry) : [];
    const combined = [...imported.issues, ...geometryIssues];
    const issueKeys = new Set<string>();
    const issues = combined.filter(item => {
      const key = `${item.severity}|${item.code}|${(item.cells ?? []).join('|')}|${item.message}`;
      if (issueKeys.has(key)) return false;
      issueKeys.add(key); return true;
    }) as GeologyIssue[];
    const result: GeologyResult = {
      kind, title, svg: rendered.svg, detailSvg: rendered.detailSvg,
      normalized, audit: { ...rendered.audit, source: normalized.source, summary: normalized.summary }, issues,
    };
    return result;
  } catch (cause) {
    if (cause instanceof Error && 'issues' in cause) throw cause;
    const message = cause instanceof Error ? cause.message : '未知错误';
    throw new Error(`导入失败：${message}`, { cause });
  }
}
