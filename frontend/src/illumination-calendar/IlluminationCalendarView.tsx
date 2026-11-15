import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Sun } from 'lucide-react'

import { fetchIlluminationCalendar, type IlluminationCalendar, type IlluminationDay, type IlluminationLevel } from '../api'
import type { Site } from '../data'
import { useLoading } from '../LoadingContext'
import './illumination-calendar.css'

const IlluminationMoon = lazy(() => import('./IlluminationMoon').then(module => ({ default: module.IlluminationMoon })))

const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const LEVEL_LABEL: Record<IlluminationLevel, string> = {
  favorable: 'Favorable',
  partial: 'Casi favorable',
  minimal: 'Casi nulo',
  none: 'Sin luz solar',
}
const monthFormat = new Intl.DateTimeFormat('es', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const dayFormat = new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
const timeFormat = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

function bestDay(days: IlluminationDay[]): IlluminationDay | undefined {
  return [...days].sort((a, b) => b.sunlitPercent - a.sunlitPercent || b.maxClearanceDeg - a.maxClearanceDeg)[0]
}

export function IlluminationCalendarView({ site }: { site: Site }) {
  const { startLoading, stopLoading } = useLoading()
  const today = new Date()
  const [year, setYear] = useState(today.getUTCFullYear())
  const [month, setMonth] = useState(today.getUTCMonth() + 1)
  const [data, setData] = useState<IlluminationCalendar | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const cache = useRef(new Map<string, IlluminationCalendar>())

  useEffect(() => {
    if (loading) {
      startLoading('calendar', `Calculando calendario solar de ${site.name}`)
    } else {
      stopLoading('calendar')
    }
    return () => stopLoading('calendar')
  }, [loading, site.name, startLoading, stopLoading])

  useEffect(() => {
    const key = `${site.lat},${site.lon},${year},${month}`
    const cached = cache.current.get(key)
    const pick = (calendar: IlluminationCalendar) => {
      setData(calendar)
      setSelectedDate(current => calendar.days.some(day => day.date === current) ? current : bestDay(calendar.days)?.date ?? null)
    }
    if (cached) {
      setError(null)
      pick(cached)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    fetchIlluminationCalendar(site, year, month, controller.signal)
      .then(calendar => {
        cache.current.set(key, calendar)
        pick(calendar)
      })
      .catch(reason => {
        if (controller.signal.aborted) return
        setData(null)
        setError(reason instanceof Error ? reason.message : 'No se pudo calcular el calendario')
      })
      .finally(() => !controller.signal.aborted && setLoading(false))
    return () => controller.abort()
  }, [site, year, month])

  const shiftMonth = (delta: number) => {
    const next = new Date(Date.UTC(year, month - 1 + delta, 1))
    setYear(next.getUTCFullYear())
    setMonth(next.getUTCMonth() + 1)
  }

  const cells = useMemo(() => {
    const first = new Date(Date.UTC(year, month - 1, 1))
    const total = new Date(Date.UTC(year, month, 0)).getUTCDate()
    const offset = (first.getUTCDay() + 6) % 7
    const byDate = new Map(data?.days.map(day => [day.date, day]))
    return [
      ...Array.from({ length: offset }, () => null),
      ...Array.from({ length: total }, (_, index) => {
        const date = `${year}-${String(month).padStart(2, '0')}-${String(index + 1).padStart(2, '0')}`
        return { date, number: index + 1, day: byDate.get(date) }
      }),
    ]
  }, [data, year, month])

  const counts = useMemo(() => {
    const result: Record<IlluminationLevel, number> = { favorable: 0, partial: 0, minimal: 0, none: 0 }
    for (const day of data?.days ?? []) result[day.level] += 1
    return result
  }, [data])

  const selected = data?.days.find(day => day.date === selectedDate)
  const best = data ? bestDay(data.days) : undefined
  const todayKey = today.toISOString().slice(0, 10)

  return <div className="illum-view">
    <div className="illum-heading">
      <div>
        <span className="illum-kicker">CALENDARIO DE ILUMINACIÓN</span>
        <h1>{site.name}</h1>
        <p>Compara cuántas horas de luz directa recibe este lugar cada día. Un porcentaje alto indica más tiempo para alimentar paneles solares; todavía hay que revisar las necesidades de la misión.</p>
      </div>
      <div className="illum-month-nav">
        <button type="button" onClick={() => shiftMonth(-1)} aria-label="Mes anterior"><ChevronLeft size={18}/></button>
        <strong>{capitalize(monthFormat.format(new Date(Date.UTC(year, month - 1, 1))))}</strong>
        <button type="button" onClick={() => shiftMonth(1)} aria-label="Mes siguiente"><ChevronRight size={18}/></button>
        <button type="button" className="illum-today" onClick={() => { setYear(today.getUTCFullYear()); setMonth(today.getUTCMonth() + 1) }}>Hoy</button>
      </div>
    </div>

    <section className="illum-calendar" aria-busy={loading}>
      <div className="illum-weekdays">{WEEKDAYS.map(name => <span key={name}>{name}</span>)}</div>
      <div className="illum-grid">
        {cells.map((cell, index) => cell === null
          ? <span key={`empty-${index}`} className="illum-cell empty"/>
          : <button
              key={cell.date}
              type="button"
              className={`illum-cell ${cell.day ? `level-${cell.day.level}` : ''} ${cell.date === selectedDate ? 'selected' : ''} ${cell.date === todayKey ? 'today' : ''}`}
              disabled={!cell.day}
              onClick={() => setSelectedDate(cell.date)}
              aria-pressed={cell.date === selectedDate}
              aria-label={cell.day ? `${cell.number}: ${LEVEL_LABEL[cell.day.level]}, ${cell.day.sunlitPercent}% de luz solar` : `${cell.number}`}
            >
              <span className="illum-number">{cell.number}</span>
              {cell.day && cell.day.level !== 'none' && <span className="illum-percent">{Math.round(cell.day.sunlitPercent)}%</span>}
            </button>)}
      </div>
      {loading && <div className="illum-overlay">Calculando la luz solar para este lugar…</div>}
      {error && <div className="illum-error">{error}</div>}
      <div className="illum-legend">
        <span><i className="level-favorable"/>Favorable · ≥{data?.thresholds.favorable ?? 70}% de luz <b>{counts.favorable}</b></span>
        <span><i className="level-partial"/>Casi favorable · {data?.thresholds.partial ?? 30}–{data?.thresholds.favorable ?? 70}% <b>{counts.partial}</b></span>
        <span><i className="level-minimal"/>Casi nulo · &lt;{data?.thresholds.partial ?? 30}% <b>{counts.minimal}</b></span>
        <span><i className="level-none"/>Sin luz solar <b>{counts.none}</b></span>
      </div>
    </section>

    <section className="illum-detail">
      <div className="illum-moon-panel">
        {selected
          ? <Suspense fallback={<div className="illum-moon"><span className="illum-moon-status">Cargando modelo lunar…</span></div>}>
              <IlluminationMoon latitude={site.lat} longitude={site.lon} sunAzimuthDeg={selected.sunAzimuthDeg} sunElevationDeg={selected.sunElevationDeg}/>
            </Suspense>
          : <div className="illum-moon"><span className="illum-moon-status">Selecciona una fecha del calendario</span></div>}
        <span className="illum-moon-caption">Arrastra para rotar · rueda para acercar · punto azul: {site.name}</span>
      </div>
      <div className="illum-stats">
        {selected ? <>
          <span className="illum-kicker">FECHA SELECCIONADA</span>
          <h2>{capitalize(dayFormat.format(new Date(`${selected.date}T00:00:00Z`)))}</h2>
          <span className={`illum-badge level-${selected.level}`}>{LEVEL_LABEL[selected.level]}</span>
          <div className="illum-stat-grid">
            <div><span>Luz solar en el día</span><strong>{selected.sunlitPercent}%</strong></div>
            <div><span>Mejor momento</span><strong>{timeFormat.format(new Date(selected.bestTimeUtc))} UTC</strong></div>
            <div><span>¿Llega luz directa este día?</span><strong>{selected.sunlitPercent > 0 ? 'Sí' : 'No'}</strong></div>
          </div>
          {best && best.date !== selected.date && <button type="button" className="illum-best" onClick={() => setSelectedDate(best.date)}><Sun size={15}/> Ir al mejor día del mes ({Number(best.date.slice(8))}, {best.sunlitPercent}%)</button>}
          <p className="illum-note">El porcentaje indica cuánto tiempo del día llega luz solar directa a este lugar. Las montañas y los bordes de cráter pueden ocultar el Sol.</p>
          <details className="illum-note"><summary>Ver datos de posición y procedencia</summary><p>Altura del Sol: {selected.sunElevationDeg.toFixed(2)}°. Dirección: {selected.sunAzimuthDeg.toFixed(1)}°. Separación respecto al terreno: {selected.maxClearanceDeg.toFixed(2)}°. Posiciones: JPL Horizons. Relieve: NASA LOLA {data?.horizonSource === 'LOLA_20M_NEAR_240M_FAR' ? '20 m cercano y 240 m lejano' : '240 m'}.</p></details>
        </> : <p className="illum-note">{loading ? 'Calculando…' : 'Sin datos para este mes.'}</p>}
      </div>
    </section>
  </div>
}
