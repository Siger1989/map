export function suggestionGroup(label: string) {
  if (/属性.*名称|属性名/.test(label)) return 'attribute';
  if (/备注|说明|内容|数据|描述/.test(label)) return 'note';
  if (/名称|标题|搜索|筛选|查找|文件夹|分组/.test(label)) return 'name';
  return label.replace(/\d+/g, '').trim() || 'text';
}
export function rankSuggestions(query: string, values: string[]) {
  const q = query.trim().toLocaleLowerCase();
  return [
    ...new Set(values.map((v) => v.trim()).filter((v) => v && v.length <= 300)),
  ]
    .filter((v) => v !== query && (!q || v.toLocaleLowerCase().includes(q)))
    .sort(
      (a, b) =>
        Number(b.toLocaleLowerCase().startsWith(q)) -
        Number(a.toLocaleLowerCase().startsWith(q)),
    )
    .slice(0, 5);
}
export function readSuggestionHistory(raw: string | null): string[] {
  try {
    const value: unknown = JSON.parse(raw ?? '[]');
    return Array.isArray(value)
      ? value
          .filter((v): v is string => typeof v === 'string' && v.length <= 300)
          .slice(0, 12)
      : [];
  } catch {
    return [];
  }
}
