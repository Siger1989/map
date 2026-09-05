import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePlaces,
  normalizeRoute,
  routeURL,
} from '../modules/navigation/provider.ts';
import { formatDuration, metresBetween } from '../modules/navigation/types.ts';
const start = { name: '成都', coordinates: [104.066, 30.659] };
const end = { name: '终点', coordinates: [104.072, 30.671] };
const fixture = () => ({
  code: 'Ok',
  routes: [
    {
      distance: 1995,
      duration: 356,
      geometry: {
        type: 'LineString',
        coordinates: [start.coordinates, end.coordinates],
      },
      legs: [
        {
          steps: [
            {
              distance: 1900,
              duration: 340,
              name: '人民中路',
              geometry: { coordinates: [start.coordinates, end.coordinates] },
              maneuver: { type: 'turn', modifier: 'left' },
            },
            {
              distance: 95,
              duration: 16,
              geometry: { coordinates: [end.coordinates] },
              maneuver: { type: 'arrive' },
            },
          ],
        },
      ],
    },
  ],
  waypoints: [{ location: start.coordinates }, { location: end.coordinates }],
});
test('三种模式发送不同道路成本模型，始终保留经纬度顺序', () => {
  for (const mode of ['auto', 'bicycle', 'pedestrian']) {
    const payload = JSON.parse(
      new URL(routeURL(start, end, mode)).searchParams.get('json'),
    );
    assert.equal(payload.costing, mode);
    assert.equal(payload.locations[0].lon, 104.066);
    assert.equal(payload.locations[0].lat, 30.659);
  }
});
test('路段保留累计耗时，供后续沿途天气使用；米和秒不混淆', () => {
  const r = normalizeRoute(fixture(), 'auto');
  assert.equal(r.distance, 1995);
  assert.equal(r.duration, 356);
  assert.equal(r.steps[1].elapsedSeconds, 340);
  assert.equal(r.steps[0].instruction, '左转 · 人民中路');
  assert.equal(r.steps[1].instruction, '到达终点');
});
test('空路线、非有限坐标、负距离不能显示为成功路线', () => {
  assert.throws(() => normalizeRoute({ code: 'NoRoute' }, 'auto'));
  const r = fixture();
  r.routes[0].geometry.coordinates[0] = [NaN, 30];
  assert.throws(() => normalizeRoute(r, 'auto'));
  const negative = fixture();
  negative.routes[0].distance = -1;
  assert.throws(() => normalizeRoute(negative, 'auto'));
});
test('过近、超出测试范围和非法端点在请求前被拒绝', () => {
  assert.throws(() => routeURL(start, start, 'auto'));
  assert.throws(() =>
    routeURL(start, { name: 'bad', coordinates: [190, 31] }, 'auto'),
  );
  assert.throws(() =>
    routeURL(start, { name: 'far', coordinates: [120, 31] }, 'auto'),
  );
});
test('地点搜索只取有效坐标并保留中文名字', () => {
  const r = normalizePlaces({
    features: [
      {
        geometry: { coordinates: [104, 30] },
        properties: { name: '都江堰', city: '成都' },
      },
      { geometry: { coordinates: [181, 30] }, properties: { name: 'bad' } },
    ],
  });
  assert.equal(r.length, 1);
  assert.equal(r[0].name, '都江堰');
  assert.equal(r[0].detail, '成都');
});
test('距离计算和耗时显示采用米与分钟，跨经线亦有效', () => {
  assert.ok(metresBetween([179.99, 0], [-179.99, 0]) < 2300);
  assert.equal(formatDuration(3600), '1 小时 0 分');
});
