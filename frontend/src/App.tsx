import { useEffect, useState, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { MapContainer, TileLayer, Marker, Circle, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import StoreDetail from './StoreDetail'
import ProductDetail from './ProductDetail'
import { formatPrice } from './format'

const CARTO_KEY = 'cb1_2szz_1_c12a73f13692e186652d59d9'
const DEFAULT_CENTER: [number, number] = [44.0165, 20.9]
const cartoUrl = `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=${CARTO_KEY}`

interface Config {
  STORES_RADIUS: number
  LOCATION_RADIUS: number
}

interface Store {
  id: string
  town: string
  street: string
  street_number: string
  latitude: number
  longitude: number
  name: string
  store_type: string
  today_products_count: number
  today_opening_minute: number
  today_closing_minute: number
}

interface ProductSearchResult {
  product_id: string
  product_name: string
  amount?: number | null
  old_price: number
  new_price: number
  store_id: string
  store_name: string
  town: string
  street: string
  street_number: string
  latitude: number
  longitude: number
}

interface SearchProductOpen {
  productId: string
  storeName: string
}

const STORE_LABELS: Record<string, string> = {
  market: 'Market',
  bakery: 'Pekara',
  restaurant: 'Restoran',
  other: 'Ostalo',
}

const STORE_COLORS: Record<string, string> = {
  market: '#3b82f6',
  bakery: '#f59e0b',
  restaurant: '#ef4444',
  other: '#8b5cf6',
}

const pinIconCache = new Map<string, L.DivIcon>()

function makePinIcon(type: string, dim: boolean) {
  const key = `${type}:${dim}`
  const cached = pinIconCache.get(key)
  if (cached) return cached

  const color = STORE_COLORS[type] ?? '#6b7280'
  const opacity = dim ? 0.35 : 0.9

  const icon = L.divIcon({
    className: '',
    iconSize: [32, 44],
    iconAnchor: [16, 44],
    html: `
      <svg width="32" height="44" viewBox="0 0 32 44" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M16 0C7.163 0 0 7.163 0 16c0 12 16 28 16 28s16-16 16-28C32 7.163 24.837 0 16 0z"
              fill="${color}" fill-opacity="${opacity}" stroke="white" stroke-width="2"/>
        <circle cx="16" cy="14" r="7" fill="white" fill-opacity="${opacity}"/>
      </svg>
    `,
  })
  pinIconCache.set(key, icon)
  return icon
}

type MapRequest =
  | { seq: number; type: 'location'; lat: number; lng: number; radiusKm: number }
  | { seq: number; type: 'town'; bounds: [[number, number], [number, number]] }
  | { seq: number; type: 'store'; lat: number; lng: number }

function MapController({
  request,
  interactionLocked,
}: {
  request: MapRequest | null
  interactionLocked: boolean
}) {
  const map = useMap()
  const lastSeq = useRef<number>(-1)
  useEffect(() => {
    if (!request || request.seq === lastSeq.current) return
    lastSeq.current = request.seq
    if (request.type === 'location') {
      map.fitBounds([
        [request.lat - request.radiusKm / 111, request.lng - request.radiusKm / (111 * Math.cos((request.lat * Math.PI) / 180))],
        [request.lat + request.radiusKm / 111, request.lng + request.radiusKm / (111 * Math.cos((request.lat * Math.PI) / 180))],
      ])
    } else if (request.type === 'store') {
      map.setView([request.lat, request.lng], Math.max(map.getZoom(), 13))
    } else {
      map.fitBounds(request.bounds)
    }
  }, [request, map])

  useEffect(() => {
    const container = map.getContainer()
    if (interactionLocked) {
      map.dragging?.disable()
      map.touchZoom?.disable()
      map.doubleClickZoom?.disable()
      map.scrollWheelZoom?.disable()
      map.boxZoom?.disable()
      container.style.touchAction = 'none'
      const preventScroll = (e: Event) => e.preventDefault()
      container.addEventListener('touchmove', preventScroll, { passive: false })
      container.addEventListener('wheel', preventScroll, { passive: false })
      return () => {
        container.removeEventListener('touchmove', preventScroll)
        container.removeEventListener('wheel', preventScroll)
      }
    } else {
      map.dragging?.enable()
      map.touchZoom?.enable()
      map.doubleClickZoom?.enable()
      map.scrollWheelZoom?.enable()
      map.boxZoom?.enable()
      container.style.touchAction = ''
    }
  }, [map, interactionLocked])
  return null
}

const userLocationIcon = L.divIcon({
  className: '',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
  html: `
    <div style="width:22px;height:22px;border-radius:50%;background:#3b82f6;border:4px solid white;box-shadow:0 0 0 2px #3b82f6, 0 2px 6px rgba(0,0,0,0.3)"></div>
  `,
})

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const dp = new Array(n + 1)
  for (let j = 0; j <= n; j++) dp[j] = j
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j]
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost)
      prev = tmp
    }
  }
  return dp[n]
}

