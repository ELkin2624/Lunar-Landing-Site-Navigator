import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Activity, ArrowDownRight, ArrowRight, ArrowUpRight, Check, ChevronRight, CircleHelp, Clock3, Compass, Download, Earth, Gauge, Layers3, MapPin, Menu, Moon, Plus, Radio, Search, Settings2, ShieldCheck, Sun, X } from 'lucide-react'
import { analyze, apiEnabled, fetchSlope, type SlopeResult } from './api'
import { SITES, chartPath, emptyScenario, formatHour, metrics, verdict, type Scenario, type Site } from './data'
import { coordinatesFromPolarMeters, isWithinPolarMap, polarMapCoordinates, polarMapPosition, polarMeters } from './polar'
import { LocalTileMap } from './LocalTileMap'
const Terrain3D = lazy(() => import('./Terrain3D').then(module => ({ default: module.Terrain3D })))

const initialDate = '2026-11-15'
function LunarMap({ site, onSelect, onPick }: { site: Site; onSelect: (site: Site) => void; onPick: (latitude: number, longitude: number) => void }) {
  const [layer, setLayer] = useState<'lroc' | 'lola'>('lroc')
  const [zoom, setZoom] = useState(0)
  const spans = [384_000, 40_000, 8_000, 2_000]
  const center = polarMeters(site.lat, site.lon)
  const span = spans[zoom]
  const markerPosition = (latitude: number, longitude: number) => {
    if (zoom === 0) return polarMapPosition(latitude, longitude)
    const point = polarMeters(latitude, longitude)
    return { left: `${50 + (point.x - center.x) / span * 100}%`, top: `${50 - (point.y - center.y) / span * 100}%` }
  }
  const pick = (event: React.MouseEvent<HTMLButtonElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const horizontal = event.detail === 0 ? 0.5 : (event.clientX - bounds.left) / bounds.width
    const vertical = event.detail === 0 ? 0.5 : (event.clientY - bounds.top) / bounds.height
    const coordinates = zoom === 0 ? polarMapCoordinates(horizontal, vertical)
      : coordinatesFromPolarMeters(center.x + (horizontal - 0.5) * span, center.y - (vertical - 0.5) * span)
    onPick(Number(coordinates.latitude.toFixed(3)), Number(coordinates.longitude.toFixed(3)))
  }
  return <div className="moon-map" aria-label="Mapa lunar georreferenciado; pulse un lugar para analizarlo">
    <div className={`polar-map ${zoom ? 'local-map' : `${layer}-layer`}`}>
      {zoom > 0 && <LocalTileMap key={`${layer}-${zoom}-${site.lat}-${site.lon}`} layer={layer} centerX={center.x} centerY={center.y} viewWidthM={span}/>}
      <button className="map-pick-layer" type="button" onClick={pick} aria-label="Elegir un punto del mapa para analizar; con teclado elige el polo sur" title="Elegir coordenadas en el mapa"/>
      {zoom === 0 && <><div className="map-rings" /><div className="map-cross map-cross-x" /><div className="map-cross map-cross-y" /><span className="pole-label">90° S</span></>}
      {SITES.map((candidate, i) => <button key={candidate.id} className={`map-point ${site.id === candidate.id ? 'active' : ''}`} style={markerPosition(candidate.lat, candidate.lon)} onClick={() => onSelect(candidate)} aria-label={`Seleccionar ${candidate.name}`} title={`${candidate.name} · ${Math.abs(candidate.lat)}° S, ${candidate.lon}° E`}><span className="point-dot"/><span className="point-index">0{i + 1}</span></button>)}
      {site.id === 'custom' && <span className="map-custom-point" style={markerPosition(site.lat, site.lon)} aria-label="Punto personalizado seleccionado"/>}
    </div>
    <span className="map-coordinate">IAU2000::30120 · POLO SUR</span>
    <span className="map-compass">0° E <span>↑</span></span>
    <div className="map-layer-toggle" role="group" aria-label="Capa cartográfica"><button type="button" aria-pressed={layer === 'lroc'} className={layer === 'lroc' ? 'active' : ''} onClick={() => setLayer('lroc')}>LROC foto</button><button type="button" aria-pressed={layer === 'lola'} className={layer === 'lola' ? 'active' : ''} onClick={() => setLayer('lola')}>LOLA relieve</button></div>
    <div className="map-zoom" role="group" aria-label="Zoom del mapa"><button type="button" disabled={zoom === spans.length - 1} onClick={() => setZoom(value => Math.min(spans.length - 1, value + 1))} aria-label="Acercar mapa">+</button><button type="button" disabled={zoom === 0} onClick={() => setZoom(value => Math.max(0, value - 1))} aria-label="Alejar mapa">−</button></div>
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
    <div className="horizon-legend"><span><i className="dot amber"/> Sol {sample.sunElevation.toFixed(1)}° · {sample.sunAzimuth?.toFixed(0)}° az</span><span><i className="dot blue"/> Tierra {sample.earthElevation.toFixed(1)}° · {sample.earthAzimuth?.toFixed(0)}° az</span><span><i className="dot grey"/> Horizonte LOLA</span></div>
  </div>
}

