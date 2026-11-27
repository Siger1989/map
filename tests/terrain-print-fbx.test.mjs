import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, LoadingManager, Texture } from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { exportTerrainPrintFbx, terrainPrintTextureMapping } from '../modules/terrainPrint/fbx.ts';
import { terrainPrintStl } from '../modules/terrainPrint/mesh.ts';

const grid = {
  width: 3, height: 3,
  eastWestMeters: 16, northSouthMeters: 12,
  elevations: [20, 21, 22, 23, 24, 25, 26, 27, 28],
};
const options = { shape: 'rectangle', widthMm: 160, baseMm: 4, rimMm: 4 };

function findMesh(root) {
  let mesh;
  root.traverse(object => { if (object.isMesh) mesh = object; });
  assert.ok(mesh);
  return mesh;
}

test('FBX loader imports original millimetre geometry, normals, UVs and separate base', () => {
  const stl = terrainPrintStl(grid, options);
  const scene = new FBXLoader().parse(exportTerrainPrintFbx(stl, options), '');
  const mesh = findMesh(scene);
  const bounds = new Box3().setFromObject(mesh);
  assert.deepEqual(bounds.min.toArray(), [-84, -64, 0]);
  assert.deepEqual(bounds.max.toArray(), [84, 64, 84]);
  assert.equal(scene.userData.unitScaleFactor, 0.1);
  assert.equal(mesh.geometry.getAttribute('position').count / 3, new DataView(stl).getUint32(80, true));
  assert.equal(mesh.geometry.getAttribute('normal').count, mesh.geometry.getAttribute('position').count);
  assert.equal(mesh.geometry.getAttribute('uv').count, mesh.geometry.getAttribute('position').count);
  assert.deepEqual(mesh.material.map(material => material.name), ['Terrain', 'Base']);
  assert.deepEqual([...new Set(mesh.geometry.groups.map(group => group.materialIndex))].sort(), [0, 1]);
});

test('the embedded PNG is linked to terrain only and is unchanged on reimport', async () => {
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAEklEQVQIHWNkYPj//z+QYABhACX2BP0mVU63AAAAAElFTkSuQmCC', 'base64');
  const stl = terrainPrintStl(grid, options);
  const data = new DataView(stl);
  const colors = ['#ffb477', '#ffb478', '#000000'];
  data.setUint16(84 + 48, 0x8000, true);
  data.setUint16(84 + 50 + 48, 0x8001, true);
  data.setUint16(84 + 100 + 48, 0x8000, true);
  data.setUint16(84 + 150 + 48, 0x8002, true);
  const buffer = exportTerrainPrintFbx(stl, options, {
    filename: 'source.png', bytes: Uint8Array.from(image).buffer, mime: 'image/png',
  }, colors);
  const manager = new LoadingManager();
  let objectUrl;
  const texture = new Texture();
  manager.addHandler(/^\.png$/, {
    setPath() {},
    load(url) { objectUrl = url; return texture; },
  });
  const previousWindow = globalThis.window;
  globalThis.window = { URL };
  try {
    const mesh = findMesh(new FBXLoader(manager).parse(buffer, ''));
    assert.equal(mesh.material[0].map, texture);
    assert.ok(mesh.material.slice(1).every(material => material.map === null));
    assert.deepEqual(mesh.material.slice(2).map(material => material.name), colors.map(color => `Track ${color}`));
    assert.deepEqual(mesh.material.slice(2).map(material => material.color.getHexString()), colors.map(color => color.slice(1)));
    assert.deepEqual(mesh.geometry.groups.slice(0, 4), [
      { start: 0, count: 3, materialIndex: 2 },
      { start: 3, count: 3, materialIndex: 3 },
      { start: 6, count: 3, materialIndex: 2 },
      { start: 9, count: 3, materialIndex: 4 },
    ]);
    assert.match(objectUrl, /^blob:/);
    const response = await fetch(objectUrl);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), image);
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('texture mapping and material classification use the terrain footprint without the rim', () => {
  const stl = terrainPrintStl(grid, options);
  const rect = terrainPrintTextureMapping(stl, options);
  assert.deepEqual(rect.coordinate(-80, -60), [0, 0]);
  assert.deepEqual(rect.coordinate(80, 60), [1, 1]);
  assert.ok(rect.isTerrainFace(-80, -60, 0, 0, 80, -60, 0.3));
  assert.ok(!rect.isTerrainFace(-84, -64, 0, 0, 80, -60, 1));
  assert.ok(!rect.isTerrainFace(-80, -60, 0, 0, 80, -60, -1));

  const round = { ...options, shape: 'circle' };
  const roundMap = terrainPrintTextureMapping(terrainPrintStl(grid, round), round);
  assert.deepEqual(roundMap.coordinate(0, 80), [0.5, 1]);
  assert.ok(roundMap.isTerrainFace(0, 0, 0, 80, 80, 0, 1));
  assert.ok(!roundMap.isTerrainFace(70, 70, 0, 80, 80, 0, 1));
});

test('invalid or oversized geometry input is rejected before export', () => {
  assert.throws(() => exportTerrainPrintFbx(new ArrayBuffer(84), options));
  const stl = terrainPrintStl(grid, options);
  new DataView(stl).setUint32(80, 700001, true);
  assert.throws(() => exportTerrainPrintFbx(stl, options));
});