function fuzzyMatchTowns(towns: string[], query: string): string[] {
  const q = normalize(query)
  return towns
    .filter((town) => {
      const t = normalize(town)
      if (t.startsWith(q) || t.includes(q)) return true
      return levenshtein(q, t) <= 2
    })
    .sort((a, b) => {
      const na = normalize(a)
      const nb = normalize(b)
      const startA = na.startsWith(q)
      const startB = nb.startsWith(q)
      if (startA !== startB) return startA ? -1 : 1
      const distA = levenshtein(q, na)
      const distB = levenshtein(q, nb)
      return distA - distB
    })
}

function getSerbiaMinutes(): number {
  const now = new Date()
  const serbiaOffset = 120
  const serbiaTime = new Date(now.getTime() + (now.getTimezoneOffset() + serbiaOffset) * 60000)
  return serbiaTime.getHours() * 60 + serbiaTime.getMinutes()
}

function isStoreDimmed(store: Store, nowMinutes: number): boolean {
  const closed = isStoreClosed(store, nowMinutes)
  return closed || store.today_products_count === 0
}

function isStoreClosed(store: Store, nowMinutes: number): boolean {
  return nowMinutes < store.today_opening_minute || nowMinutes >= store.today_closing_minute
}

function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60).toString().padStart(2, '0')
  const m = (minutes % 60).toString().padStart(2, '0')
  return `${h}:${m}`
}

type TapSession = { sx: number; sy: number; fn: (() => void) | null }
const tapSessions: Record<number, TapSession> = {}

function tapHandlers(fn: () => void) {
  return {
    onPointerDown: (e: ReactPointerEvent) => {
      tapSessions[e.pointerId] = { sx: e.clientX, sy: e.clientY, fn }
    },
    onPointerUp: (e: ReactPointerEvent) => {
      const s = tapSessions[e.pointerId]
      delete tapSessions[e.pointerId]
      if (!s) return
      const dx = e.clientX - s.sx
      const dy = e.clientY - s.sy
      if (Math.abs(dx) <= 10 && Math.abs(dy) <= 10) s.fn?.()
    },
    onPointerCancel: (e: ReactPointerEvent) => {
      delete tapSessions[e.pointerId]
    },
  }
}

