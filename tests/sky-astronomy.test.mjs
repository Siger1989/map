import assert from "node:assert/strict";
import { test } from "node:test";
import { Body, Equator, Horizon, Observer, Refraction, SearchRiseSet } from "astronomy-engine";
import {
  getAstronomicalSolarVisibility,
  getLocalDayBounds,
  getObserverTimeZone,
  getSkyPosition,
  getSolarVisibility,
} from "../modules/sky/astronomy.ts";

const HOUR_MS = 3_600_000;
const chengdu = { latitude: 30.6, longitude: 104 };
const chengduDay = getLocalDayBounds("2026-11-20", "Asia/Shanghai");

test("observer time zones and civil boundaries work independently of the device time zone", () => {
  assert.equal(getObserverTimeZone(chengdu.latitude, chengdu.longitude), "Asia/Shanghai");
  assert.equal(getObserverTimeZone(40.7, -74), "America/New_York");
  assert.equal(getObserverTimeZone(27.7172, 85.324), "Asia/Kathmandu");
  assert.equal(chengduDay.startMs, Date.parse("2026-11-19T16:00:00Z"));
  assert.equal(chengduDay.endMs, Date.parse("2026-11-20T16:00:00Z"));

  const spring = getLocalDayBounds("2026-03-08", "America/New_York");
  const autumn = getLocalDayBounds("2026-11-01", "America/New_York");
  assert.equal(spring.endMs - spring.startMs, 23 * HOUR_MS);
  assert.equal(autumn.endMs - autumn.startMs, 25 * HOUR_MS);
  assert.throws(() => getLocalDayBounds("2026-02-30", "Asia/Shanghai"), RangeError);
  assert.throws(() => getLocalDayBounds("2011-12-30", "Pacific/Apia"), RangeError);
});

test("topocentric directions and lunar illumination are valid and advance with time", () => {
  const sunrise = getSkyPosition(Date.parse("2026-11-19T23:34:00Z"), chengdu);
  const solarNoon = getSkyPosition(Date.parse("2026-11-20T04:49:00Z"), chengdu);
  assert.ok(sunrise.sun.azimuthDeg > 110 && sunrise.sun.azimuthDeg < 115);
  assert.ok(Math.abs(sunrise.sun.altitudeDeg) < 0.5);
  assert.ok(solarNoon.sun.azimuthDeg > 175 && solarNoon.sun.azimuthDeg < 185);
  assert.ok(solarNoon.sun.altitudeDeg > 35);
  assert.ok(solarNoon.moon.azimuthDeg >= 0 && solarNoon.moon.azimuthDeg < 360);
  assert.ok(solarNoon.moon.altitudeDeg > -90 && solarNoon.moon.altitudeDeg < 90);
  assert.notEqual(sunrise.moon.altitudeDeg, solarNoon.moon.altitudeDeg);
  assert.ok(solarNoon.moonIlluminatedFraction > 0 && solarNoon.moonIlluminatedFraction < 1);
});

test("flat-horizon reference agrees with the Astronomy Engine rise/set convention to within one minute", () => {
  const flat = getAstronomicalSolarVisibility(chengduDay, chengdu);
  assert.equal(flat.status, "normal");
  assert.deepEqual(flat.events.map(event => event.kind), ["rise", "set"]);
  const observer = new Observer(chengdu.latitude, chengdu.longitude, 0);
  for (const [index, direction] of [1, -1].entries()) {
    const expected = SearchRiseSet(Body.Sun, observer, direction, new Date(chengduDay.startMs), 1);
    assert.ok(expected && Math.abs(flat.events[index].timeMs - expected.date.getTime()) < 60_000);
  }

  const valley = getSolarVisibility(chengduDay, chengdu, () => 12);
  assert.ok(valley.events[0].timeMs > flat.events[0].timeMs);
  assert.ok(valley.events[1].timeMs < flat.events[1].timeMs);
});

test("a high intervening ridge produces multiple chronological solar events", () => {
  const ridge = azimuthDeg => Math.max(0, 55 * (1 - Math.abs(azimuthDeg - 172) / 16));
  const result = getSolarVisibility(chengduDay, chengdu, ridge);
  assert.deepEqual(result.events.map(event => event.kind), ["rise", "set", "rise", "set"]);
  assert.deepEqual(result.visibleIntervals, [
    { startMs: result.events[0].timeMs, endMs: result.events[1].timeMs },
    { startMs: result.events[2].timeMs, endMs: result.events[3].timeMs },
  ]);
  assert.ok(result.events.every((event, i) => i === 0 || event.timeMs > result.events[i - 1].timeMs));
});

test("DEM gaps remain unknown and never produce fictitious events", () => {
  const unknown = getSolarVisibility(chengduDay, chengdu, () => null);
  assert.deepEqual(unknown, { status: "unknown", events: [], visibleIntervals: [] });

  const partial = getSolarVisibility(chengduDay, chengdu, angle => angle > 155 && angle < 195 ? null : 0);
  assert.equal(partial.status, "unknown");
  assert.deepEqual(partial.events.map(event => event.kind), ["rise", "set"]);
  assert.equal(partial.visibleIntervals.length, 2);
  assert.ok(partial.visibleIntervals[0].endMs < partial.visibleIntervals[1].startMs);
});

test("polar day and night are distinct from missing terrain", () => {
  const arctic = { latitude: 80, longitude: 15 };
  const summer = getLocalDayBounds("2026-06-21", "Arctic/Longyearbyen");
  const winter = getLocalDayBounds("2026-12-21", "Arctic/Longyearbyen");
  assert.deepEqual(getAstronomicalSolarVisibility(summer, arctic), {
    status: "all-visible",
    events: [],
    visibleIntervals: [summer],
  });
  assert.deepEqual(getAstronomicalSolarVisibility(winter, arctic), {
    status: "all-hidden",
    events: [],
    visibleIntervals: [],
  });
});

test("crossing at a civil window boundary belongs to the following half-open window", () => {
  const boundaryMs = Date.parse("2026-11-20T00:00:00Z");
  const date = new Date(boundaryMs);
  const observer = new Observer(chengdu.latitude, chengdu.longitude, 0);
  const { ra, dec, dist } = Equator(Body.Sun, date, observer, true, true);
  const { altitude } = Horizon(date, observer, ra, dec);
  const upperLimb = altitude + (Math.asin((695700 / 149597870.7) / dist) * 180 / Math.PI);
  // Place the crossing after the preceding millisecond, clear of floating-point noise.
  const horizonAt = () => upperLimb + Refraction("normal", upperLimb) - 0.0000001;
  const left = getSolarVisibility({ startMs: boundaryMs - HOUR_MS, endMs: boundaryMs }, chengdu, horizonAt);
  const right = getSolarVisibility({ startMs: boundaryMs, endMs: boundaryMs + HOUR_MS }, chengdu, horizonAt);
  assert.equal(left.status, "all-hidden");
  assert.deepEqual(right.events.map(event => [event.kind, event.timeMs]), [["rise", boundaryMs]]);
  assert.deepEqual(right.visibleIntervals, [{ startMs: boundaryMs, endMs: boundaryMs + HOUR_MS }]);
});
