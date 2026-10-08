export type CadGeometry = GeoJSON.Point | GeoJSON.LineString | GeoJSON.Polygon;

export type CadFeature = {
  id: string;
  layer: string;
  color?: string;
  text?: string;
  geometry: CadGeometry;
  entityType: string;
  properties?: Record<string, unknown>;
};

export type CadDecoded = {
  name: string;
  format: 'dwg' | 'dxf';
  features: CadFeature[];
  layers: { name: string; color?: string }[];
  units?: string;
  unitScale?: number;
  crsHint?: string;
  warnings: string[];
};

export const CAD_LIMITS = {
  inputBytes: 20 * 1024 * 1024,
  entities: 20_000,
  vertices: 100_000,
  blockDepth: 8,
} as const;
