import { useEffect, useState, useRef } from 'react'
import { MapContainer, TileLayer, Marker, Circle, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import StoreDetail from './StoreDetail'
import ProductDetail from './ProductDetail'
import ProductSheet, { type ProductSearchResult, SIDE_PANEL_WIDTH } from './ProductSheet'
import SettingsMenu from './SettingsMenu'
import MyProducts from './MyProducts'
import { tapHandlers, dismissKeyboard } from './tapHandlers'
import { cropImageUrl, formatMinutes } from './format'
import { useNowMinutes } from './useNowMinutes'

const CARTO_KEY = __CARTO_API_KEY__
const DEFAULT_CENTER: [number, number] = [44.0165, 20.9]
const DEFAULT_TOWN = 'Novi Sad'

function loadSavedTown(): string {
  try {
    return localStorage.getItem('lastTown') || DEFAULT_TOWN
  } catch {
    return DEFAULT_TOWN
  }
}
const cartoUrl = `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=${CARTO_KEY}`

const LOCATION_RADIUS_KM = 1.0

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

function isStoreRecord(v: unknown): v is Store {
  if (typeof v !== 'object' || v === null) return false
  const s = v as Record<string, unknown>
  return (
    typeof s.id === 'string' &&
    typeof s.town === 'string' &&
    typeof s.street === 'string' &&
    typeof s.street_number === 'string' &&
    Number.isFinite(s.latitude) &&
    Number.isFinite(s.longitude) &&
    typeof s.name === 'string' &&
    typeof s.store_type === 'string' &&
    Number.isFinite(s.today_products_count) &&
    Number.isFinite(s.today_opening_minute) &&
    Number.isFinite(s.today_closing_minute) &&
    (s.image_url === undefined || s.image_url === null || typeof s.image_url === 'string')
  )
}

function parseStores(data: unknown): Store[] | null {
  if (!Array.isArray(data)) return null
  for (const s of data) {
    if (!isStoreRecord(s)) return null
  }
  return data as Store[]
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

const TOWN_FIELD_BOTTOM = 60
const STORE_TYPES_CLEARANCE = 40
const PEEK_HEIGHT = 140
const FIT_WIDTH_RATIO = 0.9

function fitBoundsInBand(map: L.Map, bounds: [[number, number], [number, number]], widthRatio = FIT_WIDTH_RATIO) {
  const size = map.getSize()
  const isDesktop = size.x >= 768
  const panelW = isDesktop ? SIDE_PANEL_WIDTH : 0
  const availW = size.x - panelW
  const sw = bounds[0]
  const ne = bounds[1]
  const latC = (sw[0] + ne[0]) / 2
  const lngC = (sw[1] + ne[1]) / 2
  const lngSpan = ne[1] - sw[1]
  let zoom: number
  if (lngSpan <= 1e-6) {
    zoom = Math.max(map.getZoom(), 14)
  } else {
    zoom = Math.log2((widthRatio * availW * 360) / (256 * lngSpan))
  }
  zoom = Math.min(Math.max(zoom, map.getMinZoom()), map.getMaxZoom())
  const bandTop = TOWN_FIELD_BOTTOM + STORE_TYPES_CLEARANCE
  const bandBottom = isDesktop ? size.y : size.y - PEEK_HEIGHT
  const bandMiddlePx = (bandTop + bandBottom) / 2
  const cx = isDesktop ? (size.x - panelW) / 2 : size.x / 2
  const c = map.project([latC, lngC], zoom)
  const center = map.unproject([c.x + (size.x / 2 - cx), c.y + (size.y / 2 - bandMiddlePx)], zoom)
  map.setView(center, zoom)
}

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
      const bounds: [[number, number], [number, number]] = [
        [request.lat - request.radiusKm / 111, request.lng - request.radiusKm / (111 * Math.cos((request.lat * Math.PI) / 180))],
        [request.lat + request.radiusKm / 111, request.lng + request.radiusKm / (111 * Math.cos((request.lat * Math.PI) / 180))],
      ]
      fitBoundsInBand(map, bounds, 0.2)
    } else if (request.type === 'focus') {
      const size = map.getSize()
      const offsetX = size.x >= 768 ? SIDE_PANEL_WIDTH / 2 : 0
      const pt = map.project([request.lat, request.lng], map.getZoom())
      const targetTop = Math.min(470, Math.max(120, size.y - 100)) + STORE_TYPES_CLEARANCE
      const center = map.unproject([pt.x + offsetX, pt.y - (targetTop - size.y / 2)], map.getZoom())
      map.panTo(center, { animate: true })
    } else if (request.type === 'store') {
      const zoom = Math.max(map.getZoom(), 13)
      const pt = map.project([request.lat, request.lng], zoom)
      const offsetX = map.getSize().x >= 768 ? SIDE_PANEL_WIDTH / 2 : 0
      map.setView(map.unproject([pt.x + offsetX, pt.y], zoom), zoom)
    } else {
      fitBoundsInBand(map, request.bounds)
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

function App() {
  const [stores, setStores] = useState<Store[]>([])
  const [error, setError] = useState<string | null>(null)
  const [selectedTown, setSelectedTown] = useState<string>(() => loadSavedTown())
  const [searchQuery, setSearchQuery] = useState(() => loadSavedTown())
  const [townSearchOpen, setTownSearchOpen] = useState(false)
  const [inputFocused, setInputFocused] = useState(false)
  const focusedSearch = useRef<'town' | 'product' | null>(null)
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null)
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
  const requestSeq = useRef(0)
  const [productSearchQuery, setProductSearchQuery] = useState('')
  const productSearchQueryRef = useRef('')
  productSearchQueryRef.current = productSearchQuery
  const [productResults, setProductResults] = useState<ProductSearchResult[]>([])
  const productSearchRequestRef = useRef(0)
  const [productSearchLoading, setProductSearchLoading] = useState(false)
  const [productSearchError, setProductSearchError] = useState(false)
  const [searchProductOpen, setSearchProductOpen] = useState<SearchProductOpen | null>(null)
  const [sheetExpanded, setSheetExpanded] = useState(false)
  const [selectedStoreType, setSelectedStoreType] = useState<string | null>(null)
  const [invalidateSignal, setInvalidateSignal] = useState(0)
  const prevDetailOpen = useRef(false)

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
    if (!townSearchOpen) {
      focusedSearch.current = null
      setInputFocused(false)
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
    if (!(inputFocused || detailStoreId != null || searchProductOpen != null || settingsOpen || myProductsOpen)) return
    const de = document.documentElement
    const prevBody = document.body.style.overflow
    const prevBodyOverscroll = document.body.style.overscrollBehavior
    const prevDoc = de.style.overflow
    const prevDocOverscroll = de.style.overscrollBehavior
    document.body.style.overflow = 'hidden'
    document.body.style.overscrollBehavior = 'none'
    de.style.overflow = 'hidden'
    de.style.overscrollBehavior = 'none'
    return () => {
      document.body.style.overflow = prevBody
      document.body.style.overscrollBehavior = prevBodyOverscroll
      de.style.overflow = prevDoc
      de.style.overscrollBehavior = prevDocOverscroll
    }
  }, [inputFocused, detailStoreId, searchProductOpen, settingsOpen, myProductsOpen])

  const applyStores = (data: unknown) => {
    const stores = parseStores(data)
    if (stores === null) {
      setStores([])
      setError('Neispravan odgovor servera.')
    } else {
      setStores(stores)
      setError(null)
    }
  }

  useEffect(() => {
    let alive = true
    fetch('/api/stores?is_active=true&only_opened=false')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((data) => {
        if (alive) applyStores(data)
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
      .then((data) => applyStores(data))
      .catch((err) => setError(err.message))
      .finally(() => setInvalidateSignal((n) => n + 1))
  }

  const didInitialFit = useRef(false)
  useEffect(() => {
    if (didInitialFit.current || stores.length === 0) return
    didInitialFit.current = true
    fitToTown(selectedTown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stores])

  const towns = Array.from(new Set(stores.map((s) => s.town))).sort()
  const hasRecentTowns = recentTowns.some((t) => towns.includes(t))
  const townListMaxHeight = Math.max(120, window.innerHeight - 140)

  function storesForTown(town: string): Store[] {
    return stores.filter((s) => s.town === town)
  }

  function fitToTown(town: string) {
    const townStores = storesForTown(town)
    if (townStores.length === 0) return
    const lats = townStores.map((s) => s.latitude)
    const lngs = townStores.map((s) => s.longitude)
    const bounds: [[number, number], [number, number]] = [
      [Math.min(...lats), Math.min(...lngs)],
      [Math.max(...lats), Math.max(...lngs)],
    ]
    requestSeq.current += 1
    setMapRequest({ seq: requestSeq.current, type: 'town', bounds })
  }

  function selectTown(town: string) {
    setSelectedTown(town)
    setSearchQuery(town)
    setTownSearchOpen(false)
    fitToTown(town)
    try {
      localStorage.setItem('lastTown', town)
    } catch {
    }
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

  const townStores = stores.filter((s) => s.town === selectedTown)
  const typeCounts: Record<string, number> = {}
  for (const s of townStores) {
    typeCounts[s.store_type] = (typeCounts[s.store_type] ?? 0) + 1
  }
  const filtered = townStores.filter((s) => selectedStoreType === null || s.store_type === selectedStoreType)
  const nowMinutes = useNowMinutes()

  function handleUseMyLocation() {
    const fallback = () => fitToTown(selectedTown)
    if (!navigator.geolocation) {
      fallback()
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude
        const lng = pos.coords.longitude
        setUserLocation([lat, lng])
        requestSeq.current += 1
        setMapRequest({ seq: requestSeq.current, type: 'location', lat, lng, radiusKm: LOCATION_RADIUS_KM })
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
              try {
                localStorage.setItem('lastTown', town)
              } catch {
              }
            }
          })
          .catch(() => {})
      },
      fallback,
      { timeout: 8000, maximumAge: 60000, enableHighAccuracy: false },
    )
  }

  useEffect(() => {
    const q = productSearchQuery.trim()
    const requestId = ++productSearchRequestRef.current
    const timer = window.setTimeout(
      () => {
        const params = new URLSearchParams()
        if (q) params.set('q', q)
        params.set('town', selectedTown)
        if (selectedStoreType) params.set('store_type', selectedStoreType)
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
            if (productSearchQueryRef.current !== q || requestId !== productSearchRequestRef.current) return
            setProductResults(data)
          })
          .catch(() => {
            if (productSearchQueryRef.current === q && requestId === productSearchRequestRef.current)
              setProductSearchError(true)
          })
          .finally(() => {
            if (productSearchQueryRef.current === q && requestId === productSearchRequestRef.current)
              setProductSearchLoading(false)
          })
      },
      q ? 300 : 0,
    )
    return () => window.clearTimeout(timer)
  }, [productSearchQuery, selectedTown, userLocation, invalidateSignal, selectedStoreType])

  function openProductFromSearch(result: ProductSearchResult) {
    requestSeq.current += 1
    setMapRequest({ seq: requestSeq.current, type: 'store', lat: result.latitude, lng: result.longitude })
    setSearchProductOpen({ productId: result.product_id, storeName: result.store_name })
  }

  function openStorePopup(storeId: string) {
    setDetailStoreId(null)
    setSearchProductOpen(null)
    setSheetExpanded(false)
    const s = stores.find((st) => st.id === storeId)
    if (s) {
      setSelectedStoreId(storeId)
      requestSeq.current += 1
      setMapRequest({ seq: requestSeq.current, type: 'focus', lat: s.latitude, lng: s.longitude })
    } else {
      setDetailStoreId(storeId)
    }
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
              radius={LOCATION_RADIUS_KM * 1000}
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

<div
        className={`pointer-events-auto absolute top-[18px] left-16 right-16 sm:left-1/2 sm:right-auto sm:w-auto sm:-translate-x-1/2 ${
          townSearchOpen ? 'z-[1610]' : 'z-[1000]'
        }`}
      >
        <div className="flex flex-col items-start gap-1">
        <div className="relative w-full max-w-sm sm:w-full sm:max-w-none">
          <div
            className={`fixed inset-0 z-[1599] transition-opacity duration-300 ${
              townSearchOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
            }`}
            onClick={() => setTownSearchOpen(false)}
          />
          <div
            className={`pointer-events-none absolute inset-x-0 top-full z-[1600] mt-1.5 overflow-hidden rounded-2xl border border-slate-200 bg-white opacity-0 shadow-2xl shadow-slate-900/10 transition-[max-height,opacity] duration-300 ease-out ${
              townSearchOpen ? 'pointer-events-auto opacity-100' : ''
            }`}
            style={{ maxHeight: townSearchOpen ? `${townListMaxHeight + 2}px` : '0px' }}
          >
            <ul
              role="listbox"
              onWheel={dismissKeyboard}
              onTouchMove={dismissKeyboard}
              className="divide-y divide-slate-100 overflow-y-auto overscroll-contain py-1"
              style={{ maxHeight: `${townListMaxHeight}px` }}
            >
              {hasRecentTowns && (
                <>
                  {recentTowns
                    .filter((t) => towns.includes(t))
                    .map((t) => (
                      <li key={t}>
                        <button
                          type="button"
                          {...tapHandlers(() => selectTown(t))}
                          onClick={() => selectTown(t)}
                          className="w-full px-4 py-3 text-left text-sm font-medium text-brand-600 hover:bg-brand-50 active:bg-brand-50"
                        >
                          {t}
                        </button>
                      </li>
                    ))}
                </>
              )}
              {towns
                .filter((t) => !recentTowns.includes(t))
                .map((t) => (
                  <li key={t}>
                    <button
                      type="button"
                      {...tapHandlers(() => selectTown(t))}
                      onClick={() => selectTown(t)}
                      className="w-full px-4 py-3 text-left text-sm font-medium text-slate-700 hover:bg-brand-50 active:bg-brand-50"
                    >
                      {t}
                    </button>
                  </li>
                ))}
            </ul>
          </div>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`pointer-events-none absolute top-1/2 right-3 z-[1900] h-5 w-5 -translate-y-1/2 text-brand-400 transition-transform duration-300 ${
              townSearchOpen ? 'rotate-180' : ''
            }`}
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
          <button
            type="button"
            onClick={() => setTownSearchOpen((v) => !v)}
            aria-haspopup="listbox"
            aria-expanded={townSearchOpen}
            className="relative z-[1800] w-full rounded-full border border-slate-200 bg-white py-2.5 pr-10 pl-4 text-left text-sm font-semibold text-slate-800 shadow-lg shadow-slate-900/5 outline-none"
          >
            {searchQuery || 'Pronađi grad...'}
          </button>
        </div>

        {error && <p className="text-center text-sm text-red-500">{error}</p>}

        {townStores.length > 0 && (
          <div
            className={`no-scrollbar -mx-16 mt-1.5 flex w-[calc(100%+8rem)] gap-1.5 overflow-x-auto px-4 pb-1 sm:mt-0 sm:mx-0 sm:w-auto sm:px-0 ${
              townSearchOpen || showHint ? 'invisible' : ''
            }`}
          >
            {(
              [
                { key: 'all', label: 'Sve', type: null },
                ...Object.entries(STORE_LABELS)
                  .map(([key, label]) => ({ key, label, type: key, count: typeCounts[key] ?? 0 }))
                  .sort((a, b) => b.count - a.count),
              ] as { key: string; label: string; type: string | null }[]
            ).map(({ key, label, type }) => {
              const active = selectedStoreType === type
              const count = type === null ? townStores.length : typeCounts[type] ?? 0
              const muted = count === 0 && !active
              return (
                <button
                  key={key}
                  type="button"
                  {...tapHandlers(() => setSelectedStoreType(active ? null : type))}
                  onClick={() => setSelectedStoreType(active ? null : type)}
                  className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition ${
                    active
                      ? 'border-brand-600 bg-brand-600 text-white'
                      : `border-slate-200 bg-white text-slate-700 ${muted ? 'opacity-45' : ''}`
                  }`}
                >
                  {type !== null && (
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: active ? '#ffffff' : STORE_COLORS[type] ?? '#78716c' }}
                    />
                  )}
                  {label}
                  <span className={`${active ? 'text-brand-100' : 'text-slate-400'}`}>· {count}</span>
                </button>
              )
            })}
          </div>
        )}
        </div>
      </div>

      <button
        type="button"
        onClick={handleUseMyLocation}
        title="Koristi moju lokaciju"
        className={`absolute top-[18px] right-4 z-[1001] flex h-11 w-11 items-center justify-center rounded-xl bg-white/95 shadow-lg backdrop-blur transition ${
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
        className="absolute top-[18px] left-4 z-[1001] flex h-11 w-11 items-center justify-center rounded-xl bg-white/95 text-slate-600 shadow-lg backdrop-blur transition hover:bg-brand-50"
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
      {showHint && !townSearchOpen && !inputFocused && productSearchQuery.length === 0 && (
        <div className="pointer-events-auto absolute top-20 left-1/2 z-[1002] w-[calc(100%-1.5rem)] max-w-sm -translate-x-1/2 sm:w-96">
          <div className="rounded-2xl bg-white/95 p-3.5 shadow-xl ring-1 ring-slate-900/5 backdrop-blur">
            <div className="flex items-center gap-2.5">
              <img src="/favicon.svg" alt="" className="h-9 w-9 shrink-0" />
              <p className="text-sm leading-tight font-extrabold text-slate-900">Ne bacaj hranu — spasi je u svom kraju.</p>
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
              Pronađi proizvode pred istek, poslednje komade i dnevni višak iz pekara, marketa i restorana — pre nego što završe u kanti.
            </p>
            <div className="mt-2.5 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  dismissHint()
                  setTownSearchOpen(true)
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
        expanded={sheetExpanded}
        onExpandedChange={setSheetExpanded}
      />
      {detailStoreId && <StoreDetail storeId={detailStoreId} onClose={() => setDetailStoreId(null)} onViewStore={openStorePopup} />}
      <SettingsMenu
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onOpenMyProducts={() => {
          setSettingsOpen(false)
          setMyProductsOpen(true)
        }}
      />
      {myProductsOpen && <MyProducts onClose={() => setMyProductsOpen(false)} onChanged={loadStores} />}
      {searchProductOpen && (
        <ProductDetail
          productId={searchProductOpen.productId}
          storeName={searchProductOpen.storeName}
          onBack={() => setSearchProductOpen(null)}
          onViewStore={openStorePopup}
        />
      )}
    </div>
  )
}

export default App
