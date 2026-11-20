import type { SkyObserver } from './astronomy';
import type { DeviceSkyOptics, DeviceSkyPose } from './deviceSkyCamera';
import {
  buildSatelliteMesh, demTileFor, earthAxis, earthPosition, eyeCell, mercator, planSatelliteTiles, sampledSurfaceHeight, terrainHeight,
  type Tile, type Vec3,
} from './satelliteTerrainGeometry';
import { loadSatelliteDem, loadSatelliteTile, satelliteImageryAvailable } from './satelliteTerrainTiles';
import { buildJourneyRouteOverlay, routeImageryFocus, type JourneyTerrainRoute, type RouteProjection } from './journeyRouteOverlay';
import { resolveJourneyCamera } from './journeyCamera';
import { ancestor, closestLoadedTile, mergeTerrainPatches, planJourneyWindow, tileAt, uniqueTiles, windowCovers, type JourneyTerrainBuffer, type JourneyWindow } from './journeyTerrainBuffer.ts';
export type { JourneyTerrainBuffer } from './journeyTerrainBuffer.ts';

export interface SatelliteTerrainCamera {
  observer: SkyObserver;
  pose: DeviceSkyPose;
  routeReady: boolean;
  subjectAltitude: number | null;
}

export type SatelliteTerrainStatus = 'loading' | 'ready' | 'partial' | 'unavailable' | 'error';
const rad = Math.PI / 180;
const workers = 4;
const maxResident = 48;
const maxJourneyResident = 144;
const fallbackBudget = 12;
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
uniform vec4 uvBounds;
varying vec2 uv;
void main(){
  if(uv.x < uvBounds.x || uv.y < uvBounds.y || uv.x > uvBounds.z || uv.y > uvBounds.w) discard;
  gl_FragColor = texture2D(imagery,uv);
}
`;

interface Mesh {
  tile: Tile;
  samples: Float32Array;
  steps: number;
  complete: boolean;
  vertex: WebGLBuffer;
  index: WebGLBuffer;
  texture: WebGLTexture;
  origin: Vec3;
  count: number;
}

const overlayVertex = 'attribute vec3 position; void main(){gl_Position=vec4(position,1.0);}';
const overlayFragment = 'precision mediump float; uniform vec4 ink; void main(){gl_FragColor=ink;}';

function link(gl: WebGLRenderingContext, vs = vertexShader, fs = fragmentShader) {
  function compile(type: number, source: string) {
    const shader = gl.createShader(type);
    if (!shader) throw Error('三维地形无法初始化');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
    gl.deleteShader(shader);
    throw Error('三维地形着色失败');
  }
  const vertex = compile(gl.VERTEX_SHADER, vs);
  const fragment = compile(gl.FRAGMENT_SHADER, fs);
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
  const uvBounds = gl.getUniformLocation(program, 'uvBounds');
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
  gl.uniform4f(uvBounds,0,0,1,1);
  gl.uniform2f(depthRange, (horizonDistance + initialNear) / (horizonDistance - initialNear),
    2 * horizonDistance * initialNear / (horizonDistance - initialNear));
  gl.enableVertexAttribArray(coordinate);
  gl.enableVertexAttribArray(imageUv);

  let overlay: { program: WebGLProgram; buffer: WebGLBuffer; attribute: number; ink: WebGLUniformLocation | null } | null = null;

  function drawRoute(route: JourneyTerrainRoute, view: RouteProjection, subjectAltitude: number | null) {
    if (!overlay) {
      const routeProgram = link(gl, overlayVertex, overlayFragment);
      const buffer = gl.createBuffer();
      if (!buffer) { gl.deleteProgram(routeProgram); return false; }
      overlay = { program: routeProgram, buffer, attribute: gl.getAttribLocation(routeProgram, 'position'), ink: gl.getUniformLocation(routeProgram, 'ink') };
    }
    const { program: routeProgram, buffer, attribute, ink } = overlay;
    const geometry = buildJourneyRouteOverlay(route, view, meshHeightAt, subjectAltitude);
    gl.useProgram(routeProgram);
    gl.disableVertexAttribArray(coordinate);
    gl.disableVertexAttribArray(imageUv);
    gl.enableVertexAttribArray(attribute);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.vertexAttribPointer(attribute, 3, gl.FLOAT, false, 0, 0);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    const paint = (vertices: number[], color: [number,number,number,number]) => {
      if (!vertices.length) return;
      gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vertices),gl.DYNAMIC_DRAW);
      gl.uniform4fv(ink,color);
      gl.drawArrays(gl.TRIANGLES,0,vertices.length/3);
    };
    // A muted trace behind ridges preserves orientation without merging
    // occluded and terrain-visible parts of the route.
    gl.depthFunc(gl.GREATER);
    paint(geometry.past,[.16,.66,.69,.34]);
    paint(geometry.future,[1,.67,.17,.42]);
    gl.depthFunc(gl.LEQUAL);
    paint(geometry.casing,[.03,.10,.13,.94]);
    paint(geometry.past,[.20,.88,.85,1]);
    paint(geometry.future,[1,.76,.24,1]);
    gl.disable(gl.DEPTH_TEST);
    paint(geometry.outline,[.04,.12,.17,1]);
    paint(geometry.arrow,[1,.93,.69,1]);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.disableVertexAttribArray(attribute);
    gl.enableVertexAttribArray(coordinate);
    gl.enableVertexAttribArray(imageUv);
    gl.useProgram(program);
    return geometry.arrow.length > 0;
  }

  let active = true;
  let area = '';
  let tiles: Tile[] = [];
  let requests: Tile[] = [];
  let desired = new Set<string>();
  let windowPlan: JourneyWindow | null = null;
  let routeModel: JourneyTerrainRoute['model'] | null = null;
  let readinessTiles: Tile[] = [];
  let windowTiles: Tile[] = [];
  let frameReady = false;
  let patches: { leaf: Tile; mesh: Mesh }[] = [];
  let coveredLeaves = 0;
  const levels = Array.from({length:18}, () => new Map<number,Mesh>());
  let revision = 0;
  let coverageRevision = -1;
  let cameraCache: {frame:JourneyTerrainRoute['frame']; optics:DeviceSkyOptics; revision:number; camera:ReturnType<typeof resolveJourneyCamera>} | null = null;
  const resident = new Map<string, Mesh>();
  const fallbacks = new Map<string,Tile>();
  const pending = new Map<string, AbortController>();
  const failed = new Map<string, number>();
  const demCache = new Map<string, Float32Array>();
  const failedDem = new Map<string, number>();
  const incomingDem = new Map<string, { controller: AbortController; request: Promise<Float32Array | null> }>();

  function readDem(imageTile: Tile) {
    const dem = demTileFor(imageTile);
    const cached = demCache.get(dem.key);
    if (cached) {
      demCache.delete(dem.key);
      demCache.set(dem.key, cached);
      return Promise.resolve(cached);
    }
    if ((failedDem.get(dem.key) ?? 0) > Date.now()) return Promise.resolve(null);
    const existing = incomingDem.get(dem.key);
    if (existing && !existing.controller.signal.aborted) return existing.request;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]);
    const request = loadSatelliteDem(dem, signal).catch(() => null).then(heights => {
      if (active && !signal.aborted && heights) {
        if (demCache.size >= maxResident) demCache.delete(demCache.keys().next().value!);
        demCache.set(dem.key, heights);
      } else if (active && !controller.signal.aborted) {
        if (failedDem.size>=80) failedDem.delete(failedDem.keys().next().value!);
        failedDem.set(dem.key,Date.now()+30_000);
      }
      return heights;
    }).finally(() => {
      if (incomingDem.get(dem.key)?.controller === controller) incomingDem.delete(dem.key);
    });
    incomingDem.set(dem.key, { controller, request });
    return request;
  }

  function abortObsoleteDem() {
    const needed = new Set([...fallbacks.values(),...requests].map(tile => demTileFor(tile).key));
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
    return { tile, samples:model.samples, steps:model.steps, complete:model.indices.length===model.steps*model.steps*6,
      vertex, index, texture, origin: model.origin, count: model.indices.length };
  }

  function trim() {
    const limit = windowPlan ? maxJourneyResident : maxResident;
    if (resident.size <= limit) return;
    for (const [key, mesh] of resident) {
      if (desired.has(key) || fallbacks.has(key)) continue;
      resident.delete(key);
      drop(mesh);
      if (resident.size <= limit) break;
    }
  }

  function schedule() {
    if (!active) return;
    for (const tile of (fallbacks.size ? [...fallbacks.values(),...requests] : requests)) {
      if (pending.size >= workers) break;
      if (resident.has(tile.key) || pending.has(tile.key) || (failed.get(tile.key) ?? 0) > Date.now()) continue;
      const controller = new AbortController();
      pending.set(tile.key, controller);
      void read(tile, controller);
    }
  }

  function failedTile(tile: Tile) {
    failed.delete(tile.key);
    if (failed.size >= 300) failed.delete(failed.keys().next().value!);
    failed.set(tile.key,Date.now()+(windowPlan ? 120_000 : 30_000));
    requestParent(tile);
  }

  function requestParent(tile: Tile) {
    if (!windowPlan || tile.z <= 8) return;
    // If a request or a whole source level is unavailable, walk up the same
    // provider's pyramid. Coarse roots allow an actual image below every child.
    const parent = ancestor(tile,tile.z-1);
    if (!desired.has(parent.key) && !resident.has(parent.key) && fallbacks.size < fallbackBudget) fallbacks.set(parent.key,parent);
  }

  async function read(tile: Tile, controller: AbortController) {
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]);
    // Await both outcomes so a failed DEM cannot orphan a decoded bitmap.
    const [dem, imagery] = await Promise.allSettled([readDem(tile), loadSatelliteTile(tile, signal)]);
    const bitmap = imagery.status === 'fulfilled' ? imagery.value : null;
    try {
      if (!active || controller.signal.aborted) return;
      const mesh = dem.status === 'fulfilled' && dem.value && bitmap ? loadGpu(tile, dem.value, bitmap) : null;
      if (mesh) {
        resident.set(tile.key, mesh);
        if (!mesh.complete) requestParent(tile);
        revision++;
        trim();
      } else {
        failedTile(tile);
      }
    } catch {
      if (active && !controller.signal.aborted) failedTile(tile);
    } finally {
      bitmap?.close();
      pending.delete(tile.key);
      schedule();
      if (active) notify();
    }
  }

  function requestArea(observer: SkyObserver, route?: JourneyTerrainRoute) {
    const { longitude, latitude } = observer;
    if (!satelliteImageryAvailable() || !Number.isFinite(longitude) || !Number.isFinite(latitude) ||
        Math.abs(latitude) > 85.05112878) {
      if (requests.length) {
        tiles = []; requests = []; readinessTiles = []; windowTiles=[]; windowPlan = null; routeModel = null; fallbacks.clear();
        desired.clear(); frameReady = false; area = ''; revision++;
        for (const controller of pending.values()) controller.abort();
        abortObsoleteDem();
      }
      return;
    }
    const focus = route ? routeImageryFocus(route) : [];
    const needsWindow = route && (!windowPlan || routeModel !== route.model ||
      !windowCovers(windowPlan,route.frame.distanceM,route.model.totalDistanceM));
    const cell = eyeCell(longitude, latitude, route ? 16 : 14) + (route ? '|' + focus.map(([lng,lat]) => eyeCell(lng,lat,16)).join('|') : '');
    if (cell === area && !needsWindow) return;
    if (needsWindow && route) {
      windowPlan = planJourneyWindow(route.model, route.frame.distanceM);
      fallbacks.clear();
      routeModel = route.model;
      windowTiles = uniqueTiles([windowPlan.overview, windowPlan.detail, windowPlan.surroundings]);
      readinessTiles=windowPlan.startup;
    } else if (!route) {
      windowPlan = null; routeModel = null; readinessTiles = []; windowTiles=[]; fallbacks.clear();
    }
    area = cell;
    tiles = planSatelliteTiles(longitude, latitude, route ? 17 : undefined, focus);
    if (route && windowPlan) {
      // Roots cover all four quadrants before their children arrive. Coarse and detailed
      // route tiles stay resident across the entire preloaded window, including turns.
      const points: (readonly [number,number])[] = [route.frame.coordinates, route.frame.cameraCoordinates,...focus];
      const initial = points.map(([x,y])=>tileAt(x,y,14));
      const corridor = points.map(([x,y])=>tileAt(x,y,17));
      requests = uniqueTiles([
        initial, initial.map(t=>ancestor(t,12)), readinessTiles, corridor,
        initial.map(t=>ancestor(t,9)), tiles.map(t=>ancestor(t,9)),
        windowPlan.overview,windowPlan.detail,tiles,windowPlan.surroundings,
      ]);
      // The preloaded window is protected. Lower priority incidental detail is served
      // by the same-provider covering mesh whenever it exceeds the GPU budget.
      if (requests.length > maxJourneyResident-fallbackBudget) {
        const protectedKeys=new Set(windowTiles.map(t=>t.key));
        const remaining=maxJourneyResident-fallbackBudget-protectedKeys.size;
        for (const tile of requests.filter(t=>!protectedKeys.has(t.key)).slice(0,remaining)) protectedKeys.add(tile.key);
        requests=requests.filter(tile=>protectedKeys.has(tile.key));
      }
    } else requests = tiles;
    desired = new Set(requests.map(tile => tile.key));
    for (const [key, controller] of pending) {
      if (!desired.has(key) && !fallbacks.has(key)) controller.abort();
    }
    abortObsoleteDem();
    trim();
    revision++;
    schedule();
  }

  function resolveCoverage() {
    if (coverageRevision === revision) return;
    coverageRevision = revision;
    patches = [];
    for (const level of levels) level.clear();
    for (const leaf of tiles) {
      let mesh = windowPlan ? closestLoadedTile(leaf,resident) : resident.get(leaf.key);
      if (windowPlan && mesh && !mesh.complete) {
        for (let z=mesh.tile.z-1; z>=8; z--) {
          const cover = resident.get(ancestor(leaf,z).key);
          if (cover?.complete) {mesh=cover;break;}
        }
      }
      if (!mesh) continue;
      patches.push({leaf,mesh});
      levels[leaf.z].set(leaf.x*131072+leaf.y,mesh);
    }
    coveredLeaves=patches.length;
    if (windowPlan) patches=mergeTerrainPatches(patches);
  }

  function drawnMesh(x: number, y: number) {
    let tx = Math.floor(x), ty = Math.floor(y);
    for (let z = 17; z >= 9; z--) {
      const mesh = levels[z].get(tx*131072+ty);
      if (mesh) return mesh;
      tx = tx >>> 1; ty = ty >>> 1;
    }
  }

  function meshHeightAt(longitude: number, latitude: number) {
    const [x,y] = mercator(longitude, latitude, 17);
    const mesh = drawnMesh(x,y);
    if (!mesh) return null;
    const scale = 2 ** (mesh.tile.z-17);
    const height = sampledSurfaceHeight(mesh.samples, mesh.steps, x*scale-mesh.tile.x, y*scale-mesh.tile.y);
    return Number.isFinite(height) ? height : null;
  }

  function heightAt(longitude: number, latitude: number) {
    const rendered = meshHeightAt(longitude, latitude);
    if (rendered !== null) return rendered;
    const [px,py] = mercator(longitude, latitude, 12);
    for (let z = 12; z >= 9; z--) {
      const scale = 2 ** (z-12), x = px*scale, y = py*scale;
      const tx=Math.floor(x),ty=Math.floor(y);
      const heights=demCache.get([z,tx,ty].join('/'));
      if (!heights) continue;
      const height=terrainHeight(heights,x-tx,y-ty);
      if (Number.isFinite(height)) return height;
    }
    return null;
  }

  function journeyBuffer(): JourneyTerrainBuffer {
    const total = readinessTiles.length;
    let loaded = 0, degraded = false;
    for (const tile of readinessTiles) {
      if (resident.has(tile.key)) loaded++;
      else if (failed.has(tile.key) || !pending.size) {
        const cover=closestLoadedTile(tile,resident);
        if (cover && (cover.tile.z>=12 || !pending.size)) { loaded++; degraded=true; }
      }
    }
    const status = loaded===total && total>0 && frameReady ? (degraded ? 'degraded' : 'ready') : pending.size ? 'loading' : 'unavailable';
    return {status, loaded, total, frameReady, throughDistanceM:windowPlan?.end ?? 0};
  }

  function retryJourneyBuffer() {
    if (!active) return;
    failed.clear();
    failedDem.clear();
    schedule();
    notify();
  }
  function draw(observer: SkyObserver, pose: DeviceSkyPose, optics: DeviceSkyOptics, width: number, height: number,
    eyeHeightMeters?: number, journey?: JourneyTerrainRoute, onCamera?: (camera: SatelliteTerrainCamera) => void): SatelliteTerrainStatus {
    if (!active || gl.isContextLost()) return 'error';
    requestArea(observer, journey);
    resolveCoverage();
    frameReady = false;
    if (!tiles.length) {
      if (!journey) gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      return 'unavailable';
    }
    if (journey) {
      // Preserve the last fully drawn frame during a seek. New work must supply an
      // actual mesh beneath the subject, the camera and the road immediately ahead.
      const nearby = [journey.frame.cameraCoordinates,...routeImageryFocus(journey)];
      if (!nearby.every(([lng,lat]) => meshHeightAt(lng,lat) !== null))
        return pending.size ? 'loading' : 'unavailable';
      if (!cameraCache || cameraCache.frame !== journey.frame || cameraCache.optics !== optics || cameraCache.revision !== revision)
        cameraCache = { frame: journey.frame, optics, revision,
          camera:resolveJourneyCamera(journey.frame, optics, { heightAt, skylineHeightAt: meshHeightAt }) };
    }
    const camera = journey ? cameraCache?.camera : null;
    if (camera) {
      observer = { longitude: camera.position[0], latitude: camera.position[1], elevationM: camera.altitude ?? undefined };
      pose = camera.pose;
    }
    const dpr = journey
      ? Math.min(2, window.devicePixelRatio || 1, 1440 / Math.max(1, width, height))
      : Math.min(1.65, window.devicePixelRatio || 1);
    const px = Math.round(width * dpr), py = Math.round(height * dpr);
    if (px < 1 || py < 1) return 'loading';
    if (canvas.width !== px || canvas.height !== py) {
      canvas.width = px;
      canvas.height = py;
    }
    gl.viewport(0, 0, px, py);

    // Wait for the tile under the eye. Rendering nearby coarser geometry from a
    // camera whose mesh-relative height is still unknown can occlude the skyline.
    const ground = (journey ? heightAt : meshHeightAt)(observer.longitude, observer.latitude);
    if (ground === null) {
      if (!journey) gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      return pending.size ? 'loading' : 'unavailable';
    }
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const heightAboveMesh = ground + Math.max(1.7, eyeHeightMeters ?? 1.7);
    const eyeAltitude = camera?.altitude ?? (eyeHeightMeters == null ? Math.max(observer.elevationM ?? heightAboveMesh, heightAboveMesh) : heightAboveMesh);
    const eye = earthPosition(observer.longitude, observer.latitude, eyeAltitude);
    const axis = (azimuth: number, altitude: number) => earthAxis(observer.longitude, observer.latitude, azimuth, altitude);
    const r = axis(pose.azimuth + 90, 0), u = axis(pose.azimuth, pose.altitude + 90);
    const c = Math.cos(pose.roll * rad), s = Math.sin(pose.roll * rad);
    const forward = axis(pose.azimuth, pose.altitude);
    const right = r.map((value, i) => value * c + u[i] * s) as Vec3;
    const up = u.map((value, i) => value * c - r[i] * s) as Vec3;
    const tanX = Math.tan(optics.horizontalFov * rad / 2), tanY = Math.tan(optics.verticalFov * rad / 2);
    gl.uniform3fv(viewForward, forward);
    gl.uniform3fv(viewRight, right);
    gl.uniform3fv(viewUp, up);
    gl.uniform2f(tangent, tanX, tanY);
    let drawn = 0;
    for (const {leaf,mesh} of patches) {
      let count=mesh.count, byteOffset=0;
      if (leaf === mesh.tile || leaf.key === mesh.tile.key) gl.uniform4f(uvBounds,0,0,1,1);
      else {
        const span = 2 ** (mesh.tile.z-leaf.z);
        const u=leaf.x*span-mesh.tile.x, v=leaf.y*span-mesh.tile.y;
        gl.uniform4f(uvBounds,u,v,u+span,v+span);
        // Full grids have row-major triangle indices. Submit only the rows
        // intersecting this child instead of rasterizing the entire ancestor.
        if (mesh.complete) {
          const first=Math.floor(v*mesh.steps), last=Math.ceil((v+span)*mesh.steps);
          const rowIndices=mesh.steps*6;
          byteOffset=first*rowIndices*2;
          count=(last-first)*rowIndices;
        }
      }
      gl.uniform3f(offset, mesh.origin[0] - eye[0], mesh.origin[1] - eye[1], mesh.origin[2] - eye[2]);
      gl.bindTexture(gl.TEXTURE_2D, mesh.texture);
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vertex);
      gl.vertexAttribPointer(coordinate, 3, gl.FLOAT, false, 20, 0);
      gl.vertexAttribPointer(imageUv, 2, gl.FLOAT, false, 20, 12);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.index);
      gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_SHORT, byteOffset);
      drawn++;
    }
    if (journey && camera && drawn > 0) {
      const routeReady = drawRoute(journey, { eye, right, up, forward, tanX, tanY, near: initialNear, far: horizonDistance, width, height }, camera.subjectAltitude);
      frameReady = routeReady;
      onCamera?.({ observer, pose, routeReady, subjectAltitude: camera.subjectAltitude });
    }
    if (coveredLeaves === tiles.length) return 'ready';
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
    if (overlay) { gl.deleteBuffer(overlay.buffer); gl.deleteProgram(overlay.program); }
    gl.deleteProgram(program);
  }

  return { draw, dispose, journeyBuffer, retryJourneyBuffer };
}
