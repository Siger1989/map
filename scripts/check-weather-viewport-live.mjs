import { mkdir, writeFile } from 'node:fs/promises';
import { weatherViewportGrid } from '../modules/weather/data.ts';

const bounds = [102.8, 29.5, 105.2, 31.1];
const grid = weatherViewportGrid(bounds);
if (!grid || grid.points.length > 81) throw new Error('viewport grid is unavailable or exceeds 81 points');
const wrap = longitude => ((longitude + 180) % 360 + 360) % 360 - 180;
const query = new URLSearchParams({
  latitude: grid.points.map(point => point.lat).join(','),
  longitude: grid.points.map(point => wrap(point.lng)).join(','),
  hourly: 'rain,showers',
  forecast_hours: '25',
  timeformat: 'unixtime',
  timezone: 'GMT',
});
const response = await fetch(`https://api.open-meteo.com/v1/forecast?${query}`);
const raw = await response.json();
const records = Array.isArray(raw) ? raw : [raw];
const expectedHours = 25;
let validCellHours = 0;
let hoursPerRecord = 0;
for (const record of records) {
  const hourly = record?.hourly;
  if (!hourly || !Array.isArray(hourly.time)) continue;
  hoursPerRecord = Math.max(hoursPerRecord, hourly.time.length);
  for (let i = 0; i < hourly.time.length; i++)
    if (Number.isFinite(hourly.rain?.[i]) && Number.isFinite(hourly.showers?.[i])) validCellHours++;
}
const summary = {
  checkedAtUTC: new Date().toISOString(),
  httpStatus: response.status,
  pointCount: grid.points.length,
  grid: { rows: grid.rows, columns: grid.columns, step: grid.step },
  hoursPerPoint: hoursPerRecord,
  validCellHours,
  expectedCellHours: grid.points.length * expectedHours,
  raw,
};
await mkdir('.openai', { recursive: true });
await writeFile('.openai/rain-weather-viewport-live-20261005.json', JSON.stringify(summary));
console.log(`HTTP ${response.status}; points=${grid.points.length}; hours=${hoursPerRecord}; valid=${validCellHours}/${grid.points.length * expectedHours}`);
if (!response.ok || records.length !== grid.points.length || hoursPerRecord !== expectedHours || validCellHours !== grid.points.length * expectedHours)
  process.exitCode = 1;
