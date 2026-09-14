import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compileOsmGraph,
  footAccess,
} from '../modules/offlineRouting/osmGraph.ts';
import {
  offlineRoute,
  validateGraph,
} from '../modules/offlineRouting/engine.ts';
const nodes = [
  { type: 'node', id: 1, lon: 0, lat: 0 },
  { type: 'node', id: 2, lon: 0.002, lat: 0 },
  { type: 'node', id: 3, lon: 0.002, lat: 0.002 },
  { type: 'node', id: 4, lon: 0, lat: 0.002 },
];
const way = (id, points, tags = {}) => ({
  type: 'way',
  id,
  nodes: points,
  tags: { highway: 'footway', name: '步道' + id, ...tags },
});
const compile = (ways, extra = []) =>
  compileOsmGraph(
    {
      elements: [
        ...new Map([...nodes, ...extra].map((n) => [n.id, n])).values(),
        ...ways,
      ],
    },
    'test',
    [-0.01, -0.01, 0.01, 0.01],
    'test',
    1,
  );
const place = (x, y) => ({ name: 'test', coordinates: [x, y] });
test('offline engine routes along topology, snaps inside edges and keeps intermediate stops without fetch', async () => {
  const graph = compile([way(10, [1, 2, 3, 4])]);
  const before = JSON.stringify(graph),
    old = globalThis.fetch;
  globalThis.fetch = () => {
    throw Error('network forbidden');
  };
  try {
    const route = await offlineRoute(
      graph,
      [place(0.0005, 0), place(0.002, 0.001), place(0.0005, 0.002)],
      new AbortController().signal,
    );
    assert.equal(route.routingSource.kind, 'offline');
    assert.equal(route.stops.length, 3);
    assert.ok(route.distance > 500 && route.distance < 700);
    assert.ok(route.coordinates.some((p) => p[0] === 0.002 && p[1] === 0));
    assert.ok(route.coordinates.some((p) => p[0] === 0.002 && p[1] === 0.002));
    assert.equal(JSON.stringify(graph), before);
  } finally {
    globalThis.fetch = old;
  }
});
test('offline engine honors foot-only direction and refuses disconnected or out-of-region routes', async () => {
  const g = compile([
    way(10, [1, 2], { 'oneway:foot': 'yes' }),
    way(11, [3, 4]),
  ]);
  await assert.rejects(
    () =>
      offlineRoute(
        g,
        [place(0.0015, 0), place(0.0005, 0)],
        new AbortController().signal,
      ),
    /不连通/,
  );
  await assert.rejects(
    () =>
      offlineRoute(
        g,
        [place(0, 0), place(0, 0.002)],
        new AbortController().signal,
      ),
    /不连通/,
  );
  await assert.rejects(
    () =>
      offlineRoute(g, [place(0, 0), place(1, 1)], new AbortController().signal),
    /超出/,
  );
});
test('foot graph rejects uncertain access and does not bridge gates, conditional restrictions or private ways', () => {
  for (const tags of [
    { access: 'private' },
    { 'foot:conditional': 'yes @ (sunrise-sunset)' },
    { foot: 'no' },
    { ford: 'yes' },
  ])
    assert.equal(footAccess({ highway: 'path', ...tags }), false);
  assert.equal(
    footAccess({ highway: 'path', access: 'private', foot: 'yes' }),
    true,
  );
  const graph = compile(
    [
      way(10, [1, 2, 3]),
      way(11, [3, 4], { access: 'private' }),
      way(12, [1, 4]),
    ],
    [
      {
        type: 'node',
        id: 2,
        lon: 0.002,
        lat: 0,
        tags: { barrier: 'gate', access: 'private' },
      },
    ],
  );
  assert.ok(graph.edges.every((e) => e.from !== 2 && e.to !== 2));
  assert.equal(graph.edges.length, 2);
  assert.throws(
    () =>
      validateGraph({
        ...graph,
        edges: [{ from: 1, to: 999, metres: 5, name: 'bad' }],
      }),
    /连接无效/,
  );
});
test('offline engine respects cancellation without modifying the package', async () => {
  const graph = compile([way(10, [1, 2, 3])]),
    controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () =>
      offlineRoute(
        graph,
        [place(0, 0), place(0.002, 0.002)],
        controller.signal,
      ),
    { name: 'AbortError' },
  );
});
