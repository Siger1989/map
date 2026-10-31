import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileOsmGraph, vehicleAccess } from '../modules/offlineRouting/osmGraph.ts';
import { offlineRoute, validateGraph } from '../modules/offlineRouting/engine.ts';
import { matchingGraphs, offlineProfileForMode, tryOfflineRoute } from '../modules/offlineRouting/provider.ts';

const nodes = [
  { type: 'node', id: 1, lon: 0, lat: 0 },
  { type: 'node', id: 2, lon: 0.001, lat: 0 },
  { type: 'node', id: 3, lon: 0.001, lat: 0.001 },
  { type: 'node', id: 4, lon: 0.002, lat: 0 },
  { type: 'node', id: 5, lon: 0.002, lat: 0.001 },
  { type: 'node', id: 6, lon: 0.003, lat: 0.001 },
];
const way = (id, refs, tags = {}) => ({
  type: 'way', id, nodes: refs,
  tags: { highway: 'residential', name: `Road ${id}`, ...tags },
});
const relation = (restriction) => ({
  type: 'relation', id: 90, tags: { type: 'restriction', restriction },
  members: [
    { type: 'way', ref: 10, role: 'from' },
    { type: 'node', ref: 2, role: 'via' },
    { type: 'way', ref: 11, role: 'to' },
  ],
});
const compile = (profile, ways, extra = []) => compileOsmGraph(
  { elements: [...nodes, ...extra, ...ways] }, 'fixture', [-0.01, -0.01, 0.01, 0.01], `g-${profile}`, 1, profile,
);
const place = (x, y) => ({ name: 'test', coordinates: [x, y] });
const route = (graph, a, b) => offlineRoute(graph, [place(...a), place(...b)], new AbortController().signal);

