import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('shared map switch exposes checked state, disabled state, and explicit density sizes', async () => {
  const [component, styles] = await Promise.all([
    read('modules/ui/MapSwitch.tsx'),
    read('modules/ui/mapSwitch.css'),
  ]);
  assert.match(component, /role="switch"/);
  assert.match(component, /onChange\(event\.currentTarget\.checked\)/);
  assert.match(component, /size\?: 'map' \| 'setting'/);
  assert.match(styles, /\.map-switch--map \{ min-height:44px/);
  assert.match(styles, /\.map-switch--setting \{ min-height:36px/);
  assert.match(styles, /data-checked='true'/);
  assert.match(styles, /var\(--ui-accent\)/);
});

test('high frequency map surfaces use shared controls without changing native preview semantics', async () => {
  const [layers, floating, dock, page, manifest] = await Promise.all([
    read('modules/controls/LayerPanel.tsx'),
    read('modules/guidance/FloatingNavigationControls.tsx'),
    read('modules/controls/ControlDock.tsx'),
    read('app/page.tsx'),
    read('package.json'),
  ]);
  assert.match(layers, /<MapSwitch[\s\S]*?size="map"/);
  assert.match(floating, /<MapSwitch[\s\S]*?size="setting"/);
  assert.match(floating, /disabled=\{!controls\.supported\}/);
  assert.match(floating, /网页仅预览/);
  assert.doesNotMatch(floating, /户外等高线3D|setOutdoorContours/);
  assert.doesNotMatch(dock, /onFriends|好友与分享|friends/);
  assert.doesNotMatch(page, /AccountFriendsPanel|createConfiguredSocialClient|importSocialShare|onFriends|panel === 'friends'/);
  assert.doesNotMatch(manifest, /@cloudbase\/js-sdk/);
  assert.match(dock, /<MapPanelHeader/);
});

test('shared panel header places back, save, and close actions through one component', async () => {
  const [header, dock, layerWindow, themeCss, surfacesCss] = await Promise.all([
    read('modules/ui/MapPanelHeader.tsx'),
    read('modules/controls/ControlDock.tsx'),
    read('modules/controls/LayerWindow.tsx'),
    read('modules/controls/outdoorTheme.css'),
    read('modules/controls/outdoorSurfaces.css'),
  ]);
  assert.match(header, /back\?:/);
  assert.match(header, /save\?:/);
  assert.match(header, /onClose: \(\) => void/);
  assert.match(dock, /<MapPanelHeader/);
  assert.match(layerWindow, /<MapPanelHeader/);
  assert.match(themeCss, /dock-heading:not\(\.map-panel-header\)/);
  assert.match(surfacesCss, /dock-heading\.map-panel-header \{[^}]*height:44px; min-height:44px/);
  assert.match(surfacesCss, /map-panel-header \.icon-button \{[^}]*width:44px; min-width:44px; height:44px; min-height:44px/);
  assert.match(surfacesCss, /map-panel-header :is\(\.dock-back,\.dock-hide\)[^}]*height:44px; min-height:44px/);
});
