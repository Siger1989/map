import test from 'node:test';
import assert from 'node:assert/strict';
import { floatingGeometry } from '../modules/input/floatingGeometry.ts';
test('suggestions remain above keyboard, including scrolled visual viewport and narrow screens', () => {
  for (const viewport of [{top:0,left:0,width:412,height:480},{top:50,left:0,width:360,height:320},{top:0,left:0,width:266,height:280}]) {
    for (const y of [40,140,240,viewport.top+viewport.height-45]) {
      const anchor={left:80,width:220,top:y,bottom:y+36};
      const box=floatingGeometry(anchor,viewport);
      assert.ok(box.top>=viewport.top+4);
      assert.ok(box.top+box.maxHeight<=viewport.top+viewport.height-4);
      assert.ok(box.left+box.width<=viewport.left+viewport.width-4);
      assert.ok(box.maxHeight<=200);
      if(anchor.top>=viewport.top+4 && anchor.bottom<=viewport.top+viewport.height-4) assert.ok(box.top>=anchor.bottom || box.top+box.maxHeight<=anchor.top);
    }
  }
});
