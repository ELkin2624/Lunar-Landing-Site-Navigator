import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Activity, ArrowDownRight, ArrowRight, ArrowUpRight, BatteryCharging, CalendarDays, Check, ChevronRight, CircleHelp, Clock3, Compass, Download, Earth, Gauge, GitCompareArrows, Layers3, MapPin, Menu, Moon, Play, Plus, Radio, Search, Settings2, ShieldCheck, Sparkles, Sun, Wifi, X, Zap } from 'lucide-react'
import { analyze, apiEnabled, askCopilot, exportScenarioCsv, fetchDataAvailability, fetchFootprint, fetchLinkBudget, fetchMissionDelta, fetchRankedSites, fetchSlope, parseNaturalConstraints, simulateCommsApi, type CopilotAskResult, type DataAvailability, type FootprintResult, type LinkBudgetInput, type LinkBudgetResult, type MissionDeltaResponse, type RankingResult, type SlopeResult } from './api'
import { COMMS_PRESETS, SITES, chartPath, computeCommsProfile, computePowerProfile, emptyScenario, formatHour, metrics, verdict, type CommsConfig, type PowerConfig, type Scenario, type Site } from './data'
import { coordinatesFromPolarMeters, isWithinPolarMap, polarMapCoordinates, polarMapPosition, polarMeters } from './polar'
import { LocalTileMap } from './LocalTileMap'
import { EducationView } from './education/EducationView'
import { MissionPlanningView } from './mission-planning/MissionPlanningView'
import { type ComparisonResults } from './mission-planning/comparison'
import { MissionResultsView } from './mission-results/MissionResultsView'
import { MissionDetailView } from './mission-detail/MissionDetailView'
import { IlluminationCalendarView } from './illumination-calendar/IlluminationCalendarView'
const Terrain3D = lazy(() => import('./Terrain3D').then(module => ({ default: module.Terrain3D })))
const OrbitalLoading = lazy(() => import('./OrbitalLoading').then(module => ({ default: module.OrbitalLoading })))

const initialDate = new Date().toISOString().slice(0, 10)

const VEHICLE_PRESETS: Record<string, { name: string; tag: string; config: PowerConfig }> = {
  viper: {
    name: 'Rover Polar (VIPER-class)',
    tag: '2.5 m² · 2.5 kWh · 120 W',
    config: { solarPanelAreaM2: 2.5, panelEfficiency: 0.30, baseLoadWatts: 120, batteryCapacityWh: 2500, initialSocPercent: 100, minAllowableSocPercent: 20 },
  },
  clps: {
    name: 'Lander CLPS Mediano',
    tag: '4.5 m² · 4.8 kWh · 210 W',
    config: { solarPanelAreaM2: 4.5, panelEfficiency: 0.30, baseLoadWatts: 210, batteryCapacityWh: 4800, initialSocPercent: 100, minAllowableSocPercent: 20 },
  },
  hab: {
    name: 'Torre Solar / Hab Artemis',
    tag: '18 m² · 24 kWh · 850 W',
    config: { solarPanelAreaM2: 18.0, panelEfficiency: 0.32, baseLoadWatts: 850, batteryCapacityWh: 24000, initialSocPercent: 100, minAllowableSocPercent: 25 },
  },
}

function LunarMap({ site, onSelect, onPick }: { site: Site; onSelect: (site: Site) => void; onPick: (latitude: number, longitude: number) => void }) {
  const [layer, setLayer] = useState<'lroc' | 'lola'>('lroc')
  const [zoom, setZoom] = useState(0)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [cursor, setCursor] = useState<string | null>(null)
  const dragStart = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null)
  const dragged = useRef(false)
  const mapRef = useRef<HTMLDivElement>(null)
  const [mapWidth, setMapWidth] = useState(420)
  useEffect(() => {
    const node = mapRef.current
    if (!node) return
    const observer = new ResizeObserver(() => setMapWidth(node.clientWidth))
    observer.observe(node)
    setMapWidth(node.clientWidth)
    return () => observer.disconnect()
  }, [])
  const spans = [384_000, 40_000, 8_000, 2_000]
  useEffect(() => { setPan({ x: 0, y: 0 }) }, [site.lat, site.lon])
  const siteCenter = polarMeters(site.lat, site.lon)
  const center = { x: siteCenter.x + pan.x, y: siteCenter.y + pan.y }
  const span = spans[zoom]
  const mapCoordinates = (horizontal: number, vertical: number) => zoom === 0 ? polarMapCoordinates(horizontal, vertical)
    : coordinatesFromPolarMeters(center.x + (horizontal - 0.5) * span, center.y - (vertical - 0.5) * span)
  const markerPosition = (latitude: number, longitude: number) => {
    if (zoom === 0) return polarMapPosition(latitude, longitude)
    const point = polarMeters(latitude, longitude)
    return { left: `${50 + (point.x - center.x) / span * 100}%`, top: `${50 - (point.y - center.y) / span * 100}%` }
  }
  const pick = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (dragged.current) { dragged.current = false; return }
    const bounds = event.currentTarget.getBoundingClientRect()
    const horizontal = event.detail === 0 ? 0.5 : (event.clientX - bounds.left) / bounds.width
    const vertical = event.detail === 0 ? 0.5 : (event.clientY - bounds.top) / bounds.height
    const coordinates = mapCoordinates(horizontal, vertical)
    onPick(Number(coordinates.latitude.toFixed(3)), Number(coordinates.longitude.toFixed(3)))
  }
  const movePointer = (event: React.PointerEvent<HTMLButtonElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const horizontal = (event.clientX - bounds.left) / bounds.width
    const vertical = (event.clientY - bounds.top) / bounds.height
    const coordinates = mapCoordinates(horizontal, vertical)
    if (Number.isFinite(coordinates.latitude)) setCursor(`${Math.abs(coordinates.latitude).toFixed(3)}° ${coordinates.latitude < 0 ? 'S' : 'N'} · ${Math.abs(coordinates.longitude).toFixed(3)}° ${coordinates.longitude < 0 ? 'O' : 'E'}`)
    if (dragStart.current && zoom > 0) {
      const start = dragStart.current
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) dragged.current = true
      if (dragged.current) setPan({ x: start.panX - (event.clientX - start.x) / bounds.width * span, y: start.panY + (event.clientY - start.y) / bounds.height * span })
    }
  }
  return <div className="moon-map" aria-label="Mapa lunar georreferenciado; pulse un lugar para analizarlo">
    <div ref={mapRef} className={`polar-map ${zoom ? 'local-map' : `${layer}-layer`}`}>
      {zoom > 0 && <LocalTileMap key={`${layer}-${zoom}-${site.lat}-${site.lon}`} layer={layer} centerX={center.x} centerY={center.y} viewWidthM={span}/>}
      <button className="map-pick-layer" type="button" onClick={pick} onPointerDown={event => { if (zoom > 0) { dragStart.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y }; event.currentTarget.setPointerCapture(event.pointerId) } }} onPointerMove={movePointer} onPointerUp={() => { dragStart.current = null }} onPointerLeave={() => setCursor(null)} aria-label="Elegir un punto del mapa para analizar; arrastra para mover el mapa" title="Pulsa para analizar · arrastra para mover"/>
      {zoom === 0 && <><div className="map-rings" /><div className="map-cross map-cross-x" /><div className="map-cross map-cross-y" /><span className="pole-label">90° S</span></>}
      {SITES.map((candidate, i) => <button key={candidate.id} className={`map-point ${site.id === candidate.id ? 'active' : ''}`} style={markerPosition(candidate.lat, candidate.lon)} onClick={() => onSelect(candidate)} aria-label={`Seleccionar ${candidate.name}`} title={`${candidate.name} · ${Math.abs(candidate.lat)}° S, ${candidate.lon}° E`}><span className="point-dot"/><span className="point-index">0{i + 1}</span></button>)}
      {site.id === 'custom' && <span className="map-custom-point" style={markerPosition(site.lat, site.lon)} aria-label="Punto personalizado seleccionado"/>}
    </div>
    <span className="map-coordinate">IAU2000::30120 · POLO SUR</span>
    <span className="map-compass">0° E <span>↑</span></span>
    <div className="map-layer-toggle" role="group" aria-label="Capa cartográfica"><button type="button" aria-pressed={layer === 'lroc'} className={layer === 'lroc' ? 'active' : ''} onClick={() => setLayer('lroc')}>LROC foto</button><button type="button" aria-pressed={layer === 'lola'} className={layer === 'lola' ? 'active' : ''} onClick={() => setLayer('lola')}>LOLA relieve</button></div>
    <div className="map-zoom" role="group" aria-label="Zoom del mapa"><button type="button" disabled={zoom === spans.length - 1} onClick={() => setZoom(value => Math.min(spans.length - 1, value + 1))} aria-label="Acercar mapa">+</button><button type="button" disabled={zoom === 0} onClick={() => setZoom(value => Math.max(0, value - 1))} aria-label="Alejar mapa">−</button></div>
    <div className="map-measure"><span className="map-measure-line"/><span>{(span * 100 / Math.max(mapWidth, 1) / 1000).toFixed(span < 8000 ? 2 : 1)} km</span></div>
    {cursor && <div className="map-cursor">{cursor}</div>}
    <div className="map-overlay"><span className="live-dot"/> {zoom ? `${span / 1000} KM DE ANCHO` : 'PULSA PARA ANALIZAR'} <span className="map-scale">{zoom ? layer === 'lroc' ? 'LROC NAC' : 'LOLA 5 M' : layer === 'lroc' ? 'WAC · SIN SOMBRAS POR FECHA' : 'LOLA DEM · 240 M/PX'}</span></div>
  </div>
}

function CoordinateForm({ site, onPick }: { site: Site; onPick: (latitude: number, longitude: number) => void }) {
  const [latitude, setLatitude] = useState(String(site.lat))
  const [longitude, setLongitude] = useState(String(site.lon))
  const [error, setError] = useState('')
  useEffect(() => { setLatitude(String(site.lat)); setLongitude(String(site.lon)); setError('') }, [site])
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const lat = Number(latitude)
    const lon = Number(longitude)
    if (!isWithinPolarMap(lat, lon)) { setError('Elige un punto dentro del mapa visible (polo sur, ±192 km).'); return }
    onPick(Number(lat.toFixed(3)), Number(lon.toFixed(3)))
  }
  return <form className="coordinate-form" onSubmit={submit}>
    <span className="coordinate-title">COORDENADAS DEL PUNTO</span>
    <label>Latitud <input type="number" min="-90" max="-75" step="0.001" value={latitude} onChange={event => setLatitude(event.target.value)} required aria-label="Latitud en grados, sur negativo"/></label>
    <label>Longitud <input type="number" min="-180" max="180" step="0.001" value={longitude} onChange={event => setLongitude(event.target.value)} required aria-label="Longitud en grados, este positivo"/></label>
    <button type="submit">Analizar</button>
    {error && <span className="coordinate-error" role="alert">{error}</span>}
  </form>
}

function Horizon({ scenario, hour }: { scenario: Scenario; hour: number }) {
  return scenario.horizonProfile ? <MeasuredHorizon scenario={scenario} hour={hour}/> : <p className="terrain-3d-message">Perfil LOLA no disponible.</p>
}

function VisibilityExplanation({ scenario, hour }: { scenario: Scenario; hour: number }) {
  const sample = scenario.samples[Math.min(hour, scenario.samples.length - 1)]
  const profile = scenario.horizonProfile || []
  const near = (azimuth: number | undefined) => azimuth == null ? undefined : profile.reduce((best, point) =>
    !best || Math.abs((point.azimuth - azimuth + 180) % 360 - 180) < Math.abs((best.azimuth - azimuth + 180) % 360 - 180) ? point : best, undefined as (typeof profile)[number] | undefined)
  const rows = [
    { name: 'Sol', elevation: sample.sunElevation, horizon: sample.horizonSun, azimuth: sample.sunAzimuth, visible: sample.sunVisible, disk: sample.sunDiskFraction },
    { name: 'Tierra', elevation: sample.earthElevation, horizon: sample.horizonEarth, azimuth: sample.earthAzimuth, visible: sample.earthVisible, disk: sample.earthDiskFraction },
  ]
  return <div className="visibility-explanation">{rows.map(row => {
    const obstacle = near(row.azimuth)
    const margin = row.elevation - row.horizon
    return <div key={row.name}>
      <strong>{row.name}: {row.visible ? 'sobre' : 'bajo'} el horizonte {Math.abs(margin).toFixed(1)}° {row.disk != null && row.disk > 0 && row.disk < 1 ? `· disco ${(row.disk * 100).toFixed(0)}%` : ''}</strong>
      <span>Elevación {row.elevation.toFixed(1)}° · relieve {row.horizon.toFixed(1)}° al azimut {row.azimuth?.toFixed(0)}°.</span>
      <span>{obstacle?.obstacleDistanceKm != null ? `Obstáculo dominante a ${obstacle.obstacleDistanceKm.toFixed(2)} km · LOLA ${obstacle.obstaclePixelScaleM} m/px.` : 'Obstáculo no identificado en este perfil.'}</span>
    </div>
  })}</div>
}

