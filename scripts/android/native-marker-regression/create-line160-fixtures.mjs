import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';

async function importBundled(entryPoint) {
  const result = await build({ entryPoints: [entryPoint], bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const [{ createNativeRouteGeometry }, { createNativeSceneGeometry }, { routeLineWidthScale }] = await Promise.all([
  importBundled('modules/map/native/routes.ts'),
  importBundled('modules/map/native/scene.ts'),
  importBundled('modules/map/zoomLineWidth.ts'),
]);

const outDir = resolve(process.argv[3] ?? '.openai');
await mkdir(outDir, { recursive: true });

const center = (process.argv[2] ?? '0,0').split(',').map(Number);
if (center.length !== 2 || !center.every(Number.isFinite) || Math.abs(center[0]) > 179 || Math.abs(center[1]) > 80) {
  throw new Error('Optional origin must be longitude,latitude within -179..179 and -80..80');
}
const atOrigin = ([lng, lat]) => [lng + center[0], lat + center[1]];
const makeLine = (lat, start = -0.004, end = 0.004) => [
  [start, lat], [-0.002, lat + 0.00015], [0.001, lat - 0.0001], [end, lat],
].map(atOrigin);
const accessLine = (lat) => [[-0.006, lat + 0.0006], [-0.005, lat + 0.0003], [-0.004, lat]].map(atOrigin);

function routeOverlay(width, color, lat, navigationClose) {
  const coordinates = makeLine(lat);
  return {
    start: null,
    end: null,
    navigationClose,
    navigationProgress: 145,
    route: {
      name: `合成 QA 路线宽度 ${width}`,
      style: { width, color },
      mode: 'auto',
      coordinates,
      segments: [
        { kind: 'road', coordinates },
        { kind: 'access', coordinates: accessLine(lat) },
      ],
      distance: 1600,
      duration: 700,
      steps: [],
      snapped: [],
      createdAt: 0,
    },
  };
}

const routeCompact = routeOverlay(2.5, '#d83b55', -0.0012, false);
const routeWide = routeOverlay(5, '#2778d8', 0.0012, true);
const routeFeatures = [routeCompact, routeWide].flatMap((route) =>
  createNativeRouteGeometry(route).features,
);

const selectedTrackLine = makeLine(-0.0032);
const compactTrackLine = makeLine(0.0032);
const trackOverlay = {
  saved: [
    {
      id: 'qa-selected-track', name: '合成 QA 选中轨迹', createdAt: 0,
      segments: [selectedTrackLine], nodes: selectedTrackLine,
      style: { color: '#ef5350', width: 4, opacity: 1 },
      simulation: true,
    },
    {
      id: 'qa-compact-track', name: '合成 QA 窄轨迹', createdAt: 0,
      segments: [compactTrackLine], nodes: compactTrackLine,
      style: { color: '#48a36c', width: 1.5, opacity: 1 },
      simulation: true,
    },
  ],
  draft: [],
  visible: true,
  style: { color: '#ffb477', width: 1.5, opacity: 1 },
  nodes: [],
  selectedId: 'qa-selected-track',
  editing: true,
  nodeSelection: { trackId: 'qa-selected-track', points: [selectedTrackLine[0], selectedTrackLine[1]] },
};

const guidanceRoute = makeLine(0.0048);
const guidanceOverlay = {
  coordinates: guidanceRoute,
  segments: [
    { kind: 'road', coordinates: guidanceRoute },
    { kind: 'access', coordinates: accessLine(0.0048) },
  ],
  target: guidanceRoute.at(-1),
};
const syntheticPosition = atOrigin([0, 0.0003]);

const stageSpecs = [
  { name: 'forward-z16', zoom: 16, pitch: 62, bearing: 0, cameraMode: 'forward', heading: 36 },
  { name: 'rotated-z14', zoom: 14, pitch: 55, bearing: 48, cameraMode: 'forward', heading: 84 },
  { name: 'top-z14', zoom: 14, pitch: 0, bearing: 0, cameraMode: 'top', heading: 0 },
  { name: 'top-z10', zoom: 10, pitch: 0, bearing: 0, cameraMode: 'top', heading: 0 },
  { name: 'rotated-z6', zoom: 6, pitch: 0, bearing: 90, cameraMode: 'top', heading: 270 },
  { name: 'forward-z10', zoom: 10, pitch: 60, bearing: 135, cameraMode: 'forward', heading: 135 },
  { name: 'forward-z6', zoom: 6, pitch: 50, bearing: 270, cameraMode: 'forward', heading: 225 },
];

function buildGeometry(cameraMode) {
  const scene = createNativeSceneGeometry({
    trackOverlay,
    routeOverlay: routeCompact,
    guidanceOverlay,
    navigationCues: {
      kind: 'route', coordinates: makeLine(0),
      position: syntheticPosition, accuracy: 5, progress: 450,
      cameraMode,
    },
    position: { coordinates: syntheticPosition },
    positionNavigating: true,
  });
  return {
    routes: { type: 'FeatureCollection', features: routeFeatures },
    tracks: scene.tracks,
    guidance: scene.guidance,
  };
}

function buildFixture(expectedScale) {
  return {
    version: 1,
    fixtureVersion: 160,
    fixturePurpose: 'synthetic route/track/guidance stroke-scale QA; no real location or saved records',
    stages: stageSpecs.map((stage) => ({
      name: stage.name,
      camera: { center, zoom: stage.zoom, pitch: stage.pitch, bearing: stage.bearing },
      expectedStrokeScale: expectedScale(stage.zoom),
      position: {
        coordinates: syntheticPosition,
        accuracy: 5,
        speed: 3,
        heading: stage.heading,
        provider: 'ip',
        source: 'qa',
        qaSynthetic: true,
      },
      positionHeading: stage.heading,
      positionNavigating: true,
      qaHeadingGlyph: stage.cameraMode === 'forward',
      renderGeometry: buildGeometry(stage.cameraMode),
    })),
  };
}

const beforeFixture = buildFixture(() => 1);
const afterFixture = buildFixture(routeLineWidthScale);
await writeFile(resolve(outDir, 'line159-before.json'), `${JSON.stringify(beforeFixture, null, 2)}\n`, 'utf8');
await writeFile(resolve(outDir, 'line160-after.json'), `${JSON.stringify(afterFixture, null, 2)}\n`, 'utf8');

const roles = new Map();
for (const feature of afterFixture.stages[0].renderGeometry.routes.features.concat(
  afterFixture.stages[0].renderGeometry.tracks.features,
  afterFixture.stages[0].renderGeometry.guidance.features,
)) {
  const role = feature.properties?.role;
  roles.set(role, (roles.get(role) ?? 0) + 1);
}
const required = ['routePath', 'routeOutline', 'routeAccess', 'track', 'trackHalo', 'selectedEdge', 'guidance', 'ribbon'];
const missing = required.filter((role) => !roles.has(role));
if (missing.length) throw new Error(`Synthetic fixture is missing required production roles: ${missing.join(', ')}`);
console.log(JSON.stringify({
  oldFixture: resolve(outDir, 'line159-before.json'),
  newFixture: resolve(outDir, 'line160-after.json'),
  stageCount: stageSpecs.length,
  expectedScales: stageSpecs.map(({ zoom }) => [zoom, routeLineWidthScale(zoom)]),
  roleCounts: Object.fromEntries(roles),
  syntheticOnly: true,
}, null, 2));
