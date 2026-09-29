import type { BrowseTile } from './browseCache.ts';

type Scheme = 'xyz' | 'tms';
type CoordinateName = 'z' | 'x' | 'y';
type CompiledPart = { expression: RegExp; names: CoordinateName[] };
type Registration = { templates: CompiledTemplate[]; scheme: Scheme };
type CompiledTemplate = { origin: string; path: CompiledPart; query: Array<{ key: CompiledPart; value: CompiledPart }> };

const registrations = new Map<object, Registration>();
const tokens = /\{(z|x|y)\}/g;
function compilePart(template: string): CompiledPart {
  const names: CoordinateName[] = [];
  let source = '^';
  let previous = 0;
  for (const match of template.matchAll(tokens)) {
    source += template.slice(previous, match.index).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const name = match[1] as CoordinateName;
    names.push(name);
    source += '(\\d+)';
    previous = match.index! + match[0].length;
  }
  source += template.slice(previous).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$';
  return { expression: new RegExp(source), names };
}

function compileTemplate(template: string): CompiledTemplate | undefined {
  try {
    const parsed = new URL(template.replaceAll('{z}', '0').replaceAll('{x}', '0').replaceAll('{y}', '0'));
    const rawPath = template.split(/[?#]/, 1)[0].replace(/^https?:\/\/[^/]+/i, '') || '/';
    const compiledPath = compilePart(rawPath);
    const queryText = template.includes('?') ? template.slice(template.indexOf('?') + 1).split('#', 1)[0] : '';
    const query = queryText ? queryText.split('&').map(pair => {
      const index = pair.indexOf('=');
      const key = index < 0 ? pair : pair.slice(0, index);
      const value = index < 0 ? '' : pair.slice(index + 1);
      return { key: compilePart(decodeURIComponent(key.replaceAll('+', ' '))), value: compilePart(decodeURIComponent(value.replaceAll('+', ' '))) };
    }) : [];
    return { origin: parsed.origin, path: compiledPath, query };
  } catch { return undefined; }
}

function matchPart(part: CompiledPart, actual: string, coordinates: Partial<Record<CoordinateName, number>>) {
  const match = part.expression.exec(actual);
  if (!match) return false;
  part.names.forEach((name, index) => {
    const value = Number(match[index + 1]);
    if (coordinates[name] !== undefined && coordinates[name] !== value) coordinates[name] = NaN;
    else coordinates[name] = value;
  });
  return true;
}

export function registerBrowseTileSource(
  owner: object,
  templates: readonly string[],
  scheme: Scheme = 'xyz',
): () => void {
  const registration: Registration = {
    templates: templates.flatMap(template => template.includes('{ratio}')
      ? [template.replaceAll('{ratio}', ''), template.replaceAll('{ratio}', '@2x')]
      : [template]).map(compileTemplate).filter((item): item is CompiledTemplate => !!item),
    scheme,
  };
  registrations.set(owner, registration);
  return () => {
    if (registrations.get(owner) === registration) registrations.delete(owner);
  };
}

export function browseTileCoordinate(url: string): BrowseTile | undefined {
  let actual: URL;
  try { actual = new URL(url); } catch { return undefined; }
  for (const registration of registrations.values()) {
    for (const template of registration.templates) {
      if (actual.origin !== template.origin) continue;
      const coordinates: Partial<Record<CoordinateName, number>> = {};
      if (!matchPart(template.path, actual.pathname, coordinates)) continue;
      const actualQuery = [...actual.searchParams.entries()];
      if (actualQuery.length !== template.query.length) continue;
      const used = new Set<number>();
      let queryMatches = true;
      for (const expected of template.query) {
        let found = -1;
        for (let i = 0; i < actualQuery.length; i++) {
          if (used.has(i)) continue;
          const candidate: Partial<Record<CoordinateName, number>> = {};
          if (matchPart(expected.key, actualQuery[i][0], candidate) && matchPart(expected.value, actualQuery[i][1], candidate)) {
            for (const name of ['z', 'x', 'y'] as const) {
              if (candidate[name] !== undefined) {
                if (coordinates[name] !== undefined && coordinates[name] !== candidate[name]) candidate[name] = NaN;
                else coordinates[name] = candidate[name];
              }
            }
            if (Object.values(candidate).some(Number.isNaN)) continue;
            found = i;
            break;
          }
        }
        if (found < 0) { queryMatches = false; break; }
        used.add(found);
      }
      if (!queryMatches || !Number.isInteger(coordinates.z) || !Number.isInteger(coordinates.x) || !Number.isInteger(coordinates.y)) continue;
      const z = coordinates.z!;
      const extent = 2 ** z;
      if (z < 0 || z > 30 || coordinates.x! < 0 || coordinates.x! >= extent || coordinates.y! < 0 || coordinates.y! >= extent) continue;
      const y = registration.scheme === 'tms' ? extent - 1 - coordinates.y! : coordinates.y!;
      return { z, x: coordinates.x!, y };
    }
  }
  return undefined;
}
