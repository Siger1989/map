import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { parseHTML } from 'linkedom';
import { gridPoints } from '../modules/weather/data.ts';

async function loadRainLegend() {
  await build({
    entryPoints: ['modules/weather/RainLegend.tsx'],
    outdir: '.openai/rain-legend-test',
    bundle: true,
    format: 'esm',
    platform: 'node',
    packages: 'external',
    jsx: 'automatic',
    loader: { '.css': 'empty' },
    logLevel: 'silent',
  });
  return (await import('../.openai/rain-legend-test/RainLegend.js')).RainLegend;
}

function weather(valuesByHour) {
  const points = gridPoints(103.28, 31.08);
  return {
    anchor: [103.28, 31.08],
    fetchedAt: 1,
    times: [Date.UTC(2026, 9, 5, 11), Date.UTC(2026, 9, 5, 12)],
    cells: points.map((point, i) => ({
      ...point,
      elevation: null,
      hours: valuesByHour.map((values) => ({ rain: values[i] ?? null })),
    })),
  };
}

function view(Component, props) {
  const html = renderToStaticMarkup(createElement(Component, props));
  return parseHTML(html).document;
}

test('rain legend shows selected Beijing time, sampled forecast range, and shared logarithmic colors', async () => {
  const RainLegend = await loadRainLegend();
  const data = weather([
    Array(25).fill(0.1),
    [0, 0.05, 0.1, 0.3, 0.5, 1, 2, 4, 10, 20],
  ]);
  const doc = view(RainLegend, { data, index: 1, loading: false, error: '' });
  assert.equal(doc.querySelector('summary strong').textContent, '雨量 mm');
  assert.equal(doc.querySelector('.rain-map-legend-heading').textContent, '雨量 mm0–2020:00⌄');
  assert.equal(doc.querySelector('.rain-map-legend-chevron').getAttribute('aria-hidden'), 'true');
  assert.equal(doc.querySelector('.rain-map-legend-range').textContent, '0–20');
  assert.equal(doc.querySelector('.rain-map-legend-range').getAttribute('aria-label'), '本区预报范围 0–20 mm');
  assert.equal(doc.querySelector('details').hasAttribute('open'), false, 'long details start collapsed');
  assert.match(doc.querySelector('.rain-map-legend-details').textContent, /Open-Meteo/);
  assert.match(doc.querySelector('.rain-map-legend-details').textContent, /连续插值/);
  assert.match(doc.querySelector('.rain-map-legend-details').textContent, /空白为无雨或无数据/);
  assert.match(doc.querySelector('.rain-map-legend-details').textContent, /非雷达观测/);
  assert.match(doc.querySelector('.rain-map-legend-details').textContent, /10月5日 20:00（北京时间）/);
  assert.match(doc.querySelector('.rain-map-legend-details').textContent, /本区预报范围 0–20 mm/);
  const previousHour = view(RainLegend, { data, index: 0, loading: false, error: '' });
  assert.equal(previousHour.querySelector('.rain-map-legend-range').textContent, '0.1–0.1');
});

test('rain legend distinguishes loading, errors, missing samples, and valid dry forecasts', async () => {
  const RainLegend = await loadRainLegend();
  const missing = weather([Array(25).fill(null), Array(25).fill(null)]);
  const loading = view(RainLegend, { data: null, index: 0, loading: true, error: '' });
  assert.equal(loading.querySelector('.rain-map-legend-range').textContent, '更新中');
  const existing = weather([Array(25).fill(0.5), Array(25).fill(1.25)]);
  const loadingExisting = view(RainLegend, { data: existing, index: 0, loading: true, error: '' });
  assert.equal(loadingExisting.querySelector('.rain-map-legend-range').getAttribute('aria-label'), '更新中');
  const failedExisting = view(RainLegend, { data: existing, index: 0, loading: false, error: '天气服务暂不可用' });
  assert.equal(failedExisting.querySelector('.rain-map-legend-range').getAttribute('aria-label'), '读取失败');
  const failure = view(RainLegend, { data: null, index: 0, loading: false, error: '天气服务暂不可用' });
  assert.equal(failure.querySelector('.rain-map-legend-range').textContent, '读取失败');
  assert.match(failure.querySelector('.rain-map-legend-details').textContent, /天气服务暂不可用/);
  const noSamples = view(RainLegend, { data: missing, index: 1, loading: false, error: '' });
  assert.equal(noSamples.querySelector('.rain-map-legend-range').textContent, '无样本');
  const dry = view(RainLegend, { data: weather([Array(25).fill(0), Array(25).fill(null)]), index: 0, loading: false, error: '' });
  assert.equal(dry.querySelector('.rain-map-legend-range').textContent, '0–0', 'valid dry values remain different from missing values');
});
