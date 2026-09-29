import { useEffect, useRef } from 'react';
import { BROWSE_CACHE_CHANGED } from './browseCachePreferences.ts';
import {
  persistedCacheRoutes,
  syncBrowseCacheRoutes,
  type CacheRoute,
  type RouteSegments,
} from './browseCacheRoute.ts';
import { setBrowseCacheWritePolicy } from './browseCache.ts';

/** Binds cache retention to every saved track and the unsaved drawing, independent of selection. */
export function useBrowseCacheRoute(saved:readonly CacheRoute[],draft:RouteSegments) {
  const latest=useRef({saved,draft});
  const hydrated=useRef(false);
  const archive=useRef<readonly CacheRoute[]|undefined>(undefined);
  const archiveValid=useRef(false);
  const checkedSaved=useRef<readonly CacheRoute[]|undefined>(undefined);
  const reconcile=useRef<()=>void>(()=>undefined);
  latest.current={saved,draft};
  reconcile.current=()=>{
    const current=latest.current;
    const savedChanged=checkedSaved.current!==current.saved;
    if(savedChanged||archive.current===undefined){
      const persisted=persistedCacheRoutes();
      checkedSaved.current=current.saved;
      if(!persisted.ok){
        archiveValid.current=false;
        setBrowseCacheWritePolicy(()=>false);
        return;
      }
      archive.current=persisted.tracks;
      archiveValid.current=true;
    }
    if(!archiveValid.current||!archive.current){setBrowseCacheWritePolicy(()=>false);return;}
    let routes=current.saved;
    if(!hydrated.current&&current.saved.length===0&&archive.current.length>0){
      // Initial hook state is empty until the track archive hydrates; use storage meanwhile.
      routes=archive.current;
    }else hydrated.current=true;
    syncBrowseCacheRoutes(routes,current.draft);
  };
  useEffect(()=>{reconcile.current();},[saved,draft]);
  useEffect(()=>{
    const changed=()=>reconcile.current();
    window.addEventListener(BROWSE_CACHE_CHANGED,changed);
    return ()=>window.removeEventListener(BROWSE_CACHE_CHANGED,changed);
  },[]);
}
