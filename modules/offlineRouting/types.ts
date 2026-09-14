import type { Coordinate } from '../navigation/types';
export type RoutingBounds = [number, number, number, number];
export type RoutingNode = { id: number; point: Coordinate };
export type RoutingEdge = {
  from: number;
  to: number;
  metres: number;
  name: string;
};
export type OfflineGraph = {
  format: 'shantu-offline-routing';
  version: 1;
  id: string;
  name: string;
  bounds: RoutingBounds;
  createdAt: number;
  nodes: RoutingNode[];
  edges: RoutingEdge[];
  attribution: string;
  profile: 'pedestrian';
};
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
