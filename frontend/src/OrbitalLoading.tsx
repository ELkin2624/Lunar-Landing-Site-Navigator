import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

import { disposeModel } from './three/disposeModel'

const BODY_URLS = ['/luna/luna_lod.glb', '/tierra/tierra_lod.glb', '/sol/sol_lod.glb']
const HOLD_MS = 1500
const TRANSITION_MS = 900
const CYCLE_MS = HOLD_MS + TRANSITION_MS
const ROTATION_SPEED = 0.85

interface LoadedBody {
  pivot: THREE.Group
  materials: THREE.Material[]
}

function setBodyBlend(body: LoadedBody, opacity: number, additive: boolean) {
  for (const material of body.materials) {
    material.opacity = opacity
    if (additive) {
      material.blending = THREE.CustomBlending
      material.blendEquation = THREE.AddEquation
      material.blendSrc = THREE.SrcAlphaFactor
      material.blendDst = THREE.OneFactor
      material.blendSrcAlpha = THREE.OneFactor
      material.blendDstAlpha = THREE.OneFactor
    } else {
      material.blending = THREE.NormalBlending
    }
  }
}

export function OrbitalLoading({ siteName, message }: { siteName?: string; message?: string }) {
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
    renderer.autoClear = false
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
    const bodies: Array<LoadedBody | null> = BODY_URLS.map(() => null)
    let alive = true
    let elapsedMs = 0
    let rotationY = 0
    let lastTime = performance.now()

    const loader = new GLTFLoader()
    BODY_URLS.forEach((url, index) => loader.load(url, gltf => {
      if (!alive) {
        disposeModel(gltf.scene)
        return
      }
      const model = gltf.scene
      const box = new THREE.Box3().setFromObject(model)
      const size = box.getSize(new THREE.Vector3())
      const baseScale = 2.2 / Math.max(size.x, size.y, size.z, 0.001)

      const materials: THREE.Material[] = []
      model.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return
        for (const material of [object.material].flat() as THREE.Material[]) {
          material.side = THREE.FrontSide
          material.transparent = true
          material.depthTest = true
          material.depthWrite = true
          materials.push(material)
        }
      })

      const pivot = new THREE.Group()
      model.position.copy(box.getCenter(new THREE.Vector3())).multiplyScalar(-1)
      pivot.add(model)
      pivot.scale.setScalar(baseScale)
      pivot.visible = false
      bodies[index] = { pivot, materials }
      scene.add(pivot)
    }, undefined, () => undefined))

    renderer.setAnimationLoop(() => {
      const now = performance.now()
      const dt = Math.min((now - lastTime) / 1000, 0.05)
      lastTime = now

      if (!reduced) {
        elapsedMs += dt * 1000
        rotationY += dt * ROTATION_SPEED
      }

      for (const body of bodies) {
        if (!body) continue
        body.pivot.visible = false
        body.pivot.rotation.y = rotationY
      }

      const step = reduced ? 0 : Math.floor(elapsedMs / CYCLE_MS) % BODY_URLS.length
      const nextStep = (step + 1) % BODY_URLS.length
      const phase = reduced ? 0 : elapsedMs % CYCLE_MS
      const rawT = phase <= HOLD_MS ? 0 : (phase - HOLD_MS) / TRANSITION_MS
      const alpha = rawT * rawT * (3 - 2 * rawT)

      const fromBody = bodies[step]
      const toBody = bodies[nextStep]

      renderer.clear()

      if (alpha > 0.001 && fromBody && toBody) {
        setBodyBlend(fromBody, 1 - alpha, false)
        fromBody.pivot.visible = true
        renderer.render(scene, camera)
        fromBody.pivot.visible = false

        renderer.clearDepth()

        setBodyBlend(toBody, alpha, true)
        toBody.pivot.visible = true
        renderer.render(scene, camera)
      } else {
        const activeBody = (alpha > 0.5 ? toBody : fromBody) ?? fromBody ?? toBody ?? bodies.find(Boolean)
        if (activeBody) {
          setBodyBlend(activeBody, 1, false)
          activeBody.pivot.visible = true
          renderer.render(scene, camera)
        }
      }
    })

    return () => {
      alive = false
      observer.disconnect()
      renderer.setAnimationLoop(null)
      bodies.forEach(body => body && disposeModel(body.pivot))
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [])

  const text = message || (siteName ? `Calculando ${siteName}` : 'Cargando')

  return <div className="orbital-loading" role="status" aria-label={text}>
    <div ref={hostRef} className="orbital-loading-model"/>
    <p className="orbital-loading-text" aria-hidden="true">{text}<span>.</span><span>.</span><span>.</span></p>
  </div>
}
