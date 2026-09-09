import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLastView } from '../modules/map/lastView.ts';
test('last camera preserves full position/zoom and rejects invalid storage', () => {
 const valid={center:[38.0073,10.0433],zoom:8.94,pitch:46,bearing:18.4};
 assert.deepEqual(parseLastView(JSON.stringify(valid)),valid);
 for(const bad of [null,'{',JSON.stringify({...valid,zoom:21}),JSON.stringify({...valid,center:[200,10]}),JSON.stringify({...valid,pitch:-1}),JSON.stringify({...valid,zoom:'8.9'})]) assert.equal(parseLastView(bad),null);
});
