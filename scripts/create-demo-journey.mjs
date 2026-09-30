import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { metresBetween } from '../modules/navigation/types.ts';
import { newAnnotation } from '../modules/annotations/data.ts';
import { validateTransfer } from '../modules/outdoor/exchange.ts';

/** Creates an importable synthetic archive; never reads or writes application storage. */
export function createDemoJourney(center = [85.552121, 28.343601]) {
  const id = 'shantu-demo-running-20260930';
  const startedAt = Date.parse('2026-09-30T08:00:00+08:00');
  const line = [], samples = [], distances = [];
  let step = 0, distance = 0;
  for (let i = 0; i <= 180; i++) {
    if (i > 0 && !(i >= 81 && i <= 92)) step++;
    const angle = step / 168 * Math.PI * 2 * 0.94;
    const point = [
      Number((center[0] + 800 * Math.cos(angle) / (111320 * Math.cos(center[1] * Math.PI / 180))).toFixed(7)),
      Number((center[1] + 600 * Math.sin(angle) / 111320).toFixed(7)),
    ];
    if (i) distance += metresBetween(line[i - 1], point);
    line.push(point); distances.push(distance);
    samples.push({ time: startedAt + i * 10000, altitude: Number((4100 + 45 * Math.sin(angle) + 12 * Math.sin(angle * 3)).toFixed(1)) });
  }
  const markers = [
    [0, '起跑（模拟）', '08:00 起跑。测试起点与行程数据入口。'],
    [80, '补水（模拟）', '08:13:20 补水，模拟停留 2 分钟。可测试标记备注。'],
    [130, '观景（模拟）', '08:21:40 观景点。可测试地图定位与沿途标记。'],
    [180, '结束（模拟）', '08:30 完成。坐标、时间和海拔均由脚本生成，非真实GPS或导航路线。'],
  ];
  const annotations = markers.map(([index, name, note], n) => ({
    ...newAnnotation('pin', line[index], null, `${id}-pin-${n}`),
    name, note, color: '#a5efc8', trackAnchor: { trackId: id, distance: distances[index] },
  }));
  const track = {
    id, name: '示例 · 30分钟跑步行程（模拟）', createdAt: startedAt, source: 'recorded', simulation: true,
    segments: [line], samples: [samples], hidden: false,
    style: { color: '#a5efc8', width: 3, travelMode: 'run', colorMode: 'speed' },
    routeTerminals: { start: line[0], end: line.at(-1) },
    pointDetails: Object.fromEntries(markers.map(([index, , note]) => [line[index].join(','), { note }])),
  };
  return validateTransfer({
    format: 'guanyun-backup', version: 1, tracks: [track], annotations, favorites: [],
    collections: {
      version: 1, groups: [{ id: `${id}-folder`, name: '示例行程（模拟）', color: '#89dfb3' }],
      assignments: Object.fromEntries([`track:${id}`, ...annotations.map(a => `annotation:${a.id}`)].map(key => [key, `${id}-folder`])),
      order: [`track:${id}`, ...annotations.map(a => `annotation:${a.id}`)],
    },
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const destination = resolve(process.argv[2] ?? 'artifacts/demo/shantu-demo-running-journey-20260930.json');
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, JSON.stringify(createDemoJourney(), null, 2), 'utf8');
  console.log(destination);
}
