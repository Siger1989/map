import { useEffect, useRef, useState } from 'react';
import {
  AmbientLight, BufferAttribute, Color, DirectionalLight, Mesh, MeshStandardMaterial,
  PerspectiveCamera, Scene, SRGBColorSpace, TextureLoader, Vector3, WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { terrainPrintTextureMapping } from './fbx';
import type { TerrainPrintRecord } from './modelStore';

type PreviewMaterial = { apply: (texture: Blob | null) => void };

export function TerrainPrintModelPreview({ record, texture }: {
  record: TerrainPrintRecord;
  texture: Blob | null;
}) {
  const view = useRef<HTMLDivElement>(null);
  const material = useRef<PreviewMaterial | null>(null);
  const reset = useRef<(() => void) | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const host = view.current;
    if (!host) return;
    setError('');
    let renderer: WebGLRenderer;
    try { renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' }); }
    catch { setError('当前设备无法启动 3D 预览。'); return; }

    const geometry = new STLLoader().parse(record.stl);
    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox!;
    const center = bounds.getCenter(new Vector3());
    const span = Math.max(...bounds.getSize(new Vector3()).toArray(), 1);
    const mapping = terrainPrintTextureMapping(record.stl, record.options);
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const uv = new Float32Array(position.count * 2);
    let groupStart = 0, groupMaterial = -1;
    for (let index = 0; index < position.count; index += 3) {
      const top = mapping.isTerrainFace(
        position.getX(index), position.getY(index),
        position.getX(index + 1), position.getY(index + 1),
        position.getX(index + 2), position.getY(index + 2), normal.getZ(index),
      ) ? 0 : 1;
      if (top !== groupMaterial) {
        if (groupMaterial !== -1) geometry.addGroup(groupStart, index - groupStart, groupMaterial);
        groupStart = index;
        groupMaterial = top;
      }
      for (let vertex = index; vertex < index + 3; vertex++) {
        uv.set(mapping.coordinate(position.getX(vertex), position.getY(vertex)), vertex * 2);
      }
    }
    if (groupMaterial !== -1) geometry.addGroup(groupStart, position.count - groupStart, groupMaterial);
    geometry.setAttribute('uv', new BufferAttribute(uv, 2));
    geometry.translate(-center.x, -center.y, -center.z);

    const terrain = new MeshStandardMaterial({ color: '#bba894', roughness: 0.86 });
    const base = new MeshStandardMaterial({ color: '#637273', roughness: 0.84 });
    const mesh = new Mesh(geometry, [terrain, base]);
    mesh.rotation.x = -Math.PI / 2;
    const scene = new Scene();
    scene.add(mesh, new AmbientLight('#f4ece0', 1.45));
    const key = new DirectionalLight('#fff3de', 2.3);
    key.position.set(-span, span * 2, span * 0.6);
    scene.add(key);
    const camera = new PerspectiveCamera(38, 1, span / 500, span * 25);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.minDistance = span * 0.18;
    controls.maxDistance = span * 8;
    controls.enablePan = false;
    controls.enableDamping = false;
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.domElement.setAttribute('aria-label', '可旋转三维地形模型');
    renderer.domElement.tabIndex = 0;
    controls.listenToKeyEvents(renderer.domElement);
    host.appendChild(renderer.domElement);

    let frame = 0;
    let currentTexture = 0;
    let pendingUrl: string | null = null;
    let disposed = false;
    const render = () => {
      if (disposed || frame) return;
      frame = requestAnimationFrame(() => { frame = 0; renderer.render(scene, camera); });
    };
    const resize = () => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      render();
    };
    const defaultView = () => {
      const fit = span / Math.min(1, camera.aspect);
      camera.position.set(fit * 0.95, fit * 0.9, fit * 1.3);
      controls.target.set(0, 0, 0);
      controls.update();
      render();
    };
    reset.current = defaultView;
    material.current = {
      apply: (blob) => {
        const version = ++currentTexture;
        if (pendingUrl) URL.revokeObjectURL(pendingUrl);
        pendingUrl = null;
        terrain.map?.dispose();
        terrain.map = null;
        terrain.color.set('#bba894');
        terrain.needsUpdate = true;
        render();
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        pendingUrl = url;
        new TextureLoader().load(url, next => {
          URL.revokeObjectURL(url);
          if (pendingUrl === url) pendingUrl = null;
          if (disposed || currentTexture !== version) { next.dispose(); return; }
          next.colorSpace = SRGBColorSpace;
          terrain.map = next;
          terrain.color = new Color('#ffffff');
          terrain.needsUpdate = true;
          render();
        }, undefined, () => {
          URL.revokeObjectURL(url);
          if (pendingUrl === url) pendingUrl = null;
          if (!disposed && currentTexture === version) setError('图源贴图无法显示。');
        });
      },
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    controls.addEventListener('change', render);
    resize();
    defaultView();
    return () => {
      disposed = true;
      material.current = null;
      reset.current = null;
      observer.disconnect();
      controls.dispose();
      if (frame) cancelAnimationFrame(frame);
      if (pendingUrl) URL.revokeObjectURL(pendingUrl);
      terrain.map?.dispose();
      geometry.dispose();
      terrain.dispose();
      base.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [record]);

  useEffect(() => { material.current?.apply(texture); }, [record, texture]);
  return <div className="terrain-library-view">
    <div ref={view} className="terrain-library-canvas" />
    {error ? <p role="alert">{error}</p> : <button type="button" onClick={() => reset.current?.()}>重置视角</button>}
  </div>;
}
