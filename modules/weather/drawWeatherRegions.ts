export interface WeatherPixel {
  x: number;
  y: number;
}

export interface ProjectedWeatherRegion {
  id: string;
  corners: readonly [WeatherPixel, WeatherPixel, WeatherPixel, WeatherPixel];
  /** World-copy geographic bounds. Clouds share one field across adjacent cells. */
  bounds?: readonly [west: number, south: number, east: number, north: number];
  weather: {
    rainMm: number | null;
    snowCm: number | null;
    cloudCover: number | null;
    isDay?: boolean;
    interval: number;
  };
}

function regionRandom(id: string) {
  let seed = 2166136261;
  for (let i = 0; i < id.length; i++) seed = Math.imul(seed ^ id.charCodeAt(i), 16777619);
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function wrap(value: number, length: number) {
  return ((value % length) + length) % length;
}

function precipitationRate(amount: number | null, interval: number) {
  return amount !== null && amount > 0 && Number.isFinite(amount) && interval > 0
    ? amount * 3600 / interval
    : 0;
}

function cloudHash(x: number, y: number, salt: number) {
  let value = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ salt;
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

function cloudNoise(x: number, y: number) {
  const column = Math.floor(x), row = Math.floor(y);
  const dx = x - column, dy = y - row;
  const u = dx * dx * (3 - 2 * dx), v = dy * dy * (3 - 2 * dy);
  const top = cloudHash(column, row, 761) * (1 - u) + cloudHash(column + 1, row, 761) * u;
  const bottom = cloudHash(column, row + 1, 761) * (1 - u) + cloudHash(column + 1, row + 1, 761) * u;
  return top * (1 - v) + bottom * v;
}

function projectCloud(corners: ProjectedWeatherRegion['corners'], u: number, v: number): WeatherPixel {
  const [nw, ne, se, sw] = corners;
  return {
    x: (nw.x * (1 - u) + ne.x * u) * (1 - v) + (sw.x * (1 - u) + se.x * u) * v,
    y: (nw.y * (1 - u) + ne.y * u) * (1 - v) + (sw.y * (1 - u) + se.y * u) * v,
  };
}

/** Restrict a large projected cell to the part around the actual viewport. */
function visibleCloudRange(corners: ProjectedWeatherRegion['corners'], width: number, height: number) {
  const [nw, ne, se, sw] = corners;
  const values: WeatherPixel[] = [];
  for (const x of [0, width / 2, width]) for (const y of [0, height / 2, height]) {
    let u = 0.5, v = 0.5;
    for (let iteration = 0; iteration < 8; iteration++) {
      const point = projectCloud(corners, u, v);
      const ax = (ne.x - nw.x) * (1 - v) + (se.x - sw.x) * v;
      const ay = (ne.y - nw.y) * (1 - v) + (se.y - sw.y) * v;
      const bx = (sw.x - nw.x) * (1 - u) + (se.x - ne.x) * u;
      const by = (sw.y - nw.y) * (1 - u) + (se.y - ne.y) * u;
      const determinant = ax * by - ay * bx;
      if (Math.abs(determinant) < 0.001) break;
      u -= ((point.x - x) * by - (point.y - y) * bx) / determinant;
      v -= (ax * (point.y - y) - ay * (point.x - x)) / determinant;
    }
    if (Number.isFinite(u) && Number.isFinite(v)) values.push({ x: u, y: v });
  }
  return values.length ? [
    Math.max(0, Math.min(...values.map(point => point.x))),
    Math.max(0, Math.min(...values.map(point => point.y))),
    Math.min(1, Math.max(...values.map(point => point.x))),
    Math.min(1, Math.max(...values.map(point => point.y))),
  ] : [0, 0, 1, 1];
}

export interface WeatherCloudPuff extends WeatherPixel {
  radius: number;
  opacity: number;
  aspect: number;
  seed: number;
}

/** Illustrative cloud texture, anchored geographically rather than to weather-cell IDs. */
export function planWeatherClouds(
  corners: ProjectedWeatherRegion['corners'],
  bounds: ProjectedWeatherRegion['bounds'],
  width: number,
  height: number,
  cover: number,
  elapsed: number,
  cloudCoverAt?: (longitude: number, latitude: number) => number,
): WeatherCloudPuff[] {
  if (!(cover >= 40)) return [];
  // Legacy callers still get a continuous screen-space field instead of per-cell rows.
  const world = bounds ?? [0, 0, width / 1000, height / 1000];
  const [west, south, east, north] = world;
  if (!(east > west && north > south)) return [];
  const [nw, ne, se, sw] = corners;
  const horizontalScale = (Math.hypot(ne.x - nw.x, ne.y - nw.y) + Math.hypot(se.x - sw.x, se.y - sw.y)) / (2 * (east - west));
  const verticalScale = (Math.hypot(sw.x - nw.x, sw.y - nw.y) + Math.hypot(se.x - ne.x, se.y - ne.y)) / (2 * (north - south));
  const scale = Math.max(horizontalScale, verticalScale);
  if (!(scale > 0 && Number.isFinite(scale))) return [];
  const lod = Math.log2(64 / (scale * 360));
  const exponent = Math.floor(lod);
  const blend = lod - exponent;
  const [left, top, right, bottom] = visibleCloudRange(corners, width, height);
  const result: WeatherCloudPuff[] = [];
  // Blend two shared geographic scales to avoid an abrupt texture replacement on zoom.
  for (const [power, weight] of [[exponent, 1 - blend], [exponent + 1, blend]]) {
    if (weight < 0.001) continue;
    const step = 360 * 2 ** power;
    const drift = elapsed * step * 0.012;
    const firstColumn = Math.floor((west + left * (east - west) - drift) / step) - 3;
    const lastColumn = Math.ceil((west + right * (east - west) - drift) / step) + 3;
    const firstRow = Math.floor((north - bottom * (north - south)) / step) - 3;
    const lastRow = Math.ceil((north - top * (north - south)) / step) + 3;
    // Ill-conditioned horizon projections must not turn an animation into an unbounded scan.
    if ((lastColumn - firstColumn + 1) * (lastRow - firstRow + 1) > 6000) continue;
    const worldColumns = Math.max(1, Math.round(360 / step));
    for (let row = firstRow; row <= lastRow; row++) for (let column = firstColumn; column <= lastColumn; column++) {
      const canonical = ((column % worldColumns) + worldColumns) % worldColumns;
      const cluster = cloudNoise(canonical / 3, row / 3);
      const density = Math.max(0, (cluster - 0.24) * 1.5) * 1.19;
      if (cloudHash(canonical, row, 1921) > density) continue;
      const longitude = (column + cloudHash(canonical, row, 73)) * step + drift;
      const latitude = (row + cloudHash(canonical, row, 139)) * step;
      const localCover = cloudCoverAt ? cloudCoverAt(longitude, latitude) : cover;
      const coverage = Math.max(0, Math.min(1, (localCover - 25) / 75));
      if (!coverage) continue;
      const point = projectCloud(corners, (longitude - west) / (east - west), (north - latitude) / (north - south));
      const radius = step * scale * (0.48 + cloudHash(canonical, row, 317) * 1.12);
      if (point.x + radius < 0 || point.x - radius > width || point.y + radius < 0 || point.y - radius > height) continue;
      result.push({ ...point, radius,
        opacity: weight * 0.19 * coverage * (0.5 + cluster * 0.65),
        aspect: 0.45 + cloudHash(canonical, row, 591) * 0.35,
        seed: Math.floor(cloudHash(canonical, row, 917) * 0x7fffffff),
      });
    }
  }
  return result;
}

/** Interpolate only available model samples; missing cells remain outside the caller's clip. */
function cloudCoverSampler(regions: readonly ProjectedWeatherRegion[]) {
  const samples = regions.flatMap(({ bounds, weather }) => bounds && weather.cloudCover !== null ? [{
    longitude: (bounds[0] + bounds[2]) / 2,
    latitude: (bounds[1] + bounds[3]) / 2,
    width: bounds[2] - bounds[0], height: bounds[3] - bounds[1],
    cover: weather.cloudCover,
  }] : []);
  return samples.length ? (longitude: number, latitude: number) => {
    let sum = 0, weights = 0;
    for (const sample of samples) {
      const deltaLongitude = longitude - sample.longitude;
      const dx = (deltaLongitude - 360 * Math.round(deltaLongitude / 360)) / sample.width;
      const dy = (latitude - sample.latitude) / sample.height;
      const distance = Math.hypot(dx, dy);
      if (distance < 0.00001) return sample.cover;
      if (distance >= 1.5) continue;
      const weight = (1 - distance / 1.5) ** 2 / (distance * distance);
      sum += sample.cover * weight;
      weights += weight;
    }
    return weights ? sum / weights : 0;
  } : undefined;
}

function drawClouds(
  ctx: Pick<CanvasRenderingContext2D, 'save' | 'restore' | 'translate' | 'scale' | 'createRadialGradient' | 'fillStyle' | 'fillRect'>,
  puffs: readonly WeatherCloudPuff[],
  isDay: boolean | undefined,
) {
  const tone = isDay === false ? '177,192,215' : '241,247,255';
  for (const { x, y, radius: size, opacity, aspect, seed } of puffs) {
    const random = regionRandom(String(seed));
    const alpha = opacity * (isDay === false ? 0.8 : 1);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, aspect);
    // Irregular overlapping lobes form banks and gaps, with no cell-centred row of icons.
    for (let lobe = 0; lobe < 5; lobe++) {
      const offsetX = (random() - 0.5) * size;
      const offsetY = (random() - 0.5) * size * 0.55;
      const radius = size * (0.35 + random() * 0.45);
      const gradient = ctx.createRadialGradient(offsetX, offsetY, 0, offsetX, offsetY, radius);
      gradient.addColorStop(0, `rgba(${tone},${alpha})`);
      gradient.addColorStop(0.45, `rgba(${tone},${alpha * 0.64})`);
      gradient.addColorStop(1, `rgba(${tone},0)`);
      ctx.fillStyle = gradient;
      ctx.fillRect(offsetX - radius, offsetY - radius, 2 * radius, 2 * radius);
    }
    ctx.restore();
  }
}

const cloudPlans = new WeakMap<readonly ProjectedWeatherRegion[], {
  time: number; width: number; height: number;
  cells: Map<ProjectedWeatherRegion, WeatherCloudPuff[]>;
  layer?: OffscreenCanvas;
}>();

export function drawWeatherRegions(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  regions: readonly ProjectedWeatherRegion[],
  elapsedSeconds: number,
) {
  ctx.clearRect(0, 0, width, height);
  const cloudy = regions.some(region => (region.weather.cloudCover ?? 0) >= 40);
  // Cloud drift is below a pixel per second. Reuse spatial noise between four updates
  // per second while rain and snow retain the caller's full animation rate.
  const cloudTime = Math.floor(elapsedSeconds * 4) / 4;
  let clouds = cloudy ? cloudPlans.get(regions) : undefined;
  if (cloudy && (!clouds || clouds.time !== cloudTime || clouds.width !== width || clouds.height !== height)) {
    const cloudCoverAt = cloudCoverSampler(regions);
    const layer = clouds?.layer;
    clouds = { time: cloudTime, width, height, cells: new Map(), layer };
    for (const region of regions) if (region.weather.cloudCover !== null) {
      clouds.cells.set(region, planWeatherClouds(region.corners, region.bounds, width, height,
        Math.max(40, Math.min(100, region.weather.cloudCover)), cloudTime, cloudCoverAt));
    }
    if (typeof OffscreenCanvas !== 'undefined' && typeof ctx.drawImage === 'function') {
      clouds.layer ??= new OffscreenCanvas(width, height);
      if (clouds.layer.width !== width) clouds.layer.width = width;
      if (clouds.layer.height !== height) clouds.layer.height = height;
      const cloudCtx = clouds.layer.getContext('2d');
      if (cloudCtx) {
        cloudCtx.clearRect(0, 0, width, height);
        for (const region of regions) {
          const puffs = clouds.cells.get(region);
          if (!puffs?.length || region.corners.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) continue;
          cloudCtx.save();
          cloudCtx.beginPath();
          cloudCtx.moveTo(region.corners[0].x, region.corners[0].y);
          for (let corner = 1; corner < 4; corner++) cloudCtx.lineTo(region.corners[corner].x, region.corners[corner].y);
          cloudCtx.closePath();
          cloudCtx.clip();
          drawClouds(cloudCtx, puffs, region.weather.isDay);
          cloudCtx.restore();
        }
      } else clouds.layer = undefined;
    }
    cloudPlans.set(regions, clouds);
  }
  if (clouds?.layer) ctx.drawImage(clouds.layer, 0, 0, width, height);

  for (const region of regions) {
    const { id, corners, weather } = region;
    const rain = precipitationRate(weather.rainMm, weather.interval);
    const snow = precipitationRate(weather.snowCm, weather.interval);
    const drawCloudField = cloudy && !clouds?.layer && weather.cloudCover !== null;
    if (!(rain > 0 || snow > 0 || drawCloudField)) continue;
    if (corners.some(({ x, y }) => !Number.isFinite(x) || !Number.isFinite(y))) continue;

    const left = Math.max(0, Math.min(...corners.map(point => point.x)));
    const top = Math.max(0, Math.min(...corners.map(point => point.y)));
    const right = Math.min(width, Math.max(...corners.map(point => point.x)));
    const bottom = Math.min(height, Math.max(...corners.map(point => point.y)));
    const visibleWidth = right - left;
    const visibleHeight = bottom - top;
    if (visibleWidth <= 0 || visibleHeight <= 0) continue;

    const area = Math.abs(corners.reduce((sum, point, i) => {
      const next = corners[(i + 1) % corners.length];
      return sum + point.x * next.y - next.x * point.y;
    }, 0)) / 2;
    if (area < 16) continue;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y);
    ctx.closePath();
    ctx.clip();

    const visibleArea = visibleWidth * visibleHeight;
    if (drawCloudField) {
      drawClouds(ctx, clouds?.cells.get(region) ?? [], weather.isDay);
    }

    // Sample the visible bounding rectangle. The clip removes particles outside the cell.
    if (rain > 0) {
      const random = regionRandom(id + '/rain');
      const strength = Math.min(1, Math.sqrt(rain / 9));
      const count = Math.min(85, Math.max(1, Math.round(visibleArea * (0.00022 + strength * 0.00115))));
      ctx.beginPath();
      for (let i = 0; i < count; i++) {
        const x = left + wrap(random() * visibleWidth - elapsedSeconds * 17, visibleWidth);
        const speed = 115 + random() * 100 + strength * 55;
        const y = top + wrap(random() * visibleHeight + elapsedSeconds * speed, visibleHeight);
        const length = 5 + random() * 8 + strength * 5;
        ctx.moveTo(x, y);
        ctx.lineTo(x - 0.19 * length, y + length);
      }
      ctx.strokeStyle = `rgba(169,220,255,${0.37 + strength * 0.23})`;
      ctx.lineWidth = 1 + strength * 0.5;
      ctx.stroke();
    }

    if (snow > 0) {
      const random = regionRandom(id + '/snow');
      const strength = Math.min(1, Math.sqrt(snow / 3));
      const count = Math.min(84, Math.max(1, Math.round(visibleArea * (0.00024 + strength * 0.0012))));
      ctx.beginPath();
      for (let i = 0; i < count; i++) {
        const phase = random() * Math.PI * 2;
        const sway = 3 + random() * 7;
        const x = left + wrap(random() * visibleWidth + Math.sin(elapsedSeconds + phase) * sway + elapsedSeconds * 6, visibleWidth);
        const speed = 15 + random() * 24;
        const y = top + wrap(random() * visibleHeight + elapsedSeconds * speed, visibleHeight);
        const radius = 0.65 + random() * 1.05 + strength * 0.35;
        ctx.moveTo(x + radius, y);
        ctx.arc(x, y, radius, 0, Math.PI * 2);
      }
      ctx.fillStyle = `rgba(247,253,255,${0.55 + strength * 0.29})`;
      ctx.fill();
    }
    ctx.restore();
  }
}
