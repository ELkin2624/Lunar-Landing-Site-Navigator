import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'

type StarCatalog = { stars: [number, number, number, number][] }

const STAR_RADIUS = 400

/** Approximate blackbody tint for a B−V colour index (Ballesteros temperature, then a warm/cool ramp). */
function starColor(bv: number) {
  const index = Math.min(Math.max(bv, -0.4), 2)
  const kelvin = 4600 * (1 / (0.92 * index + 1.7) + 1 / (0.92 * index + 0.62))
  const t = Math.min(Math.max((kelvin - 3000) / 9000, 0), 1)
  return new THREE.Color().setRGB(1 - 0.28 * t, 0.82 + 0.1 * t, 0.62 + 0.38 * t)
}

function buildStars(catalog: StarCatalog, pixelRatio: number) {
  const count = catalog.stars.length
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const sizes = new Float32Array(count)
  catalog.stars.forEach(([ra, dec, mag, bv], i) => {
    const alpha = THREE.MathUtils.degToRad(ra)
    const delta = THREE.MathUtils.degToRad(dec)
    positions[i * 3] = STAR_RADIUS * Math.cos(delta) * Math.cos(alpha)
    positions[i * 3 + 1] = STAR_RADIUS * Math.sin(delta)
    positions[i * 3 + 2] = -STAR_RADIUS * Math.cos(delta) * Math.sin(alpha)
    // Flux relative to a magnitude 6 star, compressed so the brightest stars do not bloom into discs.
    const flux = Math.pow(10, -0.4 * (mag - 6))
    const brightness = Math.min(1, 0.42 + 0.2 * Math.pow(flux, 0.42))
    starColor(bv).multiplyScalar(brightness).toArray(colors, i * 3)
    sizes[i] = (2.1 + 1.1 * Math.pow(flux, 0.24)) * pixelRatio
  })
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1))
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `attribute float size; varying vec3 vColor;
      void main() { vColor = color; gl_PointSize = size; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec3 vColor;
      void main() { float d = length(gl_PointCoord - 0.5) * 2.0; float core = exp(-d * d * 4.5); if (core < 0.02) discard; gl_FragColor = vec4(vColor * core, 1.0); }`,
    vertexColors: true,
  })
  return new THREE.Points(geometry, material)
}

/**
 * Landing Moon: LROC colour and LOLA relief (NASA SVS CGI Moon Kit) under a grazing Sun, over real
 * Hipparcos stars. The view eases toward the pointer; reduced motion renders a single still frame.
 */
