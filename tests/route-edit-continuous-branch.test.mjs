import test from 'node:test';
import assert from 'node:assert/strict';
import { startRouteEdit, selectEditNode, toggleEditBranch, appendEditBranchContinuous } from '../modules/tracks/routeEdit.ts';

test('interactive branch survives own junctions and other routes, and ends only on explicit End', () => {
  const a = [20, 10], b = [20.01, 10], c = [20.02, 10];
  const route = { id: 'qa-route', name: 'qa', createdAt: 0, source: 'manual', segments: [[a, b, c]], style: { color: '#f0a060', width: 2 } };
  let session = toggleEditBranch(selectEditNode(startRouteEdit(route), a));
  const branch = session.branch;
  const history = [];
  for (let i = 0; i < 12; i++) {
    const point = [20 + i * 0.0001, 10.0001 + i * 0.0001];
    session = appendEditBranchContinuous(session, point);
    assert.equal(session.branch, branch);
    history.push(point);
  }
  session = appendEditBranchContinuous(session, b);
  assert.equal(session.branch, branch, 'snapping to the original route does not dismiss the gesture overlay');
  const targetPoint = [20.04, 10.01];
  const target = { ...route, id: 'qa-other', segments: [[targetPoint, [20.05, 10.02]]] };
  session = appendEditBranchContinuous(session, targetPoint, target);
  assert.equal(session.branch, branch);
  session = appendEditBranchContinuous(session, [20.041, 10.011]);
  const complete = toggleEditBranch(session);
  assert.equal(complete.branch, null);
  assert.equal(complete.track.segments[branch].length, history.length + 4);
  assert.deepEqual(complete.track.segments[0], route.segments[0]);
  assert.equal(complete.sources.length, 1, 'snapping does not import or hide another route');
});
