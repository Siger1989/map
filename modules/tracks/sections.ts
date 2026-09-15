import type { Coordinate } from '../navigation/types.ts';
import { metresBetween } from '../navigation/types.ts';
import { normalizeTrackStyle, type TrackStyle } from './style.ts';

/** Section identity belongs to edges, never to a colour. Null is an unassigned new edge. */
export type TrackSections = {
  edges: (string | null)[][];
  notes: Record<string, string>;
};
export type SectionGeometry = {
  id?: string;
  segments: Coordinate[][];
  sections?: TrackSections;
  edgeColors?: (string | null)[][];
  colorConditions?: Record<string, string>;
  style?: TrackStyle;
};
const edgeKey = (a: Coordinate, b: Coordinate) =>
  [a.join(','), b.join(',')].sort().join('|');
export function validSections(
  value: unknown,
  lines: Coordinate[][],
): value is TrackSections {
  if (!value || typeof value !== 'object') return false;
  const s = value as TrackSections;
  return (
    Array.isArray(s.edges) &&
    s.edges.length === lines.length &&
    s.edges.every(
      (row, i) =>
        Array.isArray(row) &&
        row.length === Math.max(0, lines[i].length - 1) &&
        row.every(
          (id) =>
            id === null ||
            (typeof id === 'string' && id.length > 0 && id.length <= 240),
        ),
    ) &&
    !!s.notes &&
    typeof s.notes === 'object' &&
    !Array.isArray(s.notes) &&
    Object.keys(s.notes).length <= 6000 &&
    Object.entries(s.notes).every(
      ([id, note]) =>
        id.length > 0 &&
        id.length <= 240 &&
        typeof note === 'string' &&
        note.length <= 1600,
    )
  );
}
/** Legacy same-colour runs get separate identities; original legacy notes remain in the archive. */
export function materializeSections(source: SectionGeometry): TrackSections {
  if (validSections(source.sections, source.segments)) return source.sections;
  const notes: Record<string, string> = {};
  const fallback = normalizeTrackStyle(source.style).color;
  const edges = source.segments.map((line, part) => {
    let last = '',
      id = '';
    return line.slice(1).map((b, edge) => {
      const color = source.edgeColors?.[part]?.[edge] ?? fallback;
      if (last !== color) {
        id = `legacy:${(source.id ?? 'draft').slice(0, 80)}:${part}:${edge}:${line[edge].join(',')}`;
        notes[id] = source.colorConditions?.[color] ?? '';
      }
      last = color;
      return id;
    });
  });
  return { edges, notes };
}
/** Reversal, joins and deletions retain only their surviving physical edge assignments. */
export function inheritSections(
  lines: Coordinate[][],
  sources: SectionGeometry[],
): TrackSections {
  const index = new Map<string, string | null>();
  const nearby = new Map<
    string,
    { a: Coordinate; b: Coordinate; id: string | null }[]
  >();
  const notes: Record<string, string> = {};
  for (const source of sources) {
    const sections = materializeSections(source);
    Object.assign(notes, sections.notes);
    source.segments.forEach((line, i) =>
      line.slice(1).forEach((b, j) => {
        const a = line[j],
          id = sections.edges[i][j],
          key = edgeKey(a, b);
        if (!index.has(key)) index.set(key, id);
        for (const p of [a, b])
          nearby.set(p.join(','), [
            ...(nearby.get(p.join(',')) ?? []),
            { a, b, id },
          ]);
      }),
    );
  }
  const edges = lines.map((line) =>
    line.slice(1).map((b, j) => {
      const a = line[j],
        key = edgeKey(a, b);
      if (index.has(key)) return index.get(key)!;
      return (
        [
          ...(nearby.get(a.join(',')) ?? []),
          ...(nearby.get(b.join(',')) ?? []),
        ].find(
          (e) =>
            (metresBetween(e.a, a) < 0.15 && metresBetween(e.b, b) < 0.15) ||
            (metresBetween(e.b, a) < 0.15 && metresBetween(e.a, b) < 0.15),
        )?.id ?? null
      );
    }),
  );
  const used = new Set(edges.flat().filter((id): id is string => id !== null));
  return {
    edges,
    notes: Object.fromEntries([...used].map((id) => [id, notes[id] ?? ''])),
  };
}
export function editSection<T extends SectionGeometry>(
  source: T,
  id: string,
  color: string,
  note: string,
): T {
  if (!/^#[0-9a-f]{6}$/i.test(color) || note.length > 1600)
    throw new Error('路段颜色或备注无效');
  const sections = materializeSections(source);
  if (!sections.edges.some((row) => row.includes(id)))
    throw new Error('路段已变化，请重新选择');
  return {
    ...source,
    edgeColors: sections.edges.map((row, i) =>
      row.map((key, j) =>
        key === id
          ? color
          : (source.edgeColors?.[i]?.[j] ??
            normalizeTrackStyle(source.style).color),
      ),
    ),
    sections: {
      edges: sections.edges,
      notes: { ...sections.notes, [id]: note },
    },
  };
}

/** Editing a selected subrange splits its identity; other same-color sections keep their own notes. */
export function editSectionRange<T extends SectionGeometry>(
  source: T,
  path: { part: number; from: number; to: number },
  color: string,
  note: string,
): T {
  const sections = materializeSections(source),
    row = sections.edges[path.part];
  if (!row || path.from < 0 || path.to > row.length || path.to <= path.from)
    throw new Error('所选路段已变化');
  const first = row[path.from];
  const entire =
    !!first &&
    sections.edges.every((r, p) =>
      r.every(
        (id, e) =>
          id !== first || (p === path.part && e >= path.from && e < path.to),
      ),
    ) &&
    row.slice(path.from, path.to).every((id) => id === first);
  const id = entire ? first! : crypto.randomUUID();
  const edges = sections.edges.map((r, p) =>
    r.map((old, e) =>
      p === path.part && e >= path.from && e < path.to ? id : old,
    ),
  );
  return editSection(
    {
      ...source,
      sections: { edges, notes: { ...sections.notes, [id]: note } },
    },
    id,
    color,
    note,
  );
}
