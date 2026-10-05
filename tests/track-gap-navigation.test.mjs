import test from 'node:test';
import assert from 'node:assert/strict';
import { trackNavigation, RouteEndpointRequiredError } from '../modules/guidance/savedRoute.ts';
import { resolveTrackConnections } from '../modules/guidance/trackConnections.ts';
import { orientTrack } from '../modules/guidance/direction.ts';
import { routeOnNetwork } from '../modules/guidance/network.ts';
import { validFavorite, parseFavorites } from '../modules/navigation/favorites.ts';
import { createSession, advance } from '../modules/guidance/session.ts';
const A=[20,10], B=[20.001,10], C=[20.003,10], D=[20.004,10], E=[20.006,10], F=[20.007,10];
const track={id:'gap',name:'gap',createdAt:1,segments:[[A,B],[C,D],[E,F]],style:{colorMode:'elevation',opacity:0.43}};
const navigation=t=>trackNavigation(t,100,'pedestrian',[],'main',false,true);
const planned=coordinates=>({...navigation({ ...track,segments:[[A,F]] }).route,coordinates,snapped:[coordinates[0],coordinates.at(-1)],trackConnections:undefined,segments:undefined});
test('disconnected navigation warns through metadata and joins all gaps without modifying original archive or opacity',()=>{
 const before=JSON.stringify(track), favorite=navigation(track);
 assert.equal(favorite.route.trackConnections.length,2);
 assert.deepEqual(favorite.route.coordinates,[A,B,C,D,E,F]);
 assert.deepEqual(favorite.route.segments.map(s=>s.kind),['road','access','road','access','road']);
 assert.equal(favorite.route.displayOpacity,0.43);
 assert.equal(validFavorite(favorite),true);
 assert.equal(parseFavorites(JSON.stringify([favorite]))[0].route.trackConnections.length,2);
 const session=createSession(favorite.route,100); assert.ok(session.path.length>700);
 const progressed=advance(session,{coordinates:C,timestamp:101,accuracy:5},101);assert.equal(progressed.offRoute,false);
 favorite.route.coordinates[0][0]=0;assert.equal(JSON.stringify(track),before);
});
test('reverse and nearest entry retain correctly clipped dashed connections',()=>{
 const favorite=navigation(track), reversed=orientTrack(favorite,favorite.end,favorite.start,'pedestrian').route;
 assert.deepEqual(reversed.coordinates,[F,E,D,C,B,A]);
 assert.equal(reversed.segments.filter(s=>s.kind==='access').length,2);
 const entry=routeOnNetwork(favorite.route,[20.002,10]).route;
 assert.equal(entry.segments[0].kind,'access');
 assert.deepEqual(entry.segments[0].coordinates.at(-1),C);
 assert.equal(entry.displayOpacity,0.43);
});
test('road geometry fills only missing pieces, stays dashed and preserves stored points/network and transparency',async()=>{
 const source=navigation(track).route, before=JSON.stringify(source), calls=[];
 const result=await resolveTrackConnections(source,async(start,end,mode)=>{calls.push([start.coordinates,end.coordinates,mode]);return planned([start.coordinates,[start.coordinates[0],10.0005],end.coordinates]);},new AbortController().signal);
 assert.equal(calls.length,2);assert.ok(result.trackConnections.every(c=>c.routing==='road'));
 assert.equal(result.segments.filter(s=>s.kind==='access').length,2);
 assert.ok(result.distance>source.distance);assert.equal(result.displayOpacity,0.43);
 assert.deepEqual(result.coordinates.filter(p=>p[1]===10),[A,B,C,D,E,F]);
 assert.equal(JSON.stringify(source),before);
 assert.ok(result.trackNetwork.some(line=>line.some(p=>p[1]===10.0005)));
 const nearest=routeOnNetwork(result,[20.002,10.00025]).route;
 assert.ok(nearest.segments.some(s=>s.kind==='access'));
});
test('reverse gap requests follow actual navigation direction, not forward road restrictions',async()=>{
 const f=navigation(track), source=orientTrack(f,f.end,f.start,'auto').route,calls=[];
 const result=await resolveTrackConnections(source,async(start,end)=>{calls.push([start.coordinates,end.coordinates]);return planned([start.coordinates,end.coordinates]);},new AbortController().signal);
 assert.deepEqual(calls,[[C,B],[E,D]]);
 assert.deepEqual(result.coordinates,[F,E,D,C,B,A]);
});
test('road failure and all-access provider fallback retain direct reference gaps',async()=>{
 const source=navigation(track).route;let count=0;
 const result=await resolveTrackConnections(source,async()=>{if(!count++)throw new Error('No route');return {...planned([D,E]),segments:[{kind:'access',coordinates:[D,E]}]};},new AbortController().signal);
 assert.deepEqual(result.coordinates,source.coordinates);assert.ok(result.trackConnections.every(c=>c.routing==='direct'));
});
test('one global deadline handles a provider ignoring abort; cancellation never starts navigation',async()=>{
 const source=navigation(track).route;
 const timeout=await resolveTrackConnections(source,()=>new Promise(()=>{}),new AbortController().signal,20);
 assert.deepEqual(timeout.coordinates,source.coordinates);
 const controller=new AbortController(), pending=resolveTrackConnections(source,()=>new Promise(()=>{}),controller.signal,1000);controller.abort();
 await assert.rejects(pending,{name:'AbortError'});
});
test('a distant road match cannot turn a short track gap into kilometre-long road access',async()=>{
 const source=navigation(track).route;
 const result=await resolveTrackConnections(source,async(start,end)=>({...planned([start.coordinates,[20.4,10],end.coordinates]),snapped:[[20.4,10],[20.401,10]]}),new AbortController().signal);
 assert.deepEqual(result.coordinates,source.coordinates);assert.ok(result.trackConnections.every(c=>c.routing==='direct'));
});
test('actual fork destination still required, isolated nodes can be temporarily joined, invalid metadata rejected',()=>{
 assert.throws(()=>navigation({...track,segments:[[A,B,C],[B,[20.001,10.001]],[B,[20.001,9.999]],[E,F]]}),RouteEndpointRequiredError);
 assert.deepEqual(navigation({...track,segments:[[A,B],[C]]}).route.coordinates,[A,B,C]);
 const f=navigation(track);f.route.trackConnections[0].coordinates=[[NaN,10],C];assert.equal(validFavorite(f),false);
});