function MeasuredHorizon({ scenario, hour }: { scenario: Scenario; hour: number }) {
  const sample = scenario.samples[Math.min(hour, scenario.samples.length - 1)]
  const profile = scenario.horizonProfile!
  const elevations = profile.map(point => point.elevation)
  const minElevation = Math.floor(Math.min(-5, sample.sunElevation, sample.earthElevation, ...elevations) - 1)
  const maxElevation = Math.ceil(Math.max(8, sample.sunElevation, sample.earthElevation, ...elevations) + 1)
  const x = (azimuth: number) => azimuth / 360 * 700
  const y = (elevation: number) => 170 - (elevation - minElevation) / (maxElevation - minElevation) * 145
  const skyline = [...profile, { azimuth: 360, elevation: profile[0].elevation }]
  const line = skyline.map((point, index) => `${index ? 'L' : 'M'}${x(point.azimuth).toFixed(1)} ${y(point.elevation).toFixed(1)}`).join(' ')
  const terrain = `${line} L700 210 L0 210 Z`
  const sunX = x(sample.sunAzimuth ?? 0)
  const earthX = x(sample.earthAzimuth ?? 0)
  const sunY = y(sample.sunElevation)
  const earthY = y(sample.earthElevation)
  return <div className="horizon-wrap">
    <svg className="horizon-svg" viewBox="0 0 700 210" role="img" aria-label="Perfil del horizonte LOLA en 360 grados con posiciones del Sol y la Tierra calculadas por JPL Horizons">
      <defs><linearGradient id="measuredSky" x2="0" y2="1"><stop stopColor="#112741"/><stop offset="1" stopColor="#19212b"/></linearGradient><linearGradient id="measuredTerrain" x2="0" y2="1"><stop stopColor="#8a9196"/><stop offset="1" stopColor="#26333e"/></linearGradient></defs>
      <rect width="700" height="210" fill="url(#measuredSky)"/>
      <line x1="0" x2="700" y1={y(0)} y2={y(0)} stroke="#e8f0f5" strokeOpacity=".55" strokeDasharray="5 6"/>
      <text x="8" y={Math.max(12, y(0) - 5)} fill="#c2cbd2" fontSize="10">0°</text>
      <path d={terrain} fill="url(#measuredTerrain)"/><path d={line} fill="none" stroke="#d1d9db" strokeWidth="1.5"/>
      <circle cx={sunX} cy={sunY} r="13" fill="#f7cc79" opacity={sample.sunVisible ? 1 : .4}/>
      <circle cx={sunX} cy={sunY} r="20" fill="none" stroke="#f7cc79" opacity={sample.sunVisible ? .6 : .3}/>
      <circle cx={earthX} cy={earthY} r="9" fill="#75bbd3" opacity={sample.earthVisible ? 1 : .4}/>
      <circle cx={earthX} cy={earthY} r="15" fill="none" stroke="#75bbd3" opacity={sample.earthVisible ? .7 : .3}/>
      <text x={Math.min(630, sunX + 12)} y={Math.max(14, sunY - 12)} fill="#ffe0a5" fontSize="11">SOL</text>
      <text x={Math.min(625, earthX + 12)} y={Math.max(14, earthY - 12)} fill="#acd8e7" fontSize="11">TIERRA</text>
      {['N', 'E', 'S', 'O', 'N'].map((direction, index) => <text key={index} x={Math.max(5, Math.min(685, index * 175))} y="199" fill="#e5edf1" fontSize="10">{direction}</text>)}
    </svg>
    <div className="horizon-legend"><span><i className="dot amber"/> Sol {sample.sunElevation.toFixed(1)}° · {sample.sunAzimuth?.toFixed(0)}° az</span><span><i className="dot blue"/> Tierra {sample.earthElevation.toFixed(1)}° · {sample.earthAzimuth?.toFixed(0)}° az</span><span><i className="dot grey"/> Horizonte {scenario.provenance?.terrainSources.includes('LDEM_875S_20M') ? 'LOLA 20m + 240m' : 'LOLA 240m'}</span></div>
  </div>
}

function Timeline({ scenario, hour, onHourChange }: { scenario: Scenario; hour: number; onHourChange: (sampleIndex: number) => void }) {
  const totalSamples = Math.max(1, scenario.samples.length - 1)
  const width = 600
  const startMs = Date.parse(scenario.start + 'T00:00:00Z')
  const events = scenario.events || []
  const bracketMin = scenario.provenance?.transitionUncertaintyMinutes ?? 60
  const bucketSize = Math.max(1, Math.ceil(scenario.samples.length / 180))
  const buckets = useMemo(() => {
    const out: { idx: number; hourOffset: number; sun: boolean; earth: boolean }[] = []
    for (let i = 0; i < scenario.samples.length; i += bucketSize) {
      const slice = scenario.samples.slice(i, i + bucketSize)
      const sunAvg = slice.filter(s => s.sunVisible).length / slice.length
      const earthAvg = slice.filter(s => s.earthVisible).length / slice.length
      out.push({
        idx: i,
        hourOffset: scenario.samples[i].hourOffset ?? scenario.samples[i].hour,
        sun: sunAvg >= 0.5,
        earth: earthAvg >= 0.5,
      })
    }
    return out
  }, [scenario.samples, bucketSize])

  const closestSampleIndex = (targetHourOffset: number) => {
    let bestIdx = 0
    let bestDiff = Infinity
    for (let i = 0; i < scenario.samples.length; i++) {
      const off = scenario.samples[i].hourOffset ?? scenario.samples[i].hour
      const d = Math.abs(off - targetHourOffset)
      if (d < bestDiff) { bestDiff = d; bestIdx = i }
    }
    return bestIdx
  }

  return <div className="timeline-body">
    <div className="timeline-row"><span className="timeline-name"><Sun size={15}/> Sol</span><div className="segments">{buckets.map(b => <span key={b.idx} style={{ background: b.sun ? '#e8b96e' : '#263241' }} onClick={() => onHourChange(b.idx)} title={`H+${b.hourOffset.toFixed(1)}h · Sol ${b.sun ? 'visible' : 'oculto'}`}/>)}</div><strong>{metrics(scenario).sunPercent}%</strong></div>
    <div className="timeline-row"><span className="timeline-name"><Earth size={15}/> Tierra</span><div className="segments">{buckets.map(b => <span key={b.idx} style={{ background: b.earth ? '#74b9d1' : '#263241' }} onClick={() => onHourChange(b.idx)} title={`H+${b.hourOffset.toFixed(1)}h · Tierra ${b.earth ? 'visible' : 'oculta'}`}/>)}</div><strong>{metrics(scenario).earthPercent}%</strong></div>
    <div className="timeline-chart"><svg viewBox={`0 0 ${width} 64`} preserveAspectRatio="none" aria-label="Elevación del Sol y de la Tierra a lo largo del periodo"><line x1="0" y1="43" x2={width} y2="43" stroke="#627082" strokeDasharray="4 5"/><path d={chartPath(scenario.samples.map(s => s.sunElevation), width, 60, -5, 12)} fill="none" stroke="#e7b76d" strokeWidth="2"/><path d={chartPath(scenario.samples.map(s => s.earthElevation), width, 60, -5, 12)} fill="none" stroke="#79bdd3" strokeWidth="2"/><line className="chart-cursor-line" x1={Math.min(hour, totalSamples) / totalSamples * width} x2={Math.min(hour, totalSamples) / totalSamples * width} y1="0" y2="64" stroke="#eaf0f4" strokeWidth="1.5"/></svg></div>
    <input className="time-slider" aria-label="Muestra temporal de simulación" type="range" min="0" max={totalSamples} value={Math.min(hour, totalSamples)} onChange={e => onHourChange(Number(e.target.value))}/>
    <div className="timeline-labels"><span>{formatHour(scenario.start, 0)}</span><span>{formatHour(scenario.start, scenario.hours / 2)}</span><span>{formatHour(scenario.start, scenario.hours)}</span></div>
    {events.length > 0 ? <div className="transition-events-bar" aria-label="Transiciones detectadas e intervalo de incertidumbre">
      <span className="transition-tag">TRANSICIONES (±{(bracketMin / 2).toFixed(bracketMin % 2 ? 1 : 0)} min)</span>
      <div className="transition-pills">
        {events.slice(0, 8).map((ev, idx) => {
          const estHourRaw = Math.max(0, Math.min(scenario.hours, (Date.parse(ev.estimatedTimeUtc) - startMs) / 3600000))
          const estIdx = closestSampleIndex(estHourRaw)
          const bStart = ev.bracketStartUtc.slice(11, 16)
          const bEnd = ev.bracketEndUtc.slice(11, 16)
          const label = ev.kind === 'sun_visibility_start' ? 'Amanecer' : ev.kind === 'sun_visibility_end' ? 'Ocaso solar' : ev.kind === 'earth_visibility_start' ? 'Enlace Tierra' : 'Pérdida Tierra'
          return <button key={idx} type="button" className={`transition-pill ${ev.kind.startsWith('sun') ? 'sun-ev' : 'earth-ev'}`} onClick={() => onHourChange(estIdx)} title={`Saltar a H+${estHourRaw.toFixed(1)}h · Ventana de transición UTC [${bStart} – ${bEnd})`}>
            <strong>{label}</strong> <span>H+{estHourRaw.toFixed(1)}h [{bStart}–{bEnd}]</span>
          </button>
        })}
      </div>
    </div> : <div className="transition-events-bar"><span className="transition-tag">TRANSICIONES</span><small className="no-transitions">Estado constante en toda la ventana de {scenario.hours} h (muestreo cada {bracketMin} min)</small></div>}
  </div>
}

function MetricCard({ icon, label, value, suffix, color, detail, badge }: { icon: React.ReactNode; label: string; value: number; suffix: string; color: string; detail: string; badge?: string }) {
  return <div className="metric-card">
    <div className="metric-top"><span className={`metric-icon ${color}`}>{icon}</span>{badge ? <span className="metric-range-badge" title="Rango en ±240 m alrededor del punto">{badge}</span> : <ArrowUpRight size={15}/>}</div>
    <div className="metric-value">{value}<small>{suffix}</small></div>
    <div className="metric-label">{label}</div>
    <div className="metric-detail">{detail}</div>
  </div>
}

