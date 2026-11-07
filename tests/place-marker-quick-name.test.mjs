import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';

test('search/shared places persist named markers, deduplicate, and quick renames wait for IME completion', async t => {
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>');
  const disk = new Map();
  Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true,
    localStorage: { getItem: key => disk.get(key) ?? null, setItem: (key, value) => disk.set(key, value) } });
  await build({ stdin: { contents: `export {useAnnotations} from './modules/annotations/useAnnotations'; export {AnnotationQuickName} from './modules/annotations/AnnotationQuickName';`, resolveDir: process.cwd(), loader: 'tsx' },
    outfile: '.openai/place-marker-quick-name.mjs', bundle: true, format: 'esm', platform: 'node', packages: 'external', jsx: 'automatic', loader: { '.css': 'empty' },
    plugins: [{ name: 'no-network-terrain', setup(api) {
      api.onResolve({ filter: /terrain\/elevation$/ }, () => ({ path: 'terrain', namespace: 'test' }));
      api.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export async function readElevation(){return null}' }));
    } }], logLevel: 'silent' });
  const React = await import('react'), { createRoot } = await import('react-dom/client');
  const { useAnnotations, AnnotationQuickName } = await import('../.openai/place-marker-quick-name.mjs');
  let state;
  function Probe() {
    state = useAnnotations();
    const item = state.items.find(item => item.id === state.selected);
    return item && React.createElement(AnnotationQuickName, { key: item.id, id: item.id, name: item.name, onSave: name => state.update(item.id, { name }) });
  }
  const root = createRoot(document.getElementById('root'));
  t.after(async () => { await React.act(async () => root.unmount()); delete globalThis.window; delete globalThis.document; delete globalThis.localStorage; delete globalThis.IS_REACT_ACT_ENVIRONMENT; });
  await React.act(async () => root.render(React.createElement(Probe)));
  const place = { name: '测试目的地', coordinates: [20, 10], detail: '收到的地址', coordinateSystem: 'WGS84' };
  await React.act(async () => assert.equal(state.savePlace(place), true));
  assert.equal(state.items.length, 1);
  assert.equal(state.items[0].name, place.name);
  assert.equal(state.items[0].note, place.detail);
  const id = state.items[0].id;
  await React.act(async () => assert.equal(state.savePlace(place), true));
  assert.equal(state.items.length, 1);
  assert.equal(state.selected, id);
  const props = () => { const input = document.querySelector('input'); return [input, input[Object.keys(input).find(key => key.startsWith('__reactProps$'))]]; };
  let [input, handlers] = props();
  await React.act(async () => handlers.onCompositionStart());
  await React.act(async () => handlers.onChange({ target: { value: '新名称' } }));
  [input, handlers] = props();
  await React.act(async () => handlers.onBlur());
  assert.equal(state.items[0].name, place.name, 'blur during composition does not save incomplete text');
  await React.act(async () => handlers.onCompositionEnd({ currentTarget: { value: '新名称' } }));
  assert.equal(state.items[0].name, '新名称');
  assert.equal(JSON.parse(disk.get('guanyun.annotations.v1'))[0].name, '新名称');
  await React.act(async () => state.move(id, [20.001, 10.001]));
  assert.deepEqual(JSON.parse(disk.get('guanyun.annotations.v1'))[0].coordinates, [20.001, 10.001], 'moving persists without a completion button');
});
