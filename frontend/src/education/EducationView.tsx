import { lazy, Suspense } from 'react'
import { ArrowRight, CalendarDays, Earth, Sun } from 'lucide-react'
import './education.css'

const EducationMoon = lazy(() => import('./EducationMoon').then(module => ({ default: module.EducationMoon })))

/** Educational presentation is independent of mission analysis and its API state. */
export function EducationView({ onExplore }: { onExplore: () => void }) {
  return <div className="education-view">
    <div className="education-backdrop" role="group" aria-label="Vista ilustrativa de la Luna en el espacio">
      <div className="education-moon" aria-hidden="true"/>
      <Suspense fallback={null}><EducationMoon/></Suspense>
      <span className="education-vitrine-caption">LUNA · VISTA ILUSTRATIVA</span>
    </div>
    <section className="education-hero">
      <div className="education-intro">
        <span className="education-kicker">DIVULGACIÓN CIENTÍFICA Y MUSEOS</span>
        <h1>Explora el Polo Sur <em>de la Luna</em></h1>
        <p>Descubre cuándo y dónde hay luz solar y visibilidad de la Tierra para planificar una misión simulada, sin necesidad de ser experto.</p>
        <div className="education-cta-row">
          <button className="education-cta" onClick={onExplore}>Comenzar a explorar <ArrowRight size={18}/></button>
        </div>
        <div className="education-highlights"><span>Para estudiantes y curiosos</span><span>Datos reales simplificados</span><span>Sin fórmulas complejas</span></div>
      </div>
    </section>
    <section className="education-steps" aria-labelledby="education-steps-title">
      <span className="education-kicker">APRENDIZAJE INTUITIVO</span>
      <h2 id="education-steps-title">¿Cómo se planifica una misión lunar?</h2>
      <p>Tres pasos para comenzar a explorar las condiciones del terreno polar lunar.</p>
      <div className="education-step-grid">
        <article><span className="education-step-icon"><CalendarDays size={20}/></span><span className="education-step-tag">01 / TIEMPO</span><h3>Elige una fecha</h3><p>Selecciona el inicio de tu misión y observa cómo cambian las condiciones durante los siguientes siete días.</p></article>
        <article><span className="education-step-icon gold"><Sun size={20}/></span><span className="education-step-tag">02 / ENERGÍA</span><h3>Encuentra la luz</h3><p>Compara los periodos de luz y oscuridad para entender cuándo podrían funcionar los paneles solares.</p></article>
        <article><span className="education-step-icon"><Earth size={20}/></span><span className="education-step-tag">03 / COMUNICACIÓN</span><h3>Mira hacia casa</h3><p>Consulta cuándo la Tierra está por encima del horizonte local, una condición para la comunicación directa.</p></article>
      </div>
    </section>
    <p className="education-source">Datos topográficos de NASA LRO/LOLA y efemérides JPL Horizons con propósitos educativos. El análisis es regional y no certifica la seguridad de un aterrizaje.</p>
  </div>
}
