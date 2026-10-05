import assert from 'node:assert/strict'
import {
  SINGLE_STORE_SPAN_M,
  boundsForStores,
  boundsFromPoints,
  boundsSpanMeters,
  expandToMinSpan,
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

const BEOGRADE: [number, number] = [44.8, 20.5]

// --- requirement: no stores -> nothing to do ---

test('no stores -> null, so the caller leaves the map alone', () => {
  assert.equal(boundsForStores([]), null)
  assert.equal(boundsFromPoints([]), null)
})

// --- requirement: a single store is framed at 100m ---

test('single store -> 100m frame', () => {
  const b = boundsForStores([BEOGRADE])!
  const span = boundsSpanMeters(b)
  assert.ok(
    Math.abs(span - SINGLE_STORE_SPAN_M) < 1,
    `expected ~${SINGLE_STORE_SPAN_M}m span, got ${span.toFixed(1)}m`,
  )
})

test('single store frame is centered on the store', () => {
  const b = boundsForStores([BEOGRADE])!
  assert.ok(Math.abs((b[0][0] + b[1][0]) / 2 - BEOGRADE[0]) < 1e-9, 'lat center drifted')
  assert.ok(Math.abs((b[0][1] + b[1][1]) / 2 - BEOGRADE[1]) < 1e-9, 'lng center drifted')
})

test('100m is tighter than the old 500m floor', () => {
  assert.equal(SINGLE_STORE_SPAN_M, 100)
  const span = boundsSpanMeters(boundsForStores([BEOGRADE])!)
  assert.ok(span < 150, `single-store span should be ~100m, got ${span.toFixed(0)}m`)
})

// --- requirement: 2+ stores use their real extent, no minimum floor ---

test('two stores 100m apart frame at their real extent, not a floor', () => {
  const points: [number, number][] = [
    [44.8, 20.5],
    [44.8009, 20.5], // ~100m north
  ]
  const raw = boundsFromPoints(points)!
  const rawSpan = boundsSpanMeters(raw)
  const fit = boundsForStores(points)!
  assert.deepEqual(fit, raw, 'two stores must not be widened at all')
  assert.ok(Math.abs(boundsSpanMeters(fit) - rawSpan) < 1e-6, 'span changed')
})

test('5 stores in a 100m circle keep their tight extent', () => {
  const points: [number, number][] = [
    [44.8, 20.5],
    [44.8009, 20.5],
    [44.8, 20.5009],
    [44.8009, 20.5009],
    [44.8004, 20.5004],
  ]
  const fit = boundsForStores(points)!
  assert.deepEqual(fit, boundsFromPoints(points)!, 'cluster must not be widened')
  assert.ok(boundsSpanMeters(fit) < 200, 'precondition: cluster is small')
})

test('widely spread stores frame their full extent', () => {
  const points: [number, number][] = [
    [44.0, 20.0],
    [45.0, 21.0],
  ]
  assert.deepEqual(boundsForStores(points)!, [[44.0, 20.0], [45.0, 21.0]])
})

// --- edge cases that must not break the map ---

test('several stores at identical coordinates fall back to the 100m frame', () => {
  const b = boundsForStores([BEOGRADE, BEOGRADE, BEOGRADE])!
  const span = boundsSpanMeters(b)
  assert.ok(
    Math.abs(span - SINGLE_STORE_SPAN_M) < 1,
    `expected ~${SINGLE_STORE_SPAN_M}m, got ${span.toFixed(1)}m`,
  )
})

test('bounds are always ordered south-west to north-east', () => {
  const b = boundsForStores([
    [45.0, 21.0],
    [44.0, 20.0],
  ])!
  assert.ok(b[0][0] <= b[1][0], 'lat ordering')
  assert.ok(b[0][1] <= b[1][1], 'lng ordering')
})

test('expansion is centered and does not mutate its input', () => {
  const raw = boundsFromPoints([
    [44.0, 20.0],
    [44.1, 20.1],
  ])!
  const snapshot = JSON.parse(JSON.stringify(raw))
  const b = expandToMinSpan(raw, 100)
  assert.deepEqual(raw, snapshot, 'input was mutated')
  assert.ok(Math.abs((b[0][0] + b[1][0]) / 2 - (raw[0][0] + raw[1][0]) / 2) < 1e-9, 'lat center moved')
  assert.ok(Math.abs((b[0][1] + b[1][1]) / 2 - (raw[0][1] + raw[1][1]) / 2) < 1e-9, 'lng center moved')
})

test('wide bounds are left untouched by expandToMinSpan', () => {
  const raw = boundsFromPoints([
    [44.0, 20.0],
    [45.0, 21.0],
  ])!
  assert.deepEqual(expandToMinSpan(raw, 100), raw)
})

test('near-pole input stays finite', () => {
  const b = boundsForStores([
    [89.9, 10],
    [89.9, 10.001],
  ])!
  assert.ok(Number.isFinite(b[0][1]) && Number.isFinite(b[1][1]), 'lng span must stay finite')
  assert.ok(b[1][1] > b[0][1], 'lng span must stay positive')
})

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)