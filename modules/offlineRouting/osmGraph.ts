import { coordinate, metresBetween } from '../navigation/types.ts';
import {
  GRAPH_LIMITS,
  type OfflineGraph,
  type OfflineProfile,
  type RoutingBounds,
  type TurnRestriction,
} from './types.ts';
type Tags = Record<string, string>;
type OsmElement = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  tags?: Tags;
  members?: { type: string; ref: number; role?: string }[];
};
type RelationRule = { from: number; via: number; to: number; kind: 'no' | 'only' };
const allowed = new Set(['yes', 'designated', 'permissive', 'official']);
const denied = new Set(['no', 'private', 'restricted', 'use_sidepath', 'agricultural', 'forestry', 'delivery', 'customers', 'destination']);
const pedestrianRoads = new Set([
  'footway', 'path', 'pedestrian', 'steps', 'track', 'residential',
  'living_street', 'service', 'unclassified', 'tertiary', 'tertiary_link',
  'secondary', 'secondary_link',
]);
const vehicleRoads = new Set([
  'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary',
  'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link',
  'unclassified', 'residential', 'living_street', 'service',
]);
const conditionalTag = (tags: Tags, profile: OfflineProfile) =>
  Object.keys(tags).some((key) => {
    const root = key.replace(/:conditional$/, '');
    const directionalRoot = root.replace(/:(forward|backward)$/, '');
    return key.endsWith(':conditional') &&
      (['access', 'vehicle', 'motor_vehicle', profile, 'oneway', `oneway:${profile}`, 'oneway:motor_vehicle', 'oneway:vehicle'].includes(directionalRoot) ||
        root.startsWith('restriction'));
  });

/** Conservative pedestrian access, retained for existing walk-only downloads. */
export function footAccess(tags: Tags, node = false) {
  if (Object.keys(tags).some((key) => /^(access|foot).*:conditional$/.test(key))) return false;
  if (tags.foot && !allowed.has(tags.foot)) return false;
  if (!tags.foot && tags.access && !allowed.has(tags.access)) return false;
  if (tags.locked === 'yes' || tags.ford === 'yes' || tags.highway === 'ford') return false;
  if (node)
    return !tags.barrier || ['bollard', 'cycle_barrier', 'kerb', 'entrance'].includes(tags.barrier) || allowed.has(tags.foot);
  if (tags.area === 'yes' || tags.construction || tags.proposed ||
      ['alpine_hiking', 'demanding_alpine_hiking', 'difficult_alpine_hiking'].includes(tags.sac_scale)) return false;
  return pedestrianRoads.has(tags.highway) ||
    (allowed.has(tags.foot) && ['primary', 'primary_link', 'cycleway'].includes(tags.highway));
}

function accessAllowed(tags: Tags, profile: 'motorcar' | 'motorcycle') {
  // OSM's increasingly specific access keys override broader keys.
  const keys = [profile, 'motor_vehicle', 'vehicle', 'access'];
  let value: string | undefined;
  for (const key of keys) if (tags[key] !== undefined) { value = tags[key]; break; }
  if (value !== undefined && !allowed.has(value)) return false;
  return true;
}

export function vehicleAccess(tags: Tags, profile: 'motorcar' | 'motorcycle', node = false) {
  if (conditionalTag(tags, profile) || !accessAllowed(tags, profile)) return false;
  if (tags.highway === 'construction' || tags.highway === 'proposed' || tags.construction || tags.proposed) return false;
  if (node) {
    if (tags.locked === 'yes' || tags.barrier === 'block' || tags.barrier === 'bollard' || tags.barrier === 'cycle_barrier') return false;
    if (tags.barrier && !['gate', 'lift_gate', 'swing_gate', 'entrance'].includes(tags.barrier)) return false;
    if (tags.barrier && !['yes', 'designated', 'permissive', 'official'].includes(tags[profile] ?? tags.motor_vehicle ?? '')) return false;
    return true;
  }
  if (tags.area === 'yes' || tags.ford === 'yes' || tags.highway === 'ford') return false;
  return vehicleRoads.has(tags.highway) && !denied.has(tags[profile] ?? '');
}

function direction(tags: Tags, profile: 'motorcar' | 'motorcycle') {
  const specific = tags[`oneway:${profile}`] ?? tags['oneway:motor_vehicle'] ?? tags['oneway:vehicle'];
  let value = specific ?? tags.oneway;
  if (value === undefined && (tags.junction === 'roundabout' || tags.highway === 'motorway' || tags.highway === 'motorway_link')) value = 'yes';
  let [forward, backward] = ['no', '0', 'false'].includes(value ?? '')
    ? [true, true]
    : value === '-1'
      ? [false, true]
      : ['yes', '1', 'true'].includes(value ?? '')
        ? [true, false]
        : value === undefined
          ? [true, true]
          : [false, false];
  const directional = (dir: 'forward' | 'backward') => {
    for (const key of [`${profile}:${dir}`, `motor_vehicle:${dir}`, `vehicle:${dir}`, `access:${dir}`])
      if (tags[key] !== undefined) return allowed.has(tags[key]);
    return true;
  };
  forward &&= directional('forward');
  backward &&= directional('backward');
  return [forward, backward];
}

