import test from 'node:test';
import assert from 'node:assert/strict';
import { MATERIAL_GROUPS, MATERIAL_RADIUS_RULES, sharedControlRadius, linkedPanelDraft, editMaterialGroup, rgbToHsl } from '../mobile/phonePreviewMaterialGroups.js';

test('categories describe actual interface objects and share internal control radius across buttons and inputs',()=>{
  assert.deepEqual(MATERIAL_GROUPS.map(group=>group.id),['window','chrome','controls','accent','text','switch','edges']);
  assert.deepEqual(MATERIAL_GROUPS.find(group=>group.id==='window').parts[0].members,['panel','toast']);
  assert.deepEqual(MATERIAL_GROUPS.find(group=>group.id==='chrome').parts[0].members,['topbar','bottom','rail']);
  assert.deepEqual(MATERIAL_GROUPS.find(group=>group.id==='controls').parts.map(part=>part.members),[['button'],['field'],['subtle']]);
  assert.deepEqual(MATERIAL_GROUPS.find(group=>group.id==='edges').parts.map(part=>part.members),[['edge'],['line']]);
  assert.deepEqual(MATERIAL_RADIUS_RULES,{outerToken:'--ui-radius-card',innerToken:'--ui-radius-control',inputToken:'--ui-radius-control'});
  assert.equal(sharedControlRadius({radiusControl:10,radiusInput:8}),10);
  assert.equal(sharedControlRadius({radiusInput:8},12),12);
});

test('linking Favorites preserves every other existing draft value without mutating the backup',()=>{
  const draft={glass:{color:'#e8d3aa',rgb:[232,211,170],transparency:83},panel:{color:'#b5b7b1',transparency:57},favorites:{color:'#fefefe',transparency:25},field:{color:'#203040',transparency:43},shadowBlur:31,radiusCard:22};
  const raw=JSON.stringify(draft),linked=linkedPanelDraft(draft),expected=structuredClone(draft);delete expected.favorites;
  assert.deepEqual(linked,expected);assert.equal(JSON.stringify(draft),raw);
});

test('editing grouped opacity preserves each exact RGB and unrelated groups',()=>{
  const draft={rail:{color:'#babcbd',transparency:85},shadowOffset:11};
  const values={button:[10.125,50.5,100.25,.7],field:[210,180,140,.4],subtle:[30,20,10,.06]};
  const result=editMaterialGroup(draft,Object.keys(values),values,'a',68);
  for(const id of Object.keys(values)){assert.deepEqual(result[id].rgb,values[id].slice(0,3));assert.equal(result[id].transparency,68);}
  assert.deepEqual(result.rail,draft.rail);assert.equal(result.shadowOffset,11);assert.equal(draft.button,undefined);
});

test('a grouped colour change keeps different opacities unless alpha is explicitly supplied',()=>{
  const values={button:[250,240,220,.7],field:[220,200,180,.3]};
  const rgb=editMaterialGroup({},['button','field'],values,'color',[32,64,96]);
  assert.equal(rgb.button.transparency,30);assert.equal(rgb.field.transparency,70);
  const rgba=editMaterialGroup({},['button','field'],values,'color',[32,64,96,.5]);
  assert.equal(rgba.button.transparency,50);assert.equal(rgba.field.transparency,50);
});

test('window changes leave the toolbar draft independent and keep Favorites linked',()=>{
  const before={glass:{color:'#ddd5bd',transparency:80},topbar:{color:'#193433',transparency:42},favorites:{color:'#123456',transparency:10}};
  const group=MATERIAL_GROUPS.find(g=>g.id==='window');
  const edited=editMaterialGroup(before,group.parts[0].members,{panel:[221,213,189,.2],toast:[230,220,200,.4]},'a',64);
  assert.deepEqual(edited.topbar,before.topbar);assert.deepEqual(edited.glass,before.glass);assert.equal(edited.favorites,undefined);assert.equal(edited.panel.transparency,64);
});

test('hue from white survives later saturation/lightness edits and preserves other channels',()=>{
  const first=editMaterialGroup({},['panel'],{panel:[255,255,255,.25]},'h',180);
  assert.equal(first.panel.hsl[0],180);
  const second=editMaterialGroup(first,['panel'],{panel:[...first.panel.rgb,.25]},'l',50);
  const third=editMaterialGroup(second,['panel'],{panel:[...second.panel.rgb,.25]},'s',50);
  assert.equal(third.panel.color,'#40bfbf');assert.equal(third.panel.transparency,75);
  assert.ok(Math.abs(rgbToHsl(third.panel.rgb)[0]-180)<.0001);
});
