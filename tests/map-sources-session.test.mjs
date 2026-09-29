import test from 'node:test';
import assert from 'node:assert/strict';
import { getMapSourcesSessionState, mapSourcesBrowseScrollToRestore, mapSourcesBrowseStepToRestore, rememberMapSourcesBrowseScroll, rememberMapSourcesBrowseStep, updateMapSourcesSessionState } from '../modules/mapSources/sessionState.ts';

test('map-source chooser remembers tabs, search, filters and scroll in session memory', () => {
  updateMapSourcesSessionState({
    category: 'saved',
    savedQuery: 'satellite',
    savedFilter: 'online',
    libraryCategory: '日本',
    browseStep: 'list',
    listScrollTop: 416,
    libraryScrollTop: 0,
  });
  assert.deepEqual({ ...getMapSourcesSessionState() }, {
    category: 'saved',
    savedQuery: 'satellite',
    savedFilter: 'online',
    libraryCategory: '日本',
    browseStep: 'list',
    listScrollTop: 416,
    libraryScrollTop: 0,
  });
});

test('closing and reopening restores list scroll after entering import and returning', () => {
  rememberMapSourcesBrowseStep('list');
  rememberMapSourcesBrowseScroll('list', 368);
  assert.equal(mapSourcesBrowseStepToRestore(), 'list');
  assert.equal(mapSourcesBrowseScrollToRestore('list', true), 368, 'reopen the remembered list position');
  assert.equal(mapSourcesBrowseScrollToRestore('list', false), null, 'wait until source rows are ready before restoring');
  rememberMapSourcesBrowseStep('library');
  rememberMapSourcesBrowseScroll('library', 524);
  rememberMapSourcesBrowseStep('preview');
  rememberMapSourcesBrowseScroll('preview', 0);
  rememberMapSourcesBrowseStep('add');
  assert.equal(mapSourcesBrowseStepToRestore(), 'library', 'temporary import steps must not replace the last browse tab');
  assert.equal(mapSourcesBrowseScrollToRestore('library', true), 524, 'reopen library at its own scroll position');
  assert.equal(mapSourcesBrowseScrollToRestore('list', true), 368, 'library and list keep independent scroll positions');
});
