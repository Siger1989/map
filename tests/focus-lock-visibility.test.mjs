import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { focusLockVisibility } from '../modules/controls/focusLockVisibility.ts';

const names=['drawing','areaDrawing','areaEditing','routeEditor','measurement','survey','markerPicking','routePicking','movingFeature','quickAdd','sectionEditing','navigation','recording','comparison','boxSelection','sectionList','annotationDetails','photoDetails','rally','routeCard','navigationTarget','sharing','sourcePicker'];
const idle=()=>Object.fromEntries(names.map(name=>[name,false]));

test('ordinary browsing restores entry after each task or panel closes',()=>{
  assert.equal(focusLockVisibility(false,null,idle()).visible,true);
  for(const name of names){
    const activity={...idle(),[name]:true};
    assert.deepEqual(focusLockVisibility(false,null,activity),{visible:false,reasons:[name]});
    activity[name]=false;
    assert.equal(focusLockVisibility(false,null,activity).visible,true,name);
  }
  for(const panel of ['tools','layers','sources','track','annotations','favorites','outdoor']){
    assert.equal(focusLockVisibility(false,panel,idle()).visible,false,panel);
    assert.equal(focusLockVisibility(false,null,idle()).visible,true);
  }
});

test('unlock is reachable even if another activity or panel becomes active while locked',()=>{
  assert.equal(focusLockVisibility(true,'tools',Object.fromEntries(names.map(name=>[name,true]))).visible,true);
  assert.equal(focusLockVisibility(false,'tools',idle()).visible,false);
});

test('closing comparison restores ordinary controls while a selected saved marker remains on the map',()=>{
  const during={...idle(),comparison:true};
  assert.equal(focusLockVisibility(false,null,during).visible,false);
  const closed={...idle(),comparison:false,annotationDetails:false};
  assert.equal(focusLockVisibility(false,null,closed).visible,true,'a retained map selection is not an open marker-details task');
  assert.equal(focusLockVisibility(false,'annotations',{...closed,annotationDetails:true}).visible,false,'a mounted marker workspace remains a task');
  assert.equal(focusLockVisibility(false,null,{...closed,annotationDetails:false}).visible,true,'closing the details panel restores the lock entry immediately');
});

test('home binding does not borrow follow blocking or retained draft/finished-record flags',async()=>{
  const page=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
  const binding=page.slice(page.indexOf('const focusLockControl ='),page.indexOf('const switchFromSection ='));
  assert.doesNotMatch(binding,/follow\.blocked|tracks\.editing|routeChild\s*:/);
  assert.match(binding,/routeCard: routeVisible && !routeChild/);
  assert.match(binding,/drawing: tracks\.drawing/);
  assert.match(binding,/recording: recorder\.record\.phase === 'recording' \|\| recorder\.record\.phase === 'paused'/);
  assert.match(binding,/rally: rallyMode && !!navigation\.route/);
  assert.match(binding,/areaEditing: !!areas\.selected && areaEditing/);
  assert.match(binding,/annotationDetails: panel === 'annotations' && !!selectedAnnotation/);
  assert.doesNotMatch(page.slice(page.indexOf('const canAddCenterMarker'),page.indexOf('// follow.blocked')),/!selectedAnnotation/);
});