function MissionOperationsDeck({
  scenario, date, hour, onHourChange, minSun, minEarth, maxBlackout, slope, onPickCoordinate, onApplyConstraints, externalTab,
}: {
  scenario: Scenario; date: string; hour: number; onHourChange: (h: number) => void
  minSun: number; minEarth: number; maxBlackout: number; slope: SlopeResult | null
  onPickCoordinate: (lat: number, lon: number) => void
  onApplyConstraints: (c: { minSunPercent?: number; minEarthPercent?: number; maxBlackoutHours?: number }) => void
  externalTab?: 'power' | 'comms' | 'delta' | 'copilot' | null
}) {
  const [deckTab, setDeckTab] = useState<'power' | 'comms' | 'delta' | 'copilot'>('power')
  useEffect(() => {
    if (externalTab) setDeckTab(externalTab)
  }, [externalTab])

  // --- Power & Battery state ---
  const [presetKey, setPresetKey] = useState<string>('viper')
  const [powerConfig, setPowerConfig] = useState<PowerConfig>(VEHICLE_PRESETS.viper.config)
  const selectPreset = (key: string) => {
    setPresetKey(key)
    setPowerConfig(VEHICLE_PRESETS[key].config)
  }
  const powerResult = useMemo(() => computePowerProfile(scenario, powerConfig), [scenario, powerConfig])
  const currentPowerStep = powerResult.steps[Math.min(hour, Math.max(0, powerResult.steps.length - 1))]

  // --- Comms & Data Downlink state ---
  const [commsPresetKey, setCommsPresetKey] = useState<string>('xband_lander')
  const [commsConfig, setCommsConfig] = useState<CommsConfig>(COMMS_PRESETS.xband_lander.config)
  const [commsApiSynced, setCommsApiSynced] = useState(false)
  const [linkBudgetInput, setLinkBudgetInput] = useState<LinkBudgetInput>({ frequencyGhz: 8.4, rangeKm: 384400,
    spacecraftEirpDbw: 30, groundStationGtDbk: 50, targetRateMbps: 10, otherLossesDb: 3,
    requiredEbn0Db: 4, implementationLossDb: 2 })
  const [linkBudget, setLinkBudget] = useState<LinkBudgetResult | null>(null)
  const [linkBudgetError, setLinkBudgetError] = useState<string | null>(null)
  const selectCommsPreset = (key: string) => {
    setCommsPresetKey(key)
    setCommsConfig(COMMS_PRESETS[key].config)
  }
  const commsResult = useMemo(() => computeCommsProfile(scenario, commsConfig), [scenario, commsConfig])
  const currentCommsStep = commsResult.steps[Math.min(hour, Math.max(0, commsResult.steps.length - 1))]
  useEffect(() => {
    if (deckTab !== 'comms' || !apiEnabled) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setLinkBudget(null)
      fetchLinkBudget({ ...linkBudgetInput, targetRateMbps: commsConfig.peakDownlinkMbps }, controller.signal)
        .then(result => { setLinkBudget(result); setLinkBudgetError(null) })
        .catch(error => { if (!controller.signal.aborted) setLinkBudgetError(String(error)) })
    }, 250)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [deckTab, linkBudgetInput, commsConfig.peakDownlinkMbps])

  useEffect(() => {
    if (deckTab !== 'comms' || !apiEnabled || scenario.source !== 'api') {
      setCommsApiSynced(false)
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(() => {
      simulateCommsApi(scenario.site, date, commsConfig, {
        hours: scenario.hours,
        stepMinutes: scenario.stepMinutes,
        refineTransitions: scenario.refineTransitions,
      }, controller.signal)
        .then(() => { if (!controller.signal.aborted) setCommsApiSynced(true) })
        .catch(() => { if (!controller.signal.aborted) setCommsApiSynced(false) })
    }, 260)
    return () => { clearTimeout(timer); controller.abort() }
  }, [deckTab, scenario.site, scenario.source, scenario.hours, scenario.stepMinutes, scenario.refineTransitions, date, commsConfig])

  // --- Mission Delta state ---
  const [delayDays, setDelayDays] = useState(0)
  const [delayHours, setDelayHours] = useState(0)
  const [dispMeters, setDispMeters] = useState(240)
  const [dispAzimuth, setDispAzimuth] = useState(90)
  const [deltaRes, setDeltaRes] = useState<MissionDeltaResponse | null>(null)
  const [deltaLoading, setDeltaLoading] = useState(false)
  const [deltaError, setDeltaError] = useState<string | null>(null)

  useEffect(() => {
    if (deckTab !== 'delta' || !apiEnabled) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      setDeltaLoading(true)
      setDeltaError(null)
      fetchMissionDelta(
        scenario.site, date, delayDays, delayHours, dispMeters, dispAzimuth,
        { minSunPercent: minSun, minEarthPercent: minEarth, maxBlackoutHours: maxBlackout },
        controller.signal,
      ).then(res => {
        setDeltaRes(res)
        setDeltaLoading(false)
      }).catch(err => {
        if (controller.signal.aborted) return
        setDeltaError(String(err))
        setDeltaLoading(false)
      })
    }, 280)
    return () => { clearTimeout(timer); controller.abort() }
  }, [deckTab, scenario.site, date, delayDays, delayHours, dispMeters, dispAzimuth, minSun, minEarth, maxBlackout])

  // --- Copilot state ---
  const [nlPrompt, setNlPrompt] = useState('')
  const [nlFeedback, setNlFeedback] = useState<string | null>(null)
  const [focusTopic, setFocusTopic] = useState<'global' | 'energy' | 'comm' | 'terrain'>('global')
  const [chatQuery, setChatQuery] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)
  const [chatAnswer, setChatAnswer] = useState<CopilotAskResult | null>(null)

  const handleAskSubmit = async (queryText: string) => {
    const q = queryText.trim()
    if (!q) return
    setChatQuery(q)
    setChatLoading(true)
    setChatError(null)
    try {
      const res = await askCopilot(scenario.site, date, q, {
        hours: scenario.hours,
        stepMinutes: scenario.stepMinutes,
        refineTransitions: scenario.refineTransitions,
        constraints: { minSunPercent: minSun, minEarthPercent: minEarth, maxBlackoutHours: maxBlackout },
      })
      setChatAnswer(res)
    } catch (err) {
      setChatError(`Error al consultar el copiloto: ${String(err)}`)
    } finally {
      setChatLoading(false)
    }
  }

  const handleNlSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!nlPrompt.trim()) return
    try {
      const parsed = await parseNaturalConstraints(nlPrompt)
      const applied: string[] = []
      if (parsed.minSunPercent != null) applied.push(`Sol ≥ ${parsed.minSunPercent}%`)
      if (parsed.minEarthPercent != null) applied.push(`Tierra ≥ ${parsed.minEarthPercent}%`)
      if (parsed.maxBlackoutHours != null) applied.push(`Blackout ≤ ${parsed.maxBlackoutHours}h`)
      if (applied.length > 0) {
        onApplyConstraints(parsed)
        setNlFeedback(`Restricciones actualizadas: ${applied.join(' · ')}`)
      } else {
        setNlFeedback('Usa expresiones como: "al menos 60% de sol y máximo 12 horas de blackout"')
      }
    } catch {
      setNlFeedback('No se pudo procesar la restricción en el servidor.')
    }
  }

  const m = metrics(scenario)
  const sp = scenario.provenance?.spatialUncertainty

  return <section className="panel ops-deck-panel" aria-label="Consola interactiva de ingeniería de misión">
    <div className="ops-deck-header">
      <div>
        <span className="section-kicker">06 / INGENIERÍA Y SIMULACIÓN DE MISIÓN</span>
        <h2>Simulador de subsistemas y sensibilidad</h2>
      </div>
      <div className="ops-deck-tabs" role="tablist" aria-label="Módulos de ingeniería">
        <button type="button" role="tab" aria-selected={deckTab === 'power'} className={deckTab === 'power' ? 'active' : ''} onClick={() => setDeckTab('power')}>
          <BatteryCharging size={15}/> Energía y Batería <span className={`ops-badge ${powerResult.survivesMission ? (powerResult.criticalThresholdBreached ? 'warn' : 'ok') : 'crit'}`}>{powerResult.minSocPercent.toFixed(0)}% mín</span>
        </button>
        <button type="button" role="tab" aria-selected={deckTab === 'comms'} className={deckTab === 'comms' ? 'active' : ''} onClick={() => setDeckTab('comms')}>
          <Wifi size={15}/> Datos y enlace hipotético <span className={`ops-badge ${commsResult.totalDroppedGb > 0 ? 'crit' : 'warn'}`}>{commsResult.totalDownlinkedGb.toFixed(0)} GB</span>
        </button>
        <button type="button" role="tab" aria-selected={deckTab === 'delta'} className={deckTab === 'delta' ? 'active' : ''} onClick={() => setDeckTab('delta')}>
          <GitCompareArrows size={15}/> Mission Delta (Desvío / Retraso)
        </button>
        <button type="button" role="tab" aria-selected={deckTab === 'copilot'} className={deckTab === 'copilot' ? 'active' : ''} onClick={() => setDeckTab('copilot')}>
          <Sparkles size={15}/> Diagnóstico y Reglas NL
        </button>
      </div>
    </div>

    {deckTab === 'power' && <div className="ops-tab-body power-grid">
      <div className="power-controls">
        <div className="preset-bar" role="group" aria-label="Perfiles de vehículo">
          {Object.entries(VEHICLE_PRESETS).map(([key, item]) => (
            <button key={key} type="button" className={presetKey === key ? 'active' : ''} onClick={() => selectPreset(key)}>
              <strong>{item.name}</strong>
              <span>{item.tag}</span>
            </button>
          ))}
        </div>
        <div className="power-sliders">
          <label>
            <span>Área solar vertical <strong>{powerConfig.solarPanelAreaM2.toFixed(1)} m²</strong></span>
            <input type="range" min="0.5" max="25" step="0.5" value={powerConfig.solarPanelAreaM2} onChange={e => { setPresetKey('custom'); setPowerConfig(c => ({ ...c, solarPanelAreaM2: Number(e.target.value) })) }}/>
          </label>
          <label>
            <span>Capacidad batería <strong>{(powerConfig.batteryCapacityWh / 1000).toFixed(1)} kWh</strong></span>
            <input type="range" min="500" max="30000" step="500" value={powerConfig.batteryCapacityWh} onChange={e => { setPresetKey('custom'); setPowerConfig(c => ({ ...c, batteryCapacityWh: Number(e.target.value) })) }}/>
          </label>
          <label>
            <span>Consumo continuo <strong>{powerConfig.baseLoadWatts} W</strong></span>
            <input type="range" min="40" max="1200" step="20" value={powerConfig.baseLoadWatts} onChange={e => { setPresetKey('custom'); setPowerConfig(c => ({ ...c, baseLoadWatts: Number(e.target.value) })) }}/>
          </label>
          <label>
            <span>Pérdidas por polvo, temperatura y orientación <strong>{Math.round((1 - (powerConfig.solarDerateFactor ?? 0.8)) * 100)}%</strong></span>
            <input type="range" min="0.4" max="1" step="0.05" value={powerConfig.solarDerateFactor ?? 0.8} onChange={e => { setPresetKey('custom'); setPowerConfig(c => ({ ...c, solarDerateFactor: Number(e.target.value) })) }}/>
          </label>
          <label>
            <span>Calefacción adicional en sombra <strong>{powerConfig.shadowHeaterWatts ?? 0} W</strong></span>
            <input type="range" min="0" max="500" step="10" value={powerConfig.shadowHeaterWatts ?? 0} onChange={e => { setPresetKey('custom'); setPowerConfig(c => ({ ...c, shadowHeaterWatts: Number(e.target.value) })) }}/>
          </label>
        </div>
        <div className="power-kpis">
          <div><small>ESTADO MISIÓN</small><strong className={powerResult.survivesMission ? (powerResult.criticalThresholdBreached ? 'txt-warn' : 'txt-ok') : 'txt-crit'}>{powerResult.survivesMission ? (powerResult.criticalThresholdBreached ? 'Reserva tocada' : 'Nominal') : 'Batería agotada'}</strong></div>
          <div><small>SOC MÍN / FINAL</small><strong>{powerResult.minSocPercent}% / {powerResult.finalSocPercent}%</strong></div>
          <div><small>AUTONOMÍA EN SOMBRA</small><strong>{powerResult.blackoutHoursSupported} h <small>(noche: {m.longestDark} h)</small></strong></div>
          <div><small>BALANCE {Math.max(1, Math.round(scenario.hours / 24))} DÍAS</small><strong>+{powerResult.totalEnergyGeneratedKwh} / −{powerResult.totalEnergyConsumedKwh} kWh</strong></div>
        </div>
      </div>

      <div className="power-chart-box">
        <div className="power-chart-head">
          <span>CURVA DE BATERÍA (SoC %) · H+{(currentPowerStep?.hour ?? 0).toFixed(1)}h</span>
          {currentPowerStep && <span className="power-instant">Generación: <strong>{currentPowerStep.powerGeneratedW} W</strong> · Neto: <strong>{currentPowerStep.netPowerW > 0 ? `+${currentPowerStep.netPowerW}` : currentPowerStep.netPowerW} W</strong> · SoC: <strong>{currentPowerStep.socPercent}%</strong></span>}
        </div>
        <div className="power-svg-wrap" onClick={e => {
          const rect = e.currentTarget.getBoundingClientRect()
          const maxIdx = Math.max(0, powerResult.steps.length - 1)
          const idx = Math.round(((e.clientX - rect.left) / rect.width) * maxIdx)
          onHourChange(Math.max(0, Math.min(maxIdx, idx)))
        }}>
          <svg viewBox="0 0 600 130" preserveAspectRatio="none" aria-label="Curva de estado de carga de batería del 0 al 100 por ciento">
            <defs>
              <linearGradient id="socFill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={powerResult.survivesMission ? '#7fd5b4' : '#f18c8e'} stopOpacity="0.38"/>
                <stop offset="100%" stopColor="#142232" stopOpacity="0.05"/>
              </linearGradient>
            </defs>
            {/* Reserve threshold line */}
            <line x1="0" x2="600" y1={124 - (powerConfig.minAllowableSocPercent / 100) * 114} y2={124 - (powerConfig.minAllowableSocPercent / 100) * 114} stroke="#e5a95c" strokeDasharray="4 4" strokeWidth="1"/>
            <text x="6" y={120 - (powerConfig.minAllowableSocPercent / 100) * 114} fill="#e5a95c" fontSize="9">Reserva {powerConfig.minAllowableSocPercent}%</text>
            {powerResult.steps.length > 1 && <>
              <path d={`${chartPath(powerResult.steps.map(s => s.socPercent), 600, 118, 0, 100)} L600,125 L0,125 Z`} fill="url(#socFill)"/>
              <path d={chartPath(powerResult.steps.map(s => s.socPercent), 600, 118, 0, 100)} fill="none" stroke={powerResult.survivesMission ? '#7fd5b4' : '#f18c8e'} strokeWidth="2.2"/>
            </>}
            <line x1={(Math.min(hour, Math.max(1, powerResult.steps.length - 1)) / Math.max(1, powerResult.steps.length - 1)) * 600} x2={(Math.min(hour, Math.max(1, powerResult.steps.length - 1)) / Math.max(1, powerResult.steps.length - 1)) * 600} y1="0" y2="130" stroke="#f0c88d" strokeWidth="1.5"/>
          </svg>
        </div>
        <p className="power-caption">{powerResult.summary} Modelo preliminar: panel vertical orientado al Sol (1361 W/m², eficiencia {(powerConfig.panelEfficiency * 100).toFixed(0)}%), fracción visible del disco, factor de pérdidas {powerConfig.solarDerateFactor ?? 0.8} y eficiencia de batería 90%. Los perfiles son ejemplos configurables, no especificaciones oficiales de vehículos.</p>
      </div>
    </div>}

    {deckTab === 'comms' && <div className="ops-tab-body power-grid">
      <div className="power-controls">
        <div className="preset-bar" role="group" aria-label="Perfiles de radioenlace">
          {Object.entries(COMMS_PRESETS).map(([key, item]) => (
            <button key={key} type="button" className={commsPresetKey === key ? 'active' : ''} onClick={() => selectCommsPreset(key)}>
              <strong>{item.name}</strong>
              <span>{item.tag}</span>
            </button>
          ))}
        </div>
        <div className="power-sliders">
          <label>
            <span>Tasa pico supuesta (Banda {commsConfig.band}) <strong>{commsConfig.peakDownlinkMbps} Mbps</strong></span>
            <input type="range" min="1" max="100" step="0.5" value={commsConfig.peakDownlinkMbps} onChange={e => { setCommsPresetKey('custom'); setCommsConfig(c => ({ ...c, peakDownlinkMbps: Number(e.target.value) })) }}/>
          </label>
          <label>
            <span>Ciencia generada / día <strong>{commsConfig.dailyDataGenerationGb} GB/d</strong></span>
            <input type="range" min="1" max="120" step="1" value={commsConfig.dailyDataGenerationGb} onChange={e => { setCommsPresetKey('custom'); setCommsConfig(c => ({ ...c, dailyDataGenerationGb: Number(e.target.value) })) }}/>
          </label>
          <label>
            <span>Grabadora SSR / despeje <strong>{commsConfig.bufferCapacityGb} GB · ≥{commsConfig.minGrazingDeg}°</strong></span>
            <input type="range" min="4" max="256" step="4" value={commsConfig.bufferCapacityGb} onChange={e => { setCommsPresetKey('custom'); setCommsConfig(c => ({ ...c, bufferCapacityGb: Number(e.target.value) })) }}/>
          </label>
        </div>
        <div className="power-kpis">
          <div><small>COLA CON TASA SUPUESTA</small><strong className={commsResult.totalDroppedGb > 0 ? 'txt-crit' : 'txt-warn'}>{commsResult.totalDroppedGb > 0 ? 'Pérdida de Datos' : 'Sin desborde simulado'}</strong></div>
          <div><small>BAJADA / GENERADO</small><strong>{commsResult.totalDownlinkedGb} / {commsResult.totalGeneratedGb} GB</strong></div>
          <div><small>PICO BUFFER SSR</small><strong>{commsResult.peakBufferGb} GB <small>({commsResult.peakBufferPercent}%)</small></strong></div>
          <div><small>TASA MEDIA / NOMINAL</small><strong>{commsResult.averageEffectiveMbps} Mbps · {commsResult.nominalLinkPercent}%</strong></div>
        </div>
      </div>

      <div className="power-chart-box">
        <div className="power-chart-head">
          <span>COLA SSR (%) Y TASA EFECTIVA · H+{(currentCommsStep?.hour ?? 0).toFixed(1)}h {commsApiSynced ? '· API OK' : ''}</span>
          {currentCommsStep && <span className="power-instant">Tasa: <strong>{currentCommsStep.effectiveRateMbps} Mbps</strong> ({currentCommsStep.linkState === 'nominal' ? 'Nominal' : currentCommsStep.linkState === 'degraded' ? `Rasante ${currentCommsStep.clearanceDeg}°` : 'Oculto'}) · SSR: <strong>{currentCommsStep.bufferGb} GB ({currentCommsStep.bufferFillPercent}%)</strong></span>}
        </div>
        <div className="power-svg-wrap" onClick={e => {
          const rect = e.currentTarget.getBoundingClientRect()
          const maxIdx = Math.max(0, commsResult.steps.length - 1)
          const idx = Math.round(((e.clientX - rect.left) / rect.width) * maxIdx)
          onHourChange(Math.max(0, Math.min(maxIdx, idx)))
        }}>
          <svg viewBox="0 0 600 130" preserveAspectRatio="none" aria-label="Curva de llenado de buffer SSR y tasa efectiva de enlace terrestre">
            <defs>
              <linearGradient id="ssrFill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={commsResult.totalDroppedGb > 0 ? '#f18c8e' : '#7aa7ff'} stopOpacity="0.34"/>
                <stop offset="100%" stopColor="#142232" stopOpacity="0.04"/>
              </linearGradient>
            </defs>
            <line x1="0" x2="600" y1={124 - 0.85 * 114} y2={124 - 0.85 * 114} stroke="#e5a95c" strokeDasharray="4 4" strokeWidth="1"/>
            <text x="6" y={120 - 0.85 * 114} fill="#e5a95c" fontSize="9">Alerta SSR 85%</text>
            {commsResult.steps.length > 1 && <>
              <path d={`${chartPath(commsResult.steps.map(s => s.bufferFillPercent), 600, 118, 0, 100)} L600,125 L0,125 Z`} fill="url(#ssrFill)"/>
              <path d={chartPath(commsResult.steps.map(s => s.bufferFillPercent), 600, 118, 0, 100)} fill="none" stroke={commsResult.totalDroppedGb > 0 ? '#f18c8e' : '#7aa7ff'} strokeWidth="2.1"/>
              <path d={chartPath(commsResult.steps.map(s => s.effectiveRateMbps), 600, 118, 0, Math.max(1, commsConfig.peakDownlinkMbps))} fill="none" stroke="#7fd5b4" strokeDasharray="3 2" strokeWidth="1.6"/>
            </>}
            <line x1={(Math.min(hour, Math.max(1, commsResult.steps.length - 1)) / Math.max(1, commsResult.steps.length - 1)) * 600} x2={(Math.min(hour, Math.max(1, commsResult.steps.length - 1)) / Math.max(1, commsResult.steps.length - 1)) * 600} y1="0" y2="130" stroke="#f0c88d" strokeWidth="1.5"/>
          </svg>
        </div>
        <div className="link-budget-panel">
          <h3>Presupuesto de enlace editable</h3>
          <p>Valores de ejemplo, no especificaciones de una estación DSN asignada. La cola anterior supone tasa pico continua cuando el centro de la Tierra supera el despeje elegido.</p>
          <div className="link-budget-fields">
            <label>EIRP nave (dBW)<input type="number" min="-50" max="100" step="1" value={linkBudgetInput.spacecraftEirpDbw} onChange={e => setLinkBudgetInput(v => ({ ...v, spacecraftEirpDbw: Number(e.target.value) }))}/></label>
            <label>G/T estación (dB/K)<input type="number" min="-30" max="100" step="1" value={linkBudgetInput.groundStationGtDbk} onChange={e => setLinkBudgetInput(v => ({ ...v, groundStationGtDbk: Number(e.target.value) }))}/></label>
            <label>Frecuencia (GHz)<input type="number" min="0.1" max="40" step="0.1" value={linkBudgetInput.frequencyGhz} onChange={e => setLinkBudgetInput(v => ({ ...v, frequencyGhz: Number(e.target.value) }))}/></label>
            <label>Pérdidas extra (dB)<input type="number" min="0" max="50" step="0.5" value={linkBudgetInput.otherLossesDb} onChange={e => setLinkBudgetInput(v => ({ ...v, otherLossesDb: Number(e.target.value) }))}/></label>
          </div>
          {linkBudget ? <p><strong>Margen a {commsConfig.peakDownlinkMbps} Mbps: {linkBudget.marginDb.toFixed(1)} dB</strong> · tasa máxima calculada: {linkBudget.maxRateMbpsAtRequiredMargin.toFixed(2)} Mbps. {linkBudget.targetRateSupported ? 'La tasa cabe en el presupuesto supuesto.' : 'La tasa supera el presupuesto supuesto.'}</p> : <p>{linkBudgetError || 'Calculando margen…'}</p>}
          <p>Sin agenda de estación, apuntamiento, clima, codificación y pruebas de radio no se puede certificar un enlace operativo.</p>
        </div>
        <p className="power-caption">Línea azul: ocupación SSR con la tasa supuesta; verde: tasa potencial modulada por despeje geométrico. El presupuesto de enlace es una comprobación separada.</p>
      </div>
    </div>}

    {deckTab === 'delta' && <div className="ops-tab-body delta-grid">
      <div className="delta-controls">
        <p className="delta-intro">Evalúa en tiempo real con JPL Horizons y LOLA qué ocurre si el alunizaje se retrasa o cae desplazado respecto a <strong>{scenario.site.name}</strong>.</p>
        <div className="power-sliders">
          <label>
            <span>Retraso de misión (días) <strong>+{delayDays} d ({delayDays * 24 + delayHours} h)</strong></span>
            <input type="range" min="0" max="14" step="1" value={delayDays} onChange={e => setDelayDays(Number(e.target.value))}/>
          </label>
          <label>
            <span>Horas adicionales <strong>+{delayHours} h</strong></span>
            <input type="range" min="0" max="23" step="1" value={delayHours} onChange={e => setDelayHours(Number(e.target.value))}/>
          </label>
          <label>
            <span>Desplazamiento del aterrizaje <strong>{dispMeters} m</strong></span>
            <input type="range" min="0" max="3000" step="60" value={dispMeters} onChange={e => setDispMeters(Number(e.target.value))}/>
          </label>
          <label>
            <span>Rumbo del desvío (0°=N, 90°=E, 180°=S, 270°=O) <strong>{dispAzimuth}°</strong></span>
            <input type="range" min="0" max="345" step="15" value={dispAzimuth} onChange={e => setDispAzimuth(Number(e.target.value))}/>
          </label>
        </div>
      </div>

      <div className="delta-results">
        {deltaLoading ? <div className="delta-loading">Recalculando horizonte LOLA y efemérides Horizons para el escenario desplazado…</div> : deltaError ? <div className="delta-loading">{deltaError}</div> : deltaRes ? <>
          <div className="delta-header-bar">
            <span className={`delta-risk-pill risk-${deltaRes.riskLevel.toLowerCase()}`}>RIESGO {deltaRes.riskLevel === 'LOW' ? 'BAJO' : deltaRes.riskLevel === 'MODERATE' ? 'MODERADO' : 'CRÍTICO'}</span>
            <span className="delta-coords">Nuevo punto: {Math.abs(deltaRes.rescheduledSite.latitudeDeg).toFixed(3)}° S · {deltaRes.rescheduledSite.longitudeDeg.toFixed(3)}° E</span>
            {dispMeters > 0 && <button type="button" className="outline-button compact-btn" onClick={() => onPickCoordinate(Number(deltaRes.rescheduledSite.latitudeDeg.toFixed(3)), Number(deltaRes.rescheduledSite.longitudeDeg.toFixed(3)))}>Ir a este punto <ArrowUpRight size={13}/></button>}
          </div>
          <div className="delta-cards-row">
            <div className="delta-stat">
              <small>LUZ SOLAR</small>
              <strong>{deltaRes.rescheduledMetrics.sunPercent}% <em className={deltaRes.metrics.deltaSunlitPercent >= 0 ? 'pos' : 'neg'}>{deltaRes.metrics.deltaSunlitPercent >= 0 ? `+${deltaRes.metrics.deltaSunlitPercent}` : deltaRes.metrics.deltaSunlitPercent}%</em></strong>
              <span>Base: {m.sunPercent}%</span>
            </div>
            <div className="delta-stat">
              <small>ENLACE TIERRA</small>
              <strong>{deltaRes.rescheduledMetrics.earthPercent}% <em className={deltaRes.metrics.deltaEarthVisiblePercent >= 0 ? 'pos' : 'neg'}>{deltaRes.metrics.deltaEarthVisiblePercent >= 0 ? `+${deltaRes.metrics.deltaEarthVisiblePercent}` : deltaRes.metrics.deltaEarthVisiblePercent}%</em></strong>
              <span>Base: {m.earthPercent}%</span>
            </div>
            <div className="delta-stat">
              <small>OSCURIDAD MÁX</small>
              <strong>{deltaRes.rescheduledMetrics.longestDark} h <em className={deltaRes.metrics.deltaLongestDarknessHours <= 0 ? 'pos' : 'neg'}>{deltaRes.metrics.deltaLongestDarknessHours > 0 ? `+${deltaRes.metrics.deltaLongestDarknessHours}` : deltaRes.metrics.deltaLongestDarknessHours} h</em></strong>
              <span>Base: {m.longestDark} h</span>
            </div>
            <div className="delta-stat">
              <small>BLACKOUT MÁX</small>
              <strong>{deltaRes.rescheduledMetrics.longestBlackout} h <em className={deltaRes.metrics.deltaLongestBlackoutHours <= 0 ? 'pos' : 'neg'}>{deltaRes.metrics.deltaLongestBlackoutHours > 0 ? `+${deltaRes.metrics.deltaLongestBlackoutHours}` : deltaRes.metrics.deltaLongestBlackoutHours} h</em></strong>
              <span>Base: {m.longestBlackout} h</span>
            </div>
          </div>
          <div className="delta-notes">
            <strong>{deltaRes.impacts[0]}</strong>
            <span>{deltaRes.recommendations[0]}</span>
          </div>
        </> : null}
      </div>
    </div>}

    {deckTab === 'copilot' && <div className="ops-tab-body copilot-grid">
      <div className="copilot-diagnosis">
        <div className="copilot-topic-pills" role="group" aria-label="Enfoque del diagnóstico científico">
          <button type="button" className={focusTopic === 'global' ? 'active' : ''} onClick={() => setFocusTopic('global')}>Síntesis Operativa</button>
          <button type="button" className={focusTopic === 'energy' ? 'active' : ''} onClick={() => setFocusTopic('energy')}>Energía y Noche</button>
          <button type="button" className={focusTopic === 'comm' ? 'active' : ''} onClick={() => setFocusTopic('comm')}>Enlace Directo DSN</button>
          <button type="button" className={focusTopic === 'terrain' ? 'active' : ''} onClick={() => setFocusTopic('terrain')}>Incertidumbre Topográfica</button>
        </div>
        <div className="copilot-card">
          {focusTopic === 'global' && <>
            <strong>{scenario.site.name} ({date} · {scenario.hours} h): {m.sunPercent >= minSun && m.earthPercent >= minEarth && m.longestBlackout <= maxBlackout ? 'Escenario conforme con umbrales' : 'Requiere mitigación operativa'}</strong>
            <p>Disponibilidad solar del <strong>{m.sunPercent}%</strong>, visibilidad terrestre del <strong>{m.earthPercent}%</strong> y simultaneidad Sol+Tierra del <strong>{m.concurrentPercent}%</strong> para actividades EVA y descarga científica.</p>
          </>}
          {focusTopic === 'energy' && <>
            <strong>Supervivencia a {m.longestDark} h de oscuridad continua</strong>
            <p>Con el perfil <em>{VEHICLE_PRESETS[presetKey]?.name || 'Personalizado'}</em> ({powerConfig.baseLoadWatts} W y {(powerConfig.batteryCapacityWh / 1000).toFixed(1)} kWh), el SoC mínimo es <strong>{powerResult.minSocPercent}%</strong>. {powerResult.survivesMission ? 'El margen energético cubre los periodos de sombra topográfica.' : 'Se requiere hibernación nocturna o calefactores de radioisótopos (RHU).'}</p>
          </>}
          {focusTopic === 'comm' && <>
            <strong>Visibilidad directa hacia la Tierra: {m.earthPercent}% (apagón máx. {m.longestBlackout} h)</strong>
            <p>{m.earthPercent >= 70 ? 'Línea de vista directa robusta en banda X/Ka sin depender de relé orbital continuo.' : 'La libración lunar y las crestas locales bloquean la Tierra; se recomienda relé orbital polar durante las ocultaciones.'}</p>
          </>}
          {focusTopic === 'terrain' && <>
            <strong>Procedencia: {scenario.provenance?.terrainSources.join(' + ') || 'LOLA DEM'} · Pendiente {slope ? `${slope.slopeDeg.toFixed(1)}° (P90 ${slope.neighborhood.p90Deg.toFixed(1)}°, ${slope.pixelScaleM} m/px)` : 'regional'}</strong>
            <p>{sp ? `En ±${sp.radiusM} m la iluminación varía entre ${sp.sunlitPercentRange[0]}% y ${sp.sunlitPercentRange[1]}%, y Tierra entre ${sp.earthVisiblePercentRange[0]}% y ${sp.earthVisiblePercentRange[1]}%.` : 'El horizonte combina LOLA 20 m cercano y 240 m lejano.'} No certifica ausencia de rocas menores que la malla.</p>
          </>}
        </div>
        <form className="copilot-chat-box" onSubmit={e => { e.preventDefault(); handleAskSubmit(chatQuery) }}>
          <label htmlFor="copilot-ask-input">CONSULTA ABIERTA AL COPILOTO (/api/v1/copilot/ask)</label>
          <div className="nl-input-row">
            <input id="copilot-ask-input" type="text" value={chatQuery} onChange={e => setChatQuery(e.target.value)} placeholder="Pregunta sobre incertidumbre, transiciones, relieve 20m, energía o comunicación..."/>
            <button type="submit" className="primary-button" disabled={chatLoading || !chatQuery.trim()}>{chatLoading ? 'Analizando…' : 'Preguntar'}</button>
          </div>
          <div className="nl-presets">
            <button type="button" onClick={() => handleAskSubmit('¿Cuál es la incertidumbre espacial y temporal?')}>Incertidumbre</button>
            <button type="button" onClick={() => handleAskSubmit('¿Cuándo ocurren las próximas ventanas y transiciones?')}>Transiciones</button>
            <button type="button" onClick={() => handleAskSubmit('¿Cómo afecta el relieve DEM 20m y la pendiente?')}>Relieve 20 m</button>
            <button type="button" onClick={() => handleAskSubmit('¿Hay riesgo térmico o de sombra parcial?')}>Energía / disco parcial</button>
          </div>
          {chatError && <small className="nl-feedback txt-crit">{chatError}</small>}
          {chatAnswer && <div className="copilot-chat-answer" role="status">
            <strong>{chatAnswer.verdict}</strong>
            <p>{chatAnswer.directAnswer || chatAnswer.scientificExplanation}</p>
            {chatAnswer.suggestedActions.length > 0 && <small>Acción sugerida: {chatAnswer.suggestedActions[0]}</small>}
          </div>}
        </form>
      </div>

      <form className="copilot-nl-box" onSubmit={handleNlSubmit}>
        <label htmlFor="nl-constraints">CONFIGURAR RESTRICCIONES EN LENGUAJE NATURAL</label>
        <div className="nl-input-row">
          <input id="nl-constraints" type="text" value={nlPrompt} onChange={e => setNlPrompt(e.target.value)} placeholder="Ej: Al menos 65% de sol y máximo 10 horas de blackout..."/>
          <button type="submit" className="primary-button">Aplicar</button>
        </div>
        <div className="nl-presets">
          <span>Ejemplos rápidos:</span>
          <button type="button" onClick={() => setNlPrompt('Al menos 70% de sol y máximo 8 horas de blackout')}>Misión solar exigente (≥70% sol, ≤8h blackout)</button>
          <button type="button" onClick={() => setNlPrompt('Al menos 80% de tierra y máximo 4 horas de apagón')}>Enlace directo continuo (≥80% Tierra)</button>
        </div>
        {nlFeedback && <small className="nl-feedback">{nlFeedback}</small>}
      </form>
    </div>}
  </section>
}

