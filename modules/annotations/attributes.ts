export type AnnotationAttribute = { name: string; value: string };
export const ATTRIBUTE_TEMPLATE_KEY = 'shantu.annotation-attributes.v1';
export const MAX_ATTRIBUTES = 40;
export function validAttributes(v: unknown): v is AnnotationAttribute[] {
  return (
    Array.isArray(v) &&
    v.length <= MAX_ATTRIBUTES &&
    v.every(
      (f) =>
        f &&
        typeof f.name === 'string' &&
        f.name.length <= 60 &&
        typeof f.value === 'string' &&
        f.value.length <= 2000,
    )
  );
}
export function readAttributeTemplate(raw: string | null): {
  names: string[];
  recent: string[];
} {
  if (raw === null) return { names: [], recent: [] };
  const v = JSON.parse(raw);
  if (
    !v ||
    ![v.names, v.recent].every(
      (a) =>
        Array.isArray(a) &&
        a.length <= 100 &&
        a.every((s) => typeof s === 'string' && s.trim() && s.length <= 60),
    )
  )
    throw new Error('属性模板无法读取，已保留原数据');
  return v;
}
export function rememberAttributes(
  previous: ReturnType<typeof readAttributeTemplate>,
  fields: AnnotationAttribute[],
) {
  const names = [...new Set(fields.map((f) => f.name.trim()).filter(Boolean))];
  return {
    names,
    recent: [...new Set([...names, ...previous.recent])].slice(0, 100),
  };
}
export const blankAttributes = (
  template: ReturnType<typeof readAttributeTemplate>,
) => template.names.map((name) => ({ name, value: '' }));
