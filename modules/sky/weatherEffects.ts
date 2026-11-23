import { drawJourneyRain } from './journeyRain.ts'

export interface WeatherEffectsState {
  /** Hourly precipitation rates for the sampled forecast point. */
  rainMm: number | null
  snowCm: number | null
  /** Forecast cloud cover in percent. */
  cloudCover: number | null
  isDay?: boolean
}

function positiveAmount(value: number | null): number {
  return value !== null && Number.isFinite(value) ? Math.max(0, value) : 0
}

export function weatherEffectsVisible(state: WeatherEffectsState): boolean {
  return positiveAmount(state.rainMm) > 0
    || positiveAmount(state.snowCm) > 0
    || positiveAmount(state.cloudCover) > 0
}

function seed(index: number, salt: number): number {
  const hash = Math.imul(index ^ salt, 0x45d9f3b)
  const shuffled = Math.imul(hash ^ (hash >>> 16), 0x119de1f3)
  return ((shuffled ^ (shuffled >>> 16)) >>> 0) / 0x100000000
}

function wrap(value: number, span: number): number {
  return ((value % span) + span) % span
}

function drawClouds(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  cover: number,
  seconds: number,
  isDay: boolean,
  map: boolean,
): void {
  const coverage = Math.min(cover, 100) / 100
  const opacity = coverage * (map ? 0.38 : 0.47)
  const skyHeight = Math.min(height * 0.30, 220)
  const puffSize = Math.min(Math.max(width * 0.25, 74), 250)
  const padding = puffSize * 1.4
  const span = width + 2 * padding
  const groupCount = Math.ceil(coverage * Math.min(12, Math.max(5, width / 95)))
  const color = isDay ? '222, 231, 242' : '104, 123, 153'

  // Keep every soft cloud inside the upper sky strip, even over a flat route map.
  ctx.scale(1, skyHeight / (2 * puffSize))
  for (let index = 1; index <= groupCount; index++) {
    const speed = 2 + 2 * seed(index, 0x5e35)
    const center = wrap(span * (index - 0.5) / groupCount + (seconds % (span / speed)) * speed, span) - padding
    const baseY = puffSize * ((map ? 0.62 : 0.12) + 0.58 * seed(index, 0x3a5f))
    for (let puff = -1; puff <= 1; puff++) {
      const puffIndex = index * 3 + puff
      const radius = puffSize * (0.46 + 0.50 * seed(puffIndex, 0x7e2b))
      const x = center + puff * puffSize * 0.38
      const y = baseY + puffSize * 0.28 * seed(puffIndex, 0x76f1)
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius)
      gradient.addColorStop(0, 'rgba(' + color + ', ' + opacity + ')')
      gradient.addColorStop(0.48, 'rgba(' + color + ', ' + opacity * 0.63 + ')')
      gradient.addColorStop(1, 'rgba(' + color + ', 0)')
      ctx.fillStyle = gradient
      const top = Math.max(0, y - radius)
      const bottom = Math.min(puffSize * 2, y + radius)
      ctx.fillRect(x - radius, top, radius * 2, bottom - top)
    }
  }
}

function drawSnow(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  rate: number,
  seconds: number,
  map: boolean,
): void {
  const intensity = Math.min(rate, 6) / 6
  const coverage = Math.min(1.45, Math.max(0.55, Math.sqrt(width * height / (390 * 700))))
  const spanX = width + 28
  const spanY = height + 16

  for (const near of [false, true]) {
    const count = Math.round((near ? 12 + 45 * intensity : 26 + 86 * intensity) * coverage)
    ctx.fillStyle = near ? 'rgba(247, 252, 255, 0.9)' : 'rgba(227, 241, 255, 0.73)'
    ctx.strokeStyle = map ? 'rgba(46, 71, 89, 0.68)' : 'rgba(59, 82, 103, 0.52)'
    ctx.lineWidth = near ? 0.65 : 0.45
    ctx.beginPath()
    for (let index = near ? 4096 : 1, end = index + count; index < end; index++) {
      const depth = seed(index, 0x5e35)
      const velocity = (near ? 36 : 23) + depth * 24
      const radius = (near ? 1.35 : 0.8) + depth * (near ? 1.15 : 0.6)
      const sway = (near ? 10 : 6) * Math.sin((seconds % 24) * Math.PI / 3 + seed(index, 0x38f3) * 2 * Math.PI)
      const x = wrap(seed(index, 0x1b7d) * spanX + (seconds % (spanX / 7)) * 7 + sway, spanX) - 14
      const y = wrap(seed(index, 0x6abf) * spanY + (seconds % (spanY / velocity)) * velocity, spanY) - 8
      ctx.moveTo(x + radius, y)
      ctx.arc(x, y, radius, 0, 2 * Math.PI)
    }
    ctx.stroke()
    ctx.fill()
  }
  ctx.beginPath()
}

/** Draws weather in CSS pixels using the caller's elapsed time in seconds. */
export function drawWeatherEffects(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: WeatherEffectsState,
  seconds: number,
  options?: { map?: boolean },
): void {
  if (!(width > 0 && height > 0 && seconds >= 0)
    || !Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(seconds)) return

  const cloudCover = positiveAmount(state.cloudCover)
  const rain = positiveAmount(state.rainMm)
  const snow = positiveAmount(state.snowCm)
  const map = options?.map === true

  if (cloudCover > 0) {
    ctx.save()
    try {
      drawClouds(ctx, width, height, cloudCover, seconds, state.isDay !== false, map)
    } finally {
      ctx.restore()
    }
  }
  if (rain > 0) drawJourneyRain(ctx, width, height, rain, seconds)
  if (snow > 0) {
    ctx.save()
    try {
      drawSnow(ctx, width, height, snow, seconds, map)
    } finally {
      ctx.restore()
    }
  }
}
