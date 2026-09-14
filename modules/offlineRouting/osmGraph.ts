import { coordinate, metresBetween } from '../navigation/types.ts';
import {
  GRAPH_LIMITS,
  type OfflineGraph,
  type RoutingBounds,
} from './types.ts';
type Tags = Record<string, string>;
type OsmElement = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  tags?: Tags;
  members?: { type: string; ref: number }[];
};
const allowed = new Set(['yes', 'designated', 'permissive', 'official']);
const roads = new Set([
  'footway',
  'path',
  'pedestrian',
  'steps',
  'track',
  'residential',
  'living_street',
  'service',
  'unclassified',
  'tertiary',
  'tertiary_link',
  'secondary',
  'secondary_link',
]);
/** Conservative pedestrian profile: unknown conditional/private access is excluded. */
export function footAccess(tags: Tags, node = false) {
  if (
    Object.keys(tags).some((key) => /^(access|foot).*:conditional$/.test(key))
  )
    return false;
  if (tags.foot && !allowed.has(tags.foot)) return false;
  if (!tags.foot && tags.access && !allowed.has(tags.access)) return false;
  if (tags.locked === 'yes' || tags.ford === 'yes' || tags.highway === 'ford')
    return false;
  if (node)
    return (
      !tags.barrier ||
      ['bollard', 'cycle_barrier', 'kerb', 'entrance'].includes(tags.barrier) ||
      allowed.has(tags.foot)
    );
  if (
    tags.area === 'yes' ||
    tags.construction ||
    tags.proposed ||
    [
      'alpine_hiking',
      'demanding_alpine_hiking',
      'difficult_alpine_hiking',
    ].includes(tags.sac_scale)
  )
    return false;
  return (
    roads.has(tags.highway) ||
    (allowed.has(tags.foot) &&
      ['primary', 'primary_link', 'cycleway'].includes(tags.highway))
  );
}
export function compileOsmGraph(
  raw: unknown,
  name: string,
  bounds: RoutingBounds,
  id: string,
  now = Date.now(),
): OfflineGraph {
  const input = raw as { elements?: OsmElement[]; remark?: string };
  if (
    !Array.isArray(input?.elements) ||
    input.elements.length > 180000 ||
    input.remark
  )
    throw new Error('道路数据不完整或过大，请缩小区域重试');
  const nodes = new Map<number, OsmElement>(),
    blockedWays = new Set<number>();
  const seenNodes = new Set<number>();
  for (const e of input.elements) {
    if (e.type === 'node') {
      if (seenNodes.has(e.id)) throw new Error('道路数据包含重复节点');
      seenNodes.add(e.id);
    }
    if (
      e.type === 'node' &&
      Number.isSafeInteger(e.id) &&
      coordinate([e.lon, e.lat]) &&
      footAccess(e.tags ?? {}, true)
    )
      nodes.set(e.id, e);
    // Unsupported pedestrian turn/conditional restrictions fail closed for involved ways.
    if (
      e.type === 'relation' &&
      e.tags?.type?.startsWith('restriction') &&
      (e.tags['restriction:foot'] ||
        e.tags.type === 'restriction:foot' ||
        e.tags['restriction:conditional'])
    )
      for (const member of e.members ?? [])
        if (member.type === 'way') blockedWays.add(member.ref);
  }
  const used = new Set<number>(),
    edges: OfflineGraph['edges'] = [];
  for (const way of input.elements) {
    if (
      way.type !== 'way' ||
      !Array.isArray(way.nodes) ||
      !footAccess(way.tags ?? {}) ||
      blockedWays.has(way.id)
    )
      continue;
    const tags = way.tags ?? {},
      name = (tags.name ?? tags['name:zh'] ?? tags.highway ?? '步行路段').slice(
        0,
        100,
      );
    const forward =
      tags['oneway:foot'] !== '-1' && tags['foot:forward'] !== 'no';
    const backward =
      !['yes', '1', 'true'].includes(tags['oneway:foot']) &&
      tags['foot:backward'] !== 'no';
    for (let i = 1; i < way.nodes.length; i++) {
      const a = nodes.get(way.nodes[i - 1]),
        b = nodes.get(way.nodes[i]);
      if (!a || !b || a.id === b.id) continue;
      const metres = metresBetween([a.lon!, a.lat!], [b.lon!, b.lat!]);
      if (metres <= 0 || metres > 20000) continue;
      used.add(a.id);
      used.add(b.id);
      if (forward) edges.push({ from: a.id, to: b.id, metres, name });
      if (backward) edges.push({ from: b.id, to: a.id, metres, name });
      if (edges.length > GRAPH_LIMITS.edges || used.size > GRAPH_LIMITS.nodes)
        throw new Error('道路图过大，请分成更小区域');
    }
  }
  if (edges.length < 2) throw new Error('区域内没有可用的公开步行道路');
  return {
    format: 'shantu-offline-routing',
    version: 1,
    id,
    name: name.slice(0, 60),
    bounds,
    createdAt: now,
    profile: 'pedestrian',
    attribution: '© OpenStreetMap contributors · ODbL 1.0',
    nodes: [...used].map((id) => ({
      id,
      point: [nodes.get(id)!.lon!, nodes.get(id)!.lat!],
    })),
    edges,
  };
}
