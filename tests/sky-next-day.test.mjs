import assert from 'node:assert/strict';
import test from 'node:test';
import { getLocalDayBounds } from '../modules/sky/astronomy.ts';
import { skyCalendarDate, skyTimeOnDay } from '../modules/sky/skyCalendar.ts';

function nextTime(instant, zone) {
  const time = Date.parse(instant);
  const selected = getLocalDayBounds(skyCalendarDate(time, zone), zone);
  const next = getLocalDayBounds(skyCalendarDate(selected.endMs, zone), zone);
  return new Date(skyTimeOnDay(time, next, zone)).toISOString();
}

test('the next local day crosses New Year and preserves hours, minutes and milliseconds', () => {
  assert.equal(nextTime('2026-12-31T14:30:15.250Z', 'Asia/Shanghai'), '2027-01-01T14:30:15.250Z');
});

test('the next date keeps local wall time on short and long days, rolling a skipped hour forward', () => {
  assert.equal(nextTime('2026-03-07T13:15:00Z', 'America/New_York'), '2026-03-08T12:15:00.000Z');
  assert.equal(nextTime('2026-10-31T12:15:00Z', 'America/New_York'), '2026-11-01T13:15:00.000Z');
  assert.equal(nextTime('2026-03-07T07:30:00Z', 'America/New_York'), '2026-03-08T07:30:00.000Z');
});
