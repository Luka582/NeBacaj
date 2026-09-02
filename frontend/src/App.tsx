import { useEffect, useState } from 'react'
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const CARTO_KEY = 'cb1_2szz_1_c12a73f13692e186652d59d9'
const DEFAULT_CENTER: [number, number] = [44.0165, 20.9]
const cartoUrl = `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=${CARTO_KEY}`

interface Config {
  STORES_RADIUS: number
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

function Recenter({ center, radiusKm }: { center: [number, number]; radiusKm: number }) {
  const map = useMap()
  useEffect(() => {
    const dLat = radiusKm / 111
    const dLng = radiusKm / (111 * Math.cos((center[0] * Math.PI) / 180))
    map.fitBounds([
      [center[0] - dLat, center[1] - dLng],
      [center[0] + dLat, center[1] + dLng],
    ])
  }, [center, radiusKm, map])
  return null
}

function App() {
  const [stores, setStores] = useState<Store[]>([])
  const [error, setError] = useState<string | null>(null)
  const [selectedTown, setSelectedTown] = useState<string>('Sve')
  const [radius, setRadius] = useState(50)

  useEffect(() => {
    fetch('/config.json')
      .then((r) => r.json())
      .then((data: Config) => setRadius(data.STORES_RADIUS))
      .catch(() => {})
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

  const filtered = selectedTown === 'Sve'
    ? stores
    : stores.filter((s) => s.town === selectedTown)

  const center: [number, number] = (() => {
    if (selectedTown === 'Sve' || filtered.length === 0) return DEFAULT_CENTER
    const avgLat = filtered.reduce((sum, s) => sum + s.latitude, 0) / filtered.length
    const avgLng = filtered.reduce((sum, s) => sum + s.longitude, 0) / filtered.length
    return [avgLat, avgLng]
  })()

  return (
    <div className="relative h-full w-full">
      <MapContainer
        center={DEFAULT_CENTER}
        zoom={7}
        className="z-0 h-full w-full"
        preferCanvas
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>'
          url={cartoUrl}
          subdomains="abcd"
          maxZoom={20}
        />
        <Recenter center={center} radiusKm={radius} />
        {filtered.map((store) => (
          <Marker
            key={store.id}
            position={[store.latitude, store.longitude]}
            icon={makePinIcon(store.store_type)}
          />
        ))}
      </MapContainer>

      <div className="pointer-events-auto absolute top-4 left-1/2 z-[1000] w-[92%] max-w-sm -translate-x-1/2">
        <div className="rounded-2xl bg-white/95 p-4 shadow-lg backdrop-blur">
          <div className="mb-3">
            <label htmlFor="town-select" className="mb-1 block text-xs font-medium text-slate-500">
              Izaberi grad
            </label>
            <select
              id="town-select"
              value={selectedTown}
              onChange={(e) => setSelectedTown(e.target.value)}
              className="w-full appearance-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            >
              <option value="Sve">Svi gradovi</option>
              {towns.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          {error ? (
            <p className="text-center text-sm text-red-500">{error}</p>
          ) : (
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-500">
                <span className="font-semibold text-slate-700">{filtered.length}</span> prodavnica
              </p>
              <div className="flex gap-2">
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
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default App
