import { sectionKey, type SavedSection } from '../section/profileNotes.ts';
import type { Transfer } from './types.ts';

export function mergeById<T extends { id: string }>(local: T[], incoming: T[]): T[] {
  const result = new Map(local.map((item) => [item.id, item]));
  for (const item of incoming) result.set(item.id, item);
  return [...result.values()];
}

function recordKey(record: SavedSection) {
  return record.settings.objectId
    ? `id:${record.settings.objectId}`
    : `geometry:${sectionKey(record.settings)}`;
}

export function mergeSectionNotes(local: SavedSection[], incoming: SavedSection[]) {
  const records = new Map(local.map((record) => [recordKey(record), record]));
  for (const source of incoming) {
    const key = recordKey(source), old = records.get(key);
    if (!old) {
      records.set(key, source);
      continue;
    }
    records.set(key, {
      ...source,
      notes: mergeById(old.notes, source.notes),
    });
  }
  return [...records.values()];
}

export type SyncSummary = {
  added: Record<string, number>;
  overwritten: Record<string, number>;
};

export function summarizeSync(before: Transfer, incoming: Transfer): SyncSummary {
  const fields = ['tracks', 'annotations', 'favorites', 'areas', 'measurements', 'sections'] as const;
  const added: Record<string, number> = {}, overwritten: Record<string, number> = {};
  for (const field of fields) {
    const oldIds = new Set((before[field] ?? []).map((item) => item.id));
    const old = new Map((before[field] ?? []).map((item) => [item.id, JSON.stringify(item)]));
    const items = incoming[field] ?? [];
    added[field] = items.filter((item) => !oldIds.has(item.id)).length;
    overwritten[field] = items.filter((item) => old.has(item.id) && old.get(item.id) !== JSON.stringify(item)).length;
  }
  const oldGroups = new Map((before.collections?.groups ?? []).map((group) => [group.id, JSON.stringify(group)]));
  added.groups = (incoming.collections?.groups ?? []).filter((group) => !oldGroups.has(group.id)).length;
  overwritten.groups = (incoming.collections?.groups ?? []).filter((group) => oldGroups.has(group.id) && oldGroups.get(group.id) !== JSON.stringify(group)).length;
  const oldRegions = before.regions ?? {}, incomingRegions = incoming.regions ?? {};
  added.regions = Object.keys(incomingRegions).filter((key) => !Object.hasOwn(oldRegions, key)).length;
  overwritten.regions = Object.entries(incomingRegions).filter(([key, value]) =>
    Object.hasOwn(oldRegions, key) && JSON.stringify(oldRegions[key]) !== JSON.stringify(value),
  ).length;
  const oldNotes = new Map<string, string>();
  for (const record of before.sectionNotes ?? [])
    for (const note of record.notes) oldNotes.set(`${recordKey(record)}:${note.id}`, JSON.stringify(note));
  added.sectionNotes = 0;
  overwritten.sectionNotes = 0;
  for (const record of incoming.sectionNotes ?? [])
    for (const note of record.notes) {
      const key = `${recordKey(record)}:${note.id}`;
      if (!oldNotes.has(key)) added.sectionNotes++;
      else if (oldNotes.get(key) !== JSON.stringify(note)) overwritten.sectionNotes++;
    }
  return { added, overwritten };
}
