import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';
import {
  AREA_DISPLAY_UNIT_STORAGE_KEY,
  AREA_DISPLAY_UNITS,
  convertAreaFromSquareMetres,
  formatAreaValue,
  readAreaDisplayUnit,
  writeAreaDisplayUnit,
} from '../modules/areas/areaDisplayUnits.ts';

async function loadTools() {
  await build({
    stdin: { contents: "export { AreaTools } from './modules/areas/AreaTools';", resolveDir: process.cwd(), loader: 'tsx' },
    outfile: '.openai/area-tools-test/AreaTools.js', bundle: true, format: 'esm', platform: 'node',
    packages: 'external', jsx: 'automatic', loader: { '.css': 'empty' },
    plugins: [{ name: 'area-tools-test-stubs', setup(api) {
      api.onResolve({ filter: /\.\.\/annotations\/AnnotationIdentity$/ }, () => ({ path: 'annotation-identity', namespace: 'area-stub' }));
      api.onLoad({ filter: /.*/, namespace: 'area-stub' }, () => ({ contents: `
        import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
        export function AnnotationIdentity({item}) { return jsx(Fragment,{children:[
          jsx('button',{className:'annotation-logo-current',children:'图标'},'logo'),
          jsxs('label',{className:'annotation-field',children:[jsx('span',{children:'名称'},'label'),jsx('input',{value:item.name,readOnly:true},'input')]},'identity'),
          jsxs('div',{className:'annotation-attributes',children:[
            jsx('span',{className:'annotation-attribute-head',children:'属性条目'}),
            ...((item.attributes||[]).map((field,index)=>jsxs('div',{className:'annotation-attribute-row','data-row':index,children:[jsx('input',{value:field.name,readOnly:true},'name'),jsx('textarea',{value:field.value,readOnly:true},'value'),jsx('button',{children:'×'},'delete')]},index))),
            jsx('button',{children:'＋ 属性条目'})
          ]},'attributes')
        ]}) }
      `, loader: 'tsx', resolveDir: process.cwd() }));
    } }],
  });
  return (await import('../.openai/area-tools-test/AreaTools.js')).AreaTools;
}

