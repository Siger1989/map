type PlaceSuggestion = { label: string; query: string; city?: string };

function textField(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function records(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'));
}

function cityQuery(city: string, query: string) {
  return query.includes(city) ? query : `${city} ${query}`.trim();
}

function promptSuggestions(value: unknown, originalQuery: string): PlaceSuggestion[] {
  const prompts = Array.isArray(value) ? records(value)
    : value && typeof value === 'object' ? [value as Record<string, unknown>] : [];
  return prompts.flatMap((prompt) => {
    const type = Number(prompt.type);
    const promptTerm = textField(prompt, 'keyword', 'word', 'term');
    const admins = records(prompt.admins);
    if (type === 4) {
      const terms = [...new Set([
        promptTerm,
        ...admins.map((admin) => textField(admin, 'keyword', 'word', 'term')),
      ].filter(Boolean))];
      return terms.map((term) => ({ label: term, query: term }));
    }
    if (admins.length) return admins.flatMap((admin) => {
      const city = textField(admin, 'adminName', 'name');
      if (!city) return [];
      const term = textField(admin, 'keyword', 'word', 'term') || promptTerm || originalQuery;
      return [{ label: city, query: cityQuery(city, term), city }];
    });
    const term = promptTerm || originalQuery;
    return [{ label: term, query: term }];
  });
}

function plainSuggestions(value: unknown): PlaceSuggestion[] {
  if (typeof value === 'string' && value.trim()) {
    const term = value.trim();
    return [{ label: term, query: term }];
  }
  if (Array.isArray(value)) {
    const terms = value.flatMap((item) => typeof item === 'string' && item.trim() ? [{ label: item.trim(), query: item.trim() }] : []);
    return [...terms, ...records(value).flatMap((record) => {
    const label = textField(record, 'name', 'label', 'keyword', 'word', 'title');
    const term = textField(record, 'keyword', 'word', 'term', 'query') || label;
    return label && term ? [{ label, query: term }] : [];
    })];
  }
  return [];
}

/** Return executable text actions; administrative centers never become place pins. */
export function normalizeTiandituSuggestions(data: unknown, query: string): PlaceSuggestion[] {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
  const response = data as Record<string, unknown>;
  const resultType = Number(response.resultType);
  const statistics = response.statistics && typeof response.statistics === 'object'
    ? response.statistics as Record<string, unknown> : {};
  const cities = resultType === 2
    ? [...records(statistics.priorityCitys), ...records(statistics.allAdmins)].flatMap((record) => {
      const city = textField(record, 'name', 'adminName');
      return city ? [{ label: city, query: cityQuery(city, query), city }] : [];
    })
    : [];
  if (resultType === 2 && Array.isArray(statistics.priorityCitys)) {
    for (const item of statistics.priorityCitys) {
      if (typeof item === 'string' && item.trim()) cities.push({ label: item.trim(), query: cityQuery(item.trim(), query), city: item.trim() });
    }
  }
  const area = response.area && typeof response.area === 'object' && !Array.isArray(response.area)
    ? response.area as Record<string, unknown> : {};
  const areaName = resultType === 3 ? textField(area, 'name') : '';
  const candidates = [
    ...cities,
    ...(areaName ? [{ label: areaName, query: cityQuery(areaName, query), city: areaName }] : []),
    ...promptSuggestions(response.prompt, query),
    ...plainSuggestions(response.suggestions),
    ...plainSuggestions(response.suggests),
  ];
  return [...new Map(candidates.map((item) => [`${item.label}|${item.city ?? ''}|${item.query}`, item])).values()].slice(0, 10);
}