function Timeline({ scenario, hour, onHourChange }: { scenario: Scenario; hour: number; onHourChange: (hour: number) => void }) {
  const count = scenario.hours
  const width = 600
  const sun = scenario.samples.map(s => s.sunVisible ? 1 : 0)
  const earth = scenario.samples.map(s => s.earthVisible ? 1 : 0)
  return <div className="timeline-body">
    <div className="timeline-row"><span className="timeline-name"><Sun size={16}/> Sol</span><div className="segments">{sun.map((v, i) => <span key={i} style={{ background: v ? '#e8b96e' : '#263241' }} />)}</div><strong>{metrics(scenario).sunPercent}%</strong></div>
    <div className="timeline-row"><span className="timeline-name"><Earth size={16}/> Tierra</span><div className="segments">{earth.map((v, i) => <span key={i} style={{ background: v ? '#74b9d1' : '#263241' }} />)}</div><strong>{metrics(scenario).earthPercent}%</strong></div>
    <div className="timeline-chart"><svg viewBox={`0 0 ${width} 64`} preserveAspectRatio="none" aria-label="Elevación del Sol y de la Tierra a lo largo del periodo"><line x1="0" y1="43" x2={width} y2="43" stroke="#627082" strokeDasharray="4 5"/><path d={chartPath(scenario.samples.map(s => s.sunElevation), width, 60, -5, 12)} fill="none" stroke="#e7b76d" strokeWidth="2"/><path d={chartPath(scenario.samples.map(s => s.earthElevation), width, 60, -5, 12)} fill="none" stroke="#79bdd3" strokeWidth="2"/><line x1={hour / count * width} x2={hour / count * width} y1="0" y2="64" stroke="#eaf0f4" strokeWidth="1"/></svg></div>
    <input className="time-slider" aria-label="Hora de simulación" type="range" min="0" max={count} value={hour} onChange={e => onHourChange(Number(e.target.value))}/>
    <div className="timeline-labels"><span>{formatHour(scenario.start, 0)}</span><span>{formatHour(scenario.start, Math.round(count / 2))}</span><span>{formatHour(scenario.start, count)}</span></div>
  </div>
}

function MetricCard({ icon, label, value, suffix, color, detail }: { icon: React.ReactNode; label: string; value: number; suffix: string; color: string; detail: string }) {
  return <div className="metric-card"><div className="metric-top"><span className={`metric-icon ${color}`}>{icon}</span><ArrowUpRight size={15}/></div><div className="metric-value">{value}<small>{suffix}</small></div><div className="metric-label">{label}</div><div className="metric-detail">{detail}</div></div>
}

