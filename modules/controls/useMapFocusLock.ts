import { useEffect, useRef, useState } from 'react';
import type { MapHandle } from '../map/TerrainMap';
import type { Coordinate } from '../navigation/types';
import type { DirectionMode } from '../position/types';
export type CameraSnapshot = { center: Coordinate; zoom: number; pitch: number; bearing: number };
export function useMapFocusLock(options: {
  map: () => MapHandle | null; following: boolean; guiding: boolean; direction: DirectionMode;
  fix: Coordinate | null; pause: () => void; resume: () => void;
  north: () => void; free: () => void; device: () => Promise<void>;
}) {
  const [locked, setLocked] = useState(false), [browsing, setBrowsing] = useState(false);
  const current = useRef(options); current.current = options;
  const snapshot = useRef<{ camera: CameraSnapshot; following: boolean; direction: DirectionMode } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  const restore = () => {
    const saved = snapshot.current, o = current.current; if (!saved) return;
    const following = saved.following;
    o.map()?.restoreCamera({ ...saved.camera, center: following && o.fix ? o.fix : saved.camera.center });
    if (saved.direction === 'device') void o.device(); else if (saved.direction === 'north') o.north(); else o.free();
    if (following) o.resume();
    setBrowsing(false);
  };
  useEffect(() => {
    if (!locked) return;
    const pointers = new Set<number>();
    const isMap = (event: Event) => (event.target as Element)?.closest?.('.map-canvas');
    const begin = () => { clear(); current.current.pause(); current.current.free(); setBrowsing(true); };
    const schedule = () => { clear(); if (!pointers.size) timer.current = setTimeout(restore, 10000); };
    const down = (event: PointerEvent) => { if (!isMap(event)) return; pointers.add(event.pointerId); begin(); };
    const up = (event: PointerEvent) => { if (pointers.delete(event.pointerId)) schedule(); };
    const wheel = (event: WheelEvent) => { if (isMap(event)) { begin(); schedule(); } };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointerup', up, true); document.addEventListener('pointercancel', up, true);
    document.addEventListener('wheel', wheel, {capture:true, passive:true});
    return () => { clear(); document.removeEventListener('pointerdown', down, true); document.removeEventListener('pointerup', up, true); document.removeEventListener('pointercancel', up, true); document.removeEventListener('wheel', wheel, true); };
  }, [locked]);
  return { locked, browsing, adoptMode: (following:boolean,direction:DirectionMode) => {
    if(!locked || !snapshot.current)return;
    clear();setBrowsing(false);snapshot.current={camera:current.current.map()?.cameraSnapshot() ?? snapshot.current.camera,following,direction};
  }, toggle: () => {
    clear();
    if (locked) { snapshot.current = null; setLocked(false); setBrowsing(false); return; }
    const o = current.current, camera = o.map()?.cameraSnapshot();
    if (!camera) return;
    snapshot.current = { camera, following:o.following || o.guiding, direction:o.direction };
    setLocked(true); setBrowsing(false);
  } };
}