async function downloadBackendCsv(
  scenario: Scenario,
  constraints: { minSunPercent: number; minEarthPercent: number; maxBlackoutHours: number },
) {
  const blob = await exportScenarioCsv(scenario.site, scenario.start, {
    hours: scenario.hours,
    stepMinutes: scenario.stepMinutes,
    refineTransitions: scenario.refineTransitions,
    constraints,
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `lunarpath-${scenario.site.id}-${scenario.start}-${scenario.hours}h.csv`
  link.click()
  URL.revokeObjectURL(url)
}

function RegionalSlopeCard({ slope, error, baselinePixels, onBaselineChange, thresholdDeg, onThresholdChange }: {
  slope: SlopeResult | null; error: string | null; baselinePixels: 1 | 2 | 4
  onBaselineChange: (baseline: 1 | 2 | 4) => void; thresholdDeg: number; onThresholdChange: (threshold: number) => void
}) {
  const within = slope?.thresholdStatus === 'at_or_below_user_threshold'
  const scaleM = slope?.pixelScaleM ?? 240
  return <section className="panel slope-panel" aria-label="Evaluación regional preliminar de pendiente LOLA">
    <div className="panel-heading">
      <div><span className="section-kicker">07 / RELIEVE REGIONAL LOLA</span><h2>Pendiente regional multiescala</h2></div>
      <span className="period-label">DEM LOLA · {scaleM} m/px · Horn 3×3</span>
    </div>
    <div className="slope-controls">
      <label className="slope-threshold-control">Umbral de comparación configurable: <strong>{thresholdDeg}°</strong>
        <input type="range" min="2" max="30" step="1" value={thresholdDeg} onChange={e => onThresholdChange(Number(e.target.value))} aria-label="Umbral de pendiente configurable en grados"/>
      </label>
      <div className="slope-scale-buttons" role="group" aria-label="Escala base de cálculo de pendiente">
        {([1, 2, 4] as const).map(px => <button key={px} type="button" className={baselinePixels === px ? 'active' : ''} onClick={() => onBaselineChange(px)}>{px * scaleM} m ({px} px)</button>)}
      </div>
    </div>
    {slope ? <>
      <div className="slope-summary-grid">
        <div className="slope-stat">
          <small>PENDIENTE EN CELDA ({slope.baselineM.toFixed(0)} m)</small>
          <strong>{slope.slopeDeg.toFixed(2)}°</strong>
          <span>{slope.aspectDeg == null ? 'Terreno plano en esta escala' : `Caída hacia ${slope.aspectDeg.toFixed(0)}° az`}</span>
        </div>
        <div className="slope-stat">
          <small>ENTORNO REGIONAL (RADIO {slope.neighborhood.radiusM.toFixed(0)} m · {slope.neighborhood.cells} CELDAS)</small>
          <strong>Media {slope.neighborhood.meanDeg.toFixed(1)}° · P90 {slope.neighborhood.p90Deg.toFixed(1)}°</strong>
          <span>Máx {slope.neighborhood.maxDeg.toFixed(1)}° · {slope.neighborhood.fractionAboveThreshold != null ? `${(slope.neighborhood.fractionAboveThreshold * 100).toFixed(0)}% > ${thresholdDeg}°` : ''}</span>
        </div>
        <div className="slope-stat">
          <small>COMPARACIÓN CON UMBRAL DE USUARIO ({thresholdDeg}°)</small>
          <strong className={within ? 'slope-within' : 'slope-exceeds'}>{within ? `≤ ${thresholdDeg}° en escala ${slope.baselineM.toFixed(0)} m` : `> ${thresholdDeg}° en escala ${slope.baselineM.toFixed(0)} m`}</strong>
          <span>Paso real de malla: {slope.groundSpacingM.toFixed(1)} m (resolución {scaleM} m/px)</span>
        </div>
        <div className="slope-stat">
          <small>MULTIESCALA ({scaleM} / {scaleM * 2} / {scaleM * 4} m)</small>
          <strong>{slope.multiscale.map(item => `${item.slopeDeg.toFixed(1)}°`).join(' · ')}</strong>
          <span>Sensibilidad al suavizado de grilla</span>
        </div>
      </div>
    </> : <p className="slope-unavailable">{error || 'Activa el backend con el DEM LOLA (VITE_USE_API=true) para calcular la pendiente regional.'}</p>}
    <p className="slope-disclaimer">
      <strong>Nota científica:</strong> Evaluación regional preliminar sobre LOLA {scaleM} m/px{slope?.source ? ` (${slope.source})` : ''}. No resuelve cráteres locales ni rocas menores a {scaleM} m, y ningún punto se etiqueta como «aterrizaje seguro».
    </p>
  </section>
}

const shiftDateUtc = (isoDate: string, days: number) => {
  const t = Date.parse(`${isoDate}T00:00:00Z`)
  return Number.isNaN(t) ? isoDate : new Date(t + days * 86400000).toISOString().slice(0, 10)
}

const TOUR_STEPS = [
  {
    title: 'Paso 1/4 · Relieve híbrido 20 m + 240 m',
    desc: 'Cargamos de Gerlache Rim 2 (−88.3° S): usa LOLA 20 m/px en los primeros 5 km y 240 m para crestas lejanas.',
  },
  {
    title: 'Paso 2/4 · Transiciones 5 min y sensibilidad del DEM',
    desc: 'Activamos muestreo fino (±2.5 min) y probamos cambios ±240 m y una banda vertical supuesta del DEM. La banda no es un intervalo de confianza calibrado.',
  },
  {
    title: 'Paso 3/4 · Energía y Enlace DSN / Datos',
    desc: 'Evaluamos autonomía solar y capacidad de retorno científico en Banda X/Ka modulada por disco visible terrestre.',
  },
  {
    title: 'Paso 4/4 · Comparación Multi-sitio / Fechas y Ranking',
    desc: 'Contrastamos 3 candidatos en fechas distintas con detección automática de empates dentro de la tolerancia espacial.',
  },
]

export default function App() {
  const [site, setSite] = useState(SITES[0])
  const [customSite, setCustomSite] = useState<Site | null>(null)
  const [date, setDate] = useState(initialDate)
  const [scenario, setScenario] = useState<Scenario>(() => emptyScenario(SITES[0], initialDate))
  const [hour, setHour] = useState(48)
  const [durationHours, setDurationHours] = useState<24 | 72 | 168 | 336>(168)
  const [stepMinutes, setStepMinutes] = useState<60 | 30 | 15>(60)
  const [refineTransitions, setRefineTransitions] = useState(false)
  const [csvExporting, setCsvExporting] = useState(false)
  const [mode, setMode] = useState<'explorer' | 'analyst'>('explorer')
  const [tab, setTab] = useState<'overview' | 'compare'>('overview')
  const [started, setStarted] = useState(false)
  const pageTitle = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (started) pageTitle.current?.focus({ preventScroll: true })
  }, [started])
  const [leaving, setLeaving] = useState(false)
  const [entering, setEntering] = useState(false)
  const leaveTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(leaveTimer.current), [])
  useEffect(() => {
    if (!entering || !started) return
    const timer = window.setTimeout(() => setEntering(false), 1000)
    return () => window.clearTimeout(timer)
  }, [entering, started])
  const [planningOpen, setPlanningOpen] = useState(false)
  const [resultsOpen, setResultsOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [detailScenario, setDetailScenario] = useState<Scenario | null>(null)
  const [missionResults, setMissionResults] = useState<ComparisonResults | null>(null)
  const [compareId, setCompareId] = useState(SITES[1].id)
  const [compareDateB, setCompareDateB] = useState(initialDate)
  const [compareCEnabled, setCompareCEnabled] = useState(false)
  const [compareIdC, setCompareIdC] = useState(SITES[2].id)
  const [compareDateC, setCompareDateC] = useState(() => shiftDateUtc(initialDate, 14))
  const [tourStep, setTourStep] = useState<number | null>(null)
  const [deckOverrideTab, setDeckOverrideTab] = useState<'power' | 'comms' | 'delta' | 'copilot' | null>(null)
  const [search, setSearch] = useState('')
  const [minSun, setMinSun] = useState(45)
  const [minEarth, setMinEarth] = useState(60)
  const [maxBlackout, setMaxBlackout] = useState(24)
  const [slopeThreshold, setSlopeThreshold] = useState(15)
  const [slopeBaseline, setSlopeBaseline] = useState<1 | 2 | 4>(1)
  const [slope, setSlope] = useState<SlopeResult | null>(null)
  const [comparedSlope, setComparedSlope] = useState<SlopeResult | null>(null)
  const [comparedSlopeC, setComparedSlopeC] = useState<SlopeResult | null>(null)
  const [slopeError, setSlopeError] = useState<string | null>(null)
  const [footprintM, setFootprintM] = useState(20)
  const [footprint, setFootprint] = useState<FootprintResult | null>(null)
  const [footprintError, setFootprintError] = useState<string | null>(null)
  const [dataAvailability, setDataAvailability] = useState<DataAvailability | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [apiError, setApiError] = useState<string | null>(null)
  const [compareError, setCompareError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)

  // Theme state (dark/light)
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try { return localStorage.getItem('lunarpath-theme') === 'dark' ? 'dark' : 'light' } catch { return 'light' }
  })
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    try { localStorage.setItem('lunarpath-theme', theme) } catch {}
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', !started || theme === 'light' ? '#f3f6fc' : '#080d17')
  }, [theme, started])

  // Ranking state in Compare tab
  const [rankWeights, setRankWeights] = useState({ sun: 0.40, earth: 0.30, concurrent: 0.15, darknessPenalty: 0.10, blackoutPenalty: 0.05 })
  const [rankingResult, setRankingResult] = useState<RankingResult | null>(null)
  const [rankingLoading, setRankingLoading] = useState(false)

  const selectSite = (candidate: Site) => {
    if (candidate.lat !== site.lat || candidate.lon !== site.lon) {
      setLoading(true)
      setApiError(null)
      setSite(candidate)
    }
    setTab('overview')
    setPlanningOpen(false)
    setResultsOpen(false)
    setDetailOpen(false)
    setSidebarOpen(false)
  }
  const selectDate = (nextDate: string) => {
    setLoading(true)
    setApiError(null)
    setDate(nextDate)
  }
  const pickCoordinate = (latitude: number, longitude: number) => {
    const candidate: Site = { id: 'custom', name: 'Punto personalizado', region: 'Coordenada seleccionada', lat: latitude, lon: longitude, note: 'Coordenada exploratoria sobre relieve LOLA; no es un sitio aprobado' }
    setCustomSite(candidate)
    selectSite(candidate)
  }
  const changeDuration = (nextHours: 24 | 72 | 168 | 336) => {
    setDurationHours(nextHours)
    if (nextHours === 336 && stepMinutes !== 60) setStepMinutes(60)
    else if (nextHours === 168 && stepMinutes === 15) setStepMinutes(30)
  }
  useEffect(() => {
    if (!started) return
    const controller = new AbortController()
    setLoading(true)
    setApiError(null)
    analyze(site, date, controller.signal, {
      hours: durationHours,
      stepMinutes,
      refineTransitions,
      refinementStepMinutes: 5,
    }).then(result => {
      setScenario(result)
      setHour(Math.floor((result.samples.length - 1) * 0.28))
      setLoading(false)
    }).catch(error => {
      if (controller.signal.aborted) return
      setApiError(`No se pudo consultar el backend: ${String(error)}`)
      setLoading(false)
    })
    return () => controller.abort()
  }, [started, site, date, durationHours, stepMinutes, refineTransitions, retry])
  useEffect(() => {
    if (!started) return
    if (!apiEnabled) { setSlope(null); setSlopeError(null); return }
    const controller = new AbortController()
    setSlopeError(null)
    fetchSlope(site, slopeBaseline, 1000, slopeThreshold, controller.signal).then(setSlope).catch(err => {
      if (controller.signal.aborted) return
      setSlope(null)
      setSlopeError(`Pendiente no disponible: ${String(err)}`)
    })
    return () => controller.abort()
  }, [started, site, slopeBaseline, slopeThreshold])
  useEffect(() => {
    if (!started || !apiEnabled) return
    const controller = new AbortController()
    setFootprint(null)
    setFootprintError(null)
    fetchFootprint(site, footprintM, slopeThreshold, 0.5, controller.signal).then(setFootprint).catch(error => {
      if (!controller.signal.aborted) setFootprintError(String(error))
    })
    return () => controller.abort()
  }, [started, site, footprintM, slopeThreshold])
  useEffect(() => {
    if (!started) return
    const controller = new AbortController()
    fetchDataAvailability(controller.signal).then(setDataAvailability).catch(() => setDataAvailability(null))
    return () => controller.abort()
  }, [started, retry])
  useEffect(() => {
    if (compareId === site.id && compareDateB === date) {
      setCompareId(SITES.find(s => s.id !== site.id)!.id)
    }
  }, [compareId, compareDateB, date, site.id])
  const m = useMemo(() => metrics(scenario), [scenario])
  const status = verdict(m, minSun, minEarth, maxBlackout)
  const [comparedState, setCompared] = useState<Scenario>(() => emptyScenario(SITES[1], initialDate))
  const [comparedCState, setComparedC] = useState<Scenario>(() => emptyScenario(SITES[2], initialDate))
  useEffect(() => {
    if (!started || tab !== 'compare') return
    const controller = new AbortController()
    const comparisonSite = SITES.find(s => s.id === compareId) || (compareId === customSite?.id && customSite) || SITES[1]
    setCompareError(null)
    analyze(comparisonSite, compareDateB, controller.signal, {
      hours: durationHours,
      stepMinutes,
      refineTransitions,
      refinementStepMinutes: 5,
    }).then(setCompared).catch(error => {
      if (controller.signal.aborted) return
      setCompareError(`No se pudo analizar ${comparisonSite.name}: ${String(error)}`)
    })
    return () => controller.abort()
  }, [started, compareId, compareDateB, customSite, tab, durationHours, stepMinutes, refineTransitions, retry])
  useEffect(() => {
    if (!started || tab !== 'compare' || !compareCEnabled) return
    const controller = new AbortController()
    const siteC = SITES.find(s => s.id === compareIdC) || SITES[2]
    analyze(siteC, compareDateC, controller.signal, {
      hours: durationHours,
      stepMinutes,
      refineTransitions,
      refinementStepMinutes: 5,
    }).then(setComparedC).catch(error => {
      if (controller.signal.aborted) return
      setCompareError(`No se pudo analizar ${siteC.name}: ${String(error)}`)
    })
    return () => controller.abort()
  }, [started, compareCEnabled, compareIdC, compareDateC, tab, durationHours, stepMinutes, refineTransitions, retry])
  useEffect(() => {
    if (!started || !apiEnabled || tab !== 'compare') { setComparedSlope(null); setComparedSlopeC(null); return }
    const controller = new AbortController()
    const comparisonSite = SITES.find(s => s.id === compareId) || (compareId === customSite?.id && customSite) || SITES[1]
    fetchSlope(comparisonSite, slopeBaseline, 1000, slopeThreshold, controller.signal).then(setComparedSlope).catch(() => {
      if (!controller.signal.aborted) setComparedSlope(null)
    })
    if (compareCEnabled) {
      const siteC = SITES.find(s => s.id === compareIdC) || SITES[2]
      fetchSlope(siteC, slopeBaseline, 1000, slopeThreshold, controller.signal).then(setComparedSlopeC).catch(() => {
        if (!controller.signal.aborted) setComparedSlopeC(null)
      })
    } else {
      setComparedSlopeC(null)
    }
    return () => controller.abort()
  }, [started, compareId, compareCEnabled, compareIdC, customSite, slopeBaseline, slopeThreshold, tab])

  useEffect(() => {
    if (!started || !apiEnabled || tab !== 'compare') return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      setRankingLoading(true)
      fetchRankedSites(
        SITES.slice(0, 5), date, rankWeights,
        { minSunPercent: minSun, minEarthPercent: minEarth, maxBlackoutHours: maxBlackout },
        controller.signal,
      ).then(res => {
        setRankingResult(res)
        setRankingLoading(false)
      }).catch(() => {
        if (!controller.signal.aborted) setRankingLoading(false)
      })
    }, 250)
    return () => { clearTimeout(timer); controller.abort() }
  }, [started, tab, date, rankWeights, minSun, minEarth, maxBlackout])

  const compared = comparedState
  const comparedC = comparedCState
  const compareMetrics = metrics(compared)
  const compareMetricsC = metrics(comparedC)
  const noticeError = apiError || (tab === 'compare' ? compareError : null)
  const primaryReady = scenario.source === 'api' && scenario.site.lat === site.lat && scenario.site.lon === site.lon && scenario.start === date && !loading && !apiError
  const comparisonReadyB = compared.source === 'api' && compared.site.id === compareId && compared.start === compareDateB && !compareError
  const comparisonReadyC = !compareCEnabled || (comparedC.source === 'api' && comparedC.site.id === compareIdC && comparedC.start === compareDateC && !compareError)
  const comparisonReady = tab !== 'compare' || (comparisonReadyB && comparisonReadyC)
  const ready = primaryReady && comparisonReady
  const analysisLoading = loading || (tab === 'compare' && !comparisonReady && !compareError)
  const overviewLoading = !calendarOpen && !detailOpen && !resultsOpen && !planningOpen && !ready && analysisLoading
  const filteredSites = SITES.filter(s => s.name.toLowerCase().includes(search.toLowerCase()) || s.region.toLowerCase().includes(search.toLowerCase()))
  const currentSample = scenario.samples[Math.min(hour, Math.max(0, scenario.samples.length - 1))]
  const currentHourOffset = currentSample ? (currentSample.hourOffset ?? currentSample.hour) : 0
  const spA = scenario.provenance?.spatialUncertainty
  const spB = compared.provenance?.spatialUncertainty
  const spC = comparedC.provenance?.spatialUncertainty
  const commsA = useMemo(() => computeCommsProfile(scenario, COMMS_PRESETS.xband_lander.config), [scenario])
  const commsB = useMemo(() => computeCommsProfile(compared, COMMS_PRESETS.xband_lander.config), [compared])
  const commsC = useMemo(() => computeCommsProfile(comparedC, COMMS_PRESETS.xband_lander.config), [comparedC])

  const applyTourStep = (stepIdx: number) => {
    setTourStep(stepIdx)
    const gerlache = SITES.find(s => s.id === 'gerlache') || SITES[2]
    const mouton = SITES.find(s => s.id === 'mouton') || SITES[0]
    const ridge = SITES.find(s => s.id === 'connecting-ridge') || SITES[4]
    if (stepIdx === 0) {
      setTab('overview')
      setDeckOverrideTab('power')
      setSite(gerlache)
      setDurationHours(168)
      setStepMinutes(60)
      setRefineTransitions(false)
    } else if (stepIdx === 1) {
      setTab('overview')
      setSite(gerlache)
      setDurationHours(72)
      setStepMinutes(30)
      setRefineTransitions(true)
    } else if (stepIdx === 2) {
      setTab('overview')
      setSite(gerlache)
      setDeckOverrideTab('comms')
    } else if (stepIdx === 3) {
      setSite(gerlache)
      setCompareId(mouton.id)
      setCompareDateB(date)
      setCompareCEnabled(true)
      setCompareIdC(ridge.id)
      setCompareDateC(shiftDateUtc(date, 14))
      setTab('compare')
    }
  }

  // Helper to check if two ranges overlap (avoiding false single winner within spatial uncertainty)
  const rangesOverlap = (rangeA?: number[], rangeB?: number[]) => {
    if (!rangeA || !rangeB || rangeA.length < 2 || rangeB.length < 2) return false
    return Math.max(rangeA[0], rangeB[0]) <= Math.min(rangeA[1], rangeB[1])
  }

  const showHome = () => {
    setStarted(false)
    setSidebarOpen(false)
    window.scrollTo(0, 0)
  }

  const enterExplorer = () => {
    window.clearTimeout(leaveTimer.current)
    setTab('overview')
    setCalendarOpen(false)
    setPlanningOpen(false)
    setResultsOpen(false)
    setDetailOpen(false)
    setLeaving(false)
    setStarted(true)
    window.scrollTo(0, 0)
  }
  const startExploring = () => {
    if (leaving) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      enterExplorer()
      return
    }
    setLeaving(true)
    setEntering(true)
    // The warp cover's transitionend drives the switch; the timer is only a fallback.
    leaveTimer.current = window.setTimeout(enterExplorer, 2000)
  }

  if (!started) return <div className={`home-shell ${leaving ? 'is-leaving' : ''}`}>
    <header className="home-header">
      <div className="brand-symbol" aria-hidden="true"><Moon size={20}/><span/></div>
      <strong>LUNARPATH <span>AI</span></strong>
    </header>
    <main className="home-content"><EducationView onExplore={startExploring}/></main>
    <div className="home-warp" aria-hidden="true" onTransitionEnd={event => { if (leaving && event.propertyName === 'opacity') enterExplorer() }}/>
  </div>

  return <div className={`app-shell ${entering ? 'is-entering' : ''}`}>
    <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
      <div className="brand"><div className="brand-symbol"><Moon size={22}/><span/></div><div><strong>LUNARPATH<span> AI</span></strong><small>MISSION PLANNING PLATFORM</small></div><button className="mobile-close" onClick={() => setSidebarOpen(false)} aria-label="Cerrar menú"><X size={20}/></button></div>
      <div className="sidebar-section-title">NAVEGACIÓN</div>
      <button type="button" className="nav-item" onClick={showHome}><Moon size={18}/> Inicio <ChevronRight size={15}/></button>
      <button className={`nav-item ${!calendarOpen && !planningOpen && !resultsOpen && !detailOpen && tab === 'overview' ? 'selected' : ''}`} onClick={() => { setTab('overview'); setCalendarOpen(false); setPlanningOpen(false); setResultsOpen(false); setDetailOpen(false); setSidebarOpen(false) }}><Compass size={18}/> Explorador lunar <ChevronRight size={15}/></button>
      <button className={`nav-item ${!calendarOpen && !planningOpen && !resultsOpen && !detailOpen && tab === 'compare' ? 'selected' : ''}`} onClick={() => { setTab('compare'); setCalendarOpen(false); setPlanningOpen(false); setResultsOpen(false); setDetailOpen(false); setSidebarOpen(false) }}><Layers3 size={18}/> Comparar y Ranking <ChevronRight size={15}/></button>
      <button className={`nav-item ${calendarOpen ? 'selected' : ''}`} onClick={() => { setCalendarOpen(true); setPlanningOpen(false); setResultsOpen(false); setDetailOpen(false); setSidebarOpen(false) }}><CalendarDays size={18}/> Calendario de iluminación <ChevronRight size={15}/></button>
      <button className={`nav-item ${!calendarOpen && planningOpen ? 'selected' : ''}`} onClick={() => { setCalendarOpen(false); setPlanningOpen(true); setResultsOpen(false); setDetailOpen(false); setSidebarOpen(false) }}><MapPin size={18}/> Planificación guiada <ChevronRight size={15}/></button>
      <button className={`nav-item ${!calendarOpen && resultsOpen ? 'selected' : ''}`} onClick={() => { setCalendarOpen(false); setResultsOpen(true); setPlanningOpen(false); setDetailOpen(false); setSidebarOpen(false) }}><Activity size={18}/> Resultados de misión <ChevronRight size={15}/></button>
      <button className={`nav-item ${!calendarOpen && detailOpen ? 'selected' : ''}`} onClick={() => { setCalendarOpen(false); setDetailOpen(true); setResultsOpen(false); setPlanningOpen(false); setSidebarOpen(false) }}><Search size={18}/> Detalle de misión <ChevronRight size={15}/></button>
      <div className="sidebar-section-title sites-title">CATÁLOGO POLAR SUR <span>0{SITES.length}</span></div>
      <div className="site-search"><Search size={15}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar sitio o región..." aria-label="Buscar sitios"/></div>
      <div className="site-list">{customSite && <button className={`site-item ${site.id === 'custom' ? 'active' : ''}`} onClick={() => selectSite(customSite)}><span className="site-number"><MapPin size={14}/></span><span><strong>Punto personalizado</strong><small>{Math.abs(customSite.lat).toFixed(3)}° S · {customSite.lon.toFixed(3)}° E</small></span>{site.id === 'custom' && <span className="active-indicator"/>}</button>}{filteredSites.map(item => <button key={item.id} className={`site-item ${item.id === site.id ? 'active' : ''}`} onClick={() => selectSite(item)}><span className="site-number">0{SITES.indexOf(item) + 1}</span><span><strong>{item.name}</strong><small>{item.region} {item.lat <= -87.5 ? '· DEM 20m' : ''}</small></span>{item.id === site.id && <span className="active-indicator"/>}</button>)}{filteredSites.length === 0 && <p className="empty-search">Sin resultados</p>}</div>
      <div className="sidebar-bottom"><div className="mission-card"><span className="mini-orbit"><span/></span><small>ARTEMIS III</small><strong>South Pole<br/>Telemetry</strong><span className="mission-card-foot">JPL HORIZONS + LOLA <ArrowUpRight size={14}/></span></div><div className="sidebar-note"><CircleHelp size={15}/> Datos NASA y modelos con supuestos explícitos</div></div>
    </aside>
    <div className="main-shell">
      <header className="topbar">
        <button className="mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="Abrir menú"><Menu size={21}/></button>
        <div className="breadcrumbs">LUNARPATH <ChevronRight size={13}/> <strong>{calendarOpen ? 'Calendario de iluminación' : detailOpen ? 'Detalle de misión' : resultsOpen ? 'Resultados de misión' : planningOpen ? 'Planificación guiada' : tab === 'overview' ? site.name : 'Comparación y Ranking'}</strong></div>
        <div className="top-actions">
          {ready && scenario.provenance && <span className="provenance-pill" title="Fuentes topográficas activas en el horizonte">{scenario.provenance.terrainSources.includes('LDEM_875S_20M') ? 'LOLA 20m (≤5km) + 240m' : 'LOLA 240m'} · JPL Horizons</span>}
          <button
            type="button"
            className="theme-toggle"
            onClick={() => setTheme(t => (t === 'dark' ? 'light' : 'dark'))}
            aria-label={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
            title={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
          >
            {theme === 'dark' ? <Sun size={14}/> : <Moon size={14}/>}
            <span>{theme === 'dark' ? 'Claro' : 'Oscuro'}</span>
          </button>
          <span className={`source-pill ${ready ? 'api' : ''}`}><span className="live-dot"/>{ready ? 'TELEMETRÍA ACTIVA' : loading ? 'CALCULANDO' : 'SIN DATOS'}</span>
        </div>
      </header>
      <main className="content">
        {dataAvailability && !dataAvailability.analysisReady && <div className="data-availability-alert" role="alert">Falta el DEM LOLA de 240 m en el servidor. El análisis topográfico no está disponible; revisa la instalación de datos.</div>}
        {calendarOpen ? <IlluminationCalendarView site={site}/> : detailOpen ? <MissionDetailView key={detailScenario ? `${detailScenario.site.id}-${detailScenario.start}` : 'empty'} scenario={detailScenario} onCompare={() => { setDetailOpen(false); setResultsOpen(true) }} onPlan={() => { setDetailOpen(false); setPlanningOpen(true) }}/> : resultsOpen ? <MissionResultsView result={missionResults} onEdit={() => { setResultsOpen(false); setPlanningOpen(true) }} onDetail={id => { const chosen = missionResults?.scenarios.find(candidate => candidate.site.id === id); if (chosen) { setDetailScenario(chosen); setResultsOpen(false); setDetailOpen(true) } }}/> : planningOpen ? <MissionPlanningView sites={SITES} initialDate={date} initialResult={missionResults} onCompared={result => { setMissionResults(result); setDetailScenario(null); setPlanningOpen(false); setResultsOpen(true) }}/> : overviewLoading ? <Suspense fallback={<div className="orbital-loading" role="status" aria-label={`Calculando ${site.name}`}/>}><OrbitalLoading siteName={tab === 'compare' ? `${site.name} y otro sitio` : site.name}/></Suspense> : <>
        <div className="page-heading">
          <div>
            <div className="eyebrow"><span/> LUNAR SOUTH POLE / MISSION PLANNING CONSOLE</div>
            <h1 ref={pageTitle} tabIndex={-1}>{tab === 'overview' ? 'Explorador e Ingeniería Lunar' : 'Comparación con Incertidumbre y Ranking'}</h1>
            <p>{tab === 'overview' ? 'Topografía LOLA georreferenciada, efemérides JPL Horizons, simulación energética de batería y sensibilidad al aterrizaje.' : 'Contrasta candidatos considerando el margen de sensibilidad topográfica (±240 m) y pondera prioridades de misión.'}</p>
          </div>
          <div className="heading-actions">
            <button
              type="button"
              className={`outline-button ${tourStep !== null ? 'active-tour' : ''}`}
              onClick={() => (tourStep === null ? applyTourStep(0) : setTourStep(null))}
            >
              <Play size={15}/> {tourStep === null ? 'Demo Guiada' : 'Cerrar Demo'}
            </button>
            <button
              className="outline-button"
              disabled={!primaryReady || csvExporting}
              onClick={async () => {
                setCsvExporting(true)
                try {
                  await downloadBackendCsv(scenario, { minSunPercent: minSun, minEarthPercent: minEarth, maxBlackoutHours: maxBlackout })
                } catch (err) {
                  setApiError(`No se pudo exportar el CSV: ${String(err)}`)
                } finally {
                  setCsvExporting(false)
                }
              }}
            >
              <Download size={16}/> {csvExporting ? 'Exportando…' : 'Exportar CSV'}
            </button>
            <button className="primary-button" onClick={() => setTab(tab === 'overview' ? 'compare' : 'overview')}>{tab === 'overview' ? <Plus size={17}/> : <Compass size={17}/>} {tab === 'overview' ? 'Comparar y Ranking' : 'Volver al explorador'}</button>
          </div>
        </div>
        {tourStep !== null && <div className="tour-banner" role="region" aria-label="Demostración interactiva guiada">
          <div className="tour-meta">
            <span className="tour-kicker">RECORRIDO VERIFICADO · SIN SIMULACIÓN FALSA</span>
            <strong>{TOUR_STEPS[tourStep].title}</strong>
            <p>{TOUR_STEPS[tourStep].desc}</p>
          </div>
          <div className="tour-actions">
            <div className="tour-dots" role="tablist" aria-label="Pasos de la demo">{TOUR_STEPS.map((_, idx) => <button key={idx} type="button" className={tourStep === idx ? 'active' : ''} onClick={() => applyTourStep(idx)}>{idx + 1}</button>)}</div>
            {tourStep < TOUR_STEPS.length - 1 ? <button type="button" className="primary-button compact-btn" onClick={() => applyTourStep(tourStep + 1)}>Siguiente <ArrowRight size={14}/></button> : <button type="button" className="outline-button compact-btn" onClick={() => setTourStep(null)}>Finalizar</button>}
            <button type="button" className="icon-button" aria-label="Cerrar recorrido" onClick={() => setTourStep(null)}><X size={16}/></button>
          </div>
        </div>}
        {noticeError && <div className="notice" role="alert"><span className="notice-icon"><Activity size={16}/></span><span><strong>{noticeError}</strong> Revisa la conexión con FastAPI o JPL Horizons.</span></div>}
        {!ready ? <section className="panel data-unavailable"><h2>Análisis no disponible</h2><p>{apiError || compareError || 'El mapa y las métricas aparecerán cuando responda la API.'}</p><p>{apiError?.includes('502') ? 'JPL Horizons no respondió a esta consulta. Puedes reintentarla.' : 'Backend: cd backend · .venv\\Scripts\\python -m uvicorn app.main:app --reload'}</p><button className="primary-button" onClick={() => setRetry(value => value + 1)}>Reintentar análisis</button><label>Fecha de inicio (UTC) <input type="date" value={date} onChange={e => selectDate(e.target.value || initialDate)}/></label></section> : tab === 'overview' ? <>
          <div className="workspace-grid">
            <section id="site-map" className="panel map-panel"><div className="panel-heading"><div><span className="section-kicker">01 / SELECCIÓN DE SITIO</span><h2>Cartografía polar georreferenciada</h2></div><span className="icon-button" title="Fotografía LROC y relieve LOLA"><Layers3 size={18}/></span></div><LunarMap site={site} onSelect={selectSite} onPick={pickCoordinate}/><div className="selected-site"><span className="selected-pin"><MapPin size={18}/></span><div><small>{site.region.toUpperCase()} · COTA {scenario.site.heightKm ?? site.heightKm ?? 0} KM</small><strong>{site.name}</strong><span>{Math.abs(site.lat).toFixed(3)}° S · {Math.abs(site.lon).toFixed(3)}° {site.lon < 0 ? 'O' : 'E'} · <a className="trek-link" href="https://trek.nasa.gov/moon/" target="_blank" rel="noopener noreferrer" title="Abre el portal; verifica estas coordenadas con la herramienta Fly To">NASA Moon Trek ↗</a></span></div></div><CoordinateForm site={site} onPick={pickCoordinate}/></section>
            <section className="panel horizon-panel"><div className="panel-heading"><div><span className="section-kicker">02 / HORIZONTE Y OBSTÁCULOS</span><h2>Elevación local 360°</h2></div><span className="timestamp"><Clock3 size={14}/> {formatHour(date, currentHourOffset)} (H+{currentHourOffset.toFixed(1)}h)</span></div><Horizon scenario={scenario} hour={hour}/><div className="horizon-status"><span className={`status-badge ${currentSample.sunVisible ? 'good' : 'bad'}`}><Sun size={14}/>{currentSample.sunVisible ? 'Sol visible' : 'Sol oculto'}</span><span className={`status-badge ${currentSample.earthVisible ? 'good blue-badge' : 'bad'}`}><Radio size={14}/>{currentSample.earthVisible ? 'Tierra visible' : 'Tierra oculta'}</span><span className="horizon-note">Fuente: {scenario.provenance?.horizonSource}</span></div><VisibilityExplanation scenario={scenario} hour={hour}/></section>
            <section className="panel controls-panel"><div className="panel-heading"><div><span className="section-kicker">03 / PARÁMETROS OPERATIVOS</span><h2>Ventana y umbrales de misión</h2></div><Settings2 size={18} className="muted-icon"/></div><label className="field-label" htmlFor="date">FECHA DE INICIO (UTC)</label><input className="date-input" id="date" type="date" value={date} onChange={e => selectDate(e.target.value || initialDate)}/><div className="control-divider"/><div className="field-label">VENTANA Y MUESTREO</div><div className="param-grid"><label className="param-field"><span>Duración</span><select value={durationHours} onChange={e => changeDuration(Number(e.target.value) as 24 | 72 | 168 | 336)} aria-label="Duración del análisis"><option value={24}>24 h (1 día)</option><option value={72}>72 h (3 días)</option><option value={168}>168 h (7 días)</option><option value={336}>336 h (14 días)</option></select></label><label className="param-field"><span>Paso base</span><select value={stepMinutes} onChange={e => setStepMinutes(Number(e.target.value) as 60 | 30 | 15)} aria-label="Paso temporal en minutos"><option value={60}>60 min</option><option value={30} disabled={durationHours > 168}>30 min{durationHours > 168 ? ' (≤7d)' : ''}</option><option value={15} disabled={durationHours > 72}>15 min{durationHours > 72 ? ' (≤3d)' : ''}</option></select></label></div><button type="button" className={`refine-toggle-btn ${refineTransitions ? 'active' : ''}`} onClick={() => setRefineTransitions(v => !v)} aria-pressed={refineTransitions}><span>Refinar transiciones a 5 min</span><strong>{refineTransitions ? 'ACTIVO (±2.5m)' : 'OFF'}</strong></button><p className="field-hint">{scenario.provenance?.terrainSources.includes('LDEM_875S_20M') ? 'DEM 20m + 240m' : 'DEM 240m'} · Sensibilidad espacial ±{spA?.radiusM ?? 240} m</p><div className="control-divider"/><div className="field-label">MODO DE UMBRALES</div><div className="mode-toggle"><button className={mode === 'explorer' ? 'active' : ''} onClick={() => setMode('explorer')}>Estándar</button><button className={mode === 'analyst' ? 'active' : ''} onClick={() => setMode('analyst')}>Ajustar criterios</button></div>{mode === 'analyst' && <div className="analyst-fields"><label>Sol visible mínimo <strong>{minSun}%</strong><input type="range" min="0" max="100" value={minSun} onChange={e => setMinSun(Number(e.target.value))}/></label><label>Tierra visible mínimo <strong>{minEarth}%</strong><input type="range" min="0" max="100" value={minEarth} onChange={e => setMinEarth(Number(e.target.value))}/></label><label>Blackout máximo <strong>{maxBlackout} h</strong><input type="range" min="0" max="72" value={maxBlackout} onChange={e => setMaxBlackout(Number(e.target.value))}/></label><label>Umbral pendiente LOLA <strong>{slopeThreshold}°</strong><input type="range" min="2" max="30" value={slopeThreshold} onChange={e => setSlopeThreshold(Number(e.target.value))}/></label></div>}</section>
          </div>
          <div className="metrics-heading"><div><span className="section-kicker">TELEMETRÍA DE ESCENARIO</span><h2>Métricas y banda de sensibilidad del DEM</h2></div><span className="period-label"><Clock3 size={15}/> {Math.round(scenario.hours / 24)} días ({scenario.provenance?.samplingMinutes ?? stepMinutes} min) · ±{spA?.radiusM ?? 240} m{spA?.demVerticalSigmaM != null ? ` · σz supuesto ${spA.demVerticalSigmaM} m (±${spA.horizonEnvelopeDeg?.toFixed(2) ?? '0'}°)` : ''}</span></div>
          <div className="metric-grid">
            <MetricCard icon={<Sun size={20}/>} label="Visibilidad solar" value={m.sunPercent} suffix="%" color="amber-bg" badge={spA ? `±240m: ${spA.sunlitPercentRange[0]}–${spA.sunlitPercentRange[1]}%` : undefined} detail="Tiempo con Sol sobre el horizonte LOLA"/>
            <MetricCard icon={<Earth size={20}/>} label="Visibilidad terrestre" value={m.earthPercent} suffix="%" color="blue-bg" badge={spA ? `±240m: ${spA.earthVisiblePercentRange[0]}–${spA.earthVisiblePercentRange[1]}%` : undefined} detail="Línea de vista directa hacia la Tierra"/>
            <MetricCard icon={<Moon size={20}/>} label="Oscuridad continua máx" value={m.longestDark} suffix="h" color="purple-bg" badge={spA ? `±240m: ${spA.longestDarknessHoursRange[0]}–${spA.longestDarknessHoursRange[1]}h` : undefined} detail="Intervalo más largo sin energía solar"/>
            <MetricCard icon={<Radio size={20}/>} label="Blackout terrestre máx" value={m.longestBlackout} suffix="h" color="mint-bg" badge={spA ? `±240m: ${spA.longestEarthBlackoutHoursRange[0]}–${spA.longestEarthBlackoutHoursRange[1]}h` : undefined} detail="Pérdida continua de enlace directo"/>
          </div>
          <div className="lower-grid">
            <section id="mission-timeline" className="panel timeline-panel"><div className="panel-heading"><div><span className="section-kicker">04 / EVOLUCIÓN TEMPORAL</span><h2>Línea de tiempo y ventanas de transición</h2></div><span className="timeline-help"><span className="legend-dot sun"/> Sol <span className="legend-dot earth"/> Tierra · Pulsa una transición para saltar</span></div><Timeline scenario={scenario} hour={hour} onHourChange={setHour}/></section>
            <section className="panel feasibility-panel"><div className="panel-heading"><div><span className="section-kicker">05 / EVALUACIÓN</span><h2>Restricciones operativas</h2></div><Gauge size={18} className="muted-icon"/></div><div className="feasibility-top"><div className={`score-orb ${status.feasible ? 'pass' : ''}`}>{status.count}<small>/3</small></div><div><strong>{status.feasible ? 'Cumple criterios de luz y visibilidad terrestre' : 'Revisar restricciones'}</strong><span>{status.count} de 3 condiciones satisfechas (no certifica aterrizaje ni radioenlace)</span></div></div><div className="criteria-list"><div><span className={status.passed[0] ? 'criteria-ok' : 'criteria-no'}>{status.passed[0] ? <Check size={13}/> : <X size={13}/>}</span> Luz solar ≥ {minSun}% <strong>{m.sunPercent}%</strong></div><div><span className={status.passed[1] ? 'criteria-ok' : 'criteria-no'}>{status.passed[1] ? <Check size={13}/> : <X size={13}/>}</span> Tierra visible ≥ {minEarth}% <strong>{m.earthPercent}%</strong></div><div><span className={status.passed[2] ? 'criteria-ok' : 'criteria-no'}>{status.passed[2] ? <Check size={13}/> : <X size={13}/>}</span> Blackout ≤ {maxBlackout} h <strong>{m.longestBlackout} h</strong></div></div><button className="text-button" onClick={() => setMode(mode === 'analyst' ? 'explorer' : 'analyst')}>{mode === 'analyst' ? 'Ocultar controles de criterios' : 'Ajustar criterios manualmente'} <ArrowRight size={15}/></button></section>
          </div>
          <MissionOperationsDeck
            scenario={scenario} date={date} hour={hour} onHourChange={setHour}
            minSun={minSun} minEarth={minEarth} maxBlackout={maxBlackout} slope={slope}
            onPickCoordinate={pickCoordinate}
            externalTab={deckOverrideTab}
            onApplyConstraints={c => {
              if (c.minSunPercent != null) setMinSun(c.minSunPercent)
              if (c.minEarthPercent != null) setMinEarth(c.minEarthPercent)
              if (c.maxBlackoutHours != null) setMaxBlackout(c.maxBlackoutHours)
            }}
          />
          <RegionalSlopeCard slope={slope} error={slopeError} baselinePixels={slopeBaseline} onBaselineChange={setSlopeBaseline} thresholdDeg={slopeThreshold} onThresholdChange={setSlopeThreshold}/>
          <section className="panel footprint-panel" aria-label="Relieve local de huella NAC">
            <div className="panel-heading"><div><span className="section-kicker">08 / EVIDENCIA LOCAL</span><h2>Huella y rugosidad NAC estéreo</h2></div><span>DTM 2 m/px cuando hay cobertura</span></div>
            <label className="footprint-control">Ancho de huella analizada: <strong>{footprintM} m</strong>
              <input type="range" min="10" max="100" step="10" value={footprintM} onChange={event => setFootprintM(Number(event.target.value))}/>
            </label>
            {footprint?.status === 'measured_not_certified' ? <div className="footprint-metrics">
              <div><small>PENDIENTE DEL PLANO</small><strong>{footprint.slopeDeg?.toFixed(1)}°</strong><span>{footprint.slopeExceedsLimit ? 'Supera' : 'Bajo'} umbral elegido de {slopeThreshold}°</span></div>
              <div><small>RUGOSIDAD RESIDUAL RMS</small><strong>{footprint.roughnessRmsM?.toFixed(2)} m</strong><span>{footprint.roughnessExceedsLimit ? 'Supera' : 'Bajo'} umbral exploratorio de 0,5 m</span></div>
              <div><small>COBERTURA DE LA HUELLA</small><strong>{Math.round(footprint.coverageFraction * 100)}%</strong><span>{footprint.source} · {footprint.resolutionM} m/px</span></div>
            </div> : <p>{footprintError ? `Evaluación local no disponible: ${footprintError}` : footprint ? 'Sin DTM NAC estéreo suficiente para esta coordenada y huella.' : 'Consultando cobertura del DTM NAC…'}</p>}
            <p className="slope-disclaimer">{footprint?.note || 'La fotografía NAC y la pendiente LOLA regional no revelan por sí solas los peligros de la huella.'} Rocas y resistencia del suelo: sin evaluar. Ningún resultado certifica un aterrizaje.</p>
          </section>
          <Suspense fallback={<p className="terrain-3d-message">Cargando visor 3D…</p>}><Terrain3D site={site} sample={currentSample}/></Suspense>
        </> : <div className="compare-page-stack">
          <div className="compare-layout">
            <section className="panel comparison-panel">
              <div className="panel-heading">
                <div><span className="section-kicker">COMPARACIÓN MULTIFECHA Y MULTISITIO</span><h2>{compareCEnabled ? 'Tres candidatos lado a lado' : 'Dos candidatos y ventanas independientes'}</h2></div>
                <div className="compare-head-actions">
                  <button type="button" className="outline-button compact-btn" onClick={() => { setCompareId(site.id); setCompareDateB(shiftDateUtc(date, 14)) }} title="Evaluar el mismo sitio A dos semanas después (siguiente fase lunar)">Mismo sitio (+14 d)</button>
                  <button type="button" className="outline-button compact-btn" onClick={() => setCompareCEnabled(v => !v)}>{compareCEnabled ? 'Quitar 3er sitio' : '+ 3er candidato'}</button>
                </div>
              </div>
              <div className={`comparison-selectors ${compareCEnabled ? 'three-cols' : ''}`}>
                <div className="compare-slot">
                  <label>CANDIDATO A · {date}</label>
                  <div className="site-select-display"><MapPin size={16}/>{site.name}</div>
                </div>
                <div className="compare-slot">
                  <label htmlFor="compare-site">CANDIDATO B</label>
                  <div className="compare-slot-inputs">
                    <select id="compare-site" value={compareId} onChange={e => setCompareId(e.target.value)}>{SITES.map(s => <option key={s.id} value={s.id} disabled={s.id === site.id && compareDateB === date}>{s.name}</option>)}</select>
                    <input type="date" aria-label="Fecha candidato B" value={compareDateB} onChange={e => setCompareDateB(e.target.value || date)}/>
                  </div>
                </div>
                {compareCEnabled && <div className="compare-slot">
                  <label htmlFor="compare-site-c">CANDIDATO C</label>
                  <div className="compare-slot-inputs">
                    <select id="compare-site-c" value={compareIdC} onChange={e => setCompareIdC(e.target.value)}>{SITES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
                    <input type="date" aria-label="Fecha candidato C" value={compareDateC} onChange={e => setCompareDateC(e.target.value || date)}/>
                  </div>
                </div>}
              </div>
              <div className={`comparison-table ${compareCEnabled ? 'three-cols' : ''}`}>
                <div className="table-head">
                  <span>MÉTRICA E INCERTIDUMBRE</span>
                  <strong>{site.name} <small className="head-date">{date}</small></strong>
                  <strong>{compared.site.name} <small className="head-date">{compareDateB}</small></strong>
                  {compareCEnabled && <strong>{comparedC.site.name} <small className="head-date">{compareDateC}</small></strong>}
                </div>
                {[
                  {
                    name: 'Visibilidad solar',
                    vals: [`${m.sunPercent}%`, `${compareMetrics.sunPercent}%`, `${compareMetricsC.sunPercent}%`],
                    ranges: [
                      spA ? `${spA.sunlitPercentRange[0]}–${spA.sunlitPercentRange[1]}%` : null,
                      spB ? `${spB.sunlitPercentRange[0]}–${spB.sunlitPercentRange[1]}%` : null,
                      spC ? `${spC.sunlitPercentRange[0]}–${spC.sunlitPercentRange[1]}%` : null,
                    ],
                    nums: [m.sunPercent, compareMetrics.sunPercent, compareMetricsC.sunPercent],
                    tie: !compareCEnabled && rangesOverlap(spA?.sunlitPercentRange, spB?.sunlitPercentRange),
                  },
                  {
                    name: 'Visibilidad terrestre',
                    vals: [`${m.earthPercent}%`, `${compareMetrics.earthPercent}%`, `${compareMetricsC.earthPercent}%`],
                    ranges: [
                      spA ? `${spA.earthVisiblePercentRange[0]}–${spA.earthVisiblePercentRange[1]}%` : null,
                      spB ? `${spB.earthVisiblePercentRange[0]}–${spB.earthVisiblePercentRange[1]}%` : null,
                      spC ? `${spC.earthVisiblePercentRange[0]}–${spC.earthVisiblePercentRange[1]}%` : null,
                    ],
                    nums: [m.earthPercent, compareMetrics.earthPercent, compareMetricsC.earthPercent],
                    tie: !compareCEnabled && rangesOverlap(spA?.earthVisiblePercentRange, spB?.earthVisiblePercentRange),
                  },
                  {
                    name: 'Oscuridad continua máx',
                    vals: [`${m.longestDark} h`, `${compareMetrics.longestDark} h`, `${compareMetricsC.longestDark} h`],
                    ranges: [
                      spA ? `${spA.longestDarknessHoursRange[0]}–${spA.longestDarknessHoursRange[1]} h` : null,
                      spB ? `${spB.longestDarknessHoursRange[0]}–${spB.longestDarknessHoursRange[1]} h` : null,
                      spC ? `${spC.longestDarknessHoursRange[0]}–${spC.longestDarknessHoursRange[1]} h` : null,
                    ],
                    nums: [-m.longestDark, -compareMetrics.longestDark, -compareMetricsC.longestDark],
                    tie: !compareCEnabled && rangesOverlap(spA?.longestDarknessHoursRange, spB?.longestDarknessHoursRange),
                  },
                  {
                    name: 'Blackout terrestre máx',
                    vals: [`${m.longestBlackout} h`, `${compareMetrics.longestBlackout} h`, `${compareMetricsC.longestBlackout} h`],
                    ranges: [
                      spA ? `${spA.longestEarthBlackoutHoursRange[0]}–${spA.longestEarthBlackoutHoursRange[1]} h` : null,
                      spB ? `${spB.longestEarthBlackoutHoursRange[0]}–${spB.longestEarthBlackoutHoursRange[1]} h` : null,
                      spC ? `${spC.longestEarthBlackoutHoursRange[0]}–${spC.longestEarthBlackoutHoursRange[1]} h` : null,
                    ],
                    nums: [-m.longestBlackout, -compareMetrics.longestBlackout, -compareMetricsC.longestBlackout],
                    tie: !compareCEnabled && rangesOverlap(spA?.longestEarthBlackoutHoursRange, spB?.longestEarthBlackoutHoursRange),
                  },
                  {
                    name: 'Retorno DSN (Banda X · 10 Mbps)',
                    vals: [`${commsA.totalDownlinkedGb} GB`, `${commsB.totalDownlinkedGb} GB`, `${commsC.totalDownlinkedGb} GB`],
                    ranges: [
                      `SSR pico ${commsA.peakBufferPercent}%`,
                      `SSR pico ${commsB.peakBufferPercent}%`,
                      `SSR pico ${commsC.peakBufferPercent}%`,
                    ],
                    nums: [commsA.totalDownlinkedGb, commsB.totalDownlinkedGb, commsC.totalDownlinkedGb],
                    tie: false,
                  },
                  {
                    name: 'Simultaneidad Sol + Tierra',
                    vals: [`${m.concurrentPercent}%`, `${compareMetrics.concurrentPercent}%`, `${compareMetricsC.concurrentPercent}%`],
                    ranges: [null, null, null],
                    nums: [m.concurrentPercent, compareMetrics.concurrentPercent, compareMetricsC.concurrentPercent],
                    tie: !compareCEnabled && Math.abs(m.concurrentPercent - compareMetrics.concurrentPercent) <= 2,
                  },
                  ...(slope && comparedSlope ? [{
                    name: `Pendiente LOLA (${slope.baselineM.toFixed(0)} m)`,
                    vals: [`${slope.slopeDeg.toFixed(2)}°`, `${comparedSlope.slopeDeg.toFixed(2)}°`, comparedSlopeC ? `${comparedSlopeC.slopeDeg.toFixed(2)}°` : '—'],
                    ranges: [
                      `P90: ${slope.neighborhood.p90Deg.toFixed(1)}°`,
                      `P90: ${comparedSlope.neighborhood.p90Deg.toFixed(1)}°`,
                      comparedSlopeC ? `P90: ${comparedSlopeC.neighborhood.p90Deg.toFixed(1)}°` : null,
                    ],
                    nums: [-slope.slopeDeg, -comparedSlope.slopeDeg, comparedSlopeC ? -comparedSlopeC.slopeDeg : -999],
                    tie: !compareCEnabled && Math.abs(slope.slopeDeg - comparedSlope.slopeDeg) < 1.0,
                  }] : []),
                  {
                    name: 'DEM y banda de sensibilidad',
                    vals: [
                      scenario.provenance?.terrainSources.join(' + ') || 'LOLA 240m',
                      compared.provenance?.terrainSources.join(' + ') || 'LOLA 240m',
                      comparedC.provenance?.terrainSources.join(' + ') || 'LOLA 240m',
                    ],
                    ranges: [
                      spA?.horizonEnvelopeDeg != null ? `σz ${spA.demVerticalSigmaM} m (±${spA.horizonEnvelopeDeg.toFixed(2)}°)` : null,
                      spB?.horizonEnvelopeDeg != null ? `σz ${spB.demVerticalSigmaM} m (±${spB.horizonEnvelopeDeg.toFixed(2)}°)` : null,
                      spC?.horizonEnvelopeDeg != null ? `σz ${spC.demVerticalSigmaM} m (±${spC.horizonEnvelopeDeg.toFixed(2)}°)` : null,
                    ],
                    nums: [0, 0, 0],
                    tie: true,
                  },
                ].map(row => {
                  const activeNums = compareCEnabled ? row.nums : row.nums.slice(0, 2)
                  const bestVal = Math.max(...activeNums)
                  return <div className="table-row" key={row.name}>
                    <span>{row.name} {row.tie && activeNums[0] !== activeNums[1] && <em className="tie-badge" title="Las bandas de sensibilidad se solapan; no equivalen a confianza estadística calibrada">Empate técnico (±240m)</em>}</span>
                    {(compareCEnabled ? [0, 1, 2] : [0, 1]).map(colIdx => {
                      const isWin = !row.tie && activeNums[colIdx] === bestVal && activeNums.filter(v => v === bestVal).length === 1
                      return <strong key={colIdx} className={isWin ? 'winner' : ''}>
                        <div>{row.vals[colIdx]} {isWin && <ArrowUpRight size={14}/>}</div>
                        {row.ranges[colIdx] && <small className="cell-range">{row.ranges[colIdx]}</small>}
                      </strong>
                    })}
                  </div>
                })}
              </div>
            </section>
            <section className="panel compare-aside">
              <span className="section-kicker">DECISIÓN BAJO INCERTIDUMBRE</span>
              <h2>Balance entre candidatos</h2>
              <p>Las diferencias pequeñas cuyas bandas de sensibilidad se solapan no declaran ganador único. Las bandas verticales no están calibradas como intervalos de confianza para todos los sitios.</p>
              <div className="compare-mini"><span><Sun size={17}/> Ventaja solar</span><strong>{!compareCEnabled && rangesOverlap(spA?.sunlitPercentRange, spB?.sunlitPercentRange) ? 'Solapado en ±240 m' : (compareCEnabled && compareMetricsC.sunPercent >= Math.max(m.sunPercent, compareMetrics.sunPercent) ? `${comparedC.site.name} (${compareDateC})` : m.sunPercent >= compareMetrics.sunPercent ? `${site.name} (${date})` : `${compared.site.name} (${compareDateB})`)} <ArrowDownRight size={15}/></strong></div>
              <div className="compare-mini"><span><Radio size={17}/> Ventaja enlace</span><strong>{!compareCEnabled && rangesOverlap(spA?.earthVisiblePercentRange, spB?.earthVisiblePercentRange) ? 'Solapado en ±240 m' : (compareCEnabled && compareMetricsC.earthPercent >= Math.max(m.earthPercent, compareMetrics.earthPercent) ? `${comparedC.site.name} (${compareDateC})` : m.earthPercent >= compareMetrics.earthPercent ? `${site.name} (${date})` : `${compared.site.name} (${compareDateB})`)} <ArrowDownRight size={15}/></strong></div>
              <div className="compare-mini"><span><ShieldCheck size={17}/> Criterios cumplidos</span><strong>{verdict(m, minSun, minEarth, maxBlackout).count}/3 · {verdict(compareMetrics, minSun, minEarth, maxBlackout).count}/3{compareCEnabled ? ` · ${verdict(compareMetricsC, minSun, minEarth, maxBlackout).count}/3` : ''}</strong></div>
              <button className="primary-button full" onClick={() => { setDate(compareDateB); selectSite(compared.site) }}>Explorar {compared.site.name} ({compareDateB}) <ArrowRight size={16}/></button>
            </section>
          </div>

          <section className="panel ranking-panel" aria-label="Matriz de ranking multicriterio de sitios candidatos">
            <div className="panel-heading">
              <div><span className="section-kicker">MATRIZ DE DECISIÓN PONDERADA (/api/v1/scenarios/rank)</span><h2>Ranking multicriterio de sitios Artemis</h2></div>
              <span className="period-label"><Zap size={14}/> Ajusta los pesos según la prioridad de tu misión</span>
            </div>
            <div className="ranking-weights-bar">
              <label>Peso Luz Solar <strong>{Math.round(rankWeights.sun * 100)}%</strong><input type="range" min="0" max="1" step="0.05" value={rankWeights.sun} onChange={e => setRankWeights(w => ({ ...w, sun: Number(e.target.value) }))}/></label>
              <label>Peso Enlace Tierra <strong>{Math.round(rankWeights.earth * 100)}%</strong><input type="range" min="0" max="1" step="0.05" value={rankWeights.earth} onChange={e => setRankWeights(w => ({ ...w, earth: Number(e.target.value) }))}/></label>
              <label>Peso Simultaneidad <strong>{Math.round(rankWeights.concurrent * 100)}%</strong><input type="range" min="0" max="1" step="0.05" value={rankWeights.concurrent} onChange={e => setRankWeights(w => ({ ...w, concurrent: Number(e.target.value) }))}/></label>
              <label>Penalización Noche <strong>{Math.round(rankWeights.darknessPenalty * 100)}%</strong><input type="range" min="0" max="1" step="0.05" value={rankWeights.darknessPenalty} onChange={e => setRankWeights(w => ({ ...w, darknessPenalty: Number(e.target.value) }))}/></label>
            </div>
            {rankingLoading ? <p className="terrain-3d-message">Calculando ranking ponderado para los sitios candidatos…</p> : rankingResult ? <div className="ranking-list">
              {rankingResult.rankedSites.map(item => (
                <div key={item.label} className={`ranking-row ${item.rank === 1 ? 'top-rank' : ''}`}>
                  <span className="rank-badge">#{item.rank}</span>
                  <div className="rank-main">
                    <strong>{item.label} <span className="rank-score">{item.score.toFixed(1)} / 100</span></strong>
                    <div className="rank-metrics">Sol {item.sunlitPercent}% · Tierra {item.earthVisiblePercent}% · Simultáneo {item.concurrentPercent}% · Noche máx {item.longestDarknessHours}h</div>
                    <div className="rank-tags">
                      {item.highlights.slice(0, 2).map((h, i) => <span key={i} className="tag-good">{h}</span>)}
                      {item.tradeoffs.slice(0, 2).map((t, i) => <span key={i} className="tag-warn">{t}</span>)}
                    </div>
                  </div>
                  <button type="button" className="outline-button" onClick={() => { const found = SITES.find(s => s.name === item.label); if (found) selectSite(found) }}>Cargar sitio <ArrowRight size={14}/></button>
                </div>
              ))}
            </div> : null}
          </section>
        </div>}
        </>}
        {!overviewLoading && <footer><span>© 2026 LUNARPATH AI · NASA SPACE APPS CHALLENGE</span><span>{ready ? `EFEMÉRIDES JPL HORIZONS / RELIEVE ${scenario.provenance?.terrainSources.join(' + ') || 'LOLA'} / IAU2000::30120` : 'SIN RESULTADOS CIENTÍFICOS / UTC'}</span></footer>}
      </main>
    </div>
  </div>
}