function downloadCsv(scenario: Scenario) {
  const header = ['timestamp_utc', 'site_latitude_deg', 'site_longitude_deg', 'sun_azimuth_deg', 'sun_elevation_deg', 'earth_azimuth_deg', 'earth_elevation_deg', 'horizon_sun_deg', 'horizon_earth_deg', 'sun_visible', 'earth_visible', 'analysis_source', 'ephemeris_source', 'horizon_source', 'dem_pixel_scale_m', 'sampling_minutes', 'transition_bracket_minutes', 'precision_note']
  const metadata = scenario.provenance!
  const cell = (value: string | number | boolean | null | undefined) => `"${String(value ?? '').replace(/"/g, '""')}"`
  const rows = [header.map(cell).join(','), ...scenario.samples.map(sample => [
    new Date(Date.parse(scenario.start + 'T00:00:00Z') + sample.hour * 3600000).toISOString(),
    scenario.site.lat, scenario.site.lon, sample.sunAzimuth, sample.sunElevation, sample.earthAzimuth, sample.earthElevation,
    sample.horizonSun, sample.horizonEarth, sample.sunVisible, sample.earthVisible, scenario.source,
    metadata.ephemerisSource, metadata.horizonSource, metadata.demPixelScaleM,
    metadata.samplingMinutes, metadata.transitionUncertaintyMinutes,
    metadata.precisionNote,
  ].map(cell).join(','))]
  const url = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a'); link.href = url; link.download = `lunarpath-${scenario.site.id}-${scenario.start}.csv`; link.click(); URL.revokeObjectURL(url)
}

function RegionalSlopeCard({ slope, error, baselinePixels, onBaselineChange, thresholdDeg, onThresholdChange }: {
  slope: SlopeResult | null; error: string | null; baselinePixels: 1 | 2 | 4
  onBaselineChange: (baseline: 1 | 2 | 4) => void; thresholdDeg: number; onThresholdChange: (threshold: number) => void
}) {
  const within = slope?.thresholdStatus === 'at_or_below_user_threshold'
  return <section className="panel slope-panel" aria-label="Evaluación regional preliminar de pendiente LOLA">
    <div className="panel-heading">
      <div><span className="section-kicker">06 / RELIEVE REGIONAL LOLA</span><h2>Pendiente regional preliminar</h2></div>
      <span className="period-label">DEM LOLA · 240 m/px · IAU2000::30120</span>
    </div>
    <div className="slope-controls">
      <label className="slope-threshold-control">Umbral de comparación configurable: <strong>{thresholdDeg}°</strong>
        <input type="range" min="2" max="30" step="1" value={thresholdDeg} onChange={e => onThresholdChange(Number(e.target.value))} aria-label="Umbral de pendiente configurable en grados"/>
      </label>
      <div className="slope-scale-buttons" role="group" aria-label="Escala base de cálculo de pendiente">
        {([1, 2, 4] as const).map(px => <button key={px} type="button" className={baselinePixels === px ? 'active' : ''} onClick={() => onBaselineChange(px)}>{px * 240} m ({px} px)</button>)}
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
          <span>Paso real de malla: {slope.groundSpacingM.toFixed(1)} m (resolución 240 m/px)</span>
        </div>
      </div>
      <div className="slope-multiscale">
        {slope.multiscale.map(item => <span key={item.baselineM} className="slope-scale-pill">Base {item.baselineM.toFixed(0)} m: <strong>{item.slopeDeg.toFixed(2)}°</strong></span>)}
      </div>
    </> : <p className="slope-Unavailable">{error || 'Activa el backend con el DEM LOLA (VITE_USE_API=true) para calcular la pendiente regional.'}</p>}
    <p className="slope-disclaimer">
      <strong>Nota científica:</strong> Evaluación regional preliminar calculada por diferencias finitas (Horn 3×3) sobre el DEM LOLA de 240 m/píxel. No resuelve cráteres locales, rocas ni pendientes a escala de las patas de un módulo, y el valor depende de la línea de base elegida. No existe un umbral universal (p. ej. 10°); los límites dependen del vehículo y del método de medición. Este indicador <strong>no etiqueta ningún punto como «aterrizaje seguro»</strong>.
    </p>
  </section>
}

