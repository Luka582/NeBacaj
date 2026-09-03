import { useEffect, useState, useRef } from 'react'
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

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

function makePinIcon(type: string) {
  const color = STORE_COLORS[type] ?? '#6b7280'

  return L.divIcon({
    className: '',
    iconSize: [32, 44],
    iconAnchor: [16, 44],
    html: `
      <svg width="32" height="44" viewBox="0 0 32 44" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M16 0C7.163 0 0 7.163 0 16c0 12 16 28 16 28s16-16 16-28C32 7.163 24.837 0 16 0z"
              fill="${color}" fill-opacity="0.9" stroke="white" stroke-width="2"/>
        <circle cx="16" cy="14" r="7" fill="white" fill-opacity="0.9"/>
      </svg>
    `,
  })
}

type MapRequest =
  | { seq: number; type: 'location'; lat: number; lng: number; radiusKm: number }
  | { seq: number; type: 'town'; bounds: [[number, number], [number, number]] }

function MapController({ request }: { request: MapRequest | null }) {
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
    } else {
      map.fitBounds(request.bounds)
    }
  }, [request, map])
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

function App() {
  const [stores, setStores] = useState<Store[]>([])
  const [error, setError] = useState<string | null>(null)
  const [selectedTown, setSelectedTown] = useState<string>('Sve')
  const [searchQuery, setSearchQuery] = useState('')
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const [radius, setRadius] = useState(50)
  const [locationRadius, setLocationRadius] = useState(0.5)
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null)
  const [locationWarning, setLocationWarning] = useState<string | null>(null)
  const [warningLeaving, setWarningLeaving] = useState(false)
  const [mapRequest, setMapRequest] = useState<MapRequest | null>(null)
  const [recentTowns, setRecentTowns] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('recentTowns') || '[]')
    } catch {
      return []
    }
  })
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const requestSeq = useRef(0)

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
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

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

  function selectTown(town: string) {
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
        <MapController request={mapRequest} />
        {userLocation && (
          <Marker position={userLocation} icon={userLocationIcon} zIndexOffset={1000} />
        )}
        {filtered.map((store) => (
          <Marker
            key={store.id}
            position={[store.latitude, store.longitude]}
            icon={makePinIcon(store.store_type)}
          />
        ))}
      </MapContainer>

      <div className="pointer-events-auto absolute top-4 left-1/2 z-[1000] flex w-full -translate-x-1/2 flex-col items-center gap-2 sm:w-auto">
        <div className="w-[92%] max-w-sm rounded-2xl bg-white/95 p-3 shadow-lg backdrop-blur sm:max-w-none sm:w-96">
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
                  setSearchQuery(e.target.value)
                  setIsDropdownOpen(true)
                }}
                onFocus={() => {
                  setSearchQuery('')
                  setIsDropdownOpen(true)
                }}
                placeholder="Unesi naziv grada..."
                className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pr-10 pl-3 text-sm font-medium text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              />
              {isDropdownOpen && (
                <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                  <li>
                    <button
                      type="button"
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
        <div className="relative flex w-[92%] max-w-sm justify-end sm:hidden">
          <button
            type="button"
            onClick={handleUseMyLocation}
            title="Koristi moju lokaciju"
            className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/95 text-blue-600 shadow-lg backdrop-blur transition hover:bg-blue-50"
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
          {locationWarning && (
            <p
              className={`pointer-events-none absolute top-0 left-1/2 z-[1001] -translate-x-1/2 whitespace-nowrap rounded-lg bg-red-500 px-3 py-1 text-sm font-medium text-white shadow-lg transition-opacity duration-500 ${warningLeaving ? 'opacity-0' : 'opacity-100'}`}
            >
              {locationWarning}
            </p>
          )}
        </div>
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
        className="hidden h-12 w-12 items-center justify-center rounded-2xl bg-white/95 text-blue-600 shadow-lg backdrop-blur transition hover:bg-blue-50 sm:absolute sm:top-4 sm:right-4 sm:z-[1000] sm:flex"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-11 w-11"
        >
          <path d="M12 21s-7-5.2-7-11a7 7 0 0 1 14 0c0 5.8-7 11-7 11z" />
          <circle cx="12" cy="10" r="2.5" />
        </svg>
      </button>
    </div>
  )
}

export default App
