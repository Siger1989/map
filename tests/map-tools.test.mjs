import test from 'node:test';
import assert from 'node:assert/strict';
import { MAP_TOOL_BOOLEAN_FIELDS, MAP_TOOL_NAMES, mapViewSnapshot } from '../modules/controls/useMapTools.ts';

test('WebMCP exposes map-only tools and removes weather state from legacy snapshots', () => {
  assert.deepEqual(MAP_TOOL_NAMES, ['get_map_view', 'configure_map_view']);
  assert.deepEqual(MAP_TOOL_BOOLEAN_FIELDS, ['terrain', 'satellite', 'contours', 'elevationColors', 'geology', 'roads', 'labels']);
  const output = mapViewSnapshot({
    layers: { terrain: true, roads: true, clouds: true, cloudOpacity: 0.5, rain: true, temperature: true, opacity: 0.7 },
    weather: { temperature: 22 }, weatherTime: '2026-10-06T00:00:00Z', weatherError: 'old',
    view: { zoom: 5 }, point: { lng: 1, lat: 2 },
  });
  assert.deepEqual(output, {
    layers: { terrain: true, roads: true },
    view: { zoom: 5 }, point: { lng: 1, lat: 2 },
  });
});
