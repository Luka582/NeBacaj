import { useEffect, useState, useRef } from 'react'
import { MapContainer, TileLayer, Marker, Circle, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import StoreDetail from './StoreDetail'
import ProductDetail from './ProductDetail'
import ProductSheet, { type ProductSearchResult } from './ProductSheet'
import SettingsMenu from './SettingsMenu'
import MyProducts from './MyProducts'
import { tapHandlers, dismissKeyboard } from './tapHandlers'
import { cropImageUrl } from './format'

const CARTO_KEY = __CARTO_API_KEY__
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
  image_url?: string | null
  today_products_count: number
  today_opening_minute: number
  today_closing_minute: number
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

const BRAND_PIN = '#f97316'
const PIN_DEAL_OPACITY = 0.95
const PIN_DIM_OPACITY = 0.32

const pinIconCache = new Map<string, L.DivIcon>()

function makePinIcon(type: string, hasDeals: boolean, dim: boolean) {
  const key = `${type}:${hasDeals}:${dim}`
  const cached = pinIconCache.get(key)
  if (cached) return cached

  const color = dim && !hasDeals ? '#78716c' : BRAND_PIN
  const opacity = dim && !hasDeals ? PIN_DIM_OPACITY : PIN_DEAL_OPACITY
  const inner = STORE_COLORS[type] ?? '#78716c'

  const icon = L.divIcon({
    className: '',
    iconSize: [34, 46],
    iconAnchor: [17, 46],
    html: `
      <svg width="34" height="46" viewBox="0 0 34 46" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M17 0C7.9 0 .5 7.4.5 16.5.5 29 17 46 17 46S33.5 29 33.5 16.5C33.5 7.4 26.1 0 17 0z"
              fill="${color}" fill-opacity="${opacity}" stroke="white" stroke-width="2"/>
        <circle cx="17" cy="14.5" r="7.5" fill="white" fill-opacity="0.98"/>
        <circle cx="17" cy="14.5" r="3.6" fill="${inner}"/>
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
  | { seq: number; type: 'focus'; lat: number; lng: number }

function MapController({
  request,
  interactionLocked,
  invalidateSignal,
}: {
  request: MapRequest | null
  interactionLocked: boolean
  invalidateSignal: number
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
    } else if (request.type === 'focus') {
      const size = map.getSize()
      const pt = map.project([request.lat, request.lng], map.getZoom())
      const targetTop = Math.min(470, Math.max(120, size.y - 100))
      const center = map.unproject([pt.x, pt.y - (targetTop - size.y / 2)], map.getZoom())
      map.panTo(center, { animate: true })
    } else if (request.type === 'store') {
      map.setView([request.lat, request.lng], Math.max(map.getZoom(), 13))
    } else {
      map.fitBounds(request.bounds)
    }
  }, [request, map])

  const lastInvalidate = useRef(0)
  useEffect(() => {
    if (invalidateSignal === lastInvalidate.current) return
    lastInvalidate.current = invalidateSignal
    map.invalidateSize({ animate: false })
  }, [map, invalidateSignal])

  useEffect(() => {
    const onViewportResize = () => map.invalidateSize({ animate: false })
    window.addEventListener('resize', onViewportResize)
    const vv = window.visualViewport
    vv?.addEventListener('resize', onViewportResize)
    return () => {
      window.removeEventListener('resize', onViewportResize)
      vv?.removeEventListener('resize', onViewportResize)
    }
  }, [map])

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
  const open = store.today_opening_minute
  const close = store.today_closing_minute
  if (close > 1440 && nowMinutes < close - 1440) return false
  return nowMinutes < open || nowMinutes >= close
}

function formatMinutes(minutes: number): string {
  const h = Math.floor((minutes % 1440) / 60).toString().padStart(2, '0')
  const m = (minutes % 60).toString().padStart(2, '0')
  return `${h}:${m}`
}

function App() {
  const [stores, setStores] = useState<Store[]>([])
  const [error, setError] = useState<string | null>(null)
  const [selectedTown, setSelectedTown] = useState<string>('Sve')
  const [searchQuery, setSearchQuery] = useState('')
  const [townSearchOpen, setTownSearchOpen] = useState(false)
  const [townOverlayH, setTownOverlayH] = useState<number | null>(null)
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
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [myProductsOpen, setMyProductsOpen] = useState(false)
  const [showHint, setShowHint] = useState<boolean>(() => {
    try {
      return localStorage.getItem('nebacajHintDismissed') !== '1'
    } catch {
      return true
    }
  })
  const dismissHint = () => {
    setShowHint(false)
    try {
      localStorage.setItem('nebacajHintDismissed', '1')
    } catch {
      return
    }
  }
  const markerRefs = useRef<Map<string, L.Marker>>(new Map())
  const [recentTowns, setRecentTowns] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('recentTowns') || '[]')
    } catch {
      return []
    }
  })
  const inputRef = useRef<HTMLInputElement>(null)
  const townOverlayInputRef = useRef<HTMLInputElement>(null)
  const requestSeq = useRef(0)
  const [productSearchQuery, setProductSearchQuery] = useState('')
  const productSearchQueryRef = useRef('')
  productSearchQueryRef.current = productSearchQuery
  const [productResults, setProductResults] = useState<ProductSearchResult[]>([])
  const [productSearchLoading, setProductSearchLoading] = useState(false)
  const [productSearchError, setProductSearchError] = useState(false)
  const [searchProductOpen, setSearchProductOpen] = useState<SearchProductOpen | null>(null)
  const [invalidateSignal, setInvalidateSignal] = useState(0)
  const prevDetailOpen = useRef(false)

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
    if (townSearchOpen) {
      setTownOverlayH(window.innerHeight)
      townOverlayInputRef.current?.focus()
    } else {
      focusedSearch.current = null
      setInputFocused(false)
      inputRef.current?.blur()
    }
  }, [townSearchOpen])

  useEffect(() => {
    const open = detailStoreId != null || searchProductOpen != null
    if (prevDetailOpen.current && !open) {
      window.scrollTo(0, 0)
      setInvalidateSignal((c) => c + 1)
    }
    prevDetailOpen.current = open
  }, [detailStoreId, searchProductOpen])

  useEffect(() => {
    if (inputFocused || detailStoreId != null || searchProductOpen != null || settingsOpen || myProductsOpen) {
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
  }, [inputFocused, detailStoreId, searchProductOpen])

  useEffect(() => {
    let alive = true
    fetch('/api/stores?is_active=true&only_opened=false')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((data: Store[]) => {
        if (alive) setStores(data)
      })
      .catch((err) => {
        if (alive) setError(err.message)
      })
    return () => {
      alive = false
    }
  }, [])

  const loadStores = () => {
    fetch('/api/stores?is_active=true&only_opened=false')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((data: Store[]) => setStores(data))
      .catch((err) => setError(err.message))
  }

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

  function selectTown(town: string) {
    setSelectedTown(town)
    setSearchQuery(town === 'Sve' ? '' : town)
    setTownSearchOpen(false)
    fitToTown(town)
    if (town !== 'Sve') {
      setRecentTowns((prev) => {
        const next = [town, ...prev.filter((t) => t !== town)].slice(0, 5)
        try {
          localStorage.setItem('recentTowns', JSON.stringify(next))
        } catch {
          return prev
        }
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
              setTownSearchOpen(false)
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
    window.setTimeout(() => setWarningLeaving(true), 1500)
    window.setTimeout(() => {
      setLocationWarning(null)
      setWarningLeaving(false)
    }, 2000)
  }

  useEffect(() => {
    const q = productSearchQuery.trim()
    const timer = window.setTimeout(
      () => {
        const params = new URLSearchParams()
        if (q) params.set('q', q)
        if (selectedTown !== 'Sve') params.set('town', selectedTown)
        if (userLocation) {
          params.set('lat', String(userLocation[0]))
          params.set('lng', String(userLocation[1]))
        }
        params.set('limit', '100')
        setProductSearchLoading(true)
        setProductSearchError(false)
        fetch(`/api/products/search?${params.toString()}`)
          .then((res) => {
            if (!res.ok) throw new Error()
            return res.json()
          })
          .then((data: ProductSearchResult[]) => {
            if (productSearchQueryRef.current !== q) return
            setProductResults(data)
          })
          .catch(() => {
            if (productSearchQueryRef.current === q) setProductSearchError(true)
          })
          .finally(() => {
            if (productSearchQueryRef.current === q) setProductSearchLoading(false)
          })
      },
      q ? 300 : 0,
    )
    return () => window.clearTimeout(timer)
  }, [productSearchQuery, selectedTown, userLocation])

  function openProductFromSearch(result: ProductSearchResult) {
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
        <MapController request={mapRequest} interactionLocked={inputFocused} invalidateSignal={invalidateSignal} />
        {userLocation && (
          <>
            <Circle
              center={userLocation}
              radius={locationRadius * 1000}
              pathOptions={{
                color: '#f97316',
                weight: 2,
                dashArray: '6 6',
                fillColor: 'rgba(249, 115, 22, 0.08)',
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
              icon={makePinIcon(store.store_type, !dim, dim)}
              zIndexOffset={selected ? 500 : 0}
              ref={(marker) => {
                if (marker) markerRefs.current.set(store.id, marker)
                else markerRefs.current.delete(store.id)
              }}
              eventHandlers={{
                click: () => {
                  setSelectedStoreId(store.id)
                  requestSeq.current += 1
                  setMapRequest({
                    seq: requestSeq.current,
                    type: 'focus',
                    lat: store.latitude,
                    lng: store.longitude,
                  })
                },
              }}
            >
              {selected && (
                <Popup
                  closeButton={false}
                  autoPan={false}
                  offset={[0, -24]}
                  eventHandlers={{ popupclose: () => setSelectedStoreId(null) }}
                  className="store-popup"
                >
                  <div className="store-popup-content">
                    {store.image_url && (
                      <img
                        src={cropImageUrl(store.image_url, 640, 360)}
                        alt=""
                        loading="lazy"
                        className="store-popup-image"
                      />
                    )}
                    <div className="store-popup-badges">
                      <span className="store-popup-badge store-popup-badge-type">
                        <span
                          className="store-popup-type-dot"
                          style={{ backgroundColor: STORE_COLORS[store.store_type] ?? '#6b7280' }}
                        />
                        {STORE_LABELS[store.store_type] ?? 'Ostalo'}
                      </span>
                      {dim && (
                        <>
                          {closed && <span className="store-popup-badge store-popup-badge-red">Zatvoreno</span>}
                          {store.today_products_count === 0 && (
                            <span className="store-popup-badge store-popup-badge-amber">Nema proizvoda</span>
                          )}
                        </>
                      )}
                    </div>
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
                        {store.today_opening_minute === store.today_closing_minute
                          ? 'Zatvoreno'
                          : `${formatMinutes(store.today_opening_minute)} – ${formatMinutes(store.today_closing_minute)}`}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg bg-brand-600 py-2 text-sm font-semibold text-white active:bg-brand-700"
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

<div className="pointer-events-auto absolute top-4 left-16 right-16 z-[1000] sm:left-1/2 sm:right-auto sm:w-auto sm:-translate-x-1/2">
        <div className="relative w-full max-w-sm sm:w-96">
          {searchQuery ? (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="Očisti pretragu"
              className="absolute top-1/2 right-2.5 z-10 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-slate-200/80 text-slate-600 active:bg-slate-300"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
              >
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
          ) : (
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="pointer-events-none absolute top-1/2 right-3 h-5 w-5 -translate-y-1/2 text-brand-400"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
          )}
          <input
            ref={inputRef}
            id="town-search"
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => {
              focusedSearch.current = 'town'
              setSearchQuery('')
              setTownSearchOpen(true)
              setInputFocused(true)
            }}
            onBlur={() => {
              focusedSearch.current = null
              setInputFocused(false)
            }}
            onPointerDown={(e) => {
              if (focusedSearch.current === 'product') e.preventDefault()
            }}
            placeholder="Pronađi grad..."
            className="w-full rounded-full border border-slate-200 bg-white py-2.5 pr-10 pl-4 text-sm font-semibold text-slate-800 shadow-lg shadow-slate-900/5 outline-none transition focus:border-brand-400 focus:ring-4 focus:ring-brand-100"
          />
        </div>

        {error && <p className="mt-1 text-center text-sm text-red-500">{error}</p>}
        {locationWarning && (
          <p
            className={`pointer-events-none fixed top-20 left-1/2 z-[1002] -translate-x-1/2 whitespace-nowrap rounded-lg bg-red-500 px-3 py-1 text-sm font-medium text-white shadow-lg transition-opacity duration-500 sm:hidden ${warningLeaving ? 'opacity-0' : 'opacity-100'}`}
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
        className={`absolute top-4 right-4 z-[1001] flex h-11 w-11 items-center justify-center rounded-xl bg-white/95 shadow-lg backdrop-blur transition active:scale-95 ${
          userLocation ? 'text-brand-600 ring-2 ring-brand-200 hover:bg-brand-50' : 'text-slate-600 hover:bg-brand-50'
        }`}
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
      <button
        type="button"
        onClick={() => setSettingsOpen(true)}
        title="Podešavanja"
        aria-label="Podešavanja"
        className="absolute top-4 left-4 z-[1001] flex h-11 w-11 items-center justify-center rounded-xl bg-white/95 text-slate-600 shadow-lg backdrop-blur transition hover:bg-brand-50 active:scale-95"
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
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button>
      {townSearchOpen && (
        <div
          className="fixed inset-x-0 top-0 z-[1600] flex h-screen flex-col bg-white"
          style={{ height: townOverlayH != null ? `${townOverlayH}px` : '100dvh' }}
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-2 py-3">
            <button
              type="button"
              onClick={() => {
                setSearchQuery('')
                setTownSearchOpen(false)
              }}
              aria-label="Nazad"
              className="pointer-events-auto flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-600 active:bg-slate-100"
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
                <path d="M19 12H5" />
                <path d="m12 19-7-7 7-7" />
              </svg>
            </button>
            <div className="relative flex-1">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="pointer-events-none absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-slate-400"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
              </svg>
              <input
                ref={townOverlayInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => {
                  focusedSearch.current = 'town'
                  setInputFocused(true)
                }}
                onBlur={() => {
                  focusedSearch.current = null
                  setInputFocused(false)
                }}
                placeholder="Unesi naziv grada..."
                className="w-full rounded-full border border-slate-200 bg-white py-2.5 pr-3 pl-9 text-sm font-semibold text-slate-800 outline-none transition focus:border-brand-400 focus:ring-4 focus:ring-brand-100"
              />
            </div>
          </div>
          <ul
            onWheel={dismissKeyboard}
            onTouchMove={dismissKeyboard}
            className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto overscroll-contain px-2 py-2"
          >
            <li>
              <button
                type="button"
                {...tapHandlers(() => selectTown('Sve'))}
                onClick={() => selectTown('Sve')}
                className="w-full rounded-lg px-4 py-3 text-left text-sm font-medium text-slate-700 hover:bg-brand-50 active:bg-brand-50"
              >
                Svi gradovi
              </button>
            </li>
            {query.length === 0 && recentTowns.length > 0 && (
              <>
                <li className="border-t border-slate-100 px-4 pt-3 pb-1 text-xs font-semibold text-slate-400">
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
                        className="w-full rounded-lg px-4 py-3 text-left text-sm font-medium text-brand-600 hover:bg-brand-50 active:bg-brand-50"
                      >
                        {t}
                      </button>
                    </li>
                  ))}
              </>
            )}
            {filteredTowns.length === 0 && query.length > 0 ? (
              <li className="px-4 py-3 text-sm text-slate-400">Nema rezultata</li>
            ) : (
              filteredTowns
                .filter((t) => query.length > 0 || !recentTowns.includes(t))
                .map((t) => (
                  <li key={t}>
                    <button
                      type="button"
                      {...tapHandlers(() => selectTown(t))}
                      onClick={() => selectTown(t)}
                      className="w-full rounded-lg px-4 py-3 text-left text-sm font-medium text-slate-700 hover:bg-brand-50 active:bg-brand-50"
                    >
                      {t}
                    </button>
                  </li>
                ))
            )}
          </ul>
        </div>
      )}
      {showHint && !townSearchOpen && !inputFocused && productSearchQuery.length === 0 && (
        <div className="pointer-events-auto absolute top-20 left-1/2 z-[1002] w-[calc(100%-1.5rem)] max-w-sm -translate-x-1/2 sm:w-96">
          <div className="rounded-2xl bg-white/95 p-3.5 shadow-xl ring-1 ring-slate-900/5 backdrop-blur">
            <div className="flex items-center gap-2.5">
              <img src="/favicon.svg" alt="" className="h-9 w-9 shrink-0" />
              <p className="text-sm leading-tight font-extrabold text-slate-900">Najbolja cena je blizu tebe.</p>
              <button
                type="button"
                onClick={dismissHint}
                aria-label="Zatvori"
                className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-400 active:bg-slate-100"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4"
                >
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              Pronađi grad, istraži cene i sačuvaj ono što vredi — pre nego što nestane.
            </p>
            <div className="mt-2.5 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('')
                  setTownSearchOpen(true)
                  setInputFocused(true)
                }}
                className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full bg-slate-100 text-xs font-bold text-slate-700 active:bg-slate-200"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-3.5 w-3.5"
                >
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.35-4.35" />
                </svg>
                Pronađi grad
              </button>
              <button
                type="button"
                onClick={() => {
                  dismissHint()
                  handleUseMyLocation()
                }}
                className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full bg-brand-600 text-xs font-bold text-white active:bg-brand-700"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-3.5 w-3.5"
                >
                  <path d="M12 21s-7-5.2-7-11a7 7 0 0 1 14 0c0 5.8-7 11-7 11z" />
                  <circle cx="12" cy="10" r="2.5" />
                </svg>
                Moja lokacija
              </button>
            </div>
          </div>
        </div>
      )}
      {!townSearchOpen && (
        <ProductSheet
          products={productResults}
          loading={productSearchLoading}
          error={productSearchError}
          query={productSearchQuery}
          onQueryChange={setProductSearchQuery}
          onSelect={openProductFromSearch}
          focusedSearch={focusedSearch}
          onSearchFocused={setInputFocused}
          onTownDropdown={setTownSearchOpen}
        />
      )}
      {detailStoreId && <StoreDetail storeId={detailStoreId} onClose={() => setDetailStoreId(null)} />}
      {settingsOpen && (
        <SettingsMenu
          onClose={() => setSettingsOpen(false)}
          onOpenMyProducts={() => {
            setSettingsOpen(false)
            setMyProductsOpen(true)
          }}
        />
      )}
      {myProductsOpen && <MyProducts onClose={() => setMyProductsOpen(false)} onChanged={loadStores} />}
      {searchProductOpen && (
        <ProductDetail
          productId={searchProductOpen.productId}
          storeName={searchProductOpen.storeName}
          onBack={() => setSearchProductOpen(null)}
          onViewStore={(storeId) => {
            setSearchProductOpen(null)
            setDetailStoreId(storeId)
          }}
        />
      )}
    </div>
  )
}

export default App
