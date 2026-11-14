import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import postcss from 'postcss';
import { transform } from 'lightningcss';
import mobileViewportCompatibility from '../scripts/mobile-css-compat.mjs';

async function compile(css) {
  const lowered = await postcss([mobileViewportCompatibility()]).process(css, { from: undefined });
  const production = transform({ filename: 'mobile-glass.css', code: Buffer.from(lowered.css), minify: true, targets: { chrome: 99 << 16 } });
  return { lowered: lowered.css, production: production.code.toString() };
}

test('APK production minifier retains standard backdrop-filter for both declaration orders and vendor-only CSS', async () => {
  for (const css of [
    '.panel{backdrop-filter:var(--ui-glass-filter);-webkit-backdrop-filter:var(--ui-glass-filter)}',
    '.panel{-webkit-backdrop-filter:var(--ui-glass-filter);backdrop-filter:var(--ui-glass-filter)}',
    '.panel{-webkit-backdrop-filter:var(--ui-glass-filter)}',
    '.panel{backdrop-filter:blur(10px) saturate(125%)!important;-webkit-backdrop-filter:blur(10px) saturate(125%)!important}',
  ]) {
    const { lowered, production } = await compile(css);
    const declarations = postcss.parse(production).first.nodes.filter(node => node.type === 'decl');
    assert.ok(declarations.some(node => node.prop === 'backdrop-filter'), production);
    assert.ok(lowered.indexOf('-webkit-backdrop-filter:') < lowered.lastIndexOf('backdrop-filter:'), 'prefixed fallback precedes standard property');
    assert.equal((await compile(lowered)).lowered, lowered, 'normalization is idempotent');
  }
});

test('backdrop normalization preserves intentionally different fallback values and priority', async () => {
  for (const css of [
    '.panel{backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(8px)}',
    '.panel{backdrop-filter:blur(10px)!important;-webkit-backdrop-filter:blur(10px)}',
  ]) {
    const result = await postcss([mobileViewportCompatibility()]).process(css, { from: undefined });
    assert.equal(result.css, css);
  }
});

test('real dual source popup and bottom rail retain their filter and original material tokens after minification', async () => {
  const source = (await Promise.all([
    readFile(new URL('../modules/mapComparison/mapComparison.css', import.meta.url), 'utf8'),
    readFile(new URL('../modules/appearance/roundedSpring.css', import.meta.url), 'utf8'),
  ])).join('\n');
  const { production } = await compile(source);
  const root = postcss.parse(production);
  for (const selector of ['.map-comparison-heading', '.map-comparison-toolbar', '.comparison-source-popup', '.map-toolbar']) {
    const matching = [];
    root.walkRules(rule => {
      if (rule.selector.includes(selector)) matching.push(...rule.nodes.filter(node => node.type === 'decl' && node.prop === 'backdrop-filter' && node.value === 'var(--ui-glass-filter)'));
    });
    assert.ok(matching.length > 0, `${selector} must retain its standard filter in production CSS`);
  }
  assert.ok(production.includes('var(--ui-material-panel,var(--ui-glass-surface))'));
  assert.ok(production.includes('var(--ui-material-bottom,var(--ui-glass-surface))'));
});
