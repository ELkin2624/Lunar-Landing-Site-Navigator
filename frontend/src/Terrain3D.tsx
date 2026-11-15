import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { apiEnabled, fetchTerrainMesh, type TerrainMesh } from './api'
import type { Sample, Site } from './data'

type View = 'local' | 'globe'

function bodyVector(latitude: number, longitude: number): THREE.Vector3 {
  const lat = THREE.MathUtils.degToRad(latitude)
  const lon = THREE.MathUtils.degToRad(longitude)
  return new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon))
}

function sunDirection(site: Site, sample: Sample, view: View): THREE.Vector3 {
  const az = THREE.MathUtils.degToRad(sample.sunAzimuth ?? 0)
  const el = THREE.MathUtils.degToRad(sample.sunElevation)
  const lon = THREE.MathUtils.degToRad(site.lon)
  if (view === 'local') {
    const east = Math.cos(el) * Math.sin(az)
    const north = Math.cos(el) * Math.cos(az)
    return new THREE.Vector3(east * Math.cos(lon) + north * Math.sin(lon), Math.sin(el), east * Math.sin(lon) - north * Math.cos(lon)).normalize()
  }
  const lat = THREE.MathUtils.degToRad(site.lat)
  const up = bodyVector(site.lat, site.lon)
  const east = new THREE.Vector3(-Math.sin(lon), 0, -Math.cos(lon))
  const north = new THREE.Vector3(-Math.sin(lat) * Math.cos(lon), Math.cos(lat), Math.sin(lat) * Math.sin(lon))
  return east.multiplyScalar(Math.cos(el) * Math.sin(az))
    .add(north.multiplyScalar(Math.cos(el) * Math.cos(az)))
    .add(up.multiplyScalar(Math.sin(el))).normalize()
}

