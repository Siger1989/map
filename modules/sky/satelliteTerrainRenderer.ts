import type { SkyObserver } from './astronomy';
import type { DeviceSkyOptics, DeviceSkyPose } from './deviceSkyCamera';
import {
  buildSatelliteMesh, demTileFor, earthAxis, earthPosition, eyeCell, mercator, planSatelliteTiles, surfaceHeight,
  type Tile, type Vec3,
} from './satelliteTerrainGeometry';
import { loadSatelliteDem, loadSatelliteTile, satelliteImageryAvailable } from './satelliteTerrainTiles';

export type SatelliteTerrainStatus = 'loading' | 'ready' | 'partial' | 'unavailable' | 'error';
const rad = Math.PI / 180;
const workers = 4;
const maxResident = 48;
const initialNear = 0.75;
const horizonDistance = 190_000;

const vertexShader = `
attribute vec3 coordinate;
attribute vec2 imageUv;
uniform vec3 offsetFromEye, viewRight, viewUp, viewForward;
uniform vec2 tangent;
uniform vec2 depthRange;
varying vec2 uv;
void main(){
  vec3 relative = coordinate + offsetFromEye;
  float forward = dot(relative,viewForward);
  gl_Position = vec4(
    dot(relative,viewRight) / tangent.x,
    dot(relative,viewUp) / tangent.y,
    depthRange.x * forward - depthRange.y,
    forward
  );
  uv = imageUv;
}
`;
const fragmentShader = `
precision mediump float;
uniform sampler2D imagery;
varying vec2 uv;
void main(){
  gl_FragColor = texture2D(imagery,uv);
}
`;

interface Mesh {
  tile: Tile;
  height: Float32Array;
  vertex: WebGLBuffer;
  index: WebGLBuffer;
  texture: WebGLTexture;
  origin: Vec3;
  count: number;
}

function link(gl: WebGLRenderingContext) {
  function compile(type: number, source: string) {
    const shader = gl.createShader(type);
    if (!shader) throw Error('三维地形无法初始化');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
    gl.deleteShader(shader);
    throw Error('三维地形着色失败');
  }
  const vertex = compile(gl.VERTEX_SHADER, vertexShader);
  const fragment = compile(gl.FRAGMENT_SHADER, fragmentShader);
  const program = gl.createProgram();
  if (!program) throw Error('三维地形无法初始化');
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (gl.getProgramParameter(program, gl.LINK_STATUS)) return program;
  gl.deleteProgram(program);
  throw Error('三维地形着色失败');
}

