import tzLookup from "@photostructure/tz-lookup";
import { Body, Equator, Horizon, Illumination, Observer, Refraction } from "astronomy-engine";

export interface SkyObserver {
  latitude: number;
  longitude: number;
  elevationM?: number;
}

export interface SkyDirection {
  azimuthDeg: number;
  altitudeDeg: number;
}

export interface SkyTimeInterval {
  startMs: number;
  endMs: number;
}

export interface SolarVisibilityEvent {
  kind: "rise" | "set";
  timeMs: number;
  azimuthDeg: number;
}

export interface SolarVisibility {
  status: "normal" | "all-visible" | "all-hidden" | "unknown";
  events: SolarVisibilityEvent[];
  visibleIntervals: SkyTimeInterval[];
}

const DAY_MS = 86_400_000;
const SAMPLE_STEP_MS = 30_000;
const ROOT_RESOLUTION_MS = 250;
const SOLAR_RADIUS_AU = 695700 / 149597870.7;

/** Approximate IANA time zone at the observer, using a bundled offline boundary index. */
export function getObserverTimeZone(latitude: number, longitude: number): string {
  return tzLookup(latitude, longitude);
}

/** Find the half-open time range of the named local calendar date, including DST transitions. */
export function getLocalDayBounds(date: string, timeZone?: string): SkyTimeInterval {
  const dateStart = Date.parse(date + "T00:00:00Z");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date.startsWith("0000") ||
      !Number.isFinite(dateStart) || new Date(dateStart).toISOString().slice(0, 10) !== date) {
    throw new RangeError("Invalid calendar date: " + date);
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone, calendar: "gregory", numberingSystem: "latn",
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  const localDate = (timeMs: number) => {
    const parts = formatter.formatToParts(timeMs);
    const year = parts.find(part => part.type === "year")?.value.padStart(4, "0");
    const month = parts.find(part => part.type === "month")?.value;
    const day = parts.find(part => part.type === "day")?.value;
    return Number(year) * 10_000 + Number(month) * 100 + Number(day);
  };
  const firstInstant = (target: number, approxUtcMs: number) => {
    let low = approxUtcMs - DAY_MS * 1.5;
    let high = approxUtcMs + DAY_MS * 1.5;
    while (high - low > 1) {
      const mid = Math.floor((low + high) / 2);
      if (localDate(mid) < target) low = mid;
      else high = mid;
    }
    return high;
  };

  const nextUtcMs = dateStart + DAY_MS;
  const key = (timeMs: number) => {
    const utc = new Date(timeMs);
    return utc.getUTCFullYear() * 10_000 + (utc.getUTCMonth() + 1) * 100 + utc.getUTCDate();
  };
  const dayKey = key(dateStart);
  const startMs = firstInstant(dayKey, dateStart);
  const endMs = firstInstant(key(nextUtcMs), nextUtcMs);
  if (localDate(startMs) !== dayKey || startMs >= endMs) {
    throw new RangeError("Calendar date is skipped in the selected time zone: " + date);
  }
  return { startMs, endMs };
}

function toObserver(place: SkyObserver): Observer {
  return new Observer(place.latitude, place.longitude, place.elevationM ?? 0);
}

function bodyDirection(body: Body, date: Date, observer: Observer) {
  const { ra, dec, dist } = Equator(body, date, observer, true, true);
  const { azimuth, altitude } = Horizon(date, observer, ra, dec);
  return { azimuthDeg: azimuth, altitudeDeg: altitude, distanceAU: dist };
}

function apparentDirection(direction: ReturnType<typeof bodyDirection>): SkyDirection {
  return {
    azimuthDeg: direction.azimuthDeg,
    altitudeDeg: direction.altitudeDeg + Refraction("normal", direction.altitudeDeg),
  };
}

export function getSkyPosition(timeMs: number, place: SkyObserver) {
  const date = new Date(timeMs);
  const observer = toObserver(place);
  return {
    sun: apparentDirection(bodyDirection(Body.Sun, date, observer)),
    moon: apparentDirection(bodyDirection(Body.Moon, date, observer)),
    moonIlluminatedFraction: Illumination(Body.Moon, date).phase_fraction,
  };
}

interface SolarSample {
  timeMs: number;
  azimuthDeg: number;
  clearanceDeg: number | null;
}

function visible(sample: SolarSample) {
  return sample.clearanceDeg !== null && sample.clearanceDeg >= 0;
}

function extremum(
  left: SolarSample,
  center: SolarSample,
  right: SolarSample,
  sample: (timeMs: number) => SolarSample,
): SolarSample | null {
  if (left.clearanceDeg === null || center.clearanceDeg === null || right.clearanceDeg === null) return null;
  const maximum = center.clearanceDeg > left.clearanceDeg && center.clearanceDeg > right.clearanceDeg;
  const minimum = center.clearanceDeg < left.clearanceDeg && center.clearanceDeg < right.clearanceDeg;
  if (!maximum && !minimum) return null;

  let low = left.timeMs;
  let high = right.timeMs;
  while (high - low > ROOT_RESOLUTION_MS) {
    const first = sample(Math.floor((2 * low + high) / 3));
    const second = sample(Math.floor((low + 2 * high) / 3));
    if (first.clearanceDeg === null || second.clearanceDeg === null) return null;
    if ((first.clearanceDeg < second.clearanceDeg) === maximum) low = first.timeMs;
    else high = second.timeMs;
  }
  const result = sample(Math.floor((low + high) / 2));
  return visible(result) !== visible(center) ? result : null;
}

