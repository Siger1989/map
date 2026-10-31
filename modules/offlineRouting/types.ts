import type { Coordinate } from '../navigation/types';
export type RoutingBounds = [number, number, number, number];
export type OfflineProfile = 'pedestrian' | 'motorcar' | 'motorcycle';
export type RoutingNode = { id: number; point: Coordinate };
export type RoutingEdge = {
  from: number;
  to: number;
  /** OSM way identity is required to evaluate via-node turn restrictions. */
  wayId: number;
  metres: number;
  name: string;
};
export type LegacyRoutingEdge = Omit<RoutingEdge, 'wayId'>;
export type StoredRoutingEdge = RoutingEdge | LegacyRoutingEdge;
export type TurnRestriction = {
  viaNodeId: number;
  fromWayId: number;
  toWayId: number;
  kind: 'no' | 'only';
};
export type OfflineGraph = {
  format: 'shantu-offline-routing';
  version: 2;
  id: string;
  name: string;
  bounds: RoutingBounds;
  createdAt: number;
  nodes: RoutingNode[];
  edges: RoutingEdge[];
  turnRestrictions: TurnRestriction[];
  attribution: string;
  profile: OfflineProfile;
};
export type LegacyPedestrianGraph = Omit<OfflineGraph, 'version' | 'edges' | 'turnRestrictions'> & {
  version: 1;
  profile: 'pedestrian';
  edges: LegacyRoutingEdge[];
  turnRestrictions?: never;
};
export type StoredOfflineGraph = OfflineGraph | LegacyPedestrianGraph;
export type GraphManifest = Pick<
  OfflineGraph,
  'id' | 'name' | 'bounds' | 'createdAt' | 'attribution' | 'profile'
> & { nodes: number; edges: number; bytes: number; digest: string };
export const GRAPH_LIMITS = {
  nodes: 60000,
  edges: 150000,
  bytes: 24 * 1024 * 1024,
  packages: 8,
  snapMetres: 120,
  maximumAreaKm2: 100,
};
export const inBounds = (p: Coordinate, b: RoutingBounds) =>
  p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];
