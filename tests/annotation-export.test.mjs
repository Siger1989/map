import test from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import {
  newAnnotation,
  parseAnnotations,
  validAnnotation,
} from '../modules/annotations/data.ts';
import {
  blankAttributes,
  rememberAttributes,
  readAttributeTemplate,
} from '../modules/annotations/attributes.ts';
import {
  annotationSpreadsheet,
  annotationSheet,
} from '../modules/annotations/spreadsheet.ts';
import {
  validateTransfer,
  mergeData,
  collectData,
} from '../modules/outdoor/exchange.ts';
const annotation = () => ({
  ...newAnnotation('pin', [104.06, 30.67], 502, 'sample-id'),
  icon: 'sample',
  name: '采样点甲',
  attributes: [
    { name: '编号', value: '00123' },
    { name: '备注', value: '=1+1' },
    { name: '中文', value: '砂岩，含水\n二层 & <低>' },
  ],
});
test('legacy annotations and new icons/attributes survive local and transfer round trips', () => {
  const old = newAnnotation('box', [104, 31], null, 'old'),
    a = annotation();
  assert.deepEqual(parseAnnotations(JSON.stringify([old, a])), [old, a]);
  assert.equal(validAnnotation({ ...a, icon: 'not-an-icon' }), false);
  assert.equal(
    validAnnotation({ ...a, attributes: [{ name: 'x', value: 42 }] }),
    false,
  );
  assert.equal(
    validAnnotation({
      ...a,
      attributes: Array(41).fill({ name: 'x', value: '' }),
    }),
    false,
  );
  const data = new Map(),
    storage = {
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => data.set(k, v),
      removeItem: (k) => data.delete(k),
    };
  mergeData(
    validateTransfer({
      format: 'guanyun-backup',
      version: 1,
      tracks: [],
      favorites: [],
      annotations: [a],
    }),
    storage,
  );
  assert.deepEqual(collectData(storage).annotations, [a]);
});
test('attribute template remembers keys, never values, and deletion affects next default list', () => {
  const first = rememberAttributes(
    readAttributeTemplate(null),
    annotation().attributes,
  );
  assert.deepEqual(
    blankAttributes(first).map((f) => f.value),
    ['', '', ''],
  );
  const next = rememberAttributes(first, [{ name: '中文', value: 'another' }]);
  assert.deepEqual(blankAttributes(next), [{ name: '中文', value: '' }]);
  assert.ok(next.recent.includes('编号'));
  assert.throws(() => readAttributeTemplate('{bad'));
});
test('XLSX is UTF-8 OOXML, preserves leading zeroes and formula-looking text without formula cells', () => {
  const a = annotation(),
    bytes = annotationSpreadsheet([a]),
    files = unzipSync(bytes);
  assert.ok(files['[Content_Types].xml']);
  const sheet = strFromU8(files['xl/worksheets/sheet1.xml']);
  assert.match(sheet, /00123/);
  assert.match(sheet, /=1\+1/);
  assert.match(sheet, /砂岩，含水/);
  assert.match(sheet, /&amp; &lt;低&gt;/);
  assert.doesNotMatch(sheet, /<f[ >]/);
  assert.match(sheet, /t="n"><v>104.06/);
  const duplicates = annotationSheet([
    {
      ...a,
      attributes: [
        { name: '编号', value: 'a' },
        { name: '编号', value: 'b' },
        { name: '', value: 'c' },
      ],
    },
  ]);
  assert.deepEqual(duplicates.rows[1].slice(-3), ['a', 'b', 'c']);
});
