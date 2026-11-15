import { useEffect, useRef, useState } from 'react'
import { LOCAL_LAYERS, localTiles, type LocalLayer } from './moontrek'

export function LocalTileMap({ layer, centerX, centerY, viewWidthM }: { layer: LocalLayer; centerX: number; centerY: number; viewWidthM: number }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const fallbackRef = useRef<HTMLCanvasElement>(null)
  const [pixels, setPixels] = useState(420)
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const observer = new ResizeObserver(() => setPixels(host.clientWidth))
    observer.observe(host)
    setPixels(host.clientWidth)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const canvas = fallbackRef.current
    if (!canvas || pixels < 1) return
    const image = new Image()
    let active = true
    image.onload = () => {
      if (!active) return
      const context = canvas.getContext('2d')
      if (!context) return
      canvas.width = pixels
      canvas.height = pixels
      context.clearRect(0, 0, pixels, pixels)
      // Both regional rasters cover ±192 km around the pole in the same projection.
      const sourceLeft = (centerX - viewWidthM / 2 + 192_000) / 384_000 * image.width
      const sourceTop = (192_000 - centerY - viewWidthM / 2) / 384_000 * image.height
      const sourceSize = viewWidthM / 384_000 * image.width
      const clippedLeft = Math.max(0, sourceLeft)
      const clippedTop = Math.max(0, sourceTop)
      const clippedRight = Math.min(image.width, sourceLeft + sourceSize)
      const clippedBottom = Math.min(image.height, sourceTop + sourceSize)
      if (clippedRight > clippedLeft && clippedBottom > clippedTop) {
        const ratio = pixels / sourceSize
        context.drawImage(image, clippedLeft, clippedTop, clippedRight - clippedLeft, clippedBottom - clippedTop,
          (clippedLeft - sourceLeft) * ratio, (clippedTop - sourceTop) * ratio,
          (clippedRight - clippedLeft) * ratio, (clippedBottom - clippedTop) * ratio)
      }
    }
    image.src = layer === 'lroc' ? '/lroc_wac_south_pole.png' : '/lola_south_pole.png'
    return () => { active = false }
  }, [layer, centerX, centerY, viewWidthM, pixels])
  const { tiles, inCoverage, partialCoverage, sourcePixelM } = localTiles(layer, centerX, centerY, viewWidthM, pixels)
  const [loaded, setLoaded] = useState<Set<string>>(() => new Set())
  const [failed, setFailed] = useState<Set<string>>(() => new Set())
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  const signature = tiles.map(tile => tile.key).join('|')
  useEffect(() => { setLoaded(new Set()); setFailed(new Set()) }, [signature])
  const remember = (key: string, ok: boolean) => {
    const setter = ok ? setLoaded : setFailed
    setter(previous => new Set(previous).add(key))
  }
  const noData = !inCoverage || tiles.length === 0 || (loaded.size === 0 && failed.size === tiles.length)
  const partial = partialCoverage || (failed.size > 0 && loaded.size > 0)
  const statusText = noData
    ? (!online ? 'Sin conexión · se muestra el mapa regional ampliado' : `Sin imagen local de detalle en esta zona · se muestra el mapa regional ampliado`)
    : loaded.size === 0 && failed.size === 0
      ? 'Buscando imagen local de detalle · mapa regional visible mientras tanto'
      : partial
      ? `Detalle local parcial · imagen regional en las zonas sin datos (${loaded.size}/${tiles.length} teselas)`
      : loaded.size
        ? `${LOCAL_LAYERS[layer].label} · ${loaded.size}/${tiles.length} teselas (${sourcePixelM.toFixed(1)} m/px)`
        : 'Cargando teselas locales…'
  return <>
    <div className="local-tile-layer" aria-hidden="true" ref={hostRef}>
      <canvas className="local-regional-fallback" ref={fallbackRef}/>
      {tiles.map(tile => <img key={tile.key} src={tile.url} alt="" draggable={false} style={{ left: tile.left, top: tile.top, width: tile.size, height: tile.size }} onLoad={() => remember(tile.key, true)} onError={event => { event.currentTarget.style.visibility = 'hidden'; remember(tile.key, false) }}/>)}
    </div>
    <div className={`local-coverage ${noData ? 'unavailable' : ''}`} role="status">
      {statusText}
    </div>
  </>
}
