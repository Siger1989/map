import type { SkyObserver } from './astronomy';
import type { DeviceSkyOptics, DeviceSkyPose } from './deviceSkyCamera';
import {
  buildSatelliteMesh, demTileFor, earthAxis, earthPosition, eyeCell, mercator, planSatelliteTiles, resampleAncestorDem, sampledSurfaceHeight, terrainHeight,
  type Tile, type Vec3,
} from './satelliteTerrainGeometry';
import { loadSatelliteDem, loadSatelliteTile, satelliteImageryAvailable } from './satelliteTerrainTiles';
import { buildJourneyRouteOverlay, routeImageryFocus, type JourneyTerrainRoute, type RouteProjection } from './journeyRouteOverlay';
import { buildTerrainTransitions, sampleTransition } from './satelliteTerrainTransitions.ts';
import { createJourneyCameraRail } from './journeyCameraRail.ts';
import { ancestor, closestLoadedTile, journeyGpuLookahead, journeyGroundFootprint, mergeTerrainPatches, planJourneyWindow, refineJourneyLeaves, uniqueTiles, windowCovers, type JourneyTerrainBuffer, type JourneyWindow } from './journeyTerrainBuffer.ts';
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
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D imagery;
uniform vec4 uvBounds;
varying vec2 uv;
void main(){
  if(uv.x < uvBounds.x || uv.y < uvBounds.y || uv.x > uvBounds.z || uv.y > uvBounds.w) discard;
  gl_FragColor = texture2D(imagery,uv);
}
`;

interface Mesh {
  id:number;
  coarseDem:boolean;
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
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
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
  let frameReady = false;
  let focusTiles: Tile[] = [], nearTiles:Tile[]=[];
  let gpuRequired=new Set<string>();
  let planFov=0;
  let planMotion: JourneyTerrainRoute['frame']['cameraMotion'];
  let planTurn=0,planLag=0;
  let focusFrame:JourneyTerrainRoute['frame'] | null=null;
  let focusFov=0;
  let focusKey='';
  let aheadCell=-1, upcoming:Tile[]=[];
  let detailLoaded=0, minDetailZoom=0, frameDegraded=false, frameUnavailable=false;
  const cameraRail=createJourneyCameraRail();
  // Keep compressed images and shared DEM grids for the entire preparation window.
  // Only the active view's meshes consume GPU memory.
  const staged = new Map<string,{image:Blob; heights:Float32Array; complete:boolean}>();
  const completeDem = new WeakMap<Float32Array,boolean>();
  let nextMeshId=0;
  let patches: { leaf: Tile; mesh: Mesh }[] = [];
  const seamBuffer=gl.createBuffer();
  let seamSignature='';
  let transitions:ReturnType<typeof buildTerrainTransitions<Mesh>>|null=null;
  let coveredLeaves = 0;
  const levels = Array.from({length:18}, () => new Map<number,Mesh>());
  let revision = 0;
  let coverageRevision = -1;
  let cameraCache: {frame:JourneyTerrainRoute['frame']; optics:DeviceSkyOptics; revision:number; camera:ReturnType<typeof cameraRail.resolve>} | null = null;
  const resident = new Map<string, Mesh>();
  const fallbacks = new Map<string,Tile>();
  const pending = new Map<string, AbortController>();
  const failed = new Map<string, number>();
  const demCache = new Map<string, Float32Array>();
  const failedDem = new Map<string, number>();
  const incomingDem = new Map<string, { controller: AbortController; request: Promise<Float32Array | null> }>();
  const demFallback=new Map<string,Promise<Float32Array|null>>();
  const coarserDem=new WeakSet<Float32Array>();
  const refreshDem=new Set<string>();

  function readExactDem(dem:Tile) {
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

  async function readDem(imageTile:Tile) {
    const dem=demTileFor(imageTile);
    const heights=await readExactDem(dem);
    if (heights || !windowPlan || !active) return heights;
    const existing=demFallback.get(dem.key);
    if(existing)return existing;
    const fallback=(async()=>{
      for(let z=dem.z-1;active && z>=Math.max(8,dem.z-3);z--){
        const parent=ancestor(dem,z), source=await readExactDem(parent);
        if(!source)continue;
        const resampled=resampleAncestorDem(dem,parent,source);
        if(!resampled.some(Number.isFinite))continue;
        coarserDem.add(resampled);
        return resampled;
      }
      return null;
    })();
    if(demFallback.size>=48)demFallback.delete(demFallback.keys().next().value!);
    demFallback.set(dem.key,fallback);
    return fallback;
  }

  function abortObsoleteDem() {
    const needed = new Set<string>();
    for(const t of [...fallbacks.values(),...requests]){
      const dem=demTileFor(t);needed.add(dem.key);
      if(windowPlan)for(let z=dem.z-1;z>=Math.max(8,dem.z-3);z--)needed.add(ancestor(dem,z).key);
    }
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
    return { id:++nextMeshId,coarseDem:coarserDem.has(height),tile, samples:model.samples, steps:model.steps, complete:model.indices.length===model.steps*model.steps*6,
      vertex, index, texture, origin: model.origin, count: model.indices.length };
  }

  function trim() {
    const limit = windowPlan ? maxJourneyResident : maxResident;
    if (resident.size <= limit) return;
    for (const [key, mesh] of resident) {
      if (windowPlan ? gpuRequired.has(key) : desired.has(key)) continue;
      resident.delete(key);
      drop(mesh);
      if (resident.size <= limit) break;
    }
  }

  function schedule() {
    if (!active) return;
    for (const tile of (fallbacks.size ? [...fallbacks.values(),...requests] : requests)) {
      if (pending.size >= workers) break;
      if ((!refreshDem.has(tile.key) && (resident.has(tile.key) || staged.has(tile.key) && !gpuRequired.has(tile.key))) || pending.has(tile.key) ||
          (failed.get(tile.key) ?? 0) > Date.now()) continue;
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
    if (gpuRequired.has(tile.key)) gpuRequired.add(parent.key);
    // An already desired parent may have failed before its child. Walk the ladder
    // on demand so a missing z17 can use its verified z16 or z15 ancestor.
    if (failed.has(parent.key) && tile.z>9) requestParent(parent);
    if (!resident.has(parent.key)) fallbacks.set(parent.key,parent);
  }

  async function read(tile: Tile, controller: AbortController) {
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]);
    // Await both outcomes so a failed DEM cannot orphan a decoded bitmap.
    const saved = staged.get(tile.key);
    let image=saved?.image;
    const refreshing=refreshDem.delete(tile.key);
    const [dem, imagery] = await Promise.allSettled([saved && !refreshing ? Promise.resolve(saved.heights) : readDem(tile),
      saved ? createImageBitmap(saved.image) : loadSatelliteTile(tile, signal, value=>{image=value;})]);
    const bitmap = imagery.status === 'fulfilled' ? imagery.value : null;
    try {
      if (!active || controller.signal.aborted) return;
      const heights=dem.status==='fulfilled' ? dem.value : null;
      if (heights && bitmap) {
        let complete:boolean;
        if (!windowPlan || gpuRequired.has(tile.key)) {
          const mesh=loadGpu(tile,heights,bitmap);
          if(!mesh){failedTile(tile);return;}
          const previous=resident.get(tile.key);if(previous)drop(previous);
          resident.set(tile.key,mesh);
          complete=mesh.complete;
        } else {
          let all=completeDem.get(heights);
          if(all===undefined){all=heights.every(Number.isFinite);completeDem.set(heights,all);}
          if(all)complete=true;
          else {
            const mesh=buildSatelliteMesh(tile,heights);
            complete=mesh.indices.length===mesh.steps*mesh.steps*6;
          }
        }
        if (windowPlan && image && (desired.has(tile.key)||fallbacks.has(tile.key))) staged.set(tile.key,{image,heights,complete});
        if (!complete) requestParent(tile);
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

  function requestArea(observer: SkyObserver, optics:DeviceSkyOptics, route?: JourneyTerrainRoute) {
    const { longitude, latitude } = observer;
    if (!satelliteImageryAvailable() || !Number.isFinite(longitude) || !Number.isFinite(latitude) ||
        Math.abs(latitude) > 85.05112878) {
      if (requests.length) {
        tiles = []; requests = []; readinessTiles = []; windowPlan = null; routeModel = null; fallbacks.clear();
        desired.clear(); staged.clear(); focusFrame=null; frameReady = false; area = ''; revision++;
        for (const controller of pending.values()) controller.abort();
        abortObsoleteDem();
      }
      return;
    }
    const fov=Math.ceil(optics.horizontalFov/2)*2;
    const needsWindow = route && (!windowPlan || routeModel !== route.model ||
      planFov!==fov || planTurn!==route.frame.cameraTurnRadiusM || planLag!==route.frame.cameraLagM ||
      planMotion!==route.frame.cameraMotion ||
      !windowCovers(windowPlan,route.frame.distanceM,route.model.totalDistanceM));
    if(route && (route.frame!==focusFrame || focusFov!==fov)){
      focusFrame=route.frame;focusFov=fov;
      const footprint=journeyGroundFootprint(route,fov);
      nearTiles=footprint.detail;
      focusTiles=uniqueTiles([nearTiles,footprint.middle,footprint.horizon]);
      focusKey=focusTiles.map(t=>t.key).join('|');
    }
    const progressCell=route ? Math.floor(route.frame.distanceM/200) : -1;
    const cell = eyeCell(longitude, latitude, route ? 16 : 14) + (route ? '|'+progressCell+'|'+focusKey : '');
    if (cell === area && !needsWindow) return;
    if (needsWindow && route) {
      planFov=fov;planTurn=route.frame.cameraTurnRadiusM;planLag=route.frame.cameraLagM;planMotion=route.frame.cameraMotion;
      windowPlan = planJourneyWindow(route.model, route.frame.distanceM,fov,{turnRadiusM:planTurn,cameraLagM:planLag,cameraMotion:planMotion});
      fallbacks.clear();
      routeModel = route.model;
      readinessTiles=windowPlan.startup;
    } else if (!route) {
      windowPlan = null; routeModel = null; readinessTiles = []; fallbacks.clear();staged.clear();focusFrame=null;
    }
    area = cell;
    tiles = planSatelliteTiles(longitude, latitude, route ? 17 : undefined, route ? routeImageryFocus(route) : []);
    if (route && windowPlan) {
      const originals=tiles, roots=uniqueTiles([originals.map(t=>ancestor(t,9))]);
      tiles=refineJourneyLeaves(originals,focusTiles);
      // Do not request every sibling generated by subdivision: they inherit the
      // enclosing view's imagery until a closer source is available.
      const visible=uniqueTiles([focusTiles,roots,originals]);
      if(needsWindow || aheadCell!==progressCell){
        aheadCell=progressCell;upcoming=journeyGpuLookahead(route.model,route.frame.distanceM,fov,{turnRadiusM:planTurn,cameraLagM:planLag,cameraMotion:planMotion});
      }
      const early: Tile[][] = [];
      for (const checkpoint of windowPlan.checkpoints) {
        if (checkpoint.distanceM < route.frame.distanceM) continue;
        early.push(checkpoint.tiles);
        if (checkpoint.distanceM >= route.frame.distanceM + 320) break;
      }
      const gpu=uniqueTiles([visible,upcoming]).slice(0,maxJourneyResident-12);
      gpuRequired=new Set(gpu.map(t=>t.key));
      if(needsWindow)for(const t of readinessTiles)if(failed.has(t.key)||staged.get(t.key)?.complete===false)requestParent(t);
      for(const t of focusTiles) {
        for(let z=t.z-1;z>=9;z--){
          const parent=ancestor(t,z);
          if(staged.has(parent.key)||fallbacks.has(parent.key))gpuRequired.add(parent.key);
        }
        if(failed.has(t.key)||staged.get(t.key)?.complete===false)requestParent(t);
      }
      requests=uniqueTiles([[ancestor(nearTiles[0],9)],nearTiles,focusTiles,roots,...early,gpu,readinessTiles,visible]);
    } else requests = tiles;
    desired = new Set(requests.map(tile => tile.key));
    if (needsWindow) {
      for(const key of staged.keys())if(!desired.has(key)&&!fallbacks.has(key))staged.delete(key);
    }
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
    if (windowPlan) {
      patches=mergeTerrainPatches(patches);
      rebuildSeams();
    }
  }

  function drawnMesh(x: number, y: number) {
    let tx = ((Math.floor(x)%131072)+131072)%131072, ty = Math.floor(y);
    for (let z = 17; z >= 9; z--) {
      const mesh = levels[z].get(tx*131072+ty);
      if (mesh) return mesh;
      tx = tx >>> 1; ty = ty >>> 1;
    }
  }

  function rebuildSeams() {
    if(!seamBuffer)return;
    const signature=patches.map(({leaf,mesh})=>leaf.key+'='+mesh.id).join('|');
    if(signature===seamSignature)return;
    seamSignature=signature;
    transitions=buildTerrainTransitions(patches);
    gl.bindBuffer(gl.ARRAY_BUFFER,seamBuffer);
    gl.bufferData(gl.ARRAY_BUFFER,transitions.vertices,gl.DYNAMIC_DRAW);
  }

  function meshHeightAt(longitude: number, latitude: number) {
    const [x,y] = mercator(longitude, latitude, 17);
    const mesh = drawnMesh(x,y);
    if (!mesh) return null;
    const transitioned=sampleTransition(windowPlan?transitions?.bands.get(mesh):undefined,x,y);
    if(transitioned!==null)return transitioned;
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
    let loaded = 0, unavailableTiles=0, degraded = false;
    const ready = new Set<string>();
    for (const tile of readinessTiles) {
      const saved=staged.get(tile.key);
      if (saved?.complete || resident.get(tile.key)?.complete) {loaded++;ready.add(tile.key);if(saved && coarserDem.has(saved.heights))degraded=true;}
      else if (failed.has(tile.key) || staged.get(tile.key)?.complete===false) {
        let found=false;
        for(let z=tile.z-1;z>=minCover(tile);z--){
          const key=ancestor(tile,z).key;
          if(staged.get(key)?.complete || resident.get(key)?.complete){ loaded++;ready.add(tile.key);degraded=true;found=true;break;}
        }
        if(!found && exhausted(tile))unavailableTiles++;
      }
    }
    let readyThroughDistanceM: number | null = null;
    if (frameReady && focusFrame && windowPlan) {
      for (const checkpoint of windowPlan.checkpoints) {
        if (checkpoint.distanceM < focusFrame.distanceM) continue;
        if (!checkpoint.tiles.every(tile => ready.has(tile.key))) break;
        readyThroughDistanceM = checkpoint.distanceM;
      }
    }
    const prepared=loaded+unavailableTiles===total && total>0;
    const status = frameUnavailable ? 'unavailable' : prepared && frameReady ? (unavailableTiles||degraded||frameDegraded ? 'degraded' : 'ready') : pending.size ? 'loading' : 'unavailable';
    return {status, loaded, total, unavailableTiles, frameReady, frameDegraded, detailLoaded, detailTotal:nearTiles.length, minDetailZoom, throughDistanceM:windowPlan?.end ?? 0, readyThroughDistanceM};
  }

  function minCover(tile:Tile){return Math.max(8,tile.z-2);}
  function exhausted(tile:Tile){
    for(let z=tile.z;z>=minCover(tile);z--){
      const key=z===tile.z?tile.key:ancestor(tile,z).key;
      if(!failed.has(key) && staged.get(key)?.complete!==false)return false;
    }
    return true;
  }

  function retryJourneyBuffer() {
    if (!active) return;
    failed.clear();
    failedDem.clear();
    demFallback.clear();
    for(const [key,saved] of staged)if(coarserDem.has(saved.heights))refreshDem.add(key);
    schedule();
    notify();
  }
  function draw(observer: SkyObserver, pose: DeviceSkyPose, optics: DeviceSkyOptics, width: number, height: number,
    eyeHeightMeters?: number, journey?: JourneyTerrainRoute, onCamera?: (camera: SatelliteTerrainCamera) => void): SatelliteTerrainStatus {
    if (!active || gl.isContextLost()) return 'error';
    requestArea(observer, optics, journey);
    resolveCoverage();
    frameReady = false;
    frameDegraded=false; frameUnavailable=false; detailLoaded=0;minDetailZoom=0;
    if (!tiles.length) {
      if (!journey) gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      return 'unavailable';
    }
    if (journey) {
      let usable=coveredLeaves===tiles.length, min=17;
      for(const tile of focusTiles) {
        let mesh=resident.get(tile.key);
        if(!mesh?.complete) for(let z=tile.z-1;z>=minCover(tile);z--){
          const fallback=resident.get(ancestor(tile,z).key);
          if(fallback?.complete){mesh=fallback;break;}
        }
        if (tile.z===nearTiles[0]?.z) {
          min=Math.min(min,mesh?.complete?mesh.tile.z:0);
          if(mesh?.complete && mesh.tile.z===tile.z)detailLoaded++;
        }
        if (mesh?.coarseDem)frameDegraded=true;
        if (!mesh?.complete){usable=false;if(exhausted(tile))frameUnavailable=true;}
        else if(mesh.tile.z<tile.z){
          if(!failed.has(tile.key)&&staged.get(tile.key)?.complete!==false)usable=false;
          else frameDegraded=true;
        }
      }
      minDetailZoom=min;
      if (!usable) return pending.size?'loading':'unavailable';
      // Preserve the last fully drawn frame during a seek. New work must supply an
      // actual mesh beneath the subject, the camera and the road immediately ahead.
      const nearby = [journey.frame.cameraCoordinates,...routeImageryFocus(journey)];
      if (!nearby.every(([lng,lat]) => meshHeightAt(lng,lat) !== null))
        return pending.size ? 'loading' : 'unavailable';
      if (!cameraCache || cameraCache.frame !== journey.frame || cameraCache.optics !== optics || cameraCache.revision !== revision)
        cameraCache = { frame: journey.frame, optics, revision,
          camera:cameraRail.resolve(journey.model,journey.frame, optics, { heightAt, skylineHeightAt: meshHeightAt },revision) };
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
    function paintMesh(leaf:Tile,mesh:Mesh){
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
      const trim=journey ? transitions?.bounds.get(leaf.key) : undefined;
      if(trim)gl.uniform4fv(uvBounds,trim);
      gl.uniform3f(offset, mesh.origin[0] - eye[0], mesh.origin[1] - eye[1], mesh.origin[2] - eye[2]);
      gl.bindTexture(gl.TEXTURE_2D, mesh.texture);
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vertex);
      gl.vertexAttribPointer(coordinate, 3, gl.FLOAT, false, 20, 0);
      gl.vertexAttribPointer(imageUv, 2, gl.FLOAT, false, 20, 12);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.index);
      gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_SHORT, byteOffset);
    }
    const drawn=patches.length;
    for(const patch of patches)paintMesh(patch.leaf,patch.mesh);
    if (journey && seamBuffer && transitions?.draws.length) {
      gl.bindBuffer(gl.ARRAY_BUFFER,seamBuffer);
      gl.vertexAttribPointer(coordinate,3,gl.FLOAT,false,20,0);
      gl.vertexAttribPointer(imageUv,2,gl.FLOAT,false,20,12);
      gl.uniform4f(uvBounds,0,0,1,1);
      const sideX=Math.hypot(1,tanX),sideY=Math.hypot(1,tanY);
      for(const {mesh,start,count,center,radius} of transitions.draws){
        const x=center[0]-eye[0],y=center[1]-eye[1],z=center[2]-eye[2];
        const dot=(axis:Vec3)=>x*axis[0]+y*axis[1]+z*axis[2];
        const depth=dot(forward);
        if(depth < -radius || Math.abs(dot(right))>depth*tanX+radius*sideX ||
            Math.abs(dot(up))>depth*tanY+radius*sideY)continue;
        gl.uniform3f(offset,mesh.origin[0]-eye[0],mesh.origin[1]-eye[1],mesh.origin[2]-eye[2]);
        gl.bindTexture(gl.TEXTURE_2D,mesh.texture);
        gl.drawArrays(gl.TRIANGLES,start,count);
      }
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
    staged.clear();
    for (const mesh of resident.values()) drop(mesh);
    resident.clear();
    gl.deleteBuffer(seamBuffer);
    if (overlay) { gl.deleteBuffer(overlay.buffer); gl.deleteProgram(overlay.program); }
    gl.deleteProgram(program);
  }

  return { draw, dispose, journeyBuffer, retryJourneyBuffer };
}
