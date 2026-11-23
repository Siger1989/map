export interface WeatherPixel {
  x: number;
  y: number;
}

export interface ProjectedWeatherRegion {
  id: string;
  corners: readonly [WeatherPixel, WeatherPixel, WeatherPixel, WeatherPixel];
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

function drawClouds(
  ctx: CanvasRenderingContext2D,
  corners: ProjectedWeatherRegion['corners'],
  area: number,
  cover: number,
  isDay: boolean | undefined,
  random: () => number,
  elapsed: number,
) {
  const [nw, ne, se, sw] = corners;
  const count = Math.min(6, Math.max(1, Math.round(area / 15_000 * cover / 100)));
  const edge = Math.min(
    Math.hypot(ne.x - nw.x, ne.y - nw.y), Math.hypot(se.x - sw.x, se.y - sw.y),
    Math.hypot(sw.x - nw.x, sw.y - nw.y), Math.hypot(se.x - ne.x, se.y - ne.y),
  );
  const size = Math.min(86, edge * 0.33, Math.sqrt(area / count) * (0.32 + cover / 580));
  const tone = isDay === false ? '177,192,215' : '241,247,255';
  const alpha = ((isDay === false ? 0.19 : 0.25) * cover / 100).toFixed(3);

  for (let i = 0; i < count; i++) {
    const column = 0.28 + 0.44 * (i + 0.5) / count + Math.sin(elapsed * 0.18 + random() * Math.PI * 2) * 0.04;
    const row = 0.26 + random() * 0.48;
    const topX = nw.x + (ne.x - nw.x) * column;
    const topY = nw.y + (ne.y - nw.y) * column;
    const x = topX + (sw.x + (se.x - sw.x) * column - topX) * row;
    const y = topY + (sw.y + (se.y - sw.y) * column - topY) * row;

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, 0.61);
    // Feathered lobes suggest clouds while keeping the underlying imagery legible.
    for (let lobe = -1; lobe <= 1; lobe++) {
      const offsetX = lobe * size * 0.38;
      const offsetY = Math.abs(lobe) * size * 0.18;
      const radius = size * (lobe === 0 ? 0.65 : 0.45) * (0.9 + random() * 0.2);
      const gradient = ctx.createRadialGradient(offsetX, offsetY, 0, offsetX, offsetY, radius);
      gradient.addColorStop(0, `rgba(${tone},${alpha})`);
      gradient.addColorStop(0.53, `rgba(${tone},${Number(alpha) * 0.8})`);
      gradient.addColorStop(1, `rgba(${tone},0)`);
      ctx.fillStyle = gradient;
      ctx.fillRect(offsetX - radius, offsetY - radius, 2 * radius, 2 * radius);
    }
    ctx.restore();
  }
}

export function drawWeatherRegions(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  regions: readonly ProjectedWeatherRegion[],
  elapsedSeconds: number,
) {
  ctx.clearRect(0, 0, width, height);

  for (const { id, corners, weather } of regions) {
    const rain = precipitationRate(weather.rainMm, weather.interval);
    const snow = precipitationRate(weather.snowCm, weather.interval);
    const cover = weather.cloudCover ?? 0;
    if (!(rain > 0 || snow > 0 || cover >= 40)) continue;
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
    if (cover >= 40) {
      // At close zoom a geographic cell can extend far beyond the viewport.
      const cloudCorners: ProjectedWeatherRegion['corners'] = area > 3 * visibleArea
        ? [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }]
        : corners;
      drawClouds(ctx, cloudCorners, Math.min(area, visibleArea), Math.min(100, cover), weather.isDay, regionRandom(id + '/cloud'), elapsedSeconds);
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
