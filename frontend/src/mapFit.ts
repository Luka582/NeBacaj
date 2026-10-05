/** Bounds as [[south, west], [north, east]]. */
export type LatLngBounds = [[number, number], [number, number]]

/** A lone store gets a 100m frame so it is not a lone dot in an empty view. */
export const SINGLE_STORE_SPAN_M = 100

/** Tile size assumption used by the slippy-map tile source. */
const TILE_SIZE = 256
const EARTH_RADIUS_M = 6378137
const METERS_PER_DEG_LAT = (Math.PI * EARTH_RADIUS_M) / 180

export type Viewport = {
  /** Full map size in pixels. */
  size: { x: number; y: number }
  /** Reserved on the left edge (side panel), in pixels. */
  padLeft: number
  /** Reserved above the framed band (chrome), in pixels. */
  padTop: number
  /** Reserved below the framed band (bottom sheet), in pixels. */
  padBottom: number
  /** Fraction of the usable width the framed area may occupy. */
  widthRatio: number
}

/** Smallest bounds enclosing every point, or `null` when there are no points. */
export function boundsFromPoints(points: [number, number][]): LatLngBounds | null {
  if (points.length === 0) return null
  let south = Infinity
  let west = Infinity
  let north = -Infinity
  let east = -Infinity
  for (const [lat, lng] of points) {
    if (lat < south) south = lat
    if (lat > north) north = lat
    if (lng < west) west = lng
    if (lng > east) east = lng
  }
  return [[south, west], [north, east]]
}

/**
 * Grow bounds around their own center until they span at least `minSpanM` meters.
 *
 * Needed because zero-span bounds have no meaningful zoom: the fit would otherwise
 * be driven by a division by zero and jump to an arbitrary level.
 */
export function expandToMinSpan(bounds: LatLngBounds, minSpanM = SINGLE_STORE_SPAN_M): LatLngBounds {
  const [[south, west], [north, east]] = bounds
  const latCenter = (south + north) / 2
  const lngCenter = (west + east) / 2
  const latSpan = Math.max(north - south, minSpanM / METERS_PER_DEG_LAT)
  // Longitude degrees are shorter the closer you get to a pole, so scale by cos(latitude).
  const metersPerDegLng = Math.max(METERS_PER_DEG_LAT * Math.cos((latCenter * Math.PI) / 180), 1e-6)
  const lngSpan = Math.max(east - west, minSpanM / metersPerDegLng)
  return [
    [latCenter - latSpan / 2, lngCenter - lngSpan / 2],
    [latCenter + latSpan / 2, lngCenter + lngSpan / 2],
  ]
}

/**
 * Bounds to frame for the stores currently on the map, or `null` when there are none
 * (the caller then leaves the map exactly where it is).
 *
 * Any number of stores is framed on its real extent, however tight the cluster.
 * A single store has no extent, so it is framed at {@link SINGLE_STORE_SPAN_M}.
 */
export function boundsForStores(points: [number, number][]): LatLngBounds | null {
  const bounds = boundsFromPoints(points)
  if (!bounds) return null
  const [[south, west], [north, east]] = bounds
  const hasExtent = north - south > 1e-9 || east - west > 1e-9
  return hasExtent ? bounds : expandToMinSpan(bounds)
}

/** Widest ground distance covered by bounds, in meters. */
export function boundsSpanMeters(bounds: LatLngBounds): number {
  const [[south, west], [north, east]] = bounds
  const latCenter = (south + north) / 2
  const metersPerDegLng = Math.max(METERS_PER_DEG_LAT * Math.cos((latCenter * Math.PI) / 180), 1e-6)
  return Math.max((north - south) * METERS_PER_DEG_LAT, (east - west) * metersPerDegLng)
}

/** Web Mercator projected size, in pixels, of bounds at a given zoom. */
function projectedSpanPx(bounds: LatLngBounds, zoom: number): { x: number; y: number } {
  const [[south, west], [north, east]] = bounds
  const world = TILE_SIZE * 2 ** zoom
  const mercY = (lat: number) =>
    Math.log(Math.tan(Math.PI / 4 + (Math.min(89.99, Math.max(-89.99, lat)) * Math.PI) / 360))
  const xSpan = ((east - west) / 360) * world
  const ySpan = Math.abs(mercY(north) - mercY(south)) * (world / (2 * Math.PI))
  return { x: xSpan, y: ySpan }
}

/**
 * Zoom that makes `bounds` fit the padded viewport, and the point to centre on so that
 * the bounds land in the middle of that padded area rather than of the whole map.
 *
 * Returns `null` for bounds with no extent (the caller should not move the map).
 */
export function fitView(
  bounds: LatLngBounds,
  viewport: Viewport,
): { center: [number, number]; zoom: number } | null {
  const [[south, west], [north, east]] = bounds
  if (north - south <= 1e-9 && east - west <= 1e-9) return null

  const usableW = Math.max(1, viewport.size.x - viewport.padLeft)
  const usableH = Math.max(1, viewport.size.y - viewport.padTop - viewport.padBottom)
  const targetW = Math.max(1, usableW * viewport.widthRatio)

  // Largest zoom whose projected bounds still fit the target box. Floor, not round:
  // rounding up would zoom in past what the box can actually show.
  const spanAt0 = projectedSpanPx(bounds, 0)
  const scale = Math.min(targetW / spanAt0.x, usableH / spanAt0.y)
  const zoom = Math.floor(Math.log2(Math.max(scale, Number.MIN_VALUE)))

  return { center: [(south + north) / 2, (west + east) / 2], zoom }
}

/** Ground width and height, in meters, that a viewport shows at a given zoom. */
export function visibleSpanMeters(
  zoom: number,
  viewport: { width: number; height: number },
): { width: number; height: number } {
  const world = TILE_SIZE * 2 ** zoom
  return {
    width: (viewport.width / world) * 2 * Math.PI * EARTH_RADIUS_M,
    height: (viewport.height / world) * 2 * Math.PI * EARTH_RADIUS_M,
  }
}
