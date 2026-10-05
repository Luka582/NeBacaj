import assert from 'node:assert/strict'
import {
  SINGLE_STORE_SPAN_M,
  type Viewport,
  boundsForStores,
  boundsSpanMeters,
  fitView,
  visibleSpanMeters,
} from '../src/mapFit.ts'

let failures = 0
function test(name: string, fn: () => void) {
  try {
    fn()
    console.log(`  PASS  ${name}`)
  } catch (err) {
    failures += 1
    console.log(`  FAIL  ${name}\n        ${(err as Error).message.split('\n')[0]}`)
  }
}

const MOBILE: Viewport = { size: { x: 390, y: 780 }, padLeft: 0, padTop: 100, padBottom: 140, widthRatio: 0.9 }
const DESKTOP: Viewport = { size: { x: 1440, y: 900 }, padLeft: 380, padTop: 100, padBottom: 0, widthRatio: 0.9 }

function fit(points: [number, number][], vp: Viewport = MOBILE) {
  const bounds = boundsForStores(points)
  if (!bounds) return null
  return fitView(bounds, vp)
}

function minVisible(fit: { center: [number, number]; zoom: number }, vp: Viewport = MOBILE) {
  const s = visibleSpanMeters(fit.zoom, { width: vp.size.x, height: vp.size.y })
  return Math.min(s.width, s.height)
}

// --- requirement 3: nothing on the map -> do nothing ---

test('no stores -> no fit at all', () => {
  assert.equal(boundsForStores([]), null)
  assert.equal(fit([]), null)
})

test('degenerate bounds are rejected by fitView (no division by zero)', () => {
  assert.equal(fitView([[44.8, 20.5], [44.8, 20.5]], MOBILE), null)
})

// --- requirement 2 (revised): single store frames at 100m ---

test('single store: 100m frame, not 500m', () => {
  const f = fit([[44.8, 20.5]])!
  assert.ok(f, 'a fit should happen')
  const boundsSpan = boundsSpanMeters(boundsForStores([[44.8, 20.5]])!)
  assert.ok(
    Math.abs(boundsSpan - SINGLE_STORE_SPAN_M) < 1,
    `bounds should span 100m, got ${boundsSpan.toFixed(0)}m`,
  )
})

test('single store: centre is the store', () => {
  const f = fit([[44.8, 20.5]])!
  assert.ok(Math.abs(f.center[0] - 44.8) < 1e-6, 'lat centre')
  assert.ok(Math.abs(f.center[1] - 20.5) < 1e-6, 'lng centre')
})

test('single store: view shows roughly 100m, never tighter than it', () => {
  const f = fit([[44.8, 20.5]])!
  const min = minVisible(f)
  assert.ok(min >= SINGLE_STORE_SPAN_M, `expected >=100m visible, got ${min.toFixed(0)}m`)
  assert.ok(min < 260, `expected roughly 100m, got ${min.toFixed(0)}m`)
})

// --- requirement 2 (revised): 2+ stores use real extent, no floor ---

test('two stores 100m apart stay tight, no 500m floor', () => {
  const points: [number, number][] = [
    [44.8, 20.5],
    [44.8009, 20.5],
  ]
  assert.deepEqual(boundsForStores(points), [
    [44.8, 20.5],
    [44.8009, 20.5],
  ])
  const f = fit(points)!
  const min = minVisible(f)
  assert.ok(min >= 100, `expected >=100m visible, got ${min.toFixed(0)}m`)
  assert.ok(min < 320, `tight cluster must stay tight, got ${min.toFixed(0)}m`)
})

test('5 stores inside a 100m circle stay tight', () => {
  const points: [number, number][] = [
    [44.8, 20.5],
    [44.8009, 20.5],
    [44.8, 20.5009],
    [44.8009, 20.5009],
    [44.8004, 20.5004],
  ]
  const f = fit(points)!
  assert.ok(minVisible(f) < 320, `cluster should stay tight, got ${minVisible(f).toFixed(0)}m`)
})