export function EducationMoon() {
  const hostRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading')

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
    } catch {
      setStatus('failed')
      return
    }
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const pixelRatio = Math.min(window.devicePixelRatio, 2)
    renderer.setPixelRatio(pixelRatio)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 1000)
    camera.position.set(0, 0, 5.2)

    // Tilt the south pole toward the viewer and turn the near side to face the camera.
    const tilt = new THREE.Group()
    tilt.rotation.x = -0.62
    const spin = new THREE.Group()
    spin.rotation.y = -Math.PI / 2 + 0.25
    tilt.add(spin)
    scene.add(tilt)

    // Grazing sunlight from the left, as at the lunar poles; faint bluish earthshine fills the night side.
    const sun = new THREE.DirectionalLight(0xfff4e8, 3.1)
    sun.position.set(-5, 0.6, 1.8)
    scene.add(sun, new THREE.AmbientLight(0x7d94c8, 0.035))

    let disposed = false
    let moon: THREE.Mesh | undefined
    let stars: THREE.Points | undefined
    // Parallax rotates this group; the catalogue inside stays aimed at Crux and Centaurus (RA 12h, Dec −60°).
    const sky = new THREE.Group()
    scene.add(sky)
    const loader = new THREE.TextureLoader()
    const base = import.meta.env.BASE_URL + 'landing/'
    const sharp = Math.min(window.innerWidth, window.innerHeight) * pixelRatio > 1400
    const textureSize = sharp ? '4k' : '2k'

    let baseZ = 4.4
    const resize = () => {
      const width = host.clientWidth, height = host.clientHeight
      if (!width || !height) return
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      const wide = width > 900
      // Wide: the Moon fills ~90% of the height, right of the copy. Narrow: ~95% of the width, above the copy.
      const visibleHeight = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
      baseZ = wide ? 2 / (0.9 * visibleHeight) : 2 * height / (0.95 * width * visibleHeight)
      camera.setViewOffset(width, height, wide ? -width * 0.2 : 0, height * (wide ? 0.07 : 0.22), width, height)
      camera.updateProjectionMatrix()
      requestFrame()
    }

    const pointer = { x: 0, y: 0 }
    const eased = { x: 0, y: 0 }
    let frame = 0
    let last = 0
    const render = (time: number) => {
      frame = 0
      const dt = last ? Math.min((time - last) / 1000, 0.05) : 0.016
      last = time
      const follow = 1 - Math.exp(-dt * 2.6)
      eased.x += (pointer.x - eased.x) * follow
      eased.y += (pointer.y - eased.y) * follow
      spin.rotation.y = -Math.PI / 2 + 0.25 + eased.x * 0.16
      tilt.rotation.x = -0.62 + eased.y * 0.08
      camera.position.set(eased.x * 0.12, -eased.y * 0.08, baseZ)
      camera.lookAt(0, 0, 0)
      sky.rotation.set(eased.y * 0.012, eased.x * 0.02, 0)
      renderer.render(scene, camera)
      const settling = Math.abs(pointer.x - eased.x) + Math.abs(pointer.y - eased.y) > 0.0005
      if (settling && !reduceMotion) requestFrame()
      else last = 0
    }
    function requestFrame() {
      if (!frame && !disposed) frame = requestAnimationFrame(render)
    }
    const onPointer = (event: PointerEvent) => {
      if (reduceMotion || event.pointerType === 'touch') return
      pointer.x = event.clientX / window.innerWidth * 2 - 1
      pointer.y = event.clientY / window.innerHeight * 2 - 1
      requestFrame()
    }
    const onLeave = () => { pointer.x = 0; pointer.y = 0; requestFrame() }

    const observer = new ResizeObserver(resize)
    observer.observe(host)
    window.addEventListener('pointermove', onPointer, { passive: true })
    document.documentElement.addEventListener('pointerleave', onLeave)

    Promise.all([
      loader.loadAsync(`${base}moon_color_${textureSize}.jpg`),
      loader.loadAsync(`${base}moon_normal_${textureSize}.jpg`),
      fetch(`${base}stars_hip6.json`).then(response => response.ok ? response.json() as Promise<StarCatalog> : null).catch(() => null),
    ]).then(([color, normal, catalog]) => {
      if (disposed) { color.dispose(); normal.dispose(); return }
      color.colorSpace = THREE.SRGBColorSpace
      color.anisotropy = normal.anisotropy = renderer.capabilities.getMaxAnisotropy()
      moon = new THREE.Mesh(
        new THREE.SphereGeometry(1, 256, 128),
        new THREE.MeshStandardMaterial({ map: color, normalMap: normal, normalScale: new THREE.Vector2(1.3, 1.3), roughness: 1, metalness: 0 }),
      )
      spin.add(moon)
      if (catalog) {
        stars = buildStars(catalog, pixelRatio)
        const crux = new THREE.Vector3(-Math.cos(Math.PI / 3), -Math.sin(Math.PI / 3), 0)
        stars.quaternion.setFromUnitVectors(crux, new THREE.Vector3(0, 0, -1))
        sky.add(stars)
      }
      resize()
      setStatus('ready')
    }).catch(() => {
      // The static LROC image replaces the scene when the textures cannot load.
      if (!disposed) setStatus('failed')
    })

    return () => {
      disposed = true
      if (frame) cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('pointermove', onPointer)
      document.documentElement.removeEventListener('pointerleave', onLeave)
      if (moon) {
        const material = moon.material as THREE.MeshStandardMaterial
        material.map?.dispose(); material.normalMap?.dispose(); material.dispose(); moon.geometry.dispose()
      }
      if (stars) { stars.geometry.dispose(); (stars.material as THREE.Material).dispose() }
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [])

  return <div ref={hostRef} className={`education-moon-canvas is-${status}`} aria-hidden="true" />
}
