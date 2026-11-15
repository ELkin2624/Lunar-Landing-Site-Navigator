import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

const bodies = [
  { name: 'Luna', url: '/luna/luna_lod.glb' },
  { name: 'Tierra', url: '/tierra/tierra_lod.glb' },
  { name: 'Sol', url: '/sol/sol_lod.glb' },
] as const

export function OrbitalLoading({ siteName }: { siteName: string }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef(0)
  const [active, setActive] = useState(0)
  useEffect(() => { activeRef.current = active }, [active])
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const timer = window.setInterval(() => setActive(index => (index + 1) % bodies.length), 2600)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let renderer: THREE.WebGLRenderer
    try { renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'high-performance' }) }
    catch { return }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25))
    renderer.setSize(170, 170)
    host.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    scene.add(new THREE.AmbientLight(0xffffff, 2))
    const light = new THREE.DirectionalLight(0xffe2ad, 2)
    light.position.set(3, 4, 5)
    scene.add(light)
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100)
    camera.position.set(0, 0.1, 4)
    let alive = true
    let frame = 0
    const models: Array<THREE.Object3D | null> = [null, null, null]
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const draw = () => {
      if (!alive) return
      models.forEach((model, index) => { if (model) { model.visible = index === activeRef.current; if (model.visible && !reduced) model.rotation.y += 0.018 } })
      renderer.render(scene, camera)
      if (!reduced) frame = requestAnimationFrame(draw)
    }
    const loader = new GLTFLoader()
    bodies.forEach((body, index) => loader.load(body.url, gltf => {
      if (!alive) return
      const model = gltf.scene
      const box = new THREE.Box3().setFromObject(model)
      const center = box.getCenter(new THREE.Vector3())
      const size = box.getSize(new THREE.Vector3())
      model.scale.setScalar(2.2 / Math.max(size.x, size.y, size.z, 0.001))
      model.position.copy(center).multiplyScalar(-model.scale.x)
      model.visible = index === activeRef.current
      models[index] = model
      scene.add(model)
      if (reduced) renderer.render(scene, camera)
    }, undefined, () => undefined))
    draw()
    return () => {
      alive = false
      cancelAnimationFrame(frame)
      models.forEach(model => model?.traverse(object => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose()
          const materials = Array.isArray(object.material) ? object.material : [object.material]
          materials.forEach(material => material.dispose())
        }
      }))
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [])
  return <section className="panel orbital-loading" role="status" aria-live="polite">
    <div className="orbital-loading-visual"><div ref={hostRef} className="orbital-loading-model"/><div className="orbital-loading-fallback" aria-hidden="true"/></div>
    <div className="orbital-loading-copy"><span className="section-kicker">ANÁLISIS EN CURSO</span><h2>Calculando {siteName}</h2><p>Consultamos las posiciones del Sol y la Tierra y evaluamos el relieve lunar. El resultado aparecerá cuando responda la API.</p><div className="orbital-loading-steps" aria-hidden="true">{bodies.map((body, index) => <span key={body.name} className={active === index ? 'active' : ''}>{body.name}</span>)}</div><small>La animación no representa el avance de la consulta.</small></div>
  </section>
}
