import assert from 'node:assert/strict'
import test from 'node:test'
import { drawWeatherEffects, weatherEffectsVisible } from '../modules/sky/weatherEffects.ts'

const clear = { rainMm: null, snowCm: null, cloudCover: null }

function frame(state, seconds = 0, map = false) {
  const commands = []
  const ctx = {
    save: () => commands.push(['save']),
    restore: () => commands.push(['restore']),
    scale: (x, y) => commands.push(['scale', x, y]),
    createRadialGradient: (...args) => {
      commands.push(['gradient', ...args])
      return { addColorStop: (...stop) => commands.push(['stop', ...stop]) }
    },
    fillRect: (...args) => commands.push(['rect', ...args]),
    beginPath: () => {},
    moveTo: () => {},
    lineTo: (...args) => commands.push(['line', ...args]),
    arc: (...args) => commands.push(['flake', ...args]),
    stroke: () => {},
    fill: () => {},
  }
  drawWeatherEffects(ctx, 390, 857, state, seconds, { map })
  return commands
}

test('absent and invalid weather leave the canvas untouched', () => {
  for (const state of [clear, { rainMm: NaN, snowCm: -0.2, cloudCover: Infinity }]) {
    assert.equal(weatherEffectsVisible(state), false)
    assert.deepEqual(frame(state), [])
  }
})

test('clouds animate deterministically within the upper third, with lower opacity on map', () => {
  const state = { ...clear, cloudCover: 69 }
  assert.equal(weatherEffectsVisible(state), true)
  const sky = frame(state, 5)
  const map = frame(state, 5, true)
  assert.deepEqual(sky, frame(state, 5))
  assert.notDeepEqual(sky, frame(state, 6))
  const yScale = sky.find(([type]) => type === 'scale')[2]
  const bounds = sky.filter(([type]) => type === 'rect')
  assert.ok(bounds.length > 0)
  assert.ok(bounds.every(([, , y, , height]) => (y + height) * yScale <= 857 * 0.30))
  const center = commands => commands.find(([type, offset]) => type === 'stop' && offset === 0)[2]
  const opacity = color => Number(color.split(', ').at(-1).slice(0, -1))
  assert.ok(opacity(center(map)) < opacity(center(sky)))
  assert.notDeepEqual(center(frame({ ...state, isDay: false })), center(sky))
  assert.deepEqual(frame({ ...state, cloudCover: 400 }), frame({ ...state, cloudCover: 100 }))
})

test('snow reads at light rates, scales up to a cap, and can coexist with other layers', () => {
  const flakes = rate => frame({ ...clear, snowCm: rate }).filter(([type]) => type === 'flake')
  assert.ok(flakes(0.2).filter(([, x, y]) => x >= 0 && x <= 390 && y >= 0 && y <= 857).length > 25)
  assert.ok(flakes(1).length > flakes(0.2).length)
  assert.deepEqual(flakes(200), flakes(6))
  const mixed = { rainMm: 1, snowCm: 1, cloudCover: 100 }
  const sampled = frame(mixed, 3)
  for (const primitive of ['gradient', 'line', 'flake']) {
    assert.ok(sampled.some(([type]) => type === primitive))
  }
  assert.notDeepEqual(sampled, frame(mixed, 4))
  assert.deepEqual(sampled, frame(mixed, 3))
})