test('vehicle graphs are profile-specific and honor one-way direction', async () => {
  const ways = [way(10, [1, 2], { oneway: 'yes' }), way(11, [2, 3])];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('network must stay blocked during offline route calculation'); };
  try {
    for (const profile of ['motorcar', 'motorcycle']) {
      const graph = compile(profile, ways);
      assert.equal(graph.profile, profile);
      const forward = await route(graph, [0.0002, 0], [0.001, 0.0008]);
      assert.equal(forward.mode, profile === 'motorcar' ? 'auto' : 'motorcycle');
      await assert.rejects(route(graph, [0.0008, 0], [0.0002, 0]), /不连通/);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('vehicle off-road endpoint connectors remain explicitly walking access, not road legs', async () => {
  const graph = compile('motorcar', [way(15, [1, 2]), way(16, [2, 3])]);
  const planned = await route(graph, [0.0005, 0.0002], [0.0012, 0.0005]);
  assert.ok(planned.accessDistance > 0);
  assert.ok(planned.segments.some((segment) => segment.kind === 'access'));
  assert.equal(planned.roadLegs.length, 1);
  assert.deepEqual(planned.roadLegs[0][0], planned.snapped[0]);
  assert.deepEqual(planned.roadLegs[0].at(-1), planned.snapped[1]);
  assert.ok(planned.steps.some((step) => step.kind === 'access' && step.instruction.includes('虚线')));
  await assert.rejects(
    offlineRoute(graph, [place(0, 0), place(0.001, 0), place(0.002, 0.001)], new AbortController().signal),
    /只支持起点和终点/,
  );
});

test('motorcar and motorcycle access tags produce different graphs', () => {
  const ways = [
    way(10, [1, 2], { motorcar: 'no', motorcycle: 'yes' }),
    way(11, [2, 3]),
    way(12, [3, 4]),
  ];
  const car = compile('motorcar', ways), motorcycle = compile('motorcycle', ways);
  assert.ok(car.edges.every((edge) => edge.wayId !== 10));
  assert.ok(motorcycle.edges.some((edge) => edge.wayId === 10));
  assert.equal(vehicleAccess({ highway: 'residential', access: 'no', motorcar: 'yes' }, 'motorcar'), true);
});

test('known no-turn and only-turn relations constrain A* transitions at their via node', async () => {
  const ways = [
    way(10, [1, 2]),
    way(11, [2, 3]),
    way(12, [2, 4]),
    way(13, [4, 3]),
    way(14, [3, 5]),
  ];
  const noTurn = compile('motorcar', [...ways, relation('no_left_turn')]);
  const detour = await route(noTurn, [0, 0], [0.001, 0.001]);
  assert.ok(detour.coordinates.some(([x]) => x === 0.002));
  const onlyTurn = compile('motorcycle', [
    ...ways,
    { ...relation('only_straight_on'), id: 91, members: relation('only_straight_on').members.map((m) => m.role === 'to' ? { ...m, ref: 11 } : m) },
  ]);
  const constrained = await route(onlyTurn, [0, 0], [0.002, 0]);
  assert.ok(constrained.coordinates.some(([x, y]) => x === 0.001 && y === 0.001));
});

test('only-turn remains enforced when its target way is excluded from the vehicle graph', async () => {
  const blockedTarget = relation('only_straight_on');
  blockedTarget.members = blockedTarget.members.map((m) =>
    m.role === 'from' ? { ...m, ref: 80 } : m.role === 'to' ? { ...m, ref: 81 } : m,
  );
  const graph = compile('motorcar', [
    way(80, [1, 2]),
    way(81, [2, 3], { motorcar: 'no' }),
    way(82, [2, 4]),
    blockedTarget,
  ]);
  assert.equal(graph.turnRestrictions.length, 1);
  assert.equal(graph.turnRestrictions[0].kind, 'only');
  assert.equal(graph.edges.some((edge) => edge.wayId === 81), false);
  assert.equal(validateGraph(graph).turnRestrictions.length, 1);
  await assert.rejects(route(graph, [0, 0], [0.002, 0]), /不连通/);
  const noTurnToMissingWay = {
    ...blockedTarget,
    id: 96,
    tags: { type: 'restriction', restriction: 'no_left_turn' },
  };
  const noGraph = compile('motorcar', [
    way(80, [1, 2]), way(81, [2, 3], { motorcar: 'no' }), way(82, [2, 4]), noTurnToMissingWay,
  ]);
  assert.equal(noGraph.turnRestrictions.length, 0);
  assert.ok((await route(noGraph, [0, 0], [0.002, 0])).distance > 0);
});

test('turn-state search may revisit a junction without the old node-count backtrack cutoff', async () => {
  const ways = [
    way(90, [1, 2], { oneway: 'yes' }),
    way(91, [2, 3], { oneway: 'yes' }),
    way(92, [3, 2], { oneway: 'yes' }),
    way(93, [2, 4], { oneway: 'yes' }),
    way(94, [4, 2], { oneway: 'yes' }),
    way(95, [2, 5], { oneway: 'yes' }),
  ];
  const only = (id, from, to) => ({
    type: 'relation', id,
    tags: { type: 'restriction', restriction: 'only_straight_on' },
    members: [
      { type: 'way', ref: from, role: 'from' },
      { type: 'node', ref: 2, role: 'via' },
      { type: 'way', ref: to, role: 'to' },
    ],
  });
  const graph = compile('motorcar', [...ways, only(190, 90, 91), only(191, 92, 93), only(192, 94, 95)]);
  const planned = await route(graph, [0, 0], [0.002, 0.001]);
  assert.equal(planned.roadLegs[0].length, 7);
  assert.equal(planned.steps.length, 6);
});

test('turn exceptions stay profile-specific and unsupported via-way restrictions fail closed', async () => {
  const ways = [way(50, [1, 2]), way(51, [2, 3])];
  const exceptionRelation = {
    ...relation('no_left_turn'), id: 92,
    tags: { type: 'restriction', restriction: 'no_left_turn', except: 'motorcar' },
    members: relation('no_left_turn').members.map((m) => m.role === 'from' ? { ...m, ref: 50 } : m.role === 'to' ? { ...m, ref: 51 } : m),
  };
  const car = compile('motorcar', [...ways, exceptionRelation]);
  const motorcycle = compile('motorcycle', [...ways, exceptionRelation]);
  assert.ok((await route(car, [0, 0], [0.001, 0.001])).distance > 0);
  await assert.rejects(route(motorcycle, [0, 0], [0.001, 0.001]), /不连通/);
  const viaWay = {
    type: 'relation', id: 93,
    tags: { type: 'restriction', restriction: 'no_straight_on' },
    members: [
      { type: 'way', ref: 50, role: 'from' },
      { type: 'way', ref: 60, role: 'via' },
      { type: 'way', ref: 51, role: 'to' },
    ],
  };
  const guarded = compile('motorcar', [...ways, way(52, [3, 4]), viaWay]);
  assert.ok(guarded.edges.every((edge) => edge.wayId !== 50 && edge.wayId !== 51));
  const carOnlyTurn = {
    ...relation('no_left_turn'), id: 94,
    tags: { type: 'restriction', 'restriction:motorcar': 'no_left_turn' },
    members: relation('no_left_turn').members.map((m) => m.role === 'from' ? { ...m, ref: 50 } : m.role === 'to' ? { ...m, ref: 51 } : m),
  };
  const carOnlyCar = compile('motorcar', [...ways, carOnlyTurn]);
  const carOnlyMotorcycle = compile('motorcycle', [...ways, carOnlyTurn]);
  await assert.rejects(route(carOnlyCar, [0, 0], [0.001, 0.001]), /不连通/);
  assert.ok((await route(carOnlyMotorcycle, [0, 0], [0.001, 0.001])).distance > 0);
  const selfWayUTurn = {
    type: 'relation', id: 95,
    tags: { type: 'restriction', restriction: 'no_u_turn' },
    members: [
      { type: 'way', ref: 62, role: 'from' },
      { type: 'node', ref: 2, role: 'via' },
      { type: 'way', ref: 62, role: 'to' },
    ],
  };
  const uTurnGuard = compile('motorcar', [way(62, [1, 2, 3]), way(63, [2, 4]), selfWayUTurn]);
  assert.ok(uTurnGuard.edges.every((edge) => edge.wayId !== 62));
});

test('turn restriction keys inherit vehicle scopes and legacy type suffixes', async () => {
  const path = [way(100, [1, 2]), way(101, [2, 3])];
  const makeRelation = (tags) => ({
    type: 'relation', id: 110,
    tags,
    members: [
      { type: 'way', ref: 100, role: 'from' },
      { type: 'node', ref: 2, role: 'via' },
      { type: 'way', ref: 101, role: 'to' },
    ],
  });
  const cases = [
    { name: 'motor_vehicle key inherits to both modes', tags: { type: 'restriction', 'restriction:motor_vehicle': 'no_left_turn' }, car: false, moto: false },
    { name: 'vehicle key inherits to both modes', tags: { type: 'restriction', 'restriction:vehicle': 'no_left_turn' }, car: false, moto: false },
    { name: 'legacy motorcar type scopes generic value to car', tags: { type: 'restriction:motorcar', restriction: 'no_left_turn' }, car: false, moto: true },
    { name: 'legacy motorcycle type scopes generic value to motorcycle', tags: { type: 'restriction:motorcycle', restriction: 'no_left_turn' }, car: true, moto: false },
    { name: 'legacy motor_vehicle type inherits to both modes', tags: { type: 'restriction:motor_vehicle', restriction: 'no_left_turn' }, car: false, moto: false },
    { name: 'specific motorcycle key does not restrict car', tags: { type: 'restriction', 'restriction:motorcycle': 'no_left_turn' }, car: true, moto: false },
    { name: 'specific motorcar key does not restrict motorcycle', tags: { type: 'restriction', 'restriction:motorcar': 'no_left_turn' }, car: false, moto: true },
    { name: 'except motor_vehicle exempts both modes', tags: { type: 'restriction', restriction: 'no_left_turn', except: 'motor_vehicle' }, car: true, moto: true },
    { name: 'except vehicle exempts both modes', tags: { type: 'restriction', restriction: 'no_left_turn', except: 'vehicle' }, car: true, moto: true },
    { name: 'except motorcar exempts only car', tags: { type: 'restriction', restriction: 'no_left_turn', except: 'motorcar' }, car: true, moto: false },
  ];
  for (const item of cases) {
    for (const [profile, expected] of [['motorcar', item.car], ['motorcycle', item.moto]]) {
      const graph = compile(profile, [...path, makeRelation(item.tags)]);
      const planned = route(graph, [0, 0], [0.001, 0.001]);
      if (expected) assert.ok((await planned).distance > 0, `${item.name} (${profile})`);
      else await assert.rejects(planned, /不连通/, `${item.name} (${profile})`);
    }
  }
});

test('conditional turn tags are scoped by vehicle class and unknown type suffixes fail closed', () => {
  const relationFor = (id, tags, from = 120, to = 121) => ({
    type: 'relation', id, tags,
    members: [
      { type: 'way', ref: from, role: 'from' },
      { type: 'node', ref: 2, role: 'via' },
      { type: 'way', ref: to, role: 'to' },
    ],
  });
  const ways = [way(120, [1, 2]), way(121, [2, 3]), way(122, [1, 4]), way(123, [4, 3])];
  const motorcycleConditional = relationFor(220, {
    type: 'restriction',
    'restriction:motorcycle:conditional': 'no_left_turn @ (Mo-Fr)',
  });
  const carGraph = compile('motorcar', [...ways, motorcycleConditional]);
  const motoGraph = compile('motorcycle', [...ways, motorcycleConditional]);
  assert.ok(carGraph.edges.some((edge) => edge.wayId === 120));
  assert.ok(motoGraph.edges.every((edge) => edge.wayId !== 120 && edge.wayId !== 121));
  const unknownScope = relationFor(221, { type: 'restriction:unknown_vehicle', restriction: 'no_left_turn' });
  const guarded = compile('motorcar', [...ways, unknownScope]);
  assert.ok(guarded.edges.every((edge) => edge.wayId !== 120 && edge.wayId !== 121));
});

test('legacy v1 pedestrian package remains usable; v1 vehicle spoof and malformed v2 are rejected', async () => {
  const v2 = compile('pedestrian', [way(30, [1, 2]), way(31, [2, 3])]);
  const legacy = {
    ...v2,
    version: 1,
    edges: v2.edges.map(({ wayId, ...edge }) => edge),
  };
  delete legacy.turnRestrictions;
  const legacyBytes = JSON.stringify(legacy);
  assert.equal(validateGraph(legacy).version, 1);
  assert.equal(JSON.stringify(legacy), legacyBytes);
  const oldRoute = await offlineRoute(legacy, [place(0, 0), place(0.001, 0)], new AbortController().signal);
  assert.equal(oldRoute.mode, 'pedestrian');
  assert.throws(() => validateGraph({ ...legacy, profile: 'motorcar' }), /旧版离线路网仅支持步行/);
  assert.throws(() => validateGraph({ ...v2, edges: v2.edges.map(({ wayId, ...edge }) => edge), profile: 'motorcycle' }), /连接无效/);
  assert.equal(vehicleAccess({ highway: 'residential', 'motorcar:conditional': 'no @ (Mo-Fr)' }, 'motorcar'), false);
});

test('only the exact in-bounds route profile matches a saved offline package', () => {
  const base = { id: 'x', name: 'x', bounds: [-1, -1, 1, 1], createdAt: 1, attribution: 'OSM', nodes: 2, edges: 2, bytes: 1, digest: 'x' };
  const graphs = [
    { ...base, id: 'walk', profile: 'pedestrian' },
    { ...base, id: 'car', profile: 'motorcar' },
    { ...base, id: 'moto', profile: 'motorcycle' },
  ];
  const stop = place(0, 0);
  for (const [mode, profile, id] of [
    ['auto', 'motorcar', 'car'],
    ['motorcycle', 'motorcycle', 'moto'],
    ['pedestrian', 'pedestrian', 'walk'],
  ]) {
    assert.equal(offlineProfileForMode(mode), profile);
    assert.deepEqual(matchingGraphs(graphs, [stop], profile).map((g) => g.id), [id]);
  }
  assert.equal(offlineProfileForMode('bicycle'), null);
  assert.deepEqual(matchingGraphs(graphs, [place(2, 2)], 'motorcycle'), []);
});

test('motorcycle provider never falls through to another online mode', async () => {
  const signal = new AbortController().signal;
  await assert.rejects(
    tryOfflineRoute([place(0, 0), place(0.001, 0)], 'motorcycle', signal, 'online'),
    /不能改用汽车或自行车在线方案/,
  );
  assert.equal(await tryOfflineRoute([place(0, 0), place(0.001, 0)], 'auto', signal, 'online'), null);
});

test('bounded public OSM extract compiles both vehicle profiles with fetch disabled', async () => {
  const raw = JSON.parse(await readFile(new URL('./fixtures/offline-routing/berlin-small-osm.json', import.meta.url), 'utf8'));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('offline QA must not reach network'); };
  try {
    for (const profile of ['motorcar', 'motorcycle']) {
      const graph = validateGraph(compileOsmGraph(raw, 'public OSM sample', [13.404,52.519,13.406,52.521], 'public-'+profile, 1, profile));
      const planned = await offlineRoute(graph, [
        { name: 'fixture start', coordinates: [13.4048063,52.5201631] },
        { name: 'fixture end', coordinates: [13.4042511,52.5205732] },
      ], new AbortController().signal);
      assert.equal(planned.routingSource.kind, 'offline');
      assert.equal(planned.mode, profile === 'motorcar' ? 'auto' : 'motorcycle');
      assert.ok(planned.distance > 50 && planned.distance < 70);
      assert.ok((planned.accessDistance ?? 0) < .1);
    }
  } finally { globalThis.fetch = originalFetch; }
});

test('directional access and profile-specific one-way values override general vehicle direction only', async () => {
  const graphWays = [way(40, [100, 101], { oneway: 'yes', 'oneway:motorcycle': 'no', 'motorcar:forward': 'no' }), way(41, [101, 102])];
  const extra = [
    { type: 'node', id: 100, lon: 0, lat: 0 },
    { type: 'node', id: 101, lon: 0.01, lat: 0 },
    { type: 'node', id: 102, lon: 0.01, lat: 0.01 },
  ];
  const car = compile('motorcar', graphWays, extra);
  const motorcycle = compile('motorcycle', graphWays, extra);
  await assert.rejects(route(car, [0, 0], [0.01, 0]), /道路超过120米/);
  assert.ok((await route(motorcycle, [0.009, 0], [0.001, 0])).distance > 0);
  const foot = compile('pedestrian', [way(42, [1, 2], { oneway: 'yes' }), way(43, [2, 3])]);
  assert.ok((await route(foot, [0.0008, 0], [0.0002, 0])).distance > 0);
});

test('conditional vehicle and directional rules fail closed and duplicate OSM way ids reject the extract', () => {
  const conditional = compile('motorcar', [
    way(70, [1, 2], { 'motor_vehicle:conditional': 'no @ (Mo-Fr)' }),
    way(71, [2, 3]),
  ]);
  assert.ok(conditional.edges.every((edge) => edge.wayId !== 70));
  assert.equal(vehicleAccess({ highway: 'residential', 'motorcar:forward:conditional': 'no @ (Mo-Fr)' }, 'motorcar'), false);
  const unknownDirection = compile('motorcar', [
    way(73, [1, 2], { oneway: 'alternating' }), way(74, [2, 3]),
  ]);
  assert.ok(unknownDirection.edges.every((edge) => edge.wayId !== 73));
  assert.throws(() => compile('motorcycle', [way(72, [1, 2]), way(72, [2, 3])]), /重复道路编号/);
});