export function createSatelliteTerrain(canvas: HTMLCanvasElement, notify: () => void) {
  const context = canvas.getContext('webgl', { alpha: true, depth: true, antialias: true, preserveDrawingBuffer: true });
  if (!context) throw Error('设备未提供三维地形绘制能力');
  const gl: WebGLRenderingContext = context;
  const program = link(gl);
  const anisotropy = gl.getExtension('EXT_texture_filter_anisotropic');
  const coordinate = gl.getAttribLocation(program, 'coordinate');
  const imageUv = gl.getAttribLocation(program, 'imageUv');
  const offset = gl.getUniformLocation(program, 'offsetFromEye');
  const viewRight = gl.getUniformLocation(program, 'viewRight');
  const viewUp = gl.getUniformLocation(program, 'viewUp');
  const viewForward = gl.getUniformLocation(program, 'viewForward');
  const tangent = gl.getUniformLocation(program, 'tangent');
  const depthRange = gl.getUniformLocation(program, 'depthRange');
  gl.clearColor(0, 0, 0, 0);
  gl.enable(gl.DEPTH_TEST);
  gl.useProgram(program);
  gl.uniform1i(gl.getUniformLocation(program, 'imagery'), 0);
  gl.uniform2f(depthRange, (horizonDistance + initialNear) / (horizonDistance - initialNear),
    2 * horizonDistance * initialNear / (horizonDistance - initialNear));
  gl.enableVertexAttribArray(coordinate);
  gl.enableVertexAttribArray(imageUv);

  let active = true;
  let area = '';
  let tiles: Tile[] = [];
  let desired = new Set<string>();
  const resident = new Map<string, Mesh>();
  const pending = new Map<string, AbortController>();
  const failed = new Map<string, number>();
  const demCache = new Map<string, Float32Array>();
  const incomingDem = new Map<string, { controller: AbortController; request: Promise<Float32Array | null> }>();

  function readDem(imageTile: Tile) {
    const dem = demTileFor(imageTile);
    const cached = demCache.get(dem.key);
    if (cached) {
      demCache.delete(dem.key);
      demCache.set(dem.key, cached);
      return Promise.resolve(cached);
    }
    const existing = incomingDem.get(dem.key);
    if (existing) return existing.request;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(9_000)]);
    const request = loadSatelliteDem(dem, signal).then(heights => {
      if (active && !signal.aborted && heights) {
        if (demCache.size >= maxResident) demCache.delete(demCache.keys().next().value!);
        demCache.set(dem.key, heights);
      }
      return heights;
    }).finally(() => incomingDem.delete(dem.key));
    incomingDem.set(dem.key, { controller, request });
    return request;
  }

  function abortObsoleteDem() {
    const needed = new Set(tiles.map(tile => demTileFor(tile).key));
    for (const [key, entry] of incomingDem) {
      if (!needed.has(key)) entry.controller.abort();
    }
  }

  function drop(mesh: Mesh) {
    gl.deleteBuffer(mesh.vertex);
    gl.deleteBuffer(mesh.index);
    gl.deleteTexture(mesh.texture);
  }

  function loadGpu(tile: Tile, height: Float32Array, bitmap: ImageBitmap) {
    const model = buildSatelliteMesh(tile, height);
    if (!model.indices.length) return null;
    const vertex = gl.createBuffer();
    const index = gl.createBuffer();
    const texture = gl.createTexture();
    if (!vertex || !index || !texture) {
      gl.deleteBuffer(vertex);
      gl.deleteBuffer(index);
      gl.deleteTexture(texture);
      return null;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, vertex);
    gl.bufferData(gl.ARRAY_BUFFER, model.vertices, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, model.indices, gl.STATIC_DRAW);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    gl.generateMipmap(gl.TEXTURE_2D);
    if (anisotropy) {
      const supported = gl.getParameter(anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number;
      gl.texParameterf(gl.TEXTURE_2D, anisotropy.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(4, supported));
    }
    return { tile, height, vertex, index, texture, origin: model.origin, count: model.indices.length };
  }

  function trim() {
    if (resident.size <= maxResident) return;
    for (const [key, mesh] of resident) {
      if (desired.has(key)) continue;
      resident.delete(key);
      drop(mesh);
      if (resident.size <= maxResident) break;
    }
  }

  function schedule() {
    if (!active) return;
    for (const tile of tiles) {
      if (pending.size >= workers) break;
      if (resident.has(tile.key) || pending.has(tile.key) || (failed.get(tile.key) ?? 0) > Date.now()) continue;
      const controller = new AbortController();
      pending.set(tile.key, controller);
      void read(tile, controller);
    }
  }

  async function read(tile: Tile, controller: AbortController) {
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]);
    // Await both outcomes so a failed DEM cannot orphan a decoded bitmap.
    const [dem, imagery] = await Promise.allSettled([readDem(tile), loadSatelliteTile(tile, signal)]);
    const bitmap = imagery.status === 'fulfilled' ? imagery.value : null;
    try {
      if (!active || controller.signal.aborted || !desired.has(tile.key)) return;
      const mesh = dem.status === 'fulfilled' && dem.value && bitmap ? loadGpu(tile, dem.value, bitmap) : null;
      if (mesh) {
        resident.set(tile.key, mesh);
        trim();
      } else {
        failed.delete(tile.key);
        if (failed.size >= 100) failed.delete(failed.keys().next().value!);
        failed.set(tile.key, Date.now() + 30_000);
      }
    } finally {
      bitmap?.close();
      pending.delete(tile.key);
      schedule();
      if (active) notify();
    }
  }

  function requestArea(observer: SkyObserver) {
    const { longitude, latitude } = observer;
    if (!satelliteImageryAvailable() || !Number.isFinite(longitude) || !Number.isFinite(latitude) ||
        Math.abs(latitude) > 85.05112878) {
      if (tiles.length) {
        tiles = [];
        desired.clear();
        for (const controller of pending.values()) controller.abort();
        area = '';
        abortObsoleteDem();
      }
      return;
    }
    const cell = eyeCell(longitude, latitude);
    if (cell === area) return;
    area = cell;
    tiles = planSatelliteTiles(longitude, latitude);
    desired = new Set(tiles.map(tile => tile.key));
    for (const [key, controller] of pending) {
      if (!desired.has(key)) controller.abort();
    }
    abortObsoleteDem();
    schedule();
  }

  function groundAt(observer: SkyObserver) {
    for (const tile of tiles) {
      const [x, y] = mercator(observer.longitude, observer.latitude, tile.z);
      if (x < tile.x || x >= tile.x + 1 || y < tile.y || y >= tile.y + 1) continue;
      const mesh = resident.get(tile.key);
      if (!mesh) return null;
      const elevation = surfaceHeight(tile, mesh.height, x - tile.x, y - tile.y);
      return Number.isFinite(elevation) ? elevation : null;
    }
    return null;
  }

  function draw(observer: SkyObserver, pose: DeviceSkyPose, optics: DeviceSkyOptics, width: number, height: number,
    eyeHeightMeters?: number): SatelliteTerrainStatus {
    if (!active || gl.isContextLost()) return 'error';
    requestArea(observer);
    const dpr = Math.min(1.65, window.devicePixelRatio || 1);
    const px = Math.round(width * dpr), py = Math.round(height * dpr);
    if (px < 1 || py < 1) return 'loading';
    if (canvas.width !== px || canvas.height !== py) {
      canvas.width = px;
      canvas.height = py;
    }
    gl.viewport(0, 0, px, py);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!tiles.length) return 'unavailable';

    // Wait for the tile under the eye. Rendering nearby coarser geometry from a
    // camera whose mesh-relative height is still unknown can occlude the skyline.
    const ground = groundAt(observer);
    if (ground === null) return pending.size ? 'loading' : 'unavailable';
    const heightAboveMesh = ground + Math.max(1.7, eyeHeightMeters ?? 1.7);
    const eyeAltitude = eyeHeightMeters == null ? Math.max(observer.elevationM ?? heightAboveMesh, heightAboveMesh) : heightAboveMesh;
    const eye = earthPosition(observer.longitude, observer.latitude, eyeAltitude);
    const axis = (azimuth: number, altitude: number) => earthAxis(observer.longitude, observer.latitude, azimuth, altitude);
    const r = axis(pose.azimuth + 90, 0), u = axis(pose.azimuth, pose.altitude + 90);
    const c = Math.cos(pose.roll * rad), s = Math.sin(pose.roll * rad);
    gl.uniform3fv(viewForward, axis(pose.azimuth, pose.altitude));
    gl.uniform3fv(viewRight, r.map((value, i) => value * c + u[i] * s));
    gl.uniform3fv(viewUp, u.map((value, i) => value * c - r[i] * s));
    gl.uniform2f(tangent, Math.tan(optics.horizontalFov * rad / 2), Math.tan(optics.verticalFov * rad / 2));
    let drawn = 0;
    for (const tile of tiles) {
      const mesh = resident.get(tile.key);
      if (!mesh) continue;
      gl.uniform3f(offset, mesh.origin[0] - eye[0], mesh.origin[1] - eye[1], mesh.origin[2] - eye[2]);
      gl.bindTexture(gl.TEXTURE_2D, mesh.texture);
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vertex);
      gl.vertexAttribPointer(coordinate, 3, gl.FLOAT, false, 20, 0);
      gl.vertexAttribPointer(imageUv, 2, gl.FLOAT, false, 20, 12);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.index);
      gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);
      drawn++;
    }
    if (drawn === tiles.length) return 'ready';
    if (drawn > 0) return 'partial';
    return pending.size ? 'loading' : 'unavailable';
  }

  function dispose() {
    active = false;
    for (const controller of pending.values()) controller.abort();
    for (const { controller } of incomingDem.values()) controller.abort();
    demCache.clear();
    for (const mesh of resident.values()) drop(mesh);
    resident.clear();
    gl.deleteProgram(program);
  }

  return { draw, dispose };
}
