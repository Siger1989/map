import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRouteWeatherQuestion } from '../modules/journey/routeWeatherQuestion.ts';

const reference = Date.parse('2026-11-23T08:00:00+08:00');
const parse = (question, context) => parseRouteWeatherQuestion(question, reference, context);
const beijing = (day, time) => Date.parse(`2026-11-${day}T${time}:00+08:00`);

test('uses the departure city calendar and handles daylight-saving gaps', () => {
  assert.deepEqual(parseRouteWeatherQuestion('明天早上9点', reference, undefined, 'America/Los_Angeles').departures,
    [Date.parse('2026-11-23T09:00:00-08:00')]);
  assert.ok(parseRouteWeatherQuestion('明天凌晨2点半', Date.parse('2026-03-07T12:00:00-08:00'),
    undefined, 'America/Los_Angeles').error);
});

test('offers morning departures for a Beijing date with no departure time', () => {
  assert.deepEqual(parse('明天几点出发，走到哪段会下雨？').departures,
    ['07:00', '09:00', '11:00'].map((time) => beijing(24, time)));
  assert.deepEqual(parse('今天几点出发？').departures,
    ['09:00', '11:00'].map((time) => beijing(23, time)));
  assert.deepEqual(parse('后天下午几点出发？').departures,
    ['13:00', '15:00', '17:00'].map((time) => beijing(25, time)));
});

test('supports comparison, Chinese clock expressions and contextual changes', () => {
  assert.deepEqual(parse('对比明早七点半和九点、11:00出发').departures,
    ['07:30', '09:00', '11:00'].map((time) => beijing(24, time)));
  assert.deepEqual(parse('改9点呢', beijing(24, '07:00')).departures, [beijing(24, '09:00')]);
  assert.deepEqual(parse('明晚七点一刻和八点四十五分').departures,
    ['19:15', '20:45'].map((time) => beijing(24, time)));
  assert.deepEqual(parse('分别看 2026-11-24 9:00 和 11月25日下午两点').departures,
    [beijing(24, '09:00'), beijing(25, '14:00')]);
  assert.deepEqual(parse('雨量多少，走到哪段会下雨？'), { departures: [] });
});

test('asks for a valid future departure instead of guessing unsupported dates', () => {
  assert.ok(parse('下周五9点出发').error);
  assert.ok(parse('三天后9点出发').error);
  assert.ok(parse('明年明天9点出发').error);
  assert.ok(parse('11月31号上午9点出发').error);
  assert.ok(parse('今天7点半出发').error);
  assert.ok(parse('明天24:00出发').error);
  assert.ok(parse('明天8:90出发').error);
});
