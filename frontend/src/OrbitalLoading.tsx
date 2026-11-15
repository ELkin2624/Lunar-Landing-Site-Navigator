import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

import { disposeModel } from './three/disposeModel'

const BODY_URLS = ['/luna/luna_lod.glb', '/tierra/tierra_lod.glb', '/sol/sol_lod.glb']
const HOLD_MS = 2400

export function OrbitalLoading({ siteName }: { siteName: string }) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
    } catch {
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.add(new THREE.AmbientLight(0xffffff, 1.6))
    const light = new THREE.DirectionalLight(0xffe2ad, 2.2)
    light.position.set(3, 4, 5)
    scene.add(light)
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100)
    camera.position.set(0, 0.1, 4.4)

    const resize = () => {
      const size = Math.min(host.clientWidth, host.clientHeight)
      if (!size) return
      renderer.setSize(size, size, false)
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host)
    resize()

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const models: Array<THREE.Object3D | null> = BODY_URLS.map(() => null)
    const scales = BODY_URLS.map((_, index) => (index === 0 ? 1 : 0))
    const baseScales = BODY_URLS.map(() => 1)
    let active = 0
    let alive = true
    const timer = reduced ? undefined : window.setInterval(() => { active = (active + 1) % BODY_URLS.length }, HOLD_MS)

    const loader = new GLTFLoader()
    BODY_URLS.forEach((url, index) => loader.load(url, gltf => {
      if (!alive) {
        disposeModel(gltf.scene)
        return
      }
      const model = gltf.scene
      const box = new THREE.Box3().setFromObject(model)
      const size = box.getSize(new THREE.Vector3())
      baseScales[index] = 2.2 / Math.max(size.x, size.y, size.z, 0.001)
      const pivot = new THREE.Group()
      model.position.copy(box.getCenter(new THREE.Vector3())).multiplyScalar(-1)
      pivot.add(model)
      pivot.scale.setScalar(baseScales[index] * scales[index])
      pivot.visible = scales[index] > 0.001
      models[index] = pivot
      scene.add(pivot)
    }, undefined, () => undefined))

    renderer.setAnimationLoop(() => {
      const previousGone = scales.every((scale, index) => index === active || scale < 0.03)
      models.forEach((model, index) => {
        const target = index === active && previousGone ? 1 : 0
        scales[index] += (target - scales[index]) * (target ? 0.07 : 0.12)
        if (!model) return
        const eased = scales[index] < 0.001 ? 0 : scales[index]
        model.visible = eased > 0
        model.scale.setScalar(baseScales[index] * eased)
        if (!reduced) model.rotation.y += 0.012 + (1 - eased) * 0.06
      })
      renderer.render(scene, camera)
    })

    return () => {
      alive = false
      window.clearInterval(timer)
      observer.disconnect()
      renderer.setAnimationLoop(null)
      models.forEach(model => model && disposeModel(model))
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [])

  return <div className="orbital-loading" role="status" aria-label={`Calculando ${siteName}`}>
    <div ref={hostRef} className="orbital-loading-model"/>
    <p className="orbital-loading-text" aria-hidden="true">Cargando<span>.</span><span>.</span><span>.</span></p>
  </div>
}
