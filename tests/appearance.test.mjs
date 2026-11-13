import test from 'node:test';
import assert from 'node:assert/strict';
import {parseAppearance,DEFAULT_APPEARANCE,PRESETS,contrastRatio,themeTokens,mix} from '../modules/appearance/theme.ts';
test('appearance restores invalid storage and preserves independent light/dark palettes',()=>{
  for(const value of [null,'bad','{}',JSON.stringify({...DEFAULT_APPEARANCE,light:{...DEFAULT_APPEARANCE.light,background:'url(x)'}})]) {
    assert.deepEqual(parseAppearance(value),DEFAULT_APPEARANCE);
  }
  const custom=structuredClone(DEFAULT_APPEARANCE);custom.mode='system';custom.dark.background='#090909';
  assert.deepEqual(parseAppearance(JSON.stringify(custom)),custom);
  const originalAccent=DEFAULT_APPEARANCE.light.accent;const restored=parseAppearance(null);restored.light.accent='#000000';assert.equal(DEFAULT_APPEARANCE.light.accent,originalAccent);
});
test('theme keeps chosen accent and readable foreground, including low contrast custom colours',()=>{
  for(const palette of [...PRESETS.flatMap(p=>[p.light,p.dark]),{accent:'#aaaaaa',background:'#aaaaaa',foreground:'#aaaaaa',contrast:100}]) {
    const values=themeTokens(palette);
    assert.equal(values['--ui-accent'],palette.accent);
    assert.ok(contrastRatio(values['--ui-accent-ink'],values['--ui-surface'])>=4.5, 'accent text remains readable on the palette surface');
    assert.ok(contrastRatio(values['--ui-ink'],values['--ui-surface'])>=4.5);
    assert.ok(contrastRatio(values['--ui-on-accent'],palette.accent)>=4.5);
    assert.ok(contrastRatio(values['--ui-on-switch'],values['--ui-switch-on'])>=3, 'softened switches retain non-text contrast in presets and custom palettes');
    assert.ok(contrastRatio(values['--ui-on-switch-off'],values['--ui-switch-off'])>=3, 'off switches retain non-text contrast in presets and custom palettes');
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

test('all presets retain readable buttons after shared UI migration',()=>{
  for(const palette of PRESETS.flatMap(p=>[p.light,p.dark])) {
    const values=themeTokens(palette);
    assert.ok(contrastRatio(values['--ui-button'],values['--ui-button-ink'])>=4.5);
    assert.ok(contrastRatio(values['--ui-active'],values['--ui-active-ink'])>=4.5);
  }
  const legacy={mode:'light',light:{accent:'#15572b',background:'#ffffff',button:'#eef3f0',foreground:'#10243c',contrast:40},dark:{accent:'#9de8c4',background:'#17231f',button:'#30433a',foreground:'#edf6f0',contrast:50}};
  assert.deepEqual(parseAppearance(JSON.stringify(legacy)),legacy);
});

test('cream orange preset uses a vivid control accent and readable warm accent text',()=>{
  const preset=PRESETS.find(p=>p.name==='奶油橙');
  assert.ok(preset);
  assert.equal(preset.light.background,'#fffaf1');
  assert.equal(preset.light.accent,'#f4a900');
  assert.equal(themeTokens(preset.light)['--ui-accent'],preset.light.accent);
  assert.ok(contrastRatio(themeTokens(preset.light)['--ui-accent-ink'],preset.light.background)>=4.5);
  assert.equal(DEFAULT_APPEARANCE.mode,'light');
  assert.deepEqual(parseAppearance(JSON.stringify({...DEFAULT_APPEARANCE,mode:'dark'})),{...DEFAULT_APPEARANCE,mode:'dark'});
});

test('classic comparison palettes keep cream orange as default and preserve legacy presets',()=>{
  const comparison=['奶油橙','海盐蓝','薄荷绿','雾紫','珊瑚','深琥珀'];
  assert.deepEqual(comparison.map(name=>PRESETS.find(p=>p.name===name)?.name),comparison);
  assert.equal(DEFAULT_APPEARANCE.light.accent,PRESETS.find(p=>p.name==='奶油橙').light.accent);
  for(const legacy of ['山兔默认','科技深蓝','湖蓝','暖沙']) assert.ok(PRESETS.some(p=>p.name===legacy));
  for(const preset of PRESETS) {
    for(const scheme of ['light','dark']) {
      const palette=preset[scheme];
      assert.ok(contrastRatio(palette.foreground,palette.background)>=4.5,`${preset.name} ${scheme} text contrast`);
    }
  }
});

test('frosted surfaces reveal the map while keeping text legible over light and dark backdrops',()=>{
  for(const preset of PRESETS) for(const mode of ['light','dark']) {
    const palette=preset[mode], tokens=themeTokens(palette);
    const alpha=Number(tokens['--ui-glass-surface'].match(/,\s*([\d.]+)\)$/)[1]);
    assert.ok(alpha >= .5 && alpha < .8,`${preset.name} ${mode} stays visibly translucent`);
    for(const backdrop of ['#000000','#ffffff','#9aac8b','#184c76']) {
      assert.ok(contrastRatio(tokens['--ui-glass-ink'],mix(backdrop,palette.background,alpha))>=4.5,
        `${preset.name} ${mode} readable over ${backdrop}`);
    }
  }
});
