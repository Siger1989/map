import type { FeatureCollection } from 'geojson';
import type { Map } from 'maplibre-gl';
import type { ManualTrack } from './drawing.ts';
import type { Coordinate } from '../navigation/types.ts';
import { edgeColorIndex } from './edgeColors.ts';
import { edgeNoteIndex } from './selectionDetails.ts';
import { trackEdgeKey } from './alternatives.ts';
import { normalizeTrackStyle } from './style.ts';
import { syncOverlayData } from '../map/overlayData.ts';

const shortNote = (note: string) => { const text = note.replace(/\s+/g, ' ').trim(); return [...text].length > 18 ? [...text].slice(0,18).join('') + '…' : text; };
/** Keep each note on its own contiguous physical section; never bridge missing edges. */
export function trackNoteFeatures(tracks: ManualTrack[]): FeatureCollection {
  const features: FeatureCollection['features'] = [];
  for (const track of tracks) {
    const style = normalizeTrackStyle(track.style), colors = edgeColorIndex(track), notes = edgeNoteIndex(track);
    if (track.hidden || style.opacity === 0) continue;
    for (const line of track.segments) {
      let run: Coordinate[] = [], note = '';
      const flush = () => { if (note && run.length > 1) features.push({ type:'Feature', properties:{ note:shortNote(note), trackId:track.id }, geometry:{ type:'LineString', coordinates:run } }); run=[]; };
      for (let i=1;i<line.length;i++) {
        const a=line[i-1],b=line[i],key=trackEdgeKey(a,b),color=colors.get(key) ?? style.color;
        const next=(notes.get(key) ?? track.colorConditions?.[color] ?? '').trim();
        if(next !== note){flush();note=next;}
        if(next){if(!run.length)run.push(a);run.push(b);}
      }
      flush();
    }
    const points = new Set(track.segments.flat().map(p=>p.join(',')));
    for (const [key,detail] of Object.entries(track.pointDetails ?? {})) if(detail.note?.trim() && points.has(key)) {
      features.push({type:'Feature',properties:{note:shortNote(detail.note),trackId:track.id},geometry:{type:'Point',coordinates:key.split(',').map(Number)}});
    }
  }
  return {type:'FeatureCollection',features};
}

export function syncTrackNotes(map: Map, tracks: ManualTrack[], scale=1) {
  const id='manual-track-notes';
  if(!map.getSource(id))map.addSource(id,{type:'geojson',data:{type:'FeatureCollection',features:[]}});
  for(const kind of ['line','point'] as const) {
    const layer=`${id}-${kind}`;
    if(map.getLayer(layer))continue;
    map.addLayer({
      id:layer,type:'symbol',source:id,minzoom:10,
      filter:['==',['geometry-type'],kind==='line'?'LineString':'Point'],
      layout:{
        'text-field':['get','note'],'text-font':['Noto Sans Regular'],'text-size':11*scale,
        'text-max-width':9,'text-padding':6*scale,'text-allow-overlap':false,'text-ignore-placement':false,
        ...(kind==='line' ? {'symbol-placement':'line-center' as const,'text-offset':[0,-1],'text-keep-upright':true}
          : {'text-variable-anchor':['top','bottom','left','right'] as ('top'|'bottom'|'left'|'right')[],'text-radial-offset':0.9,'text-justify':'auto' as const}),
      },
      paint:{'text-color':'#fff4cd','text-halo-color':'#234037','text-halo-width':1.1*scale},
    });
  }
  syncOverlayData(map,id,trackNoteFeatures(tracks));
}
