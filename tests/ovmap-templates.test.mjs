import test from 'node:test';
import assert from 'node:assert/strict';
import {
  renderOvmapTemplate,
  supportedOvmapTemplate,
} from '../modules/mapSources/ovmapTemplates.ts';

test('renders XYZ tokens while preserving query parameters and ordinary braces', () => {
  const template = 'https://tiles.example.invalid/{4}/{$z}/{$x}/{$y}.png?token=fixture&layer={base}';
  assert.equal(supportedOvmapTemplate(template), true);
  assert.equal(
    renderOvmapTemplate(template, 4, 7, 9),
    'https://tiles.example.invalid/{4}/4/7/9.png?token=fixture&layer={base}',
  );
});

test('renders the OVMAP Bing XYZ plus {4} compound as a quadkey', () => {
  const template = 'https://tiles.example.invalid/comp/ch/{$x}{$y}{$z}{4}?x={x}&layer={base}';
  assert.equal(supportedOvmapTemplate(template), true);
  assert.equal(
    renderOvmapTemplate(template, 3, 3, 5),
    'https://tiles.example.invalid/comp/ch/213?x=3&layer={base}',
  );
  assert.equal(
    renderOvmapTemplate('/literal/{4}/{$z}/{$x}/{$y}', 3, 3, 5),
    '/literal/{4}/3/3/5',
  );
});

test('accepts the app standard brace form for XYZ coordinates', () => {
  assert.equal(
    renderOvmapTemplate('https://tiles.example.invalid/{z}/{x}/{y}.png?token=fixture', 4, 7, 9),
    'https://tiles.example.invalid/4/7/9.png?token=fixture',
  );
});

test('supports bounded arithmetic including the documented 512px parent tile mapping', () => {
  const template = 'https://tiles.example.invalid/tile/{$z-1}/{$x/2}/{$y/2}?token=fixture';
  assert.equal(
    renderOvmapTemplate(template, 17, 25, 31),
    'https://tiles.example.invalid/tile/16/12/15?token=fixture',
  );
  assert.equal(renderOvmapTemplate('/{$z+2}/{$x*3}/{$y-1}', 4, 2, 3), '/6/6/2');
  assert.equal(renderOvmapTemplate('/{$x/2}', 3, 5, 7), '/2');
});

test('renders the observed Galileo salt token', () => {
  const template = 'https://tile.example.invalid/{$z}/{$x}/{$y}?s={$Galileo}';
  assert.equal(supportedOvmapTemplate(template), true);
  assert.equal(
    renderOvmapTemplate(template, 3, 1, 0),
    'https://tile.example.invalid/3/1/0?s=Gal',
  );
  assert.equal(renderOvmapTemplate('/{$Galileo}', 3, 0, 0), '/');
});

test('renders only the explicit OVMAP {$y!} reverse-row token', () => {
  assert.equal(renderOvmapTemplate('/{$z}/{$x}/{$y!}', 0, 0, 0), '/0/0/0');
  assert.equal(renderOvmapTemplate('/{$z}/{$x}/{$y!}', 4, 3, 0), '/4/3/15');
  assert.equal(renderOvmapTemplate('/{$z}/{$x}/{$y!}', 4, 3, 15), '/4/3/0');
  assert.equal(renderOvmapTemplate('/{$z}/{$x}/{$y!}', 24, 1234567, 1234567), '/24/1234567/15542648');
  assert.equal(renderOvmapTemplate('/{$z}/{x}/{$y}/{$y!}', 4, 3, 6), '/4/3/6/9');
  assert.equal(supportedOvmapTemplate('/{$y!}'), true, 'the reverse row alone identifies a tile template');
});

test('rejects unknown variables, executable syntax, unbounded expressions, and zero division', () => {
  for (const template of [
    'https://tiles.example.invalid/{$q}/{$x}/{$y}',
    'https://tiles.example.invalid/{$serverpart}/{$x}/{$y}',
    'https://tiles.example.invalid/{$quadkey}',
    'https://tiles.example.invalid/{$x}/{$y}/{$z};{$x.constructor}',
    'https://tiles.example.invalid/{$x+1000001}/{$y}/{$z}',
    'https://tiles.example.invalid/{$x/0}/{$y}/{$z}',
    'https://tiles.example.invalid/{$x+1+2}/{$y}/{$z}',
    'https://tiles.example.invalid/{$x/1000001}/{$y}/{$z}',
    'https://tiles.example.invalid/{$x/{$y}}',
    'https://tiles.example.invalid/{$x!}',
    'https://tiles.example.invalid/{$z!}',
    'https://tiles.example.invalid/{$y!!}',
    'https://tiles.example.invalid/{$y!+1}',
    'https://tiles.example.invalid/{$y!-1}',
    'https://tiles.example.invalid/{$y!/2}',
  ]) {
    assert.equal(supportedOvmapTemplate(template), false, template);
    assert.throws(() => renderOvmapTemplate(template, 3, 1, 1), /不支持/);
  }
});

test('ordinary brace text is never interpreted as the reverse-row operator', () => {
  assert.equal(renderOvmapTemplate('/{y!}/{$z}/{$x}', 4, 3, 6), '/{y!}/4/3');
});

test('bounds coordinate inputs and computed values', () => {
  assert.throws(() => renderOvmapTemplate('/{$z}/{$x}/{$y}', -1, 0, 0), /缩放级别/);
  assert.throws(() => renderOvmapTemplate('/{$z}/{$x}/{$y}', 2, 4, 0), /坐标/);
  assert.throws(() => renderOvmapTemplate('/{$x*999999}', 20, 1024, 0), /安全范围/);
});