function localGeometry(mesh: TerrainMesh): THREE.BufferGeometry {
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const half = (mesh.gridSize - 1) / 2
  for (let row = 0; row < mesh.gridSize; row++) {
    for (let col = 0; col < mesh.gridSize; col++) {
      const height = mesh.heightsM[row * mesh.gridSize + col]
      positions.push((col - half) * mesh.gridSpacingM, (height - mesh.minHeightM) * 3, (row - half) * mesh.gridSpacingM)
      uvs.push((mesh.centerXM + (col - half) * mesh.gridSpacingM + 192_000) / 384_000,
        (mesh.centerYM - (row - half) * mesh.gridSpacingM + 192_000) / 384_000)
      if (row < mesh.gridSize - 1 && col < mesh.gridSize - 1) {
        const a = row * mesh.gridSize + col
        indices.push(a, a + mesh.gridSize, a + 1, a + 1, a + mesh.gridSize, a + mesh.gridSize + 1)
      }
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

export function Terrain3D({ site, sample }: { site: Site; sample: Sample }) {
  const [view, setView] = useState<View>(apiEnabled ? 'local' : 'globe')
  const [mesh, setMesh] = useState<TerrainMesh | null>(null)
  const [meshError, setMeshError] = useState<string | null>(null)
  const [renderError, setRenderError] = useState<string | null>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const lightRef = useRef<THREE.DirectionalLight | null>(null)
  const sunRef = useRef<THREE.Object3D | null>(null)
  const earthRef = useRef<THREE.Object3D | null>(null)
  const drawRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    setMesh(null)
    setMeshError(null)
    if (!apiEnabled) return
    const controller = new AbortController()
    fetchTerrainMesh(site, controller.signal).then(setMesh).catch(error => {
      if (!controller.signal.aborted) setMeshError(String(error))
    })
    return () => controller.abort()
  }, [site])

  useEffect(() => {
    const host = hostRef.current
    if (!host || (view === 'local' && !mesh)) return
    setRenderError(null)
    let renderer: THREE.WebGLRenderer
    try { renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' }) }
    catch { setRenderError('WebGL no está disponible en este navegador.'); return }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25))
    renderer.setClearColor(0x0b1420)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    host.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(view === 'globe' ? 60 : 45, 1, view === 'globe' ? 0.01 : 10, view === 'globe' ? 100 : 100_000)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = false
    controls.enablePan = true
    const light = new THREE.DirectionalLight(0xfff3d9, 2.5)
    scene.add(light, new THREE.AmbientLight(0xb8c5d2, 1.7))
    lightRef.current = light
    let frame = 0
    const draw = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; renderer.render(scene, camera) }) }
    drawRef.current = draw
    controls.addEventListener('change', draw)
    let disposed = false
    let local: THREE.BufferGeometry | null = null
    let localMaterial: THREE.Material | null = null
    let texture: THREE.Texture | null = null
    const loadedModels: THREE.Object3D[] = []
    if (view === 'local' && mesh) {
      local = localGeometry(mesh)
      texture = new THREE.TextureLoader().load('/lroc_wac_south_pole.png', draw)
      texture.colorSpace = THREE.SRGBColorSpace
      localMaterial = new THREE.MeshStandardMaterial({ map: texture, color: 0xffffff, roughness: 1, side: THREE.DoubleSide })
      scene.add(new THREE.Mesh(local, localMaterial))
      const grid = new THREE.GridHelper(mesh.spanM, 8, 0x607387, 0x354455)
      grid.position.y = -20
      scene.add(grid)
      camera.position.set(mesh.spanM * 0.8, mesh.spanM * 0.65, mesh.spanM * 0.8)
      controls.target.set(0, (mesh.maxHeightM - mesh.minHeightM) * 1.5, 0)
    } else {
      const marker = new THREE.Mesh(new THREE.SphereGeometry(0.018, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffc476 }))
      marker.position.copy(bodyVector(site.lat, site.lon).multiplyScalar(1.025))
      scene.add(marker)
      camera.position.copy(bodyVector(site.lat, site.lon).multiplyScalar(7))
      controls.target.set(0, 0, 0)
      new GLTFLoader().load('/luna/luna_cientifica.glb', gltf => {
        if (disposed) return
        scene.add(gltf.scene)
        loadedModels.push(gltf.scene)
        draw()
      }, undefined, () => { if (!disposed) setRenderError('No se pudo cargar el modelo GLB del equipo.') })
      const loadBody = (url: string, size: number, body: 'sun' | 'earth') => {
        new GLTFLoader().load(url, gltf => {
          if (disposed) return
          const object = gltf.scene
          const dimensions = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3())
          object.scale.multiplyScalar(size / Math.max(dimensions.x, dimensions.y, dimensions.z, 0.001))
          const directionSample = body === 'sun' ? sample : { ...sample, sunAzimuth: sample.earthAzimuth, sunElevation: sample.earthElevation }
          object.position.copy(sunDirection(site, directionSample, 'globe').multiplyScalar(body === 'sun' ? 3.2 : 2.6))
          scene.add(object)
          loadedModels.push(object)
          if (body === 'sun') sunRef.current = object
          else earthRef.current = object
          draw()
        }, undefined, () => { if (!disposed) setRenderError(`No se pudo cargar el modelo de ${body === 'sun' ? 'Sol' : 'Tierra'}.`) })
      }
      loadBody('/sol/sol_cientifico.glb', 0.55, 'sun')
      loadBody('/tierra/tierra_cientifica.glb', 0.4, 'earth')
    }
    controls.update()
    const resize = () => {
      const width = Math.max(250, host.clientWidth)
      const height = Math.max(320, host.clientHeight)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height)
      draw()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host)
    resize()
    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      observer.disconnect()
      controls.removeEventListener('change', draw)
      controls.dispose()
      local?.dispose()
      localMaterial?.dispose()
      texture?.dispose()
      for (const model of loadedModels) model.traverse(object => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose()
          const materials = Array.isArray(object.material) ? object.material : [object.material]
          materials.forEach(material => material.dispose())
        }
      })
      lightRef.current = null
      sunRef.current = null
      earthRef.current = null
      drawRef.current = null
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [view, mesh, site])

  useEffect(() => {
    if (!lightRef.current) return
    lightRef.current.position.copy(sunDirection(site, sample, view).multiplyScalar(view === 'globe' ? 20 : 20_000))
    if (sunRef.current) sunRef.current.position.copy(sunDirection(site, sample, 'globe').multiplyScalar(3.2))
    if (earthRef.current) {
      const earthSample = { ...sample, sunAzimuth: sample.earthAzimuth, sunElevation: sample.earthElevation }
      earthRef.current.position.copy(sunDirection(site, earthSample, 'globe').multiplyScalar(2.6))
    }
    drawRef.current?.()
  }, [site, sample, view, mesh])

  return <section className="panel terrain-3d-panel">
    <div className="panel-heading"><div><span className="section-kicker">07 / EXPLORACIÓN ESPACIAL</span><h2>Relieve 3D y cuerpos celestes</h2></div><div className="terrain-view-toggle" role="group" aria-label="Vista tridimensional"><button className={view === 'local' ? 'active' : ''} onClick={() => setView('local')}>Terreno LOLA</button><button className={view === 'globe' ? 'active' : ''} onClick={() => setView('globe')}>Luna, Sol y Tierra</button></div></div>
    <div className="terrain-3d-status"><span>Resultado calculado: Sol {sample.sunVisible ? 'visible' : 'oculto'}</span><span>Tierra {sample.earthVisible ? 'visible' : 'oculta'}</span><span>La imagen 3D ilustra la geometría; no calcula estas ventanas.</span></div>
    {view === 'local' && mesh?.gridSpacingM === 20 && <p className="terrain-3d-caution">Hay relieve local a 20 m/píxel. Las métricas de luz y comunicación aún usan un horizonte regional de 240 m/píxel; pueden cambiar al incorporar obstáculos cercanos.</p>}
    {view === 'local' && (meshError || !apiEnabled) ? <p className="terrain-3d-message">{meshError || 'Activa el backend y descarga el DEM LOLA para ver el terreno local.'}</p> : view === 'local' && !mesh ? <p className="terrain-3d-message">Cargando malla LOLA del sitio…</p> : null}
    <div ref={hostRef} className="terrain-3d-canvas" style={{ display: view === 'local' && !mesh ? 'none' : undefined }}/>
    {renderError && <p className="terrain-3d-message" role="alert">{renderError}</p>}
    <p className="terrain-3d-note">{view === 'local' ? `Malla ${mesh?.source ?? 'LOLA'} · ${mesh?.spanM ?? '…'} m de ancho · relieve vertical ×3 · textura WAC estática de 480 m/píxel.` : 'Modelos Blender de Luna, Sol y Tierra · direcciones aparentes desde Horizons; tamaños y distancias fuera de escala.'} La luz sigue el Sol de Horizons; el sombreado 3D es visual y no representa las sombras calculadas por el análisis de visibilidad.</p>
  </section>
}
