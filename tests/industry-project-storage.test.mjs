import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {
  INDUSTRY_PROJECT_MAX_SOURCE_BYTES,
  readIndustryProjects,
  replaceIndustryProjects,
  syncIndustryProjects,
  validateIndustryProjects,
} from '../modules/industry/projectStorage.ts';

const project = (id, name, kind = 'section', source = 'UEs=') => ({ id, name, kind, sourceBase64: source, createdAt: 1 });

test('行业原文件项目校验、按ID同步和精确恢复均遵守容量并保留正确语义', async () => {
  assert.deepEqual(validateIndustryProjects([project('a', 'a.xlsx')]), [project('a', 'a.xlsx')]);
  assert.throws(() => validateIndustryProjects([project('a', 'a.xlsx'), project('a', 'again.xlsx')]), /重复/);
  assert.throws(() => validateIndustryProjects([project('bad', 'bad.xlsx', 'section', 'not base64!')]), /编码/);
  assert.throws(() => validateIndustryProjects([project('bad', 'bad.xlsx', 'other')]), /图种/);
  const oversized = 'A'.repeat(Math.ceil((INDUSTRY_PROJECT_MAX_SOURCE_BYTES + 1) / 3) * 4);
  assert.throws(() => validateIndustryProjects([project('large', 'large.xlsx', 'section', oversized)]), /20 MB/);

  await replaceIndustryProjects([project('local', 'local.xlsx'), project('shared', 'before.xlsx')]);
  const merged = await syncIndustryProjects([project('shared', 'after.xlsx', 'drill')]);
  assert.equal(merged.length, 2);
  assert.equal(merged.find(item => item.id === 'local').name, 'local.xlsx');
  assert.equal(merged.find(item => item.id === 'shared').name, 'after.xlsx');
  assert.equal(merged.find(item => item.id === 'shared').kind, 'drill');
  assert.deepEqual(await readIndustryProjects(), merged);

  await replaceIndustryProjects([project('only', 'restored.xlsx')]);
  assert.deepEqual(await readIndustryProjects(), [project('only', 'restored.xlsx')]);
});