test('2km-separated stores show kilometres', () => {
  const f = fit([
    [44.8, 20.5],
    [44.8 + 2000 / 111320, 20.5],
  ])!
  assert.ok(minVisible(f) > 900, `expected >900m visible, got ${minVisible(f).toFixed(0)}m`)
})

// --- requirement 1: framing follows what is on the map ---

test('a narrow subset frames tighter than the whole town', () => {
  const whole = fit([
    [44.75, 20.4],
    [44.9, 20.7],
  ])!
  const subset = fit([
    [44.8004, 20.5002],
    [44.8006, 20.5004],
  ])!
  assert.ok(subset.zoom > whole.zoom, `subset should zoom in (${subset.zoom} vs ${whole.zoom})`)
})

test('more spread out zooms further out', () => {
  const few = fit([
    [44.8, 20.5],
    [44.8005, 20.5],
  ])!
  const many = fit([
    [44.7, 20.4],
    [44.9, 20.6],
  ])!
  assert.ok(many.zoom < few.zoom, `wider must zoom out (${many.zoom} < ${few.zoom})`)
})

test('fit centre is always the middle of the framed bounds', () => {
  const f = fit([
    [44.0, 20.0],
    [44.5, 20.5],
  ])!
  assert.ok(Math.abs(f.center[0] - 44.25) < 1e-9, 'lat centre')
  assert.ok(Math.abs(f.center[1] - 20.25) < 1e-9, 'lng centre')
})

// --- viewport padding ---

test('a side panel forces a tighter zoom than the same viewport without one', () => {
  const bounds: [number, number][] = [
    [44.7, 20.4],
    [44.9, 20.6],
  ]
  const vp = { ...DESKTOP }
  const noPanel = fit(bounds, { ...vp, padLeft: 0 })!
  const withPanel = fit(bounds, vp)!
  assert.ok(
    withPanel.zoom <= noPanel.zoom,
    `panel must not zoom in more (${withPanel.zoom} vs ${noPanel.zoom})`,
  )
})

test('larger viewport shows more ground at the same zoom', () => {
  const small = visibleSpanMeters(14, { width: 390, height: 780 })
  const large = visibleSpanMeters(14, { width: 1440, height: 900 })
  assert.ok(large.width > small.width, 'width scales with viewport')
  assert.ok(large.height > small.height, 'height scales with viewport')
})

test('bounds that fit need no more than the target width', () => {
  const points: [number, number][] = [
    [44.8, 20.5],
    [44.81, 20.51],
  ]
  const f = fit(points)!
  const b = boundsForStores(points)!
  const span = visibleSpanMeters(f.zoom, { width: MOBILE.size.x, height: MOBILE.size.y })
  const latSpanM = boundsSpanMeters([[b[0][0], b[0][1]], [b[1][0], b[0][1]]])
  assert.ok(span.width >= latSpanM, `view must contain the bounds horizontally`)
})

// --- robustness ---

test('works for a single store on desktop too', () => {
  const f = fit([[44.8, 20.5]], DESKTOP)
  assert.ok(f, 'desktop single-store fit should happen')
  assert.ok(Number.isFinite(f.zoom) && f.zoom >= 0, `zoom must be a finite number, got ${f.zoom}`)
})

test('high-latitude bounds do not produce nonsense zooms', () => {
  const f = fit([
    [69.0, 23.0],
    [69.05, 23.05],
  ])!
  assert.ok(Number.isFinite(f.zoom) && f.zoom >= 0, `zoom must be finite, got ${f.zoom}`)
})

test('a zero-size viewport does not produce NaN', () => {
  const f = fit(
    [
      [44.8, 20.5],
      [44.81, 20.51],
    ],
    { size: { x: 0, y: 0 }, padLeft: 0, padTop: 0, padBottom: 0, widthRatio: 0.9 },
  )
  assert.ok(f === null || (Number.isFinite(f.zoom) && !Number.isNaN(f.zoom)), 'zoom must not be NaN')
})

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