function setupStorage() {
  const { window } = parseHTML('<html><body></body></html>');
  const values = new Map();
  let failed = false;
  Object.assign(globalThis, {
    window,
    document: window.document,
    localStorage: {
      getItem: key => values.get(key) ?? null,
      setItem(key, value) { if (failed) throw new Error('storage unavailable'); values.set(key, String(value)); },
      removeItem: key => values.delete(key),
    },
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  return { window, values, fail: value => { failed = value; } };
}

function area(id) {
  return {
    id, name: `区域 ${id}`, note: '', color: '#66cfa2', visible: true,
    boundary: [[104, 31], [104.01, 31], [104.01, 31.01], [104, 31.01], [104, 31]],
    attributes: [{ name: '一', value: '1' }, { name: '二', value: '2' }, { name: '三', value: '3' }],
    createdAt: 1,
  };
}

test('square-metre conversions use standard exact unit factors and format zero/fractional values', () => {
  assert.equal(convertAreaFromSquareMetres(10_000, 'ha'), 1);
  assert.equal(convertAreaFromSquareMetres(2000 / 3, 'mu'), 1);
  assert.equal(convertAreaFromSquareMetres(0.09290304, 'ft2'), 1);
  assert.equal(convertAreaFromSquareMetres(4046.8564224, 'acre'), 1);
  assert.equal(convertAreaFromSquareMetres(2_589_988.110336, 'mi2'), 1);
  assert.equal(formatAreaValue(0, 'ha'), '0');
  assert.equal(formatAreaValue(1, 'ha'), '0.0001');
  assert.equal(formatAreaValue(1.5, 'mu'), '0.00225');
  assert.equal(AREA_DISPLAY_UNITS.length, 7);
});

test('area details change units immediately, persist across area selection and keep drawing while removing stretch controls', async t => {
  const dom = setupStorage();
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const AreaTools = await loadTools();
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  t.after(async () => React.act(async () => root.unmount()));
  const removed = [];
  const stateFor = selected => ({
    drawing: false, draft: [], items: [area(selected), area('another')], selected,
    update() {}, undoMove() {}, canUndo: false, remove(id) { removed.push(id); },
  });
  const render = (selected, drawing = false) => React.act(async () => root.render(React.createElement(AreaTools, {
    state: drawing ? { ...stateFor(selected), drawing: true, draft: [[104, 31]] } : stateFor(selected),
    onFinish() {}, onHide() {},
  })));

  await render('zone');
  const unitSelect = host.querySelector('[aria-label="面积单位"]');
  assert.ok(unitSelect);
  assert.equal(unitSelect.value, 'm2');
  assert.ok(host.querySelector('[aria-label="区域面积"]').textContent.length > 0);
  assert.equal(host.textContent.includes('拉伸成模型'), false);
  assert.equal(host.querySelector('[aria-label="拉伸高度"]'), null);
  const editorContentChildren = [...host.querySelector('.area-editor-content').children];
  assert.equal(editorContentChildren.at(-1).classList.contains('annotation-attributes'), true, 'custom attributes are the final editor section');
  assert.equal(editorContentChildren.at(-1).querySelectorAll('.annotation-attribute-row').length, 3, 'three custom rows are rendered');
  assert.ok(host.querySelector('.area-metrics summary').textContent.includes('球面面积估算'));

  await React.act(async () => host.querySelector('[aria-label="删除区域"]').click());
  assert.ok(host.querySelector('[role="alertdialog"][aria-label="确认删除区域"]'));
  assert.deepEqual(removed, [], 'the top delete button only opens confirmation');
  await React.act(async () => host.querySelector('[aria-label="取消删除区域"]').click());
  assert.equal(host.querySelector('[role="alertdialog"]'), null);
  await React.act(async () => host.querySelector('[aria-label="删除区域"]').click());
  await React.act(async () => host.querySelector('button[aria-label="确认删除区域"]').click());
  assert.deepEqual(removed, ['zone'], 'delete requires explicit confirmation');

  const reactProps = element => element[Object.keys(element).find(key => key.startsWith('__reactProps$'))];
  await React.act(async () => reactProps(unitSelect).onChange({ target: { value: 'ha' } }));
  assert.equal(host.querySelector('[aria-label="面积单位"]').value, 'ha');
  const haOutput = host.querySelector('[aria-label="区域面积"]').textContent;
  await render('another');
  assert.equal(host.querySelector('[aria-label="面积单位"]').value, 'ha', 'another region uses the same selected display unit');
  assert.equal(host.querySelector('[aria-label="区域面积"]').textContent, haOutput, 'unit-only display does not mutate area geometry/metrics');
  assert.equal(dom.values.get(AREA_DISPLAY_UNIT_STORAGE_KEY), 'ha');
  assert.equal(readAreaDisplayUnit(), 'ha');

  await render('another', true);
  assert.ok(host.querySelector('[aria-label="划区域工具"]'), 'region drawing remains available');
  assert.ok([...host.querySelectorAll('button')].some(button => button.textContent.includes('闭合区域')));
  assert.equal(host.querySelector('[aria-label="面积单位"]'), null, 'drawing flow is unchanged and does not add an area readout');
});

test('unit persistence failure leaves the stored preference unchanged and invalid values fall back to square metres', () => {
  const dom = setupStorage();
  assert.equal(readAreaDisplayUnit(), 'm2');
  dom.fail(true);
  assert.equal(writeAreaDisplayUnit('acre'), false);
  assert.equal(dom.values.has(AREA_DISPLAY_UNIT_STORAGE_KEY), false);
  dom.fail(false);
  dom.values.set(AREA_DISPLAY_UNIT_STORAGE_KEY, 'unknown');
  assert.equal(readAreaDisplayUnit(), 'm2');
  assert.equal(writeAreaDisplayUnit('ha'), true);
  assert.equal(readAreaDisplayUnit(), 'ha');
});
