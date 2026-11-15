import { ArrowLeft, ArrowRight, Earth, Lightbulb, Sun } from 'lucide-react'
import { metrics, type Sample } from '../data'
import { longestWindow, type ComparisonResults, type Priority } from '../mission-planning/comparison'
import './mission-results.css'

const priorityLabels: Record<Priority, string> = {
  solar: 'luz solar', earth: 'vista directa a la Tierra', balanced: 'luz solar y vista a la Tierra al mismo tiempo',
}
const stateClass = (s: Sample) => s.sunVisible ? (s.earthVisible ? 'both' : 'sun') : (s.earthVisible ? 'earth' : 'neither')
const stateLabel = (s: Sample) => s.sunVisible ? (s.earthVisible ? 'Sol y Tierra visibles' : 'Solo el Sol visible') : (s.earthVisible ? 'Solo la Tierra visible' : 'Sol y Tierra ocultos')
const displayDate = (date: string) => new Intl.DateTimeFormat('es', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`))

function explainZero(priority: Priority, sunSeen: boolean, earthSeen: boolean) {
  if (priority === 'balanced' && sunSeen && earthSeen) return 'Hay momentos con luz y otros con vista a la Tierra, pero no coinciden esta semana.'
  if (priority === 'balanced' && !sunSeen && !earthSeen) return 'Ni el Sol ni la Tierra quedaron a la vista durante las horas analizadas.'
  if (priority === 'solar' || priority === 'balanced' && !sunSeen) return 'No se encontró luz solar directa durante las horas analizadas.'
  return 'La Tierra no quedó a la vista durante las horas analizadas.'
}

export function MissionResultsView({ result, onEdit, onDetail }: { result: ComparisonResults | null; onEdit: () => void; onDetail: (id: string, date: string) => void }) {
  if (!result) return <section className="results-view results-empty"><span className="results-kicker">COMPARACIÓN DE MISIÓN</span><h1>Compara tus lugares lunares</h1><p>Elige una fecha y dos lugares para saber cuándo reciben luz y cuándo se puede ver la Tierra.</p><button className="results-primary" onClick={onEdit}>Configurar misión <ArrowRight size={16}/></button></section>
  const { scenarios, date, duration, priority } = result
  const windows = scenarios.map(s => longestWindow(s, priority))
  const passing = scenarios.filter((_, i) => windows[i] >= duration)
  const longest = Math.max(...windows)
  const conclusion = passing.length === scenarios.length ? 'Los dos lugares cumplen lo que pediste' : passing.length === 1 ? `${passing[0].site.name} cumple lo que pediste` : 'Ninguno de los dos lugares cumple tu requisito esta semana'
  const nextStep = passing.length ? 'Compara también cuánta luz y vista a la Tierra tiene cada lugar antes de estudiar uno con más detalle.' : longest === 0 ? 'No encontramos ningún tramo continuo con la condición elegida. Prueba otra fecha, otros lugares o cambia la prioridad.' : `El tramo más largo fue de ${longest} horas, menos de las ${duration} que necesitas. Prueba otra fecha o reduce la duración requerida.`
  return <div className="results-view">
    <div className="results-heading"><div><span className="results-kicker">COMPARACIÓN DE DOS LUGARES</span><h1>¿Dónde conviene explorar?</h1><p>Resultados para los siete días desde el {displayDate(date)}. Todas las horas usan tiempo universal.</p></div><button className="results-secondary" onClick={onEdit}>Cambiar fecha o lugares</button></div>
    <section className="results-conclusion" aria-live="polite"><span className="results-kicker">QUÉ SIGNIFICAN LOS RESULTADOS</span><h2>{conclusion}</h2><p>Buscas al menos <strong>{duration} horas seguidas</strong> con {priorityLabels[priority]}. {nextStep}</p></section>
    <section className="results-goal"><span className="results-goal-icon"><Lightbulb size={21}/></span><div><span className="results-kicker">TU PRIORIDAD</span><h2>{duration} horas seguidas con {priorityLabels[priority]}</h2><p>“Seguidas” significa sin interrupciones. No sumamos momentos separados del día.</p></div></section>
    <section className="results-cards" aria-label="Condiciones por lugar">{scenarios.map((scenario, index) => {
      const values = metrics(scenario), window = windows[index], meets = window >= duration
      return <article key={scenario.site.id} className="results-card"><div className="results-card-top"><span className={meets ? 'results-badge pass' : 'results-badge'}>{meets ? 'Alcanza las horas necesarias' : 'No alcanza las horas necesarias'}</span><span>{Math.abs(scenario.site.lat).toFixed(2)}° S · {Math.abs(scenario.site.lon).toFixed(2)}° {scenario.site.lon < 0 ? 'O' : 'E'}</span></div><h2>{scenario.site.name.replace('(fondo PSR)', '(cráter en sombra)')}</h2><p>{scenario.site.note}</p>
        <div className="results-window"><span>TRAMO MÁS LARGO QUE CUMPLE TU PRIORIDAD</span><strong>{window} {window === 1 ? 'hora' : 'horas'}</strong><p>{window === 0 ? explainZero(priority, scenario.samples.some(sample => sample.sunVisible), scenario.samples.some(sample => sample.earthVisible)) : `Es el periodo continuo más largo; necesitas ${duration} horas seguidas.`}</p></div>
        <div className="results-metric"><span><Sun size={16}/> Sol a la vista</span><b>{values.sunPercent}%</b><div><i style={{ width: `${values.sunPercent}%` }} className="sun"/></div><small>Parte de la semana con luz directa. Puede ayudar a cargar paneles solares.</small></div>
        <div className="results-metric"><span><Earth size={16}/> Tierra a la vista</span><b>{values.earthPercent}%</b><div><i style={{ width: `${values.earthPercent}%` }} className="earth"/></div><small>Parte de la semana con línea de vista. Una señal de radio aún requiere más comprobaciones.</small></div>
        <div className="results-metric"><span>Sol y Tierra a la vez</span><b>{values.concurrentPercent}%</b><div><i style={{ width: `${values.concurrentPercent}%` }} className="both"/></div><small>Tiempo en que coinciden luz y posibilidad de comunicación directa.</small></div>
        <button className="results-detail" onClick={() => onDetail(scenario.site.id, date)}>Ver cuándo aparecen y desaparecen <ArrowRight size={16}/></button></article>
    })}</section>
    <section className="results-timeline"><span className="results-kicker">CÓMO CAMBIAN LAS CONDICIONES</span><h2>Una semana, hora por hora</h2><p>Cada barra recorre los siete días de izquierda a derecha. Los colores indican si hay luz, vista a la Tierra o ambas. Coloca el cursor sobre una franja para ver su hora.</p><div className="results-days">{Array.from({ length: 7 }, (_, day) => { const d = new Date(Date.parse(`${date}T00:00:00Z`) + day * 86400000); return <span key={day}>{new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(d)}</span> })}</div>{scenarios.map(scenario => <div className="results-track" key={scenario.site.id}><strong>{scenario.site.name}</strong><div className="results-segments" role="img" aria-label={`Evolución horaria de Sol y Tierra en ${scenario.site.name}`}>{scenario.samples.map((sample, index) => <span key={index} className={stateClass(sample)} title={`${new Date(Date.parse(`${date}T00:00:00Z`) + (sample.hourOffset ?? sample.hour) * 3600000).toISOString().replace('T', ' ').slice(0, 16)} UTC: ${stateLabel(sample)}`}/>)}</div></div>)}<div className="results-legend"><span><i className="both"/> Sol y Tierra</span><span><i className="sun"/> Solo Sol</span><span><i className="earth"/> Solo Tierra</span><span><i className="neither"/> Ambos ocultos</span></div></section>
    <details className="results-method"><summary>¿De dónde salen estos datos?</summary><p>Calculamos dónde están el Sol y la Tierra y si las montañas o bordes de cráter los tapan desde cada lugar. Usamos posiciones de JPL Horizons y relieve medido por NASA LOLA. Revisamos la situación una vez por hora: un cambio breve entre dos revisiones podría no aparecer. Ver la Tierra no garantiza que una estación pueda recibir la señal, y esto no certifica un aterrizaje.</p></details>
    <button className="results-secondary results-back" onClick={onEdit}><ArrowLeft size={16}/> Probar otra fecha o lugares</button>
  </div>
}
