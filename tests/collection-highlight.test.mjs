import test from 'node:test';
import assert from 'node:assert/strict';
import { collectionHighlightData } from '../modules/collections/selectionHighlight.ts';
test('collection flash retains disconnected geometry and never mutates saved colors',()=>{
  const track={segments:[[[104,30],[104.01,30]],[[104.02,30],[104.03,30]]],style:{color:'#ff0000'},edgeColors:[['#ff0000'],['#0000ff']]};
  const entry={kind:'track',track};const before=JSON.stringify(entry);
  const data=collectionHighlightData(entry);
  assert.deepEqual(data.features[0].geometry,{type:'MultiLineString',coordinates:track.segments});
  assert.equal(JSON.stringify(entry),before);
  assert.equal(data.features[0].properties.role,'collectionHighlight');
});
test('a selected marker is highlighted at its actual anchor instead of a fabricated footprint',()=>{
  const data=collectionHighlightData({kind:'pin',coordinates:[104,30]});
  assert.deepEqual(data.features[0].geometry,{type:'Point',coordinates:[104,30]});
});
