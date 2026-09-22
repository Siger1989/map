import test from 'node:test';
import assert from 'node:assert/strict';
import { DrawingSession } from '../modules/tracks/DrawingSession.ts';
import { trackDistance } from '../modules/tracks/drawing.ts';
const options={mode:'freehand',anchor:[100.1,20],length:48,width:400,height:800,candidates:[],snapping:false,
  project:c=>({x:(c[0]-100)*1000,y:c[1]*10}),unproject:p=>[100+p.x/1000,p.y/10]};
test('dragging distance follows the sampled stroke and matches the released geometry',()=>{
  const s=new DrawingSession();
  assert.equal(s.input({type:'start',point:{x:100,y:248}},options).preview.distanceMetres,0);
  let preview;
  for(const point of [{x:100,y:280},{x:160,y:330},{x:210,y:340}])preview=s.input({type:'move',point},options).preview;
  assert.ok(preview.distanceMetres>0);
  const result=s.input({type:'end',reason:'release'},options);
  assert.ok(Math.abs(preview.distanceMetres-trackDistance([result.stroke]))<0.01);
  assert.equal(s.input({type:'cancel'},options).preview,null);
});
test('road preview measures bends instead of endpoint straight distance and excludes disconnected gaps',()=>{
  const s=new DrawingSession(),from=[100.1,20],section=[[100.1,20.1],[100.2,20.1]];
  const o={...options,mode:'points',anchor:null,lastVertex:from,roadSnapping:true,
    snapRoad:()=>({match:{coordinate:section[1],screen:options.project(section[1])},section})};
  const result=s.input({type:'start',point:{x:200,y:245}},o);
  assert.equal(result.preview.distanceMetres,trackDistance([[from,...section]]));
  assert.ok(result.preview.distanceMetres>trackDistance([[from,section[1]]]));
  const disconnected=[[[100,20],[100.01,20]],[[101,21],[101.01,21]]];
  assert.equal(trackDistance(disconnected),trackDistance([disconnected[0]])+trackDistance([disconnected[1]]));
});