function crossing(
  left: SolarSample,
  right: SolarSample,
  sample: (timeMs: number) => SolarSample,
): SolarSample | null {
  let low = left;
  let high = right;
  while (high.timeMs - low.timeMs > ROOT_RESOLUTION_MS) {
    const mid = sample(Math.floor((low.timeMs + high.timeMs) / 2));
    if (mid.clearanceDeg === null) return null;
    if (visible(mid) === visible(left)) low = mid;
    else high = mid;
  }
  return high;
}

/**
 * Estimate visibility of the Sun's upper limb against a DEM horizon.
 * Horizon angles are relative to the local horizontal. A null angle means unknown coverage.
 * Known intervals are clipped to the selected day. No events are invented at data gaps.
 */
export function getSolarVisibility(
  day: SkyTimeInterval,
  place: SkyObserver,
  horizonAt: (azimuthDeg: number) => number | null,
): SolarVisibility {
  const { startMs, endMs } = day;
  if (!(Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs && endMs - startMs <= DAY_MS * 2)) {
    throw new RangeError("Invalid daily interval");
  }

  const observer = toObserver(place);
  const sample = (timeMs: number): SolarSample => {
    const { azimuthDeg, altitudeDeg, distanceAU } = bodyDirection(Body.Sun, new Date(timeMs), observer);
    const horizonDeg = horizonAt(azimuthDeg);
    const radiusDeg = Math.asin(SOLAR_RADIUS_AU / distanceAU) * 180 / Math.PI;
    const upperLimb = altitudeDeg + radiusDeg;
    const clearanceDeg = horizonDeg !== null && Number.isFinite(horizonDeg)
      ? upperLimb + Refraction("normal", upperLimb) - horizonDeg
      : null;
    return { timeMs, azimuthDeg, clearanceDeg };
  };

  // The preceding sample identifies a crossing exactly at the first instant of the day.
  const samples = [sample(startMs - 1)];
  for (let timeMs = startMs; timeMs < endMs - 1; timeMs += SAMPLE_STEP_MS) {
    samples.push(sample(timeMs));
  }
  samples.push(sample(endMs - 1));

  const refined: SolarSample[] = [];
  for (let i = 1; i < samples.length - 1; i++) {
    const point = extremum(samples[i - 1], samples[i], samples[i + 1], sample);
    if (point) refined.push(point);
  }
  samples.push(...refined);
  samples.sort((a, b) => a.timeMs - b.timeMs);

  const events: SolarVisibilityEvent[] = [];
  const visibleIntervals: SkyTimeInterval[] = [];
  let unknown = false;
  let intervalStart: number | null = visible(samples[0]) ? startMs : null;
  const closeInterval = (timeMs: number) => {
    if (intervalStart !== null && timeMs > intervalStart) {
      visibleIntervals.push({ startMs: intervalStart, endMs: timeMs });
    }
    intervalStart = null;
  };

  for (let i = 1; i < samples.length; i++) {
    const left = samples[i - 1];
    const right = samples[i];
    if (right.timeMs < startMs) continue;
    if (left.clearanceDeg === null || right.clearanceDeg === null) {
      unknown ||= right.clearanceDeg === null || left.timeMs >= startMs;
      closeInterval(Math.max(startMs, left.timeMs));
      if (visible(right)) intervalStart = right.timeMs;
      continue;
    }

    if (visible(left) === visible(right)) continue;
    const event = crossing(left, right, sample);
    if (!event) {
      unknown = true;
      closeInterval(Math.max(startMs, left.timeMs));
      if (visible(right)) intervalStart = right.timeMs;
      continue;
    }
    if (event.timeMs >= startMs) {
      events.push({ kind: visible(right) ? "rise" : "set", timeMs: event.timeMs, azimuthDeg: event.azimuthDeg });
    }
    if (visible(right)) intervalStart = Math.max(startMs, event.timeMs);
    else closeInterval(event.timeMs);
  }

  closeInterval(endMs);
  let status: SolarVisibility["status"] = "normal";
  if (unknown) status = "unknown";
  else if (events.length === 0) status = visibleIntervals.length ? "all-visible" : "all-hidden";
  return { status, events, visibleIntervals };
}

/** Reference for an unobstructed observer at a level horizontal skyline. */
export function getAstronomicalSolarVisibility(day: SkyTimeInterval, place: SkyObserver): SolarVisibility {
  return getSolarVisibility(day, place, () => 0);
}