const unrelatedRestrictionTypes = new Set([
  'foot', 'motorcar', 'motorcycle', 'bicycle', 'moped', 'bus', 'psv', 'taxi', 'hgv', 'goods',
  'agricultural', 'forestry', 'hazmat', 'caravan', 'trailer', 'emergency',
  'tram', 'train', 'boat', 'horse',
]);
function restrictionTypeApplies(tags: Tags, profile: 'motorcar' | 'motorcycle') {
  if (tags.type === 'restriction') return 'yes' as const;
  if (!tags.type?.startsWith('restriction:')) return 'unknown' as const;
  const scope = tags.type.slice('restriction:'.length);
  if ([profile, 'motor_vehicle', 'vehicle'].includes(scope)) return 'yes' as const;
  return unrelatedRestrictionTypes.has(scope) ? 'no' as const : 'unknown' as const;
}
function exceptsProfile(tags: Tags, profile: 'motorcar' | 'motorcycle') {
  const values = new Set((tags.except ?? '').split(';').map((v) => v.trim()).filter(Boolean));
  return values.has(profile) || values.has('motor_vehicle') || values.has('vehicle');
}
function conditionalTurnApplies(tags: Tags, profile: 'motorcar' | 'motorcycle') {
  return [
    `restriction:${profile}:conditional`,
    'restriction:motor_vehicle:conditional',
    'restriction:vehicle:conditional',
    'restriction:conditional',
  ].some((key) => tags[key] !== undefined);
}
function restrictionValue(tags: Tags, profile: 'motorcar' | 'motorcycle') {
  for (const key of [`restriction:${profile}`, 'restriction:motor_vehicle', 'restriction:vehicle'])
    if (tags[key] !== undefined) return tags[key];
  return tags.restriction;
}
function hasOtherScopedRestriction(tags: Tags, profile: 'motorcar' | 'motorcycle') {
  return Object.keys(tags).some((key) => {
    const scope = /^restriction:([^:]+)$/.exec(key)?.[1];
    return !!scope && scope !== profile &&
      (['motorcar', 'motorcycle'].includes(scope) || unrelatedRestrictionTypes.has(scope));
  });
}
function hasOtherScopedConditionalRestriction(tags: Tags, profile: 'motorcar' | 'motorcycle') {
  return Object.keys(tags).some((key) => {
    const scope = /^restriction:([^:]+):conditional$/.exec(key)?.[1];
    return !!scope && scope !== profile &&
      (['motorcar', 'motorcycle'].includes(scope) || unrelatedRestrictionTypes.has(scope));
  });
}

