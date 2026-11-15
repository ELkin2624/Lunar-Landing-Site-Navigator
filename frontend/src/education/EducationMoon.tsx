import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

import { disposeModel } from '../three/disposeModel'

export function EducationMoon() {
  const hostRef = useRef<HTMLDivElement>(null)
  const pausedRef = useRef(window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
    } catch {
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    const canvas = renderer.domElement
    host.appendChild(canvas)

    const scene = new THREE.Scene()
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 20)
    camera.position.set(0, -1.55, 4)
    camera.lookAt(0, 0, 0)

    const moon = new THREE.Group()
    moon.rotation.y = -0.35
    scene.add(moon, new THREE.AmbientLight(0x87aaff, 0.2))
    const sunlight = new THREE.DirectionalLight(0xfff3df, 2.8)
    sunlight.position.set(-3.5, 2.4, 3.6)
    scene.add(sunlight)

    let disposed = false
    let model: THREE.Object3D | undefined
    let lastFrame = 0
    const draw = () => renderer.render(scene, camera)
    const resize = () => {
      const { clientWidth: width, clientHeight: height } = host
      if (!width || !height) return
      const scale = 2.8 / Math.min(width, height)
      camera.left = -width * scale / 2
      camera.right = width * scale / 2
      camera.top = height * scale / 2
      camera.bottom = -height * scale / 2
      camera.updateProjectionMatrix()
      renderer.setSize(width, height, false)
      draw()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host)

    new GLTFLoader().load(import.meta.env.BASE_URL + 'luna/luna_cientifica.glb', ({ scene: lunarModel }) => {
      if (disposed) {
        disposeModel(lunarModel)
        return
      }
      const bounds = new THREE.Box3().setFromObject(lunarModel)
      const center = bounds.getCenter(new THREE.Vector3())
      const size = bounds.getSize(new THREE.Vector3())
      const scale = 2 / Math.max(size.x, size.y, size.z)
      const centered = new THREE.Group()
      centered.add(lunarModel)
      centered.scale.setScalar(scale)
      centered.position.copy(center).multiplyScalar(-scale)
      moon.add(centered)
      model = lunarModel
      resize()
      setReady(true)

      renderer.setAnimationLoop(time => {
        const elapsed = lastFrame ? Math.min((time - lastFrame) / 1000, 0.05) : 0
        lastFrame = time
        if (pausedRef.current || document.hidden) return
        moon.rotation.y += elapsed * 0.16
        draw()
      })
    }, undefined, () => {
      // Keep the static lunar image if the 3D model cannot load.
    })

    return () => {
      disposed = true
      observer.disconnect()
      renderer.setAnimationLoop(null)
      if (model) disposeModel(model)
      renderer.dispose()
      canvas.remove()
    }
  }, [])

  return <div ref={hostRef} className={`education-moon-canvas${ready ? ' is-ready' : ''}`} aria-hidden="true" />
}
