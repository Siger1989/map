import test from 'node:test';
import assert from 'node:assert/strict';
import {parseAppearance,DEFAULT_APPEARANCE,PRESETS,contrastRatio,themeTokens} from '../modules/appearance/theme.ts';
test('appearance restores invalid storage and preserves independent light/dark palettes',()=>{
  for(const value of [null,'bad','{}',JSON.stringify({...DEFAULT_APPEARANCE,light:{...DEFAULT_APPEARANCE.light,background:'url(x)'}})]) {
    assert.deepEqual(parseAppearance(value),DEFAULT_APPEARANCE);
  }
  const custom=structuredClone(DEFAULT_APPEARANCE);custom.mode='system';custom.dark.background='#090909';
  assert.deepEqual(parseAppearance(JSON.stringify(custom)),custom);
  const restored=parseAppearance(null);restored.light.accent='#000000';assert.equal(DEFAULT_APPEARANCE.light.accent,'#15572b');
});
test('theme keeps chosen accent and readable foreground, including low contrast custom colours',()=>{
  for(const palette of [...PRESETS.flatMap(p=>[p.light,p.dark]),{accent:'#aaaaaa',background:'#aaaaaa',foreground:'#aaaaaa',contrast:100}]) {
    const values=themeTokens(palette);
    assert.equal(values['--ui-accent'],palette.accent);
    assert.ok(contrastRatio(values['--ui-ink'],values['--ui-surface'])>=4.5);
    assert.ok(contrastRatio(values['--ui-on-accent'],palette.accent)>=4.5);
  }
});
test('background and button colours are independent, including old saved preferences',()=>{
  const before=themeTokens(DEFAULT_APPEARANCE.light);
  const after=themeTokens({...DEFAULT_APPEARANCE.light,background:'#ff4d4d'});
  assert.equal(after['--ui-surface'],'#ff4d4d');
  assert.equal(after['--ui-button'],before['--ui-button']);
  const old=structuredClone(DEFAULT_APPEARANCE);delete old.light.button;
  assert.equal(parseAppearance(JSON.stringify(old)).light.button,DEFAULT_APPEARANCE.light.button);
});
