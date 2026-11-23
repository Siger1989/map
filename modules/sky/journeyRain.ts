const RAIN_LAYER_PADDING = 32

function particleSeed(index: number, salt: number): number {
  const hash = Math.imul(index ^ salt, 0x45d9f3b)
  const shuffled = Math.imul(hash ^ (hash >>> 16), 0x119de1f3)
  return ((shuffled ^ (shuffled >>> 16)) >>> 0) / 0x100000000
}

function movingCoordinate(seed: number, span: number, velocity: number, seconds: number): number {
  const period = span / velocity
  return (seed * span + (seconds % period) * velocity) % span - RAIN_LAYER_PADDING
}

function drawStreaks(
  context: CanvasRenderingContext2D,
  spanX: number,
  spanY: number,
  seconds: number,
  count: number,
  near: boolean,
): void {
  const baseSpeed = near ? 835 : 490
  const baseLength = near ? 17 : 8
  const seedOffset = near ? 4096 : 1
  const slant = near ? 0.19 : 0.15

  context.strokeStyle = near ? 'rgba(207, 232, 252, 0.48)' : 'rgba(177, 210, 239, 0.32)'
  context.lineWidth = near ? 1.15 : 0.72
  context.beginPath()
  for (let index = seedOffset; index < seedOffset + count; index++) {
    const depth = particleSeed(index, 0x5e35)
    const speed = baseSpeed * (0.8 + 0.4 * depth)
    const length = baseLength * (0.65 + 0.7 * depth)
    const x = movingCoordinate(particleSeed(index, 0x1b7d), spanX, speed * slant, seconds)
    const y = movingCoordinate(particleSeed(index, 0x6abf), spanY, speed, seconds)
    context.moveTo(x, y)
    context.lineTo(x - length * slant, y - length)
  }
  context.stroke()
}

/** Draws rain using CSS-pixel dimensions and elapsed route playback time in seconds. */
export function drawJourneyRain(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  hourlyRainMm: number,
  playheadSeconds: number,
): void {
  if (!(width > 0 && height > 0 && hourlyRainMm > 0 && playheadSeconds >= 0)
    || !Number.isFinite(width) || !Number.isFinite(height)
    || !Number.isFinite(hourlyRainMm) || !Number.isFinite(playheadSeconds)) return

  // A trace of rain should read on a phone. Density then rises on a logarithmic scale.
  const intensity = Math.log1p(Math.min(hourlyRainMm, 40)) / Math.log(41)
  const coverage = Math.min(1.3, Math.max(0.55, Math.sqrt(width * height / (390 * 700))))
  const spanX = width + 2 * RAIN_LAYER_PADDING
  const spanY = height + 2 * RAIN_LAYER_PADDING
  const farCount = Math.round((31 + 72 * intensity) * coverage)
  const nearCount = Math.round((14 + 37 * intensity) * coverage)
  const dropCount = Math.round((8 + 16 * intensity) * coverage)

  context.save()
  try {
    context.lineCap = 'round'
    drawStreaks(context, spanX, spanY, playheadSeconds, farCount, false)
    drawStreaks(context, spanX, spanY, playheadSeconds, nearCount, true)

    context.fillStyle = 'rgba(214, 238, 255, 0.38)'
    context.beginPath()
    for (let index = 8192; index < 8192 + dropCount; index++) {
      const speed = 290 + 250 * particleSeed(index, 0x5e35)
      const x = movingCoordinate(particleSeed(index, 0x1b7d), spanX, speed * 0.16, playheadSeconds)
      const y = movingCoordinate(particleSeed(index, 0x6abf), spanY, speed, playheadSeconds)
      const radius = 0.5 + 0.45 * particleSeed(index, 0x38f3)
      context.moveTo(x + radius, y)
      context.arc(x, y, radius, 0, 2 * Math.PI)
    }
    context.fill()
  } finally {
    context.beginPath()
    context.restore()
  }
}
