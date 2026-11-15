import { useState } from 'react'
import { ArrowLeft, ArrowRight, Earth, Lightbulb, Sun } from 'lucide-react'
import { formatHour, metrics, type Scenario } from '../data'
import './mission-detail.css'

function simultaneousWindows(scenario: Scenario) {
  const windows: { start: number; end: number }[] = []
  let start: number | null = null
  for (const sample of scenario.samples) {
    if (sample.sunVisible && sample.earthVisible && start === null) start = sample.hour
    if ((!sample.sunVisible || !sample.earthVisible) && start !== null) {
      windows.push({ start, end: sample.hour })
      start = null
    }
  }
  if (start !== null && start < scenario.hours) windows.push({ start, end: scenario.hours })
  return windows.filter(window => window.end > window.start)
    .sort((a, b) => (b.end - b.start) - (a.end - a.start)).slice(0, 3)
}

function HorizonProfile({ scenario, index }: { scenario: Scenario; index: number }) {
  const sample = scenario.samples[index]
  const profile = scenario.horizonProfile
  if (!profile?.length || !sample) return <p className="detail-muted">No hay información del terreno para esta vista.</p>
  const elevations = profile.map(point => point.elevation)
  const low = Math.floor(Math.min(-5, sample.sunElevation, sample.earthElevation, ...elevations) - 1)
  const high = Math.ceil(Math.max(8, sample.sunElevation, sample.earthElevation, ...elevations) + 1)
  const x = (azimuth: number) => azimuth / 360 * 800
  const y = (elevation: number) => 210 - (elevation - low) / (high - low) * 180
  const points = [...profile, { azimuth: 360, elevation: profile[0].elevation }]
  const line = points.map((point, i) => `${i ? 'L' : 'M'}${x(point.azimuth).toFixed(1)} ${y(point.elevation).toFixed(1)}`).join(' ')
  return <div className="detail-chart">
    <svg viewBox="0 0 800 250" role="img" aria-label="Silueta del terreno con posiciones del Sol y la Tierra">
      <line x1="0" x2="800" y1={y(0)} y2={y(0)} stroke="#a8b8cb" strokeDasharray="5 5"/>
      <path d={`${line} L800 250 L0 250 Z`} fill="#aab9ca"/>
      <path d={line} fill="none" stroke="#526d89" strokeWidth="2"/>
      <circle cx={x(sample.sunAzimuth ?? 0)} cy={y(sample.sunElevation)} r="8" fill="#e99932" opacity={sample.sunVisible ? 1 : .4}/>
      <circle cx={x(sample.earthAzimuth ?? 0)} cy={y(sample.earthElevation)} r="7" fill="#2865ca" opacity={sample.earthVisible ? 1 : .4}/>
      {['N', 'E', 'S', 'O', 'N'].map((label, i) => <text key={i} x={Math.max(5, Math.min(785, i * 200))} y="242" fontSize="11" fill="#263e57">{label}</text>)}
    </svg>
    <div className="detail-legend"><span><i className="sun"/> Sol {sample.sunVisible ? 'a la vista' : 'oculto'}</span>
      <span><i className="earth"/> Tierra {sample.earthVisible ? 'a la vista' : 'oculta'}</span>
      <span><i className="terrain"/> Montañas y bordes de cráter</span></div>
  </div>
}

