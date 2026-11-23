import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Exercise the production scheduler/readiness logic without network or private keys.
// Only tile transport and WebGL are test doubles; mesh, coverage, camera and route
// generation run unchanged. Real-image browser evidence is recorded separately.
test('a journey draws imagery or real relief, switches providers and rejects missing elevations', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const bundle = await build({
    stdin: { contents: `
      export {createSatelliteTerrain} from './modules/sky/satelliteTerrainRenderer.ts';
      export {createJourneyPlayback,getJourneyPlaybackFrame} from './modules/sky/journeyPlayback.ts';
    `, resolveDir: root },
    bundle: true, platform: 'node', format: 'esm', write: false,
    plugins: [{ name: 'controlled-tile-transport', setup(api) {
      api.onLoad({ filter: /satelliteTerrainTiles\.ts$/ }, () => ({ loader: 'ts', contents: `
        export function satelliteImageryAvailable() { return true; }
        export async function loadSatelliteTile(tile,signal,remember) {
          const fixture=globalThis.journeyLoadingFixture;
          fixture.legacyRequests++;
          if(fixture.unavailable || tile.z>fixture.maximumZoom) return null;
          remember?.(new Blob(['controlled imagery fixture']));
          return {width:256,height:256,close(){}};
        }
        export async function loadJourneyImageryTile(source,tile,signal,remember) {
          const fixture=globalThis.journeyLoadingFixture;
          fixture.sourceRequests.push({id:source.id,z:tile.z});
          if(source.id==='missing') return null;
          if(source.id==='delayed') {
            fixture.delayedSignals.push(signal);
            await fixture.delayedTiles;
          }
          remember?.(new Blob([source.id]));
          return {width:256,height:256,close(){}};
        }
        export async function loadSatelliteDem() {
          if(globalThis.journeyLoadingFixture.noDem) return null;
          return Float32Array.from({length:65536},(_,i)=>500+(i%256)/10+(i>>8)/10);
        }
      ` }));
    } }],
  });
  const {createSatelliteTerrain, createJourneyPlayback, getJourneyPlaybackFrame} =
    await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
  const saved = { window: globalThis.window, createImageBitmap: globalThis.createImageBitmap };
  globalThis.window = { devicePixelRatio: 1 };
  globalThis.createImageBitmap = async () => ({ width: 256, height: 256, close() {} });
  const fixture = globalThis.journeyLoadingFixture = {
    maximumZoom: 14, unavailable: false, legacyRequests: 0, sourceRequests: [], delayedSignals: [],
  };
  const source = (id, minzoom = 0, maxzoom = 19) => ({
    id, name: id, kind: 'online', format: 'png', attribution: '', minzoom, maxzoom, tileSize: 256, bytes: 0,
  });
  const gl = new Proxy({}, { get(_target, name) {
    if (name === 'getExtension') return () => null;
    if (name === 'getShaderParameter' || name === 'getProgramParameter') return () => true;
    if (name === 'isContextLost') return () => false;
    if (String(name).startsWith('create') || name === 'getUniformLocation') return () => ({});
    if (name === 'getAttribLocation') return () => 0;
    return /^[A-Z_]+$/.test(String(name)) ? 0 : () => {};
  } });
  const canvas = { width: 390, height: 704, getContext: () => gl };
  const model = createJourneyPlayback({segments: [[
    {coordinates:[103.57,30.9]}, {coordinates:[103.575,30.903]},
  ]]});
  const frame = getJourneyPlaybackFrame(model, 0);
  const optics = {horizontalFov:38, verticalFov:65};
  let renderer;
  const draw = () => renderer.draw(
    {longitude:frame.cameraCoordinates[0],latitude:frame.cameraCoordinates[1]},
    {azimuth:frame.headingDeg,altitude:0,roll:0}, optics, 390, 704, undefined, {model,frame},
  );
  const settle = async (ready = state => state.status !== 'loading') => {
    draw();
    for (let i=0; i<100; i++) {
      await new Promise(resolve => setImmediate(resolve));
      draw();
      const state = renderer.journeyBuffer();
      if (ready(state)) return state;
    }
    assert.fail('controlled tile requests did not settle');
  };
  try {
    renderer = createSatelliteTerrain(canvas, () => {});
    const coarse = await settle(state => state.status === 'degraded' && state.minDetailZoom === 14);
    assert.equal(coarse.status, 'degraded');
    assert.equal(coarse.frameReady, true);
    assert.equal(coarse.frameDegraded, true);
    assert.equal(coarse.minDetailZoom, 14);
    assert.equal(coarse.loaded, coarse.total);
    assert.equal(coarse.frameHasImagery, true);

    fixture.maximumZoom = 17;
    renderer.retryJourneyBuffer();
    const recovered = await settle(state => state.status === 'ready');
    assert.equal(recovered.status, 'ready');
    assert.equal(recovered.frameReady, true);
    assert.equal(recovered.minDetailZoom, 17);
    assert.equal(recovered.detailLoaded, recovered.detailTotal);
    assert.equal(recovered.frameTerrainOnly, false);

    renderer.dispose();
    fixture.unavailable = true;
    renderer = createSatelliteTerrain(canvas, () => {});
    const relief = await settle();
    assert.equal(relief.status, 'degraded');
    assert.equal(relief.frameReady, true);
    assert.equal(relief.frameTerrainOnly, true);
    assert.equal(relief.frameHasImagery, false);
    assert.ok(relief.readyThroughDistanceM > 0);

    fixture.unavailable = false;
    renderer.retryJourneyBuffer();
    const textured = await settle(state => state.status === 'ready');
    assert.equal(textured.frameHasImagery, true);
    assert.equal(textured.frameTerrainOnly, false);

    renderer.dispose();
    fixture.noDem = true;
    renderer = createSatelliteTerrain(canvas, () => {});
    const missing = await settle();
    assert.equal(missing.status, 'unavailable');
    assert.equal(missing.frameReady, false);
    assert.equal(missing.loaded, 0);

    renderer.dispose();
    fixture.noDem = false;
    const legacyRequests = fixture.legacyRequests;
    renderer = createSatelliteTerrain(canvas, () => {}, source('first'));
    const first = await settle(state => state.status === 'ready');
    assert.equal(first.frameHasImagery, true);
    assert.ok(fixture.sourceRequests.length > 0);
    assert.ok(fixture.sourceRequests.every(request => request.id === 'first'));

    let releaseDelayedTiles;
    fixture.delayedTiles = new Promise(resolve => { releaseDelayedTiles = resolve; });
    renderer.setJourneySource(source('delayed'));
    assert.equal(renderer.journeyBuffer().frameHasImagery, false);
    draw();
    assert.ok(fixture.delayedSignals.length > 0);
    renderer.setJourneySource(source('missing'));
    assert.ok(fixture.delayedSignals.every(signal => signal.aborted));
    releaseDelayedTiles();
    const changed = await settle();
    assert.equal(changed.status, 'degraded');
    assert.equal(changed.frameReady, true);
    assert.equal(changed.frameHasImagery, false);
    assert.equal(changed.frameTerrainOnly, true);

    const beforeRelief = fixture.sourceRequests.length;
    renderer.setJourneySource(null);
    const onlyRelief = await settle();
    assert.equal(onlyRelief.frameTerrainOnly, true);
    assert.equal(onlyRelief.frameHasImagery, false);
    assert.equal(fixture.sourceRequests.length, beforeRelief);

    renderer.setJourneySource(source('limited', 13, 14));
    const limited = await settle(state => state.frameReady && state.frameHasImagery);
    assert.equal(limited.minDetailZoom, 14);
    const limitedRequests = fixture.sourceRequests.slice(beforeRelief);
    assert.ok(limitedRequests.length > 0);
    assert.ok(limitedRequests.every(({id,z}) => id === 'limited' && z >= 13 && z <= 14));
    assert.equal(fixture.legacyRequests, legacyRequests);
  } finally {
    renderer?.dispose();
    for (const [name,value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[name];
      else globalThis[name] = value;
    }
    delete globalThis.journeyLoadingFixture;
  }
});
