export type GeologyUnit = {
  key: string;
  name: string;
  age: string;
  lithology: string;
  color: string;
  description: string;
  source: string;
  sourceUrl: string | null;
};
export type GeologyState = {
  source: 'world' | 'geocloud20w';
  status: 'off' | 'loading' | 'ready' | 'empty' | 'error' | 'authorization';
  message?: string;
  serviceTitle?: string;
  legendUrl?: string;
  legend: GeologyUnit[];
  sources: { name: string; url: string | null }[];
  selection: GeologyUnit | null;
};
export const INITIAL_GEOLOGY: GeologyState = {
  source: 'world', status: 'off', legend: [], sources: [], selection: null,
};
const translations: Record<string, string> = {
  Quaternary: '第四纪', Neogene: '新近纪', Paleogene: '古近纪',
  Cenozoic: '新生代', Mesozoic: '中生代', Paleozoic: '古生代',
  Cretaceous: '白垩纪', Jurassic: '侏罗纪', Triassic: '三叠纪',
  Permian: '二叠纪', Carboniferous: '石炭纪', Devonian: '泥盆纪',
  Silurian: '志留纪', Ordovician: '奥陶纪', Cambrian: '寒武纪',
  Precambrian: '前寒武纪', Proterozoic: '元古宙', Archean: '太古宙',
  Neoproterozoic: '新元古代', Mesoproterozoic: '中元古代', Paleoproterozoic: '古元古代',
  Holocene: '全新世', Pleistocene: '更新世',
  'intrusive igneous rocks': '侵入岩', 'sedimentary rocks': '沉积岩',
  'intrusive rocks': '侵入岩', 'sedimentary and volcanic rocks': '沉积岩与火山岩',
  'metamorphic rocks': '变质岩', 'igneous rocks': '火成岩',
  'volcanic rocks': '火山岩', 'intermediate volcanic rocks': '中性火山岩',
  'felsic volcanic rocks': '长英质火山岩', 'mafic volcanic rocks': '镁铁质火山岩',
  'unconsolidated sediments': '松散沉积物',
};
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
export function translateGeology(value: string): string {
  return value.replace(/\b(Late|Middle|Early)\b/g, (word) => ({ Late: '晚', Middle: '中', Early: '早' })[word]!)
    .replace(new RegExp(Object.keys(translations).sort((a, b) => b.length - a.length).join('|'), 'g'), (word) => translations[word]);
}
export function safeSourceUrl(value: unknown): string | null {
  const url = text(value);
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch { return null; }
}
export function geologyUnit(properties: Record<string, unknown>): GeologyUnit {
  const color = /^#[\da-f]{6}$/i.test(text(properties.color)) ? text(properties.color) : '#a8b5be';
  const name = text(properties.name) || '未命名地质单元';
  const age = text(properties.age) || '年代未标注';
  const year = text(properties.ref_year);
  const sourceName = text(properties.ref_name) || text(properties.ref_source);
  return {
    key: `${color}:${name}:${age}`,
    name: translateGeology(name), age: translateGeology(age),
    lithology: translateGeology(text(properties.lith)) || '岩性未标注', color,
    description: text(properties.descrip),
    source: sourceName ? `${sourceName}${year ? ` · ${year}` : ''}` : `Macrostrat 原始图源 ${properties.source_id ?? '未标注'}`,
    sourceUrl: safeSourceUrl(properties.ref_url),
  };
}