export function MissionDetailView({ scenario, onCompare, onPlan, hasComparison = false }: {
  scenario: Scenario | null
  onCompare: () => void
  onPlan: () => void
  hasComparison?: boolean
}) {
  const [index, setIndex] = useState(0)
  if (!scenario || !scenario.samples.length) return <section className="detail-view detail-empty">
    <span className="detail-kicker">DETALLE DE UN LUGAR</span><h1>Explora el detalle de un lugar</h1>
    <p>Elige un lugar desde la comparación para ver cuándo hay luz y vista a la Tierra.</p>
    <button className="detail-primary" onClick={onPlan}>Configurar misión <ArrowRight size={16}/></button>
  </section>

  const current = Math.min(index, scenario.samples.length - 1)
  const sample = scenario.samples[current]
  const m = metrics(scenario)
  const windows = simultaneousWindows(scenario)
  const explanation = sample.sunVisible && sample.earthVisible
    ? 'En esta hora hay luz solar y se puede ver la Tierra desde el lugar elegido.'
    : sample.sunVisible
      ? 'En esta hora hay luz solar, pero la Tierra queda bajo el horizonte local.'
      : sample.earthVisible
        ? 'En esta hora se ve la Tierra, pero el Sol queda bajo el horizonte local; los paneles no reciben luz directa.'
        : 'En esta hora ni el Sol ni la Tierra quedan por encima del horizonte local.'

  return <div className="detail-view">
    <button className="detail-back" onClick={onCompare}><ArrowLeft size={16}/> {hasComparison ? 'Volver a la comparación' : 'Elegir lugares para comparar'}</button>
    <div className="detail-heading"><span className="detail-kicker">EXPLORA LAS CONDICIONES HORA POR HORA</span>
      <h1>{scenario.site.name.replace('(fondo PSR)', '(cráter en sombra)')}</h1>
      <p>{scenario.site.note} · {Math.abs(scenario.site.lat).toFixed(3)}° S · {Math.abs(scenario.site.lon).toFixed(3)}° {scenario.site.lon < 0 ? 'O' : 'E'}</p>
    </div>

    <section className="detail-panel"><span className="detail-kicker">LO QUE VES DESDE ESTE LUGAR</span>
      <h2>¿El terreno tapa el Sol o la Tierra?</h2>
      <p>La zona gris representa montañas y bordes de cráter. Si el Sol o la Tierra quedan detrás de ella, no se ven desde este lugar.</p>
      <HorizonProfile scenario={scenario} index={current}/>
      <p className="detail-meaning" aria-live="polite">{explanation}</p>
      <label className="detail-time">Elige una hora: <strong>{formatHour(scenario.start, sample.hour)}</strong>
        <input type="range" min="0" max={scenario.samples.length - 1} value={current} onChange={e => setIndex(Number(e.target.value))}/>
      </label>
    </section>

    <div className="detail-summary"><div><Sun size={20}/><span>Tiempo con luz solar<strong>{m.sunPercent}%</strong><small>de la semana analizada</small></span></div>
      <div><Earth size={20}/><span>Tiempo con vista a la Tierra<strong>{m.earthPercent}%</strong><small>posibilidad de enlace directo</small></span></div>
      <div><Lightbulb size={20}/><span>Tiempo con ambas<strong>{m.concurrentPercent}%</strong><small>luz y vista a la Tierra a la vez</small></span></div></div>

    <div className="detail-columns"><section className="detail-panel"><span className="detail-kicker">MOMENTOS FAVORABLES</span>
      <h2>¿Cuándo coinciden la luz y la Tierra?</h2><p>Estos son los tramos más largos, sin interrupciones, dentro de la semana.</p>
      {windows.length ? <div className="detail-windows">{windows.map((window, i) => <article key={window.start}>
        <span>{String(i + 1).padStart(2, '0')}</span><div><strong>{window.end - window.start} horas estimadas</strong>
          <p>{formatHour(scenario.start, window.start)} — {formatHour(scenario.start, window.end)}</p></div>
      </article>)}</div> : <p className="detail-muted">No encontramos una hora en que coincidan luz solar y vista a la Tierra. Prueba otra fecha o lugar.</p>}
    </section><section className="detail-panel"><span className="detail-kicker">QUÉ HACER CON ESTE RESULTADO</span>
      <h2>Compara antes de elegir</h2><p>Un lugar con más luz puede facilitar el uso de paneles solares. Poder ver la Tierra abre una posibilidad de comunicación directa; aún hay que comprobar el equipo de radio.</p>
      <details className="detail-method"><summary>¿Cómo se obtuvo esta información?</summary><p>Las posiciones del Sol y la Tierra provienen de JPL Horizons y la forma del terreno de mediciones lunares LOLA. Se revisa una vez por hora, por lo que un cambio breve entre revisiones podría pasar inadvertido. El resultado no certifica la seguridad de un aterrizaje.</p></details>
      <button className="detail-primary" onClick={onPlan}>Probar otro lugar o fecha <ArrowRight size={16}/></button>
    </section></div>
  </div>
}
