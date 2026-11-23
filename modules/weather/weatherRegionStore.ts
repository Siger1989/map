import type { CurrentWeather, WeatherBounds, WeatherRegion } from './liveWeatherRegions.ts';

export type LoadedWeatherRegion = WeatherRegion & { weather: CurrentWeather };
type Entry = { region: WeatherRegion; weather?: CurrentWeather; refreshAt: number; freshUntil: number; validUntil: number };
type Loader = (samples: WeatherRegion[], signal: AbortSignal) => Promise<Map<string, CurrentWeather>>;
const freshMs = 12 * 60_000;
const validMs = 30 * 60_000;
const requestTimeoutMs = 8_000;
const retryDelaysMs = [5_000, 15_000, 30_000, 60_000];

function intersection(a: WeatherBounds, b: WeatherBounds): WeatherBounds | null {
  const bounds: WeatherBounds = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
  return bounds[0] < bounds[2] && bounds[1] < bounds[3] ? bounds : null;
}

function subtract(a: WeatherBounds, b: WeatherBounds): WeatherBounds[] {
  const pieces: WeatherBounds[] = [
    [a[0], a[1], b[0], a[3]], [b[2], a[1], a[2], a[3]],
    [b[0], a[1], b[2], b[1]], [b[0], b[3], b[2], a[3]],
  ];
  return pieces.filter(r => r[0] < r[2] && r[1] < r[3]);
}

/** Shared, bounded requests survive camera changes; only queued obsolete work is discarded. */
export class WeatherRegionStore {
  private entries = new Map<string, Entry>();
  private demands = new Map<symbol, WeatherRegion[]>();
  private pending = new Set<string>();
  private listeners = new Set<() => void>();
  private running = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private cooldownUntil = 0;
  private failureStreak = 0;

  private load: Loader;
  private now: () => number;
  constructor(load: Loader, now: () => number = Date.now) { this.load = load; this.now = now; }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  demand(owner: symbol, regions: WeatherRegion[]) {
    if (regions.length) this.demands.set(owner, regions);
    else this.demands.delete(owner);
    this.pump();
  }

  private emit() { for (const listener of this.listeners) listener(); }

  private pump() {
    clearTimeout(this.timer);
    this.timer = undefined;
    const now = this.now();
    const wanted = [...new Map([...this.demands.values()].flat().map(r => [r.id, r])).values()];
    const missing = wanted.filter(r => !this.pending.has(r.id) && (this.entries.get(r.id)?.refreshAt ?? 0) <= now);
    // After a network failure, let one request prove recovery before opening the queue.
    const concurrency = this.failureStreak ? 1 : 2;
    const needsFirstPaint = !wanted.some(r => (this.entries.get(r.id)?.validUntil ?? 0) > now);
    if (now >= this.cooldownUntil) {
      while (this.running < concurrency && missing.length) {
        const centerFirst = (needsFirstPaint || this.failureStreak > 0) && this.running === 0;
        const batch = missing.splice(0, centerFirst ? 4 : 16);
        batch.forEach(r => this.pending.add(r.id));
        this.running++;
        void this.request(batch);
      }
    }
    const next = wanted.filter(r => !this.pending.has(r.id)).map(r => Math.max(this.cooldownUntil, this.entries.get(r.id)?.refreshAt ?? now));
    if (next.length && this.running < concurrency) {
      this.timer = setTimeout(() => this.pump(), Math.max(100, Math.min(...next) - now));
    }
  }

  private async request(regions: WeatherRegion[]) {
    let loaded = new Map<string, CurrentWeather>();
    let retryMs = 60_000; // Valid responses may omit cells with no data.
    try {
      loaded = await this.load(regions, AbortSignal.timeout(requestTimeoutMs));
      if (this.now() >= this.cooldownUntil) this.failureStreak = 0;
    } catch (error) {
      const now = this.now();
      if (error && typeof error === 'object' && 'status' in error && error.status === 429) {
        const retryAfterMs = 'retryAfterMs' in error && typeof error.retryAfterMs === 'number' ? error.retryAfterMs : 0;
        this.cooldownUntil = Math.max(this.cooldownUntil, now + Math.max(60_000, retryAfterMs));
        this.failureStreak = Math.max(1, this.failureStreak);
      } else if (now >= this.cooldownUntil) {
        this.cooldownUntil = now + retryDelaysMs[this.failureStreak];
        this.failureStreak = Math.min(this.failureStreak + 1, retryDelaysMs.length - 1);
      }
      retryMs = this.cooldownUntil - now;
    }
    const now = this.now();
    for (const region of regions) {
      const weather = loaded.get(region.id);
      const old = this.entries.get(region.id);
      this.entries.delete(region.id);
      this.entries.set(region.id, {
        region, weather: weather ?? old?.weather,
        refreshAt: now + (weather ? freshMs : retryMs),
        freshUntil: weather ? now + freshMs : old?.freshUntil ?? 0,
        validUntil: weather ? now + validMs : old?.validUntil ?? 0,
      });
      this.pending.delete(region.id);
    }
    while (this.entries.size > 256) this.entries.delete(this.entries.keys().next().value!);
    this.running--;
    this.emit();
    this.pump();
  }

  snapshot(regions: WeatherRegion[]) {
    const now = this.now();
    const cells: LoadedWeatherRegion[] = [];
    let refreshing = false, stale = false, failed = false;
    // Prefer finer cached coverage. Clip every fallback to its measured geographic area
    // and subtract it before painting another cell, avoiding doubled rain/clouds.
    const candidates = [...this.entries.values()].filter(e => e.weather && e.validUntil > now)
      .sort((a, b) => (a.region.bounds[2] - a.region.bounds[0]) - (b.region.bounds[2] - b.region.bounds[0]));
    for (const region of regions) {
      const current = this.entries.get(region.id);
      failed ||= Boolean(current && !current.weather);
      if (!current || current.refreshAt <= now || this.pending.has(region.id)) refreshing = true;
      if (current?.weather && current.validUntil > now) {
        cells.push({ ...region, weather: current.weather });
        stale ||= current.freshUntil <= now;
        continue;
      }
      let uncovered: WeatherBounds[] = [region.bounds];
      for (const entry of candidates) {
        const source = entry.region.bounds;
        const shift = 360 * Math.round(((region.bounds[0] + region.bounds[2]) - (source[0] + source[2])) / 720);
        const bounds: WeatherBounds = [source[0] + shift, source[1], source[2] + shift, source[3]];
        uncovered = uncovered.flatMap(piece => {
          const clip = intersection(piece, bounds);
          if (!clip) return [piece];
          cells.push({ ...entry.region, id: entry.region.id + '/' + clip.join(','), bounds: clip, weather: entry.weather! });
          stale ||= entry.freshUntil <= now;
          return subtract(piece, clip);
        });
        if (!uncovered.length) break;
      }
    }
    return { cells, refreshing, stale, status: cells.length ? 'ready' as const : failed ? 'unavailable' as const : refreshing ? 'loading' as const : 'unavailable' as const };
  }
}
