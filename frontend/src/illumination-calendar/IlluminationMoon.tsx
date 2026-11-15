import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

import { disposeModel } from '../three/disposeModel'
import { bodyVector, globeDirection } from '../three/lunarFrame'

type Props = { latitude: number; longitude: number; sunAzimuthDeg: number; sunElevationDeg: number }

function starfield(): THREE.Points {
  const positions: number[] = []
  let seed = 7
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  for (let i = 0; i < 1400; i += 1) {
    const direction = new THREE.Vector3(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1).normalize().multiplyScalar(40 + random() * 20)
    positions.push(direction.x, direction.y, direction.z)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  return new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0xc9d6ee, size: 0.09, sizeAttenuation: true, transparent: true, opacity: 0.75 }))
}

export function IlluminationMoon({ latitude, longitude, sunAzimuthDeg, sunElevationDeg }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<{ light: THREE.DirectionalLight; marker: THREE.Mesh; target: THREE.Vector3; current: THREE.Vector3 } | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    } catch {
      setStatus('error')
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 200)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.enablePan = false
    controls.minDistance = 1.5
    controls.maxDistance = 7
    controls.rotateSpeed = 0.6

    const stars = starfield()
    scene.add(stars, new THREE.AmbientLight(0x6c83b0, 0.06))
    const light = new THREE.DirectionalLight(0xfff4e2, 3.4)
    scene.add(light, light.target)
    const marker = new THREE.Mesh(new THREE.SphereGeometry(0.022, 16, 12), new THREE.MeshBasicMaterial({ color: 0x5e9bff }))
    scene.add(marker)

    const initial = globeDirection(latitude, longitude, sunAzimuthDeg, sunElevationDeg)
    sceneRef.current = { light, marker, target: initial.clone(), current: initial.clone() }

    // Look across the sunlight so the day/night terminator crosses the site instead of facing a full disk.
    const up = bodyVector(latitude, longitude)
    const side = new THREE.Vector3().crossVectors(initial, up)
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0)
    camera.position.copy(up.multiplyScalar(0.75).add(side.normalize().multiplyScalar(0.65)).add(initial.clone().multiplyScalar(0.3)).normalize().multiplyScalar(4.4))
    controls.target.set(0, 0, 0)

    const resize = () => {
      const { clientWidth: width, clientHeight: height } = host
      if (!width || !height) return
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height, false)
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host)
    resize()

    let disposed = false
    let model: THREE.Object3D | undefined
    new GLTFLoader().load(import.meta.env.BASE_URL + 'luna/luna_lod.glb', ({ scene: lunar }) => {
      if (disposed) {
        disposeModel(lunar)
        return
      }
      const size = new THREE.Box3().setFromObject(lunar).getSize(new THREE.Vector3())
      lunar.scale.setScalar(2 / Math.max(size.x, size.y, size.z))
      scene.add(lunar)
      model = lunar
      setStatus('ready')
    }, undefined, () => !disposed && setStatus('error'))

    renderer.setAnimationLoop(() => {
      const state = sceneRef.current
      if (state) {
        state.current.lerp(state.target, 0.08).normalize()
        state.light.position.copy(state.current).multiplyScalar(10)
      }
      controls.update()
      renderer.render(scene, camera)
    })

    return () => {
      disposed = true
      observer.disconnect()
      renderer.setAnimationLoop(null)
      controls.dispose()
      if (model) disposeModel(model)
      for (const object of [stars, marker]) {
        object.geometry.dispose()
        ;(object.material as THREE.Material).dispose()
      }
      renderer.dispose()
      renderer.domElement.remove()
      sceneRef.current = null
    }
  }, [latitude, longitude])

  useEffect(() => {
    const state = sceneRef.current
    if (!state) return
    state.target.copy(globeDirection(latitude, longitude, sunAzimuthDeg, sunElevationDeg))
    state.marker.position.copy(bodyVector(latitude, longitude).multiplyScalar(1.012))
  }, [latitude, longitude, sunAzimuthDeg, sunElevationDeg])

  return <div className="illum-moon" ref={hostRef}>
    {status === 'loading' && <span className="illum-moon-status">Cargando modelo lunar…</span>}
    {status === 'error' && <span className="illum-moon-status">No se pudo cargar el modelo 3D de la Luna.</span>}
  </div>
}
