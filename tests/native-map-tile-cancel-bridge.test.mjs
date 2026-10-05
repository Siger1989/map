import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Android gateway passes opaque tile request ids and the JS bridge cancels by id', () => {
  const gateway = readFileSync('mobile/android/src/com/guanyun/weather/LocalGateway.java', 'utf8');
  const bridge = readFileSync('mobile/android/src/com/guanyun/weather/NativeBridge.java', 'utf8');
  assert.match(gateway, /String requestId\s*=\s*uri\.getQueryParameter\("requestId"\)/);
  assert.match(gateway, /MapTileProxy\.fetch\(source,\s*requestId\)/);
  assert.match(bridge, /@JavascriptInterface\s+public void cancelMapTile\(String requestId\)\s*\{\s*MapTileProxy\.cancel\(requestId\);\s*\}/);
});
