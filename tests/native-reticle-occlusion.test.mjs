import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { createNativeReticleOcclusion, reticleCovered } from '../mobile/native-reticle-occlusion.ts';

const rect = (left, top, right, bottom) => ({left, top, right, bottom});
const panel = (bounds, opacity = 1) => ({...bounds, opacity, radii:[23,23,23,23], blur:10, saturation:1.25});

test('only positive area overlap with visible glass suppresses the reticle', () => {
  const cursor = rect(170,400,222,452);
  assert.equal(reticleCovered(cursor,[panel(rect(16,56,300,440))]),true);
  assert.equal(reticleCovered(cursor,[panel(rect(16,56,300,400))]),false);
  assert.equal(reticleCovered(cursor,[panel(rect(330,56,380,700))]),false);
  assert.equal(reticleCovered(cursor,[panel(rect(16,56,300,440),0)]),false);
  assert.equal(reticleCovered(rect(0,0,0,0),[panel(rect(0,0,300,440))]),false);
});

test('opening, moving and closing glass restores main/dual reticles without moving them or changing marker controls', () => {
  const { document } = parseHTML('<html><body><i class="map-center-cursor"></i><i class="map-comparison-cross"></i><button class="center-add"></button></body></html>');
  const [main, dual] = document.querySelectorAll('i');
  main.getBoundingClientRect = () => rect(170,400,222,452);
  dual.getBoundingClientRect = () => rect(170,650,222,702);
  const sync = createNativeReticleOcclusion(document);
  const covered = el => el.hasAttribute('data-native-reticle-covered');
  sync.update([panel(rect(16,56,300,440))]);
  assert.deepEqual([covered(main),covered(dual)],[true,false]);
  assert.equal(document.querySelector('button').attributes.length,1);
  assert.equal(main.getAttribute('style'),null);
  sync.update([panel(rect(16,600,300,720))]);
  assert.deepEqual([covered(main),covered(dual)],[false,true]);
  sync.update([]);
  assert.deepEqual([covered(main),covered(dual)],[false,false]);
  sync.update([panel(rect(0,0,390,800))]);
  dual.remove();
  sync.update([panel(rect(0,0,390,800))]);
  assert.equal(covered(dual),false);
  sync.clear();
  assert.equal(covered(main),false);
});
