import test from 'node:test';
import assert from 'node:assert/strict';
import { Matrix4 } from 'three';
import {
  MODEL_MASK_COLUMNS,
  MODEL_MASK_ROWS,
  MODEL_MASK_SIZE,
  TerrainModelMask,
} from '../modules/modelTerrain/terrainMask.ts';

function makeGL() {
  const listeners = new Map();
  const gl = {
    canvas: {
      addEventListener(name, listener) {
        const entries = listeners.get(name) ?? new Set();
        entries.add(listener);
        listeners.set(name, entries);
      },
      removeEventListener(name, listener) {
        listeners.get(name)?.delete(listener);
      },
      dispatch(name) {
        for (const listener of listeners.get(name) ?? []) listener(new Event(name));
      },
      listenerCount(name) {
        return listeners.get(name)?.size ?? 0;
      },
    },
    MAX_COMBINED_TEXTURE_IMAGE_UNITS: 1,
    ACTIVE_TEXTURE: 2,
    TEXTURE_BINDING_2D: 3,
    UNPACK_FLIP_Y_WEBGL: 4,
    UNPACK_PREMULTIPLY_ALPHA_WEBGL: 5,
    TEXTURE0: 100,
    TEXTURE_2D: 6,
    TEXTURE_MIN_FILTER: 7,
    TEXTURE_MAG_FILTER: 8,
    TEXTURE_WRAP_S: 9,
    TEXTURE_WRAP_T: 10,
    NEAREST: 11,
    CLAMP_TO_EDGE: 12,
    RGBA: 13,
    UNSIGNED_BYTE: 14,
    reads: 0,
    binds: 0,
    draws: 0,
    textures: [],
    uploads: [],
    uniformCounts: [],
    activeTextureValue: 100,
    binding: null,
    shaderSource(shader, source) {
      shader.source = source;
    },
    useProgram(program) {
      this.nativeProgram = program;
    },
    drawElements() {
      this.draws++;
    },
    createTexture() {
      const texture = { id: this.textures.length + 1 };
      this.textures.push(texture);
      return texture;
    },
    deleteTexture(texture) {
      this.deletedTexture = texture;
    },
    getParameter(parameter) {
      this.reads++;
      if (parameter === this.MAX_COMBINED_TEXTURE_IMAGE_UNITS) return 8;
      if (parameter === this.ACTIVE_TEXTURE) return this.activeTextureValue;
      if (parameter === this.TEXTURE_BINDING_2D) return this.binding;
      if (parameter === this.UNPACK_FLIP_Y_WEBGL) return false;
      if (parameter === this.UNPACK_PREMULTIPLY_ALPHA_WEBGL) return false;
      return null;
    },
    getUniformLocation(program, name) {
      return { program, name };
    },
    uniformMatrix4fv() {},
    uniform4fv() {},
    uniform1i(location, value) {
      if (location.name === 'u_model_count') this.uniformCounts.push(value);
    },
    activeTexture(value) {
      this.activeTextureValue = value;
    },
    bindTexture(_target, texture) {
      this.binds++;
      this.binding = texture;
    },
    texParameteri() {},
    pixelStorei() {},
    texImage2D(...args) {
      this.uploads.push(args.at(-1));
    },
  };
  return gl;
}

function useTerrainProgram(gl, program = {}) {
  gl.shaderSource({}, 'layout in a_pos3d; out v_fog_depth; void main() {}');
  gl.useProgram(program);
  return program;
}

function draw(gl) {
  gl.drawElements(4, 3, 5, 0);
}

test('disabled terrain draws clear the count once, then avoid GL reads and texture binds', () => {
  const gl = makeGL();
  const mask = new TerrainModelMask(gl);
  useTerrainProgram(gl);
  gl.reads = 0;
  gl.binds = 0;
  for (let i = 0; i < 100; i++) draw(gl);
  assert.equal(gl.draws, 100);
  assert.equal(gl.reads, 0);
  assert.equal(gl.binds, 0);
  assert.deepEqual(gl.uniformCounts, [0]);
  mask.dispose();
});

test('active to disabled transition writes zero once before passthrough', () => {
  const gl = makeGL();
  const mask = new TerrainModelMask(gl);
  useTerrainProgram(gl);
  const size = MODEL_MASK_COLUMNS * MODEL_MASK_ROWS * MODEL_MASK_SIZE ** 2 * 4;
  mask.setData(new Float32Array(320), new Uint8Array(size), 1);
  draw(gl);
  mask.disable();
  gl.reads = 0;
  gl.binds = 0;
  draw(gl);
  for (let i = 0; i < 20; i++) draw(gl);
  assert.deepEqual(gl.uniformCounts, [1, 0]);
  assert.equal(gl.reads, 0);
  assert.equal(gl.binds, 0);
  mask.dispose();
});

test('context restoration creates a new texture and reuploads retained atlas; dispose removes listener', () => {
  const gl = makeGL();
  const nativeDraw = gl.drawElements;
  const mask = new TerrainModelMask(gl);
  const program = useTerrainProgram(gl);
  const size = MODEL_MASK_COLUMNS * MODEL_MASK_ROWS * MODEL_MASK_SIZE ** 2 * 4;
  const atlas = new Uint8Array(size);
  atlas[0] = 123;
  mask.setData(new Float32Array(320), atlas, 1);
  draw(gl);
  assert.equal(gl.uploads.length, 1);
  assert.equal(gl.uploads[0], atlas);
  assert.equal(gl.canvas.listenerCount('webglcontextrestored'), 1);

  gl.canvas.dispatch('webglcontextrestored');
  assert.equal(gl.textures.length, 2);
  gl.useProgram(program);
  draw(gl);
  assert.equal(gl.uploads.length, 2);
  assert.equal(gl.uploads[1], atlas);
  assert.equal(gl.binding, null);

  mask.dispose();
  assert.equal(gl.canvas.listenerCount('webglcontextrestored'), 0);
  assert.equal(gl.drawElements, nativeDraw);
  const creates = gl.textures.length;
  gl.canvas.dispatch('webglcontextrestored');
  assert.equal(gl.textures.length, creates);
});

test('dispose does not overwrite a later GL wrapper', () => {
  const gl = makeGL();
  const mask = new TerrainModelMask(gl);
  const hook = gl.drawElements;
  const outer = (...args) => hook(...args);
  gl.drawElements = outer;
  mask.dispose();
  assert.equal(gl.drawElements, outer);
});

test('disabled camera frames do not churn revision or uniform updates', () => {
  const gl = makeGL();
  const mask = new TerrainModelMask(gl);
  useTerrainProgram(gl);
  const base = new Matrix4();
  mask.frame(base);
  draw(gl);
  mask.frame(base.clone().makeTranslation(1, 2, 3));
  draw(gl);
  assert.deepEqual(gl.uniformCounts, [0]);
  assert.equal(gl.reads, 1); // Constructor's texture-unit limit query only.
  mask.dispose();
});
