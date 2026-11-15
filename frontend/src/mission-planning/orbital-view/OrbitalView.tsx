import { useEffect, useRef, useState } from 'react'
import { Maximize, Minimize } from 'lucide-react'
import './orbital-view.css'

export function OrbitalView() {
  const viewer = useRef<HTMLDivElement>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    function syncFullscreen() {
      setFullscreen(document.fullscreenElement === viewer.current)
      setFailed(false)
    }
    document.addEventListener('fullscreenchange', syncFullscreen)
    return () => document.removeEventListener('fullscreenchange', syncFullscreen)
  }, [])

  async function toggleFullscreen() {
    const element = viewer.current
    if (!element) return
    try {
      if (document.fullscreenElement === element) await document.exitFullscreen()
      else await element.requestFullscreen()
    } catch {
      setFailed(true)
    }
  }

  return <div className="planning-orbit-viewer" ref={viewer}>
    <iframe
      className="planning-orbit-frame"
      src={import.meta.env.BASE_URL + 'sistema-solar.html'}
      title="Sistema solar interactivo: Sol, Tierra y Luna"
    />
    {document.fullscreenEnabled && <button type="button" className="planning-orbit-fullscreen" onClick={toggleFullscreen}>
      {fullscreen ? <Minimize size={16} aria-hidden="true" /> : <Maximize size={16} aria-hidden="true" />}
      {fullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
    </button>}
    {failed && <p className="planning-orbit-fullscreen-error" role="status">El navegador no pudo cambiar el modo de pantalla.</p>}
  </div>
}
