import { SITES, type Site } from '../data'

function polarPoint(site: Site, latitudeRange: number) {
  const radius = (90 + site.lat) / latitudeRange * 82
  const longitude = site.lon * Math.PI / 180
  return { x: 100 + radius * Math.sin(longitude), y: 100 - radius * Math.cos(longitude) }
}

export function PolarSiteInset({ site, onPick }: { site: Site; onPick: (latitude: number, longitude: number) => void }) {
  const sites = site.id === 'custom' ? [...SITES, site] : SITES
  const latitudeRange = Math.max(6.5, 90 + site.lat + 0.5)
  const pick = (event: React.MouseEvent<SVGSVGElement>) => {
    const point = event.currentTarget.createSVGPoint()
    point.x = event.clientX
    point.y = event.clientY
    const coordinates = point.matrixTransform(event.currentTarget.getScreenCTM()?.inverse())
    const x = coordinates.x - 100
    const y = 100 - coordinates.y
    const radius = Math.hypot(x, y)
    if (radius > 82) return
    onPick(Number((-90 + radius / 82 * latitudeRange).toFixed(3)), Number((Math.atan2(x, y) * 180 / Math.PI).toFixed(3)))
  }

  return <div className="illum-polar-inset" aria-label={`Mapa polar sur: ${site.name}, ${Math.abs(site.lat).toFixed(2)} grados sur, ${site.lon.toFixed(2)} grados de longitud`}>
    <strong>POLO SUR · POSICIONES</strong>
    <svg viewBox="0 0 200 200" role="img" aria-label="Ubicación de los sitios del catálogo alrededor del polo sur; pulsa para elegir un punto" onClick={pick}>
      <circle cx="100" cy="100" r="82" className="polar-grid"/>
      <circle cx="100" cy="100" r={82 * 3 / latitudeRange} className="polar-grid"/>
      <path d="M100 18V182M18 100H182" className="polar-axis"/>
      <text x="104" y="96" className="polar-pole-label">90° S</text>
      <text x="105" y="59" className="polar-ring-label">87° S</text>
      <text x="105" y="22" className="polar-ring-label">{(90 - latitudeRange).toFixed(1)}° S</text>
      {sites.map((candidate, index) => {
        const { x, y } = polarPoint(candidate, latitudeRange)
        const active = candidate.id === site.id
        return <g key={candidate.id}>
          <circle cx={x} cy={y} r={active ? 5 : 3} className={active ? 'polar-site active' : 'polar-site'}>
            <title>{candidate.name}: {Math.abs(candidate.lat).toFixed(2)}° S, {candidate.lon.toFixed(2)}°</title>
          </circle>
          {active && <circle cx={x} cy={y} r="9" className="polar-selection-ring"/>}
          <text x={x + 5} y={y - 5} className={active ? 'polar-site-label active' : 'polar-site-label'}>{candidate.id === 'custom' ? 'P' : index + 1}</text>
        </g>
      })}
    </svg>
    <span>{site.name} · {Math.abs(site.lat).toFixed(2)}° S · {Math.abs(site.lon).toFixed(2)}° {site.lon < 0 ? 'O' : 'E'}</span>
  </div>
}