export function compileOsmGraph(
  raw: unknown,
  name: string,
  bounds: RoutingBounds,
  id: string,
  now = Date.now(),
  profile: OfflineProfile = 'pedestrian',
): OfflineGraph {
  const input = raw as { elements?: OsmElement[]; remark?: string };
  if (!Array.isArray(input?.elements) || input.elements.length > 180000 || input.remark)
    throw new Error('道路数据不完整或过大，请缩小区域重试');
  const isVehicle = profile !== 'pedestrian';
  const nodes = new Map<number, OsmElement>(), blockedWays = new Set<number>();
  const seenNodes = new Set<number>(), seenWays = new Set<number>();
  const turnRestrictions: TurnRestriction[] = [];
  for (const e of input.elements) {
    if (e.type === 'node') {
      if (seenNodes.has(e.id)) throw new Error('道路数据包含重复节点');
      seenNodes.add(e.id);
    }
    if (e.type === 'way') {
      if (seenWays.has(e.id)) throw new Error('道路数据包含重复道路编号');
      seenWays.add(e.id);
    }
    const access = e.tags ?? {};
    if (e.type === 'node' && Number.isSafeInteger(e.id) && coordinate([e.lon, e.lat]) &&
        (isVehicle ? vehicleAccess(access, profile as 'motorcar' | 'motorcycle', true) : footAccess(access, true))) nodes.set(e.id, e);
    if (e.type !== 'relation' || !e.tags?.type?.startsWith('restriction')) continue;
    if (!isVehicle) {
      if (e.tags['restriction:foot'] || e.tags.type === 'restriction:foot' || e.tags['restriction:conditional'])
        for (const member of e.members ?? []) if (member.type === 'way') blockedWays.add(member.ref);
      continue;
    }
    const vehicleProfile = profile as 'motorcar' | 'motorcycle',
      scope = restrictionTypeApplies(e.tags, vehicleProfile);
    if (scope === 'no' || exceptsProfile(e.tags, vehicleProfile)) continue;
    if (scope === 'unknown' || conditionalTurnApplies(e.tags, vehicleProfile)) {
      for (const member of e.members ?? []) if (member.type === 'way') blockedWays.add(member.ref);
      continue;
    }
    const value = restrictionValue(e.tags, vehicleProfile);
    if (value === undefined && (hasOtherScopedRestriction(e.tags, vehicleProfile) || hasOtherScopedConditionalRestriction(e.tags, vehicleProfile))) continue;
    const members = e.members ?? [],
      fromMembers = members.filter((m) => m.role === 'from' && m.type === 'way'),
      viaMembers = members.filter((m) => m.role === 'via'),
      toMembers = members.filter((m) => m.role === 'to' && m.type === 'way'),
      from = fromMembers[0]?.ref,
      via = viaMembers[0]?.type === 'node' ? viaMembers[0].ref : undefined,
      to = toMembers[0]?.ref,
      supported = fromMembers.length === 1 && viaMembers.length === 1 && via !== undefined && toMembers.length === 1;
    if (value && supported && from !== to && (value.startsWith('no_') || value.startsWith('only_')))
      turnRestrictions.push({ viaNodeId: via, fromWayId: from!, toWayId: to!, kind: value.startsWith('only_') ? 'only' : 'no' });
    else for (const member of members) if (member.type === 'way') blockedWays.add(member.ref);
  }
  const used = new Set<number>(), edges: OfflineGraph['edges'] = [];
  for (const way of input.elements) {
    const tags = way.tags ?? {};
    if (way.type !== 'way' || !Array.isArray(way.nodes) || blockedWays.has(way.id) ||
        !(isVehicle ? vehicleAccess(tags, profile as 'motorcar' | 'motorcycle') : footAccess(tags))) continue;
    const roadName = (tags.name ?? tags['name:zh'] ?? tags.highway ?? (isVehicle ? '未命名道路' : '步行路段')).slice(0, 100);
    const [forward, backward] = isVehicle
      ? direction(tags, profile as 'motorcar' | 'motorcycle')
      : [tags['oneway:foot'] !== '-1' && tags['foot:forward'] !== 'no', !['yes', '1', 'true'].includes(tags['oneway:foot'] ?? '') && tags['foot:backward'] !== 'no'];
    for (let i = 1; i < way.nodes.length; i++) {
      const a = nodes.get(way.nodes[i - 1]), b = nodes.get(way.nodes[i]);
      if (!a || !b || a.id === b.id) continue;
      const metres = metresBetween([a.lon!, a.lat!], [b.lon!, b.lat!]);
      if (metres <= 0 || metres > 20000) continue;
      used.add(a.id); used.add(b.id);
      if (forward) edges.push({ from: a.id, to: b.id, wayId: way.id, metres, name: roadName });
      if (backward) edges.push({ from: b.id, to: a.id, wayId: way.id, metres, name: roadName });
      if (edges.length > GRAPH_LIMITS.edges || used.size > GRAPH_LIMITS.nodes) throw new Error('道路图过大，请分成更小区域');
    }
  }
  if (edges.length < 2) throw new Error(`区域内没有可用的公开${profile === 'pedestrian' ? '步行' : '机动车'}道路`);
  const incomingWayByNode = new Map<number, Set<number>>(),
    outgoingWayByNode = new Map<number, Set<number>>();
  for (const edge of edges) {
    if (!incomingWayByNode.has(edge.to)) incomingWayByNode.set(edge.to, new Set());
    incomingWayByNode.get(edge.to)!.add(edge.wayId);
    if (!outgoingWayByNode.has(edge.from)) outgoingWayByNode.set(edge.from, new Set());
    outgoingWayByNode.get(edge.from)!.add(edge.wayId);
  }
  const connectedRestrictions = turnRestrictions.filter((r) => used.has(r.viaNodeId) &&
    incomingWayByNode.get(r.viaNodeId)?.has(r.fromWayId) &&
    (r.kind === 'only' || outgoingWayByNode.get(r.viaNodeId)?.has(r.toWayId)));
  return {
    format: 'shantu-offline-routing', version: 2, id, name: name.slice(0, 60), bounds, createdAt: now,
    profile, turnRestrictions: connectedRestrictions,
    attribution: '© OpenStreetMap contributors · ODbL 1.0',
    nodes: [...used].map((nodeId) => ({ id: nodeId, point: [nodes.get(nodeId)!.lon!, nodes.get(nodeId)!.lat!] })),
    edges,
  };
}