function App() {
  const [stores, setStores] = useState<Store[]>([])
  const [error, setError] = useState<string | null>(null)
  const [selectedTown, setSelectedTown] = useState<string>('Sve')
  const [searchQuery, setSearchQuery] = useState('')
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const [inputFocused, setInputFocused] = useState(false)
  const focusedSearch = useRef<'town' | 'product' | null>(null)
  const [radius, setRadius] = useState(50)
  const [locationRadius, setLocationRadius] = useState(0.5)
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null)
  const [locationWarning, setLocationWarning] = useState<string | null>(null)
  const [warningLeaving, setWarningLeaving] = useState(false)
  const [mapRequest, setMapRequest] = useState<MapRequest | null>(null)
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null)
  const [detailStoreId, setDetailStoreId] = useState<string | null>(null)
  const markerRefs = useRef<Map<string, L.Marker>>(new Map())
  const [recentTowns, setRecentTowns] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('recentTowns') || '[]')
    } catch {
      return []
    }
  })
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const productDropdownRef = useRef<HTMLDivElement>(null)
  const requestSeq = useRef(0)
  const [productSearchQuery, setProductSearchQuery] = useState('')
  const productSearchQueryRef = useRef('')
  productSearchQueryRef.current = productSearchQuery
  const [productResults, setProductResults] = useState<ProductSearchResult[]>([])
  const [productSearchOpen, setProductSearchOpen] = useState(false)
  const [productSearchLoading, setProductSearchLoading] = useState(false)
  const [productSearchError, setProductSearchError] = useState(false)
  const [searchProductOpen, setSearchProductOpen] = useState<SearchProductOpen | null>(null)

  useEffect(() => {
    fetch('/config.json')
      .then((r) => r.json())
      .then((data: Config) => {
        setRadius(data.STORES_RADIUS)
        setLocationRadius(data.LOCATION_RADIUS)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!selectedStoreId) return
    const marker = markerRefs.current.get(selectedStoreId)
    if (marker) {
      const t = window.setTimeout(() => {
        if (marker.isPopupOpen()) return
        marker.openPopup()
      }, 0)
      return () => window.clearTimeout(t)
    }
  }, [selectedStoreId])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false)
      }
      if (productDropdownRef.current && !productDropdownRef.current.contains(e.target as Node)) {
        setProductSearchOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    let lastHeight = vv.height
    const onResize = () => {
      if (vv.height - lastHeight > 60) {
        const el = document.activeElement
        if (el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) el.blur()
      }
      lastHeight = vv.height
    }
    vv.addEventListener('resize', onResize)
    return () => vv.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    if (inputFocused) {
      const de = document.documentElement
      const prevBody = document.body.style.overflow
      const prevDoc = de.style.overflow
      document.body.style.overflow = 'hidden'
      document.body.style.overscrollBehavior = 'none'
      de.style.overflow = 'hidden'
      de.style.overscrollBehavior = 'none'
      return () => {
        document.body.style.overflow = prevBody
        document.body.style.overscrollBehavior = ''
        de.style.overflow = prevDoc
        de.style.overscrollBehavior = ''
      }
    }
  }, [inputFocused])

  useEffect(() => {
    fetch('/api/stores?is_active=true&only_opened=false')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((data: Store[]) => setStores(data))
      .catch((err) => setError(err.message))
  }, [])

  const towns = Array.from(new Set(stores.map((s) => s.town))).sort()

  const query = searchQuery.trim()
  const filteredTowns = query.length === 0
    ? towns
    : fuzzyMatchTowns(towns, query)

  function storesForTown(town: string): Store[] {
    return town === 'Sve' ? stores : stores.filter((s) => s.town === town)
  }

  function fitToTown(town: string) {
    if (town === 'Sve') {
      if (stores.length === 0) return
      const lats = stores.map((s) => s.latitude)
      const lngs = stores.map((s) => s.longitude)
      const dLat = radius / 111
      const dLng = radius / (111 * Math.cos(((Math.min(...lats) + Math.max(...lats)) / 2 * Math.PI) / 180))
      const bounds: [[number, number], [number, number]] = [
        [Math.min(...lats) - dLat, Math.min(...lngs) - dLng],
        [Math.max(...lats) + dLat, Math.max(...lngs) + dLng],
      ]
      requestSeq.current += 1
      setMapRequest({ seq: requestSeq.current, type: 'town', bounds })
      return
    }
    const townStores = storesForTown(town)
    if (townStores.length === 0) return
    const lats = townStores.map((s) => s.latitude)
    const lngs = townStores.map((s) => s.longitude)
    const dLat = radius / 111
    const dLng = radius / (111 * Math.cos(((Math.min(...lats) + Math.max(...lats)) / 2 * Math.PI) / 180))
    const bounds: [[number, number], [number, number]] = [
      [Math.min(...lats) - dLat, Math.min(...lngs) - dLng],
      [Math.max(...lats) + dLat, Math.max(...lngs) + dLng],
    ]
    requestSeq.current += 1
    setMapRequest({ seq: requestSeq.current, type: 'town', bounds })
  }

  function clearProductSearch() {
    setProductSearchQuery('')
    setProductSearchOpen(false)
    setProductResults([])
    setProductSearchError(false)
    setProductSearchLoading(false)
  }

  function selectTown(town: string) {
    clearProductSearch()
    setSelectedTown(town)
    setSearchQuery(town === 'Sve' ? '' : town)
    setIsDropdownOpen(false)
    fitToTown(town)
    if (town !== 'Sve') {
      setRecentTowns((prev) => {
        const next = [town, ...prev.filter((t) => t !== town)].slice(0, 5)
        try {
          localStorage.setItem('recentTowns', JSON.stringify(next))
        } catch {}
        return next
      })
    }
  }

  const filtered = selectedTown === 'Sve'
    ? stores
    : stores.filter((s) => s.town === selectedTown)
  const nowMinutes = getSerbiaMinutes()

  function handleUseMyLocation() {
    if (!navigator.geolocation) {
      showLocationWarning('Lokacija nije omogućena u ovom pregledaču')
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude
        const lng = pos.coords.longitude
        setUserLocation([lat, lng])
        requestSeq.current += 1
        setMapRequest({ seq: requestSeq.current, type: 'location', lat, lng, radiusKm: locationRadius })
        fetch(`/api/town/${lat}/${lng}`)
          .then((r) => {
            if (!r.ok) throw new Error()
            return r.json()
          })
          .then((town) => {
            if (town) {
              setSelectedTown(town)
              setSearchQuery(town)
              setIsDropdownOpen(false)
            }
          })
          .catch(() => {})
      },
      () => showLocationWarning('Lokacija nije omogućena'),
      { timeout: 8000, maximumAge: 60000, enableHighAccuracy: false },
    )
  }

  function showLocationWarning(msg: string) {
    setWarningLeaving(false)
    setLocationWarning(msg)
    window.setTimeout(() => setWarningLeaving(true), 3000)
    window.setTimeout(() => {
      setLocationWarning(null)
      setWarningLeaving(false)
    }, 3500)
  }

  useEffect(() => {
    const q = productSearchQuery.trim()
    if (!q) {
      setProductResults([])
      setProductSearchOpen(false)
      setProductSearchError(false)
      setProductSearchLoading(false)
      return
    }
    setProductSearchLoading(true)
    setProductSearchError(false)
    const timer = window.setTimeout(() => {
      fetch(`/api/products/search?q=${encodeURIComponent(q)}`)
        .then((res) => {
          if (!res.ok) throw new Error()
          return res.json()
        })
        .then((data: ProductSearchResult[]) => {
          if (productSearchQueryRef.current !== q) return
          setProductResults(data)
          setProductSearchOpen(true)
        })
        .catch(() => {
          if (productSearchQueryRef.current === q) setProductSearchError(true)
        })
        .finally(() => {
          if (productSearchQueryRef.current === q) setProductSearchLoading(false)
        })
    }, 300)
    return () => window.clearTimeout(timer)
  }, [productSearchQuery])

  function openProductFromSearch(result: ProductSearchResult) {
    setProductSearchOpen(false)
    requestSeq.current += 1
    setMapRequest({ seq: requestSeq.current, type: 'store', lat: result.latitude, lng: result.longitude })
    setSearchProductOpen({ productId: result.product_id, storeName: result.store_name })
  }

  return (
    <div className="relative h-full w-full">
      <MapContainer
        center={DEFAULT_CENTER}
        zoom={7}
        zoomControl={false}
        className="z-0 h-full w-full"
        preferCanvas
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>'
          url={cartoUrl}
          subdomains="abcd"
          maxZoom={20}
        />
        <MapController request={mapRequest} interactionLocked={inputFocused} />
        {userLocation && (
          <>
            <Circle
              center={userLocation}
              radius={locationRadius * 1000}
              pathOptions={{
                color: '#3b82f6',
                weight: 2,
                dashArray: '6 6',
                fillColor: 'rgba(59, 130, 246, 0.08)',
                fillOpacity: 1,
              }}
            />
            <Marker position={userLocation} icon={userLocationIcon} zIndexOffset={1000} />
          </>
        )}
        {filtered.map((store) => {
          const dim = isStoreDimmed(store, nowMinutes)
          const closed = isStoreClosed(store, nowMinutes)
          const selected = store.id === selectedStoreId
          return (
            <Marker
              key={store.id}
              position={[store.latitude, store.longitude]}
              icon={makePinIcon(store.store_type, dim)}
              zIndexOffset={selected ? 500 : 0}
              ref={(marker) => {
                if (marker) markerRefs.current.set(store.id, marker)
                else markerRefs.current.delete(store.id)
              }}
              eventHandlers={{ click: () => setSelectedStoreId(store.id) }}
            >
              {selected && (
                <Popup
                  closeButton={false}
                  autoPan
                  offset={[0, -24]}
                  eventHandlers={{ popupclose: () => setSelectedStoreId(null) }}
                  className="store-popup"
                >
                  <div className="store-popup-content">
                    {dim && (
                      <div className="store-popup-badges">
                        {closed && <span className="store-popup-badge store-popup-badge-red">Zatvoreno</span>}
                        {store.today_products_count === 0 && (
                          <span className="store-popup-badge store-popup-badge-amber">Nema proizvoda</span>
                        )}
                      </div>
                    )}
                    <div className="store-popup-name">{store.name}</div>
                    <div className="store-popup-address">
                      {store.street} {store.street_number}
                    </div>
                    <div className="store-popup-row">
                      <span>Proizvoda danas</span>
                      <span className="store-popup-count">{store.today_products_count}</span>
                    </div>
                    <div className="store-popup-row">
                      <span>Radno vreme</span>
                      <span>
                        {formatMinutes(store.today_opening_minute)} – {formatMinutes(store.today_closing_minute)}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white active:bg-blue-700"
                      onPointerDown={() => {
                        setDetailStoreId(store.id)
                        setSelectedStoreId(null)
                      }}
                    >
                      Detalji o radnji
                    </button>
                  </div>
                </Popup>
              )}
            </Marker>
          )
        })}
      </MapContainer>

      <div className="pointer-events-auto absolute top-4 left-4 right-16 z-[1000] sm:left-1/2 sm:right-auto sm:w-auto sm:-translate-x-1/2">
        <div className="w-full max-w-sm rounded-2xl bg-white/95 p-3 shadow-lg backdrop-blur sm:w-96">
          <div className="mb-3">
            <div ref={dropdownRef} className="relative">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="pointer-events-none absolute top-1/2 right-3 h-5 w-5 -translate-y-1/2 text-slate-400"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
              </svg>
              <input
                ref={inputRef}
                id="town-search"
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  clearProductSearch()
                  setSearchQuery(e.target.value)
                  setIsDropdownOpen(true)
                }}
                onFocus={() => {
                  focusedSearch.current = 'town'
                  clearProductSearch()
                  setSearchQuery('')
                  setIsDropdownOpen(true)
                  setInputFocused(true)
                }}
                onBlur={() => {
                  focusedSearch.current = null
                  setIsDropdownOpen(false)
                  setInputFocused(false)
                }}
                onPointerDown={(e) => {
                  if (focusedSearch.current === 'product') e.preventDefault()
                }}
                placeholder="Unesi naziv grada..."
                className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pr-10 pl-3 text-sm font-medium text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              />
              {isDropdownOpen && (
                <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-auto overscroll-contain rounded-lg border border-slate-200 bg-white shadow-lg">
                  <li>
                    <button
                      type="button"
                      {...tapHandlers(() => selectTown('Sve'))}
                      onClick={() => selectTown('Sve')}
                      className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-blue-50"
                    >
                      Svi gradovi
                    </button>
                  </li>
                  {query.length === 0 && recentTowns.length > 0 && (
                    <>
                      <li className="border-t border-slate-100 px-3 pt-2 pb-1 text-xs font-semibold text-slate-400">
                        Nedavni
                      </li>
                      {recentTowns
                        .filter((t) => towns.includes(t))
                        .map((t) => (
                          <li key={t}>
                            <button
                              type="button"
                              {...tapHandlers(() => selectTown(t))}
                              onClick={() => selectTown(t)}
                              className="w-full px-3 py-2 text-left text-sm font-medium text-blue-600 hover:bg-blue-50"
                            >
                              {t}
                            </button>
                          </li>
                        ))}
                    </>
                  )}
                  {filteredTowns.length === 0 && query.length > 0 ? (
                    <li className="px-3 py-2 text-sm text-slate-400">Nema rezultata</li>
                  ) : (
                    filteredTowns
                      .filter((t) => query.length > 0 || !recentTowns.includes(t))
                      .map((t) => (
                        <li key={t}>
                          <button
                            type="button"
                            {...tapHandlers(() => selectTown(t))}
                            onClick={() => selectTown(t)}
                            className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-blue-50"
                          >
                            {t}
                          </button>
                        </li>
                      ))
                  )}
                </ul>
              )}
            </div>
          </div>

          <div ref={productDropdownRef} className="mb-3 relative">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="pointer-events-none absolute top-1/2 right-3 h-5 w-5 -translate-y-1/2 text-slate-400"
            >
              <path d="m21 21-4.35-4.35" />
              <path d="M3 3h4l2.6 12.2a2 2 0 0 0 2 1.8h7.6a2 2 0 0 0 2-1.6L23 7H7" />
            </svg>
            <input
              type="text"
              value={productSearchQuery}