export default function App() {
  const [site, setSite] = useState(SITES[0])
  const [customSite, setCustomSite] = useState<Site | null>(null)
  const [date, setDate] = useState(initialDate)
  const [scenario, setScenario] = useState<Scenario>(() => emptyScenario(SITES[0], initialDate))
  const [hour, setHour] = useState(48)
  const [mode, setMode] = useState<'explorer' | 'analyst'>('explorer')
  const [tab, setTab] = useState<'overview' | 'compare'>('overview')
  const [compareId, setCompareId] = useState(SITES[1].id)
  const [search, setSearch] = useState('')
  const [minSun, setMinSun] = useState(45)
  const [minEarth, setMinEarth] = useState(60)
  const [maxBlackout, setMaxBlackout] = useState(24)
  const [slopeThreshold, setSlopeThreshold] = useState(15)
  const [slopeBaseline, setSlopeBaseline] = useState<1 | 2 | 4>(1)
  const [slope, setSlope] = useState<SlopeResult | null>(null)
  const [comparedSlope, setComparedSlope] = useState<SlopeResult | null>(null)
  const [slopeError, setSlopeError] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [apiError, setApiError] = useState<string | null>(null)
  const [compareError, setCompareError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const selectSite = (candidate: Site) => {
    if (candidate.lat !== site.lat || candidate.lon !== site.lon) {
      setLoading(true)
      setApiError(null)
      setSite(candidate)
    }
    setTab('overview')
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
  useEffect(() => { const controller = new AbortController(); setLoading(true); setApiError(null); analyze(site, date, controller.signal).then(result => { setScenario(result); setHour(Math.min(48, result.hours)); setLoading(false) }).catch(error => { if (controller.signal.aborted) return; setApiError(`No se pudo consultar el backend: ${String(error)}`); setLoading(false) }); return () => controller.abort() }, [site, date, retry])
  useEffect(() => {
    if (!apiEnabled) { setSlope(null); setSlopeError(null); return }
    const controller = new AbortController()
    setSlopeError(null)
    fetchSlope(site, slopeBaseline, 1000, slopeThreshold, controller.signal).then(setSlope).catch(err => {
      if (controller.signal.aborted) return
      setSlope(null)
      setSlopeError(`Pendiente no disponible: ${String(err)}`)
    })
    return () => controller.abort()
  }, [site, slopeBaseline, slopeThreshold])
  useEffect(() => { if (compareId === site.id) setCompareId(SITES.find(s => s.id !== site.id)!.id) }, [compareId, site.id])
  const m = useMemo(() => metrics(scenario), [scenario])
  const status = verdict(m, minSun, minEarth, maxBlackout)
  const [comparedState, setCompared] = useState<Scenario>(() => emptyScenario(SITES[1], initialDate))
  useEffect(() => { if (tab !== 'compare') return; const controller = new AbortController(); const comparisonSite = SITES.find(s => s.id === compareId) || SITES[1]; setCompareError(null); analyze(comparisonSite, date, controller.signal).then(setCompared).catch(error => { if (controller.signal.aborted) return; setCompareError(`No se pudo analizar ${comparisonSite.name}: ${String(error)}`) }); return () => controller.abort() }, [compareId, date, tab, retry])
  useEffect(() => {
    if (!apiEnabled || tab !== 'compare') { setComparedSlope(null); return }
    const controller = new AbortController()
    const comparisonSite = SITES.find(s => s.id === compareId) || SITES[1]
    fetchSlope(comparisonSite, slopeBaseline, 1000, slopeThreshold, controller.signal).then(setComparedSlope).catch(() => {
      if (!controller.signal.aborted) setComparedSlope(null)
    })
    return () => controller.abort()
  }, [compareId, slopeBaseline, slopeThreshold, tab])
  const compared = comparedState
  const compareMetrics = metrics(compared)
  const noticeError = apiError || (tab === 'compare' ? compareError : null)
  const primaryReady = scenario.source === 'api' && scenario.site.lat === site.lat && scenario.site.lon === site.lon && scenario.start === date && !loading && !apiError
  const comparisonReady = tab !== 'compare' || (compared.source === 'api' && compared.site.id === compareId && compared.start === date && !compareError)
  const ready = primaryReady && comparisonReady
  const filteredSites = SITES.filter(s => s.name.toLowerCase().includes(search.toLowerCase()))
  const currentSample = scenario.samples[Math.min(hour, scenario.samples.length - 1)]
  return <div className="app-shell">
    <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
      <div className="brand"><div className="brand-symbol"><Moon size={22}/><span/></div><div><strong>LUNARPATH<span> AI</span></strong><small>MISSION PLANNING PLATFORM</small></div><button className="mobile-close" onClick={() => setSidebarOpen(false)} aria-label="Cerrar menú"><X size={20}/></button></div>
      <div className="sidebar-section-title">NAVEGACIÓN</div>
      <button className={`nav-item ${tab === 'overview' ? 'selected' : ''}`} onClick={() => { setTab('overview'); setSidebarOpen(false) }}><Compass size={18}/> Explorador lunar <ChevronRight size={15}/></button>
      <button className={`nav-item ${tab === 'compare' ? 'selected' : ''}`} onClick={() => { setTab('compare'); setSidebarOpen(false) }}><Layers3 size={18}/> Comparar sitios <ChevronRight size={15}/></button>
      <div className="sidebar-section-title sites-title">SITIOS CANDIDATOS <span>04</span></div>
      <div className="site-search"><Search size={15}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar región..." aria-label="Buscar sitios"/></div>
      <div className="site-list">{customSite && <button className={`site-item ${site.id === 'custom' ? 'active' : ''}`} onClick={() => selectSite(customSite)}><span className="site-number"><MapPin size={14}/></span><span><strong>Punto personalizado</strong><small>{Math.abs(customSite.lat).toFixed(3)}° S · {customSite.lon.toFixed(3)}° E</small></span>{site.id === 'custom' && <span className="active-indicator"/>}</button>}{filteredSites.map(item => <button key={item.id} className={`site-item ${item.id === site.id ? 'active' : ''}`} onClick={() => selectSite(item)}><span className="site-number">0{SITES.indexOf(item) + 1}</span><span><strong>{item.name}</strong><small>{item.region}</small></span>{item.id === site.id && <span className="active-indicator"/>}</button>)}{filteredSites.length === 0 && <p className="empty-search">Sin resultados</p>}</div>
      <div className="sidebar-bottom"><div className="mission-card"><span className="mini-orbit"><span/></span><small>PROYECTO</small><strong>South Pole<br/>Explorer</strong><span className="mission-card-foot">NASA SPACE APPS 2026 <ArrowUpRight size={14}/></span></div><div className="sidebar-note"><CircleHelp size={15}/> Resultados solo con datos de la API</div></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><button className="mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="Abrir menú"><Menu size={21}/></button><div className="breadcrumbs">LUNARPATH <ChevronRight size={13}/> <strong>{tab === 'overview' ? 'Explorador' : 'Comparación'}</strong></div><div className="top-actions"><span className={`source-pill ${ready ? 'api' : ''}`}><span className="live-dot"/>{ready ? 'DATOS API' : loading ? 'CALCULANDO' : 'SIN DATOS'}</span><span className="top-divider"/><span className="avatar">LP</span></div></header>
      <main className="content">
        <div className="page-heading"><div><div className="eyebrow"><span/> LUNAR SOUTH POLE / MISSION ANALYSIS</div><h1>{tab === 'overview' ? 'Explorador lunar' : 'Comparar sitios'}<span className="heading-star">✦</span></h1><p>{tab === 'overview' ? 'Explora condiciones de iluminación y visibilidad terrestre para planificar una misión.' : 'Evalúa dos ubicaciones bajo las mismas condiciones y restricciones.'}</p></div><div className="heading-actions"><button className="outline-button" disabled={!primaryReady} onClick={() => downloadCsv(scenario)}><Download size={16}/> Exportar CSV</button><button className="primary-button" onClick={() => setTab(tab === 'overview' ? 'compare' : 'overview')}>{tab === 'overview' ? <Plus size={17}/> : <Compass size={17}/>} {tab === 'overview' ? 'Comparar sitios' : 'Volver al explorador'}</button></div></div>
        <div className="notice" role={noticeError ? 'alert' : undefined}><span className="notice-icon"><Activity size={16}/></span><span><strong>{noticeError || (loading ? 'Calculando efemérides y horizonte del sitio.' : ready ? 'Análisis del backend conectado.' : 'Esperando datos científicos.')}</strong> {ready ? 'Horizons y LOLA · análisis regional preliminar.' : 'Inicia FastAPI y verifica la conexión para obtener resultados.'}</span></div>
        {!ready ? <section className="panel data-unavailable"><h2>{loading || !apiError ? 'Consultando datos de misión…' : 'Análisis no disponible'}</h2><p>{apiError || compareError || 'El mapa y las métricas aparecerán cuando responda la API.'}</p><p>{apiError?.includes('502') ? 'JPL Horizons no respondió a esta consulta. Puedes reintentarla.' : 'Backend: cd backend · .venv\Scripts\python -m uvicorn app.main:app --reload'}</p><button className="primary-button" onClick={() => setRetry(value => value + 1)}>Reintentar análisis</button><label>Fecha de inicio (UTC) <input type="date" value={date} onChange={e => selectDate(e.target.value || initialDate)}/></label></section> : tab === 'overview' ? <>
          <div className="workspace-grid">
            <section className="panel map-panel"><div className="panel-heading"><div><span className="section-kicker">01 / SELECCIÓN DE SITIO</span><h2>Explorador de superficie</h2></div><span className="icon-button" title="Fotografía LROC y relieve LOLA"><Layers3 size={18}/></span></div><LunarMap site={site} onSelect={selectSite} onPick={pickCoordinate}/><p className="map-caption">{site.id === 'custom' ? 'Punto exploratorio' : 'Región de muestra'} · Mosaico WAC sin sombras de la fecha elegida ni detalle de rocas pequeñas.</p><div className="selected-site"><span className="selected-pin"><MapPin size={18}/></span><div><small>SITIO SELECCIONADO</small><strong>{site.name}</strong><span>{Math.abs(site.lat).toFixed(3)}° S · {Math.abs(site.lon).toFixed(3)}° {site.lon < 0 ? 'O' : 'E'}</span><a className="trek-link" href="https://trek.nasa.gov/moon/" target="_blank" rel="noopener noreferrer" title="Abre el portal; verifica estas coordenadas con la herramienta Fly To">Abrir NASA Moon Trek ↗</a></div><ChevronRight size={18}/></div><CoordinateForm site={site} onPick={pickCoordinate}/></section>
            <section className="panel horizon-panel"><div className="panel-heading"><div><span className="section-kicker">02 / VISUALIZACIÓN</span><h2>Horizonte local</h2></div><span className="timestamp"><Clock3 size={14}/> {formatHour(date, hour)}</span></div><Horizon scenario={scenario} hour={hour}/><div className="horizon-status"><span className={`status-badge ${currentSample.sunVisible ? 'good' : 'bad'}`}><Sun size={14}/>{currentSample.sunVisible ? 'Sol visible' : 'Sol oculto'}</span><span className={`status-badge ${currentSample.earthVisible ? 'good blue-badge' : 'bad'}`}><Radio size={14}/>{currentSample.earthVisible ? 'Tierra visible' : 'Tierra oculta'}</span><span className="horizon-note">Elevación respecto al horizonte local</span></div></section>
            <section className="panel controls-panel"><div className="panel-heading"><div><span className="section-kicker">03 / CONFIGURACIÓN</span><h2>Parámetros de misión</h2></div><Settings2 size={18} className="muted-icon"/></div><label className="field-label" htmlFor="date">FECHA DE INICIO (UTC)</label><input className="date-input" id="date" type="date" value={date} onChange={e => selectDate(e.target.value || initialDate)}/><div className="control-divider"/><div className="field-label">VISTA DE CRITERIOS</div><div className="mode-toggle"><button className={mode === 'explorer' ? 'active' : ''} onClick={() => setMode('explorer')}>Explorar</button><button className={mode === 'analyst' ? 'active' : ''} onClick={() => setMode('analyst')}>Criterios</button></div><div className="control-divider"/><div className="field-label">VENTANA TEMPORAL</div><div className="select-like" title="Ventana de análisis fija">7 días fijos</div><p className="field-hint">Muestras cada hora · {scenario.samples.length} puntos</p>{mode === 'analyst' && <div className="analyst-fields"><label>Sol visible mínimo <strong>{minSun}%</strong><input type="range" min="0" max="100" value={minSun} onChange={e => setMinSun(Number(e.target.value))}/></label><label>Tierra visible mínimo <strong>{minEarth}%</strong><input type="range" min="0" max="100" value={minEarth} onChange={e => setMinEarth(Number(e.target.value))}/></label><label>Blackout máximo <strong>{maxBlackout} h</strong><input type="range" min="0" max="72" value={maxBlackout} onChange={e => setMaxBlackout(Number(e.target.value))}/></label><label>Umbral pendiente LOLA <strong>{slopeThreshold}°</strong><input type="range" min="2" max="30" value={slopeThreshold} onChange={e => setSlopeThreshold(Number(e.target.value))}/></label></div>}</section>
          </div>
          <div className="metrics-heading"><div><span className="section-kicker">CONDICIONES DE MISIÓN</span><h2>Resumen de condiciones</h2></div><span className="period-label"><Clock3 size={15}/> Periodo de 7 días {loading && '· Actualizando...'}</span></div>
          <div className="metric-grid"><MetricCard icon={<Sun size={20}/>} label="Visibilidad solar" value={m.sunPercent} suffix="%" color="amber-bg" detail="Tiempo con Sol sobre el relieve"/><MetricCard icon={<Earth size={20}/>} label="Visibilidad terrestre" value={m.earthPercent} suffix="%" color="blue-bg" detail="Línea de vista directa"/><MetricCard icon={<Moon size={20}/>} label="Oscuridad más larga" value={m.longestDark} suffix="h" color="purple-bg" detail="Intervalo continuo sin Sol"/><MetricCard icon={<Radio size={20}/>} label="Blackout máximo" value={m.longestBlackout} suffix="h" color="mint-bg" detail="Sin visibilidad terrestre"/></div>
          <div className="lower-grid"><section className="panel timeline-panel"><div className="panel-heading"><div><span className="section-kicker">04 / EVOLUCIÓN TEMPORAL</span><h2>Línea de tiempo de misión</h2></div><span className="timeline-help"><span className="legend-dot sun"/> Luz solar <span className="legend-dot earth"/> Tierra visible</span></div><Timeline scenario={scenario} hour={hour} onHourChange={setHour}/></section><section className="panel feasibility-panel"><div className="panel-heading"><div><span className="section-kicker">05 / EVALUACIÓN</span><h2>Restricciones operativas</h2></div><Gauge size={18} className="muted-icon"/></div><div className="feasibility-top"><div className={`score-orb ${status.feasible ? 'pass' : ''}`}>{status.count}<small>/3</small></div><div><strong>{status.feasible ? 'Cumple criterios de luz y enlace' : 'Revisar restricciones'}</strong><span>{status.count} de 3 condiciones satisfechas (no certifica aterrizaje)</span></div></div><div className="criteria-list"><div><span className={status.passed[0] ? 'criteria-ok' : 'criteria-no'}>{status.passed[0] ? <Check size={13}/> : <X size={13}/>}</span> Luz solar ≥ {minSun}% <strong>{m.sunPercent}%</strong></div><div><span className={status.passed[1] ? 'criteria-ok' : 'criteria-no'}>{status.passed[1] ? <Check size={13}/> : <X size={13}/>}</span> Tierra visible ≥ {minEarth}% <strong>{m.earthPercent}%</strong></div><div><span className={status.passed[2] ? 'criteria-ok' : 'criteria-no'}>{status.passed[2] ? <Check size={13}/> : <X size={13}/>}</span> Blackout ≤ {maxBlackout} h <strong>{m.longestBlackout} h</strong></div></div><button className="text-button" onClick={() => setMode('analyst')}>Ajustar criterios <ArrowRight size={15}/></button></section></div>
          <RegionalSlopeCard slope={slope} error={slopeError} baselinePixels={slopeBaseline} onBaselineChange={setSlopeBaseline} thresholdDeg={slopeThreshold} onThresholdChange={setSlopeThreshold}/>
          <Suspense fallback={<p className="terrain-3d-message">Cargando visor 3D…</p>}><Terrain3D site={site} sample={currentSample}/></Suspense>
        </> : <div className="compare-layout"><section className="panel comparison-panel"><div className="panel-heading"><div><span className="section-kicker">COMPARACIÓN DE ESCENARIOS</span><h2>Dos sitios, una ventana temporal</h2></div><span className="period-label"><Clock3 size={14}/> {date} · 7 días</span></div><div className="comparison-selectors"><div><label>SITIO A</label><div className="site-select-display"><MapPin size={17}/>{site.name}</div></div><span className="versus">VS</span><div><label htmlFor="compare-site">SITIO B</label><select id="compare-site" value={compareId} onChange={e => setCompareId(e.target.value)}>{SITES.filter(s => s.id !== site.id).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div></div><div className="comparison-table"><div className="table-head"><span>MÉTRICA</span><strong>{site.name} · API</strong><strong>{compared.site.name} · API</strong></div>{[
            ['Visibilidad solar', `${m.sunPercent}%`, `${compareMetrics.sunPercent}%`, m.sunPercent, compareMetrics.sunPercent],
            ['Visibilidad terrestre', `${m.earthPercent}%`, `${compareMetrics.earthPercent}%`, m.earthPercent, compareMetrics.earthPercent],
            ['Oscuridad más larga', `${m.longestDark} h`, `${compareMetrics.longestDark} h`, -m.longestDark, -compareMetrics.longestDark],
            ['Blackout máximo', `${m.longestBlackout} h`, `${compareMetrics.longestBlackout} h`, -m.longestBlackout, -compareMetrics.longestBlackout],
            ['Disponibilidad simultánea', `${m.concurrentPercent}%`, `${compareMetrics.concurrentPercent}%`, m.concurrentPercent, compareMetrics.concurrentPercent],
            ...(slope && comparedSlope ? [['Pendiente regional LOLA (' + slope.baselineM.toFixed(0) + ' m)', `${slope.slopeDeg.toFixed(2)}° (P90 ${slope.neighborhood.p90Deg.toFixed(1)}°)`, `${comparedSlope.slopeDeg.toFixed(2)}° (P90 ${comparedSlope.neighborhood.p90Deg.toFixed(1)}°)`, -slope.slopeDeg, -comparedSlope.slopeDeg]] : []),
          ].map(([name, a, b, av, bv]) => <div className="table-row" key={String(name)}><span>{name}</span><strong className={Number(av) > Number(bv) ? 'winner' : ''}>{a}{Number(av) > Number(bv) && <ArrowUpRight size={14}/>}</strong><strong className={Number(bv) > Number(av) ? 'winner' : ''}>{b}{Number(bv) > Number(av) && <ArrowUpRight size={14}/>}</strong></div>)}</div></section><section className="panel compare-aside"><span className="section-kicker">ANÁLISIS RÁPIDO</span><h2>Balance de misión</h2><p>Compara luz, comunicaciones y relieve regional durante el mismo periodo.</p><div className="compare-mini"><span><Sun size={17}/> Ventaja solar</span><strong>{m.sunPercent >= compareMetrics.sunPercent ? site.name : compared.site.name} <ArrowDownRight size={15}/></strong></div><div className="compare-mini"><span><Radio size={17}/> Ventaja de comunicación</span><strong>{m.earthPercent >= compareMetrics.earthPercent ? site.name : compared.site.name} <ArrowDownRight size={15}/></strong></div><div className="compare-mini"><span><ShieldCheck size={17}/> Restricciones (luz/enlace)</span><strong>{verdict(m, minSun, minEarth, maxBlackout).count} / 3 vs {verdict(compareMetrics, minSun, minEarth, maxBlackout).count} / 3</strong></div><button className="primary-button full" onClick={() => selectSite(compared.site)}>Explorar {compared.site.name} <ArrowRight size={16}/></button></section></div>}
        <footer><span>© 2026 LUNARPATH AI · NASA SPACE APPS CHALLENGE</span><span>{ready ? 'EFEMÉRIDES JPL / RELIEVE LOLA 240 M / IAU2000::30120' : 'SIN RESULTADOS CIENTÍFICOS / UTC'}</span></footer>
      </main>
    </div>
  </div>
}
