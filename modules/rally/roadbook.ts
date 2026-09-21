import type { PlannedRoute, TravelMode } from '../navigation/types';
import { metresBetween } from '../navigation/types.ts';
import type { PositionFix } from '../position/types';
import { freshFix } from '../guidance/session.ts';

/** Preserve provider instructions: these are navigation cues, not recce pace notes. */
export function roadbookNotes(route: PlannedRoute, progress: number, pathLength: number) {
  const travelled = pathLength > 0 ? Math.max(0, progress / pathLength) * route.distance : 0;
  let offset = 0;
  const notes = route.steps.map((step, index) => {
    const note = { index, at: offset, text: step.instruction, kind: step.kind };
    offset += step.distance;
    return note;
  }).filter(n => n.index > 0 && n.at > travelled + 5);
  return notes.slice(0, 3).map((note, i) => ({ ...note,
    distance: Math.max(0, note.at - (i ? notes[i - 1].at : travelled)),
  }));
}

export function turnKind(text: string) {
  if (/回头|掉头|u.?turn/i.test(text)) return /右|right/i.test(text) ? 'uturn-right' : 'uturn-left';
  if (/左|left/i.test(text)) return 'left';
  if (/右|right/i.test(text)) return 'right';
  if (/到达终点|抵达终点|arrive at.*destination/i.test(text)) return 'finish';
  if (/直行|继续|沿|出发|straight|continue|head|depart/i.test(text)) return 'straight';
  return 'unknown';
}

/** Estimate only from two fresh, plausible fixes. Missing location never means zero speed. */
export function fixSpeed(a: PositionFix | null, b: PositionFix | null, mode: TravelMode, now: number) {
  if (!a || !b || !freshFix(a, now) || !freshFix(b, now)) return null;
  const seconds = (b.timestamp - a.timestamp) / 1000;
  if (seconds < 1 || seconds > 20) return null;
  const speed = metresBetween(a.coordinates, b.coordinates) / seconds;
  return speed <= { auto: 80, bicycle: 30, pedestrian: 12 }[mode] ? speed * 3.6 : null;
}

export function clockDuration(seconds: number) {
  const n = Math.max(0, Math.floor(seconds));
  return `${Math.floor(n / 3600).toString().padStart(2, '0')}:${Math.floor(n / 60 % 60).toString().padStart(2, '0')}:${(n % 60).toString().padStart(2, '0')}`;
}
