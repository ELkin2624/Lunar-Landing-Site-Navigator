import { lazy, Suspense, useEffect, useState } from 'react'
import { ArrowRight, CalendarDays, Check, Earth, Lightbulb, MapPin, Sun } from 'lucide-react'
import { analyze } from '../api'
import { metrics, type Scenario, type Site } from '../data'
import { longestWindow, type Priority, type ComparisonResults } from './comparison'
import './mission-planning.css'

const OrbitalView = lazy(() => import('./orbital-view/OrbitalView').then(module => ({ default: module.OrbitalView })))

const priorities: { id: Priority; title: string; description: string }[] = [
  { id: 'solar', title: 'Más luz solar', description: 'Prioriza la disponibilidad de luz para la misión.' },
  { id: 'earth', title: 'Más vista a la Tierra', description: 'Prioriza la visibilidad para comunicación directa.' },
  { id: 'balanced', title: 'Equilibrio entre ambas', description: 'Busca luz y visibilidad terrestre al mismo tiempo.' },
]
export function MissionPlanningView({ sites, initialDate, initialResult, onCompared }: { sites: Site[]; initialDate: string; initialResult: ComparisonResults | null; onCompared: (result: ComparisonResults) => void }) {
  const [date, setDate] = useState(initialResult?.date ?? initialDate)
  const [duration, setDuration] = useState(initialResult?.duration ?? 6)
  const [priority, setPriority] = useState<Priority>(initialResult?.priority ?? 'solar')
  const [selected, setSelected] = useState<string[]>(() => initialResult?.scenarios.map(scenario => scenario.site.id) ?? [])
  const [help, setHelp] = useState(false)
  const [results, setResults] = useState<Scenario[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [controller, setController] = useState<AbortController | null>(null)
  useEffect(() => () => controller?.abort(), [controller])
  const resetResult = () => { controller?.abort(); setController(null); setResults(null); setLoading(false); setError('') }
  const toggleSite = (id: string) => {
    resetResult()
    setSelected(previous => previous.includes(id) ? previous.filter(item => item !== id) : previous.length < 2 ? [...previous, id] : previous)
  }
  const compare = async () => {
    if (selected.length !== 2 || !date) return
    const nextController = new AbortController()
    setController(nextController); setLoading(true); setError(''); setResults(null)
    try {
      const chosen = selected.map(id => sites.find(site => site.id === id)!)
      const data = await Promise.all(chosen.map(site => analyze(site, date, nextController.signal)))
      if (!nextController.signal.aborted) { setResults(data); onCompared({ scenarios: data, date, duration, priority }) }
    } catch {
      if (!nextController.signal.aborted) setError('No se pudieron consultar los datos. Comprueba que el backend esté disponible y vuelve a intentarlo.')
    } finally { if (!nextController.signal.aborted) setLoading(false) }
  }
  return <div className="guided">
    <div className="guided-top"><div><span className="guided-kicker">PLANIFICACIÓN ASISTIDA</span><h1>Configura tu misión</h1><p>Elige una fecha y dos sitios para comparar sus condiciones durante siete días.</p></div><button className="guided-help" onClick={() => setHelp(!help)} aria-expanded={help}><Lightbulb size={16}/> Guía rápida</button></div>
    {help && <div className="guided-tip">Elige la fecha, la duración y la prioridad de tu misión. Después selecciona dos sitios en la lista y compara sus resultados.</div>}
    <div className="guided-progress" aria-label="Progreso de la misión"><span className={!results ? 'active' : ''}>1 <b>Elige fecha y sitios</b></span><ArrowRight size={15}/><span className={results ? 'active' : ''}>2 <b>Compara resultados</b></span></div>
    <div className="guided-grid"><section className="guided-config" aria-label="Configuración de misión">
      <label className="guided-label" htmlFor="guided-date">¿Cuándo viajarás?</label><div className="guided-date"><CalendarDays size={18}/><input id="guided-date" type="date" value={date} onChange={e => { resetResult(); setDate(e.target.value) }}/></div><p className="guided-hint">Fecha de inicio UTC · ventana de 7 días</p>
      <fieldset><legend>¿Cuántas horas seguidas necesitas?</legend><p>Duración mínima de la condición elegida.</p><div className="guided-durations">{[3, 6, 12, 24].map(value => <button type="button" key={value} aria-pressed={duration === value} className={duration === value ? 'selected' : ''} onClick={() => { resetResult(); setDuration(value) }}>{value} h</button>)}</div></fieldset>
      <fieldset><legend>¿Qué es lo más importante?</legend><div className="guided-priorities">{priorities.map(item => <label key={item.id} className={priority === item.id ? 'selected' : ''}><input type="radio" name="mission-priority" checked={priority === item.id} onChange={() => { resetResult(); setPriority(item.id) }}/><span><strong>{item.title}</strong><small>{item.description}</small></span></label>)}</div></fieldset>
      <div className="guided-note"><Lightbulb size={18}/><span>En el polo sur, el relieve puede ocultar el Sol o la Tierra incluso cuando están por encima del horizonte geométrico.</span></div>
    </section><section className="guided-sites" aria-label="Selección de sitios"><div className="guided-sites-heading"><div><span className="guided-kicker">POLO SUR LUNAR</span><h2>Selecciona dos sitios</h2></div><span>{selected.length} / 2 seleccionados</span></div>
      <Suspense fallback={<p className="guided-hint" role="status">Abriendo visor 3D…</p>}>
        <OrbitalView />
      </Suspense>
      <div className="guided-site-list">{sites.map((site, index) => <button type="button" key={site.id} className={selected.includes(site.id) ? 'selected' : ''} aria-pressed={selected.includes(site.id)} onClick={() => toggleSite(site.id)}><span className="guided-site-number">{index + 1}</span><span><strong>{site.name}</strong><small>{site.region} · {Math.abs(site.lat).toFixed(2)}° S</small></span>{selected.includes(site.id) ? <Check size={18}/> : <MapPin size={17}/>}</button>)}</div><p className="guided-hint">{selected.length === 2 ? 'Para cambiar un sitio, primero quítalo de la selección.' : 'Selecciona dos ubicaciones para continuar.'}</p></section></div>
    <div className="guided-action"><div><strong>{selected.length} de 2 sitios seleccionados</strong><small>{selected.map(id => sites.find(site => site.id === id)?.name).join(' · ') || 'Elige sitios en la lista'}</small></div><div><button className="guided-clear" onClick={() => { resetResult(); setSelected([]) }}>Limpiar selección</button><button className="guided-submit" disabled={selected.length !== 2 || !date || loading} onClick={compare}>{loading ? 'Consultando…' : 'Comparar sitios'} <ArrowRight size={17}/></button></div></div>
    {loading && <p className="guided-status" role="status">Consultando las condiciones de ambos sitios…</p>}{error && <p className="guided-error" role="alert">{error}</p>}
    {results && <section className="guided-results" aria-live="polite"><span className="guided-kicker">RESULTADOS · {date} UTC</span><h2>Compara las condiciones</h2><p>Prioridad: {priorities.find(item => item.id === priority)?.title.toLowerCase()} · mínimo {duration} horas seguidas</p><div className="guided-results-grid">{results.map(result => { const m = metrics(result); const window = longestWindow(result, priority); return <article key={result.site.id}><h3>{result.site.name}</h3><div><span><Sun size={16}/> Sol visible</span><strong>{m.sunPercent}%</strong></div><div><span><Earth size={16}/> Tierra visible</span><strong>{m.earthPercent}%</strong></div><div><span>Mayor intervalo de la prioridad</span><strong>{window} h</strong></div><p className={window >= duration ? 'meets' : ''}>{window >= duration ? `Alcanza ${duration} h consecutivas` : `No alcanza ${duration} h consecutivas`}</p></article> })}</div><p className="guided-disclaimer">Estimación con muestras horarias; las transiciones tienen incertidumbre. La visibilidad terrestre no garantiza una comunicación y estos resultados no certifican la seguridad de un aterrizaje.</p></section>}
  </div>
}
