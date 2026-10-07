import materialsJson from './templates/materials.json' with { type: 'json' };
import drillJson from './templates/drill-patterns.json' with { type: 'json' };

export const esc = (value: unknown): string =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;',
      })[c]!,
  );
export const num = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;
export const fmt = (v: unknown, digits = 2): string =>
  v === null || v === undefined || v === '' ? '未提供' : num(v).toFixed(digits);
export const text = (v: unknown): string => (v == null ? '' : String(v));

type Primitive = Record<string, number | string> & { type: string };
export const materialsDocument = materialsJson as any;
const mats = materialsDocument.materials as Record<
  string,
  {
    id: string;
    name: string;
    orientation?: string;
    background?: string;
    stroke?: string;
    reference_status?: string;
    tile_width?: number;
    tile_height?: number;
    anchor_feature?: number[];
    svg: Primitive[];
  }
>;
const drill = drillJson as any;

export function sectionDefs(context = 'main'): string {
  const scale = num(materialsDocument.render_scales?.[context], 1) || 1;
  return (
    Object.entries(mats)
      .map(([, m]) => {
        const w = num(m.tile_width, num(materialsDocument.tile?.width, 24));
        const h = num(m.tile_height, num(materialsDocument.tile?.height, 24));
        const stroke = esc(m.stroke || '#36404a');
        const body =
          m.reference_status === 'unverified'
            ? ''
            : m.svg
                .map((p) => {
                  const sw = num(p.width, 1.1);
                  if (p.type === 'line')
                    return `<line x1="${num(p.x1)}" y1="${num(p.y1)}" x2="${num(p.x2)}" y2="${num(p.y2)}" fill="none" stroke="${stroke}" stroke-width="${sw}"/>`;
                  if (p.type === 'circle')
                    return `<circle cx="${num(p.cx)}" cy="${num(p.cy)}" r="${num(p.r)}" fill="${stroke}" stroke="none"/>`;
                  if (p.type === 'path' && typeof p.d === 'string')
                    return `<path d="${esc(p.d)}" fill="none" stroke="${stroke}" stroke-width="${sw}"/>`;
                  return '';
                })
                .join('');
        return `<pattern id="${esc(m.id)}" width="${w}" height="${h}" patternUnits="userSpaceOnUse" patternTransform="scale(${scale})"><rect width="${w}" height="${h}" fill="${m.reference_status === 'unverified' ? '#ffffff' : esc(m.background || '#eeeeee')}"/>${body}</pattern>`;
      })
      .join('') +
    `<pattern id="mat_pending" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="scale(${scale})"><rect width="12" height="12" fill="#ffffff"/></pattern>`
  );
}
export function sectionMaterial(name: unknown): string {
  return mats[text(name)]?.id || 'mat_pending';
}
export function materialSpec(name: unknown) {
  return mats[text(name)];
}
export function materialTemplate(name: unknown): string {
  const m = mats[text(name)];
  return m ? m.id : 'mat_pending';
}
export function drillDefs(): string {
  return (
    Object.entries(
      drill.patterns as Record<
        string,
        { width: number; height: number; svg: string }
      >,
    )
      .map(
        ([id, p]) =>
          `<pattern id="drill-${esc(id)}" width="${num(p.width)}" height="${num(p.height)}" patternUnits="userSpaceOnUse">${p.svg}</pattern>`,
      )
      .join('') +
    '<pattern id="drill-pending" width="18" height="18" patternUnits="userSpaceOnUse"><rect width="18" height="18" fill="#fff"/></pattern>'
  );
}
export function drillPattern(material: unknown): string {
  const code = (drill.materials as Record<string, string>)[text(material)];
  const id = code && (drill.codes as Record<string, string>)[code];
  return id ? `drill-${id}` : 'drill-pending';
}
export function assertBounded(data: Record<string, any>, limit = 20000): void {
  const visit = (v: unknown, depth = 0): number => {
    if (depth > 20) throw new Error('输入嵌套层级过深，无法安全绘制');
    if (typeof v === 'string' && v.length > 20000)
      throw new Error(
        '单个文本字段过长（超过 20000 字符），未截断，请先整理输入',
      );
    if (Array.isArray(v)) {
      if (v.length > limit)
        throw new Error(`记录数超过安全上限 ${limit}，未截断`);
      let n = 0;
      for (const x of v) n += visit(x, depth + 1);
      return n;
    }
    if (v && typeof v === 'object') {
      let n = 0;
      for (const x of Object.values(v as object)) n += visit(x, depth + 1);
      return n;
    }
    return 1;
  };
  visit(data);
}