onChange={(e) => {
                  setIsDropdownOpen(false)
                  setProductSearchQuery(e.target.value)
                  setProductSearchOpen(e.target.value.trim().length > 0)
                }}
onFocus={() => {
                  focusedSearch.current = 'product'
                  setIsDropdownOpen(false)
                  clearProductSearch()
                  setInputFocused(true)
                }}
                onBlur={() => {
                  focusedSearch.current = null
                  clearProductSearch()
                  setInputFocused(false)
                }}
                onPointerDown={(e) => {
                  if (focusedSearch.current === 'town') e.preventDefault()
                }}
                placeholder="Pretraži proizvode..."
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pr-10 pl-3 text-sm font-medium text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
            {productSearchOpen && (
              <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-auto overscroll-contain rounded-lg border border-slate-200 bg-white shadow-lg">
                {productSearchLoading && (
                  <li className="px-3 py-2 text-sm text-slate-400">Pretraga...</li>
                )}
                {!productSearchLoading && productSearchError && (
                  <li className="px-3 py-2 text-sm text-red-500">Greška pri pretrazi</li>
                )}
                {!productSearchLoading && !productSearchError && productResults.length === 0 && (
                  <li className="px-3 py-2 text-sm text-slate-400">Nema rezultata</li>
                )}
                {!productSearchLoading &&
                  !productSearchError &&
                  productResults.map((r) => (
                    <li key={r.product_id}>
                      <button
                        type="button"
                        {...tapHandlers(() => openProductFromSearch(r))}
                        onClick={() => openProductFromSearch(r)}
                        className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-blue-50"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-slate-900">{r.product_name}</p>
                          <p className="truncate text-xs text-slate-500">
                            {r.store_name} · {r.street} {r.street_number}, {r.town}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-sm font-bold text-red-600">{formatPrice(r.new_price)}</p>
                          {r.old_price > r.new_price && (
                            <p className="text-xs text-slate-400 line-through">{formatPrice(r.old_price)}</p>
                          )}
                        </div>
                      </button>
                    </li>
                  ))}
              </ul>
            )}
          </div>

          {error ? (
            <p className="text-center text-sm text-red-500">{error}</p>
          ) : (
            <div className="flex items-center justify-center gap-3">
              {Object.entries(STORE_LABELS).map(([type, label]) => (
                <span key={type} className="flex items-center gap-1 text-xs text-slate-500">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: STORE_COLORS[type] }}
                  />
                  {label}
                </span>
              ))}
            </div>
          )}
        </div>
        {locationWarning && (
          <p
            className={`pointer-events-none absolute top-16 right-16 z-[1002] whitespace-nowrap rounded-lg bg-red-500 px-3 py-1 text-sm font-medium text-white shadow-lg transition-opacity duration-500 sm:hidden ${warningLeaving ? 'opacity-0' : 'opacity-100'}`}
          >
            {locationWarning}
          </p>
        )}
        {locationWarning && (
          <p
            className={`pointer-events-none absolute top-1/2 left-1/2 z-[1001] hidden -translate-x-1/2 translate-y-full whitespace-nowrap rounded-lg bg-red-500 px-3 py-1 text-sm font-medium text-white shadow-lg transition-opacity duration-500 sm:block ${warningLeaving ? 'opacity-0' : 'opacity-100'}`}
          >
            {locationWarning}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={handleUseMyLocation}
        title="Koristi moju lokaciju"
        className="absolute top-4 right-4 z-[1001] flex h-11 w-11 items-center justify-center rounded-xl bg-white/95 text-blue-600 shadow-lg backdrop-blur transition hover:bg-blue-50 active:scale-95"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-5 w-5"
        >
          <path d="M12 21s-7-5.2-7-11a7 7 0 0 1 14 0c0 5.8-7 11-7 11z" />
          <circle cx="12" cy="10" r="2.5" />
        </svg>
      </button>
      {detailStoreId && <StoreDetail storeId={detailStoreId} onClose={() => setDetailStoreId(null)} />}
      {searchProductOpen && (
        <ProductDetail
          productId={searchProductOpen.productId}
          storeName={searchProductOpen.storeName}
          onBack={() => setSearchProductOpen(null)}
        />
      )}
    </div>
  )
}

export default App
