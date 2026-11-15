import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { apiEnabled, fetchNacTexture, fetchTerrainMesh, type TerrainMesh } from './api'
import type { Sample, Site } from './data'
import { disposeModel } from './three/disposeModel'
import { bodyVector, globeDirection } from './three/lunarFrame'

type View = 'local' | 'globe'
type Body = 'moon' | 'sun' | 'earth'
type Quality = 'auto' | 'high' | 'save'

function sunDirection(site: Site, sample: Sample, view: View): THREE.Vector3 {
  if (view === 'local') {
    const az = THREE.MathUtils.degToRad(sample.sunAzimuth ?? 0)
    const el = THREE.MathUtils.degToRad(sample.sunElevation)
    const lon = THREE.MathUtils.degToRad(site.lon)
    const east = Math.cos(el) * Math.sin(az)
    const north = Math.cos(el) * Math.cos(az)
    return new THREE.Vector3(east * Math.cos(lon) + north * Math.sin(lon), Math.sin(el), east * Math.sin(lon) - north * Math.cos(lon)).normalize()
  }
  return globeDirection(site.lat, site.lon, sample.sunAzimuth ?? 0, sample.sunElevation)
}

function localGeometry(mesh: TerrainMesh, useLocalTexture: boolean): THREE.BufferGeometry {
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const half = (mesh.gridSize - 1) / 2
  for (let row = 0; row < mesh.gridSize; row++) {
    for (let col = 0; col < mesh.gridSize; col++) {
      const height = mesh.heightsM[row * mesh.gridSize + col]
      positions.push((col - half) * mesh.gridSpacingM, (height - mesh.minHeightM) * 3, (row - half) * mesh.gridSpacingM)
      uvs.push(useLocalTexture ? col / (mesh.gridSize - 1) : (mesh.centerXM + (col - half) * mesh.gridSpacingM + 192_000) / 384_000,
        useLocalTexture ? 1 - row / (mesh.gridSize - 1) : (mesh.centerYM - (row - half) * mesh.gridSpacingM + 192_000) / 384_000)
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
  const [focus, setFocus] = useState<Body>('moon')
  const [quality, setQuality] = useState<Quality>('auto')
  const [measuredFps, setMeasuredFps] = useState<number | null>(null)
  const [perfTelemetry, setPerfTelemetry] = useState<{ loadMs: number; tris: number; heapMb: number | null; assetTier: 'LOD' | 'HD' } | null>(null)
  const [mesh, setMesh] = useState<TerrainMesh | null>(null)
  const [meshError, setMeshError] = useState<string | null>(null)
  const [textureInfo, setTextureInfo] = useState<{ url: string; pixelM: number; coverage: number } | null>(null)
  const [textureError, setTextureError] = useState<string | null>(null)
  const [renderError, setRenderError] = useState<string | null>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const lightRef = useRef<THREE.DirectionalLight | null>(null)
  const sunRef = useRef<THREE.Object3D | null>(null)
  const earthRef = useRef<THREE.Object3D | null>(null)
  const drawRef = useRef<(() => void) | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const qualityRef = useRef<Quality>('auto')
  const adaptiveLow = useRef(false)
  const highDetailGlobe = view === 'globe' && quality === 'high'
  const downloadTelemetry = () => {
    const report = { recordedAtUtc: new Date().toISOString(), userAgent: navigator.userAgent,
      viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
      site: { latitudeDeg: site.lat, longitudeDeg: site.lon }, view, quality,
      measuredFps, adaptiveResolution: adaptiveLow.current, ...perfTelemetry,
      mesh: mesh ? { source: mesh.source, gridSize: mesh.gridSize, spacingM: mesh.gridSpacingM } : null,
      texture: textureInfo ? { pixelM: textureInfo.pixelM, coverage: textureInfo.coverage } : null }
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `lunarpath-3d-${Date.now()}.json`
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  useEffect(() => {
    qualityRef.current = quality
    adaptiveLow.current = false
    const renderer = rendererRef.current
    const host = hostRef.current
    if (renderer && host) {
      renderer.setPixelRatio(quality === 'high' ? Math.min(window.devicePixelRatio || 1, 1.5) : quality === 'save' ? 0.75 : Math.min(window.devicePixelRatio || 1, 1.25))
      renderer.setSize(host.clientWidth, host.clientHeight)
      drawRef.current?.()
    }
  }, [quality])

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
    setTextureInfo(null)
    setTextureError(null)
    if (!mesh || view !== 'local') return
    if (site.lat > -85.5) {
      setTextureError(`Aviso de cobertura NASA: Este sitio está a ${Math.abs(site.lat).toFixed(1)}° S, fuera del mosaico polar fotográfico de alta resolución LRO NAC (disponible entre 85.5° S y 90° S). Se proyecta la malla real LOLA con fotografía regional WAC.`)
      return
    }
    const controller = new AbortController()
    let objectUrl: string | null = null
    fetchNacTexture(site, mesh.spanM, controller.signal).then(info => {
      if (controller.signal.aborted) { URL.revokeObjectURL(info.url); return }
      objectUrl = info.url
      setTextureInfo(info)
    }).catch(() => {
      if (!controller.signal.aborted) {
        setTextureError('Aviso de cobertura: La fotografía de detalle LRO NAC (1 m/px) no tiene cobertura en este sector o el archivo GeoTIFF no está descargado localmente. Se usa la imagen regional WAC sobre el relieve LOLA.')
      }
    })
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [mesh, site, view])

  useEffect(() => {
    const host = hostRef.current
    if (!host || (view === 'local' && !mesh)) return
    setRenderError(null)
    let renderer: THREE.WebGLRenderer
    try { renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' }) }
    catch { setRenderError('WebGL no está disponible en este navegador.'); return }
    renderer.setPixelRatio(qualityRef.current === 'high' ? Math.min(window.devicePixelRatio || 1, 1.5) : qualityRef.current === 'save' ? 0.75 : Math.min(window.devicePixelRatio || 1, 1.25))
    rendererRef.current = renderer
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
    let previousFrame = 0
    const frameSamples: number[] = []
    const draw = () => { if (!frame) frame = requestAnimationFrame(now => {
      frame = 0
      renderer.render(scene, camera)
      if (previousFrame && now - previousFrame < 250) frameSamples.push(now - previousFrame)
      previousFrame = now
      if (frameSamples.length >= 20) {
        const fps = Math.round(1000 / (frameSamples.reduce((sum, value) => sum + value, 0) / frameSamples.length))
        frameSamples.length = 0
        setMeasuredFps(fps)
        if (qualityRef.current === 'auto' && fps < 35 && !adaptiveLow.current) {
          adaptiveLow.current = true
          renderer.setPixelRatio(0.75)
          renderer.setSize(host.clientWidth, host.clientHeight)
        }
      }
    }) }
    drawRef.current = draw
    cameraRef.current = camera
    controlsRef.current = controls
    controls.addEventListener('change', draw)
    let disposed = false
    const sceneStart = performance.now()
    const recordTelemetry = (assetTier: 'LOD' | 'HD') => {
      const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
      setPerfTelemetry({
        loadMs: Math.round(performance.now() - sceneStart),
        tris: renderer.info.render.triangles,
        heapMb: mem ? Math.round(mem.usedJSHeapSize / 1048576) : null,
        assetTier,
      })
    }
    let local: THREE.BufferGeometry | null = null
    let localMaterial: THREE.Material | null = null
    let texture: THREE.Texture | null = null
    const loadedModels: THREE.Object3D[] = []
    const bodyModels: Partial<Record<Body, THREE.Object3D>> = {}
    if (view === 'local' && mesh) {
      local = localGeometry(mesh, Boolean(textureInfo))
      texture = new THREE.TextureLoader().load(textureInfo?.url || '/lroc_wac_south_pole.png', draw)
      texture.colorSpace = THREE.SRGBColorSpace
      localMaterial = new THREE.MeshStandardMaterial({ map: texture, color: 0xffffff, roughness: 1, side: THREE.DoubleSide })
      scene.add(new THREE.Mesh(local, localMaterial))
      const grid = new THREE.GridHelper(mesh.spanM, 8, 0x607387, 0x354455)
      grid.position.y = -20
      scene.add(grid)
      camera.position.set(mesh.spanM * 0.8, mesh.spanM * 0.65, mesh.spanM * 0.8)
      controls.target.set(0, (mesh.maxHeightM - mesh.minHeightM) * 1.5, 0)
      draw()
      requestAnimationFrame(() => !disposed && recordTelemetry('LOD'))
    } else {
      const marker = new THREE.Mesh(new THREE.SphereGeometry(0.018, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffc476 }))
      marker.position.copy(bodyVector(site.lat, site.lon).multiplyScalar(1.025))
      scene.add(marker)
      camera.position.copy(bodyVector(site.lat, site.lon).multiplyScalar(7))
      controls.target.set(0, 0, 0)
      new GLTFLoader().load(highDetailGlobe ? '/luna/luna_cientifica.glb' : '/luna/luna_lod.glb', gltf => {
        if (disposed) return
        scene.add(gltf.scene)
        loadedModels.push(gltf.scene)
        bodyModels.moon = gltf.scene
        draw()
        requestAnimationFrame(() => !disposed && recordTelemetry(highDetailGlobe ? 'HD' : 'LOD'))
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
          bodyModels[body] = object
          draw()
        }, undefined, () => { if (!disposed) setRenderError(`No se pudo cargar el modelo de ${body === 'sun' ? 'Sol' : 'Tierra'}.`) })
      }
      loadBody(highDetailGlobe ? '/sol/sol_cientifico.glb' : '/sol/sol_lod.glb', 0.55, 'sun')
      loadBody(highDetailGlobe ? '/tierra/tierra_cientifica.glb' : '/tierra/tierra_lod.glb', 0.4, 'earth')
    }
    let pointerStart: [number, number] | null = null
    const onPointerDown = (event: PointerEvent) => { pointerStart = [event.clientX, event.clientY] }
    const onPointerUp = (event: PointerEvent) => {
      if (view !== 'globe' || !pointerStart || Math.hypot(event.clientX - pointerStart[0], event.clientY - pointerStart[1]) > 5) return
      const rect = renderer.domElement.getBoundingClientRect()
      const pointer = new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -((event.clientY - rect.top) / rect.height * 2 - 1))
      const raycaster = new THREE.Raycaster()
      raycaster.setFromCamera(pointer, camera)
      for (const body of ['moon', 'sun', 'earth'] as const) {
        if (bodyModels[body] && raycaster.intersectObject(bodyModels[body], true).length) { setFocus(body); break }
      }
    }
    renderer.domElement.addEventListener('pointerdown', onPointerDown)
    renderer.domElement.addEventListener('pointerup', onPointerUp)
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
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      renderer.domElement.removeEventListener('pointerup', onPointerUp)
      local?.dispose()
      localMaterial?.dispose()
      texture?.dispose()
      for (const model of loadedModels) disposeModel(model)
      lightRef.current = null
      sunRef.current = null
      earthRef.current = null
      drawRef.current = null
      cameraRef.current = null
      controlsRef.current = null
      renderer.dispose()
      rendererRef.current = null
      renderer.domElement.remove()
    }
  }, [view, mesh, site, textureInfo, highDetailGlobe])

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

  useEffect(() => {
    if (view !== 'globe' || !cameraRef.current || !controlsRef.current) return
    const camera = cameraRef.current
    const controls = controlsRef.current
    // The Moon view looks down the site normal so the whole globe stays framed with the marker centred.
    const target = focus === 'moon' ? new THREE.Vector3(0, 0, 0)
      : focus === 'sun' ? sunRef.current?.position.clone() : earthRef.current?.position.clone()
    if (!target) return
    const distance = 1.35
    const destination = focus === 'moon' ? bodyVector(site.lat, site.lon).normalize().multiplyScalar(3.4)
      : target.clone().add(new THREE.Vector3(distance * 0.7, distance * 0.45, distance))
    const fromCamera = camera.position.clone()
    const fromTarget = controls.target.clone()
    let frame = 0
    const started = performance.now()
    const animate = (now: number) => {
      const t = Math.min(1, (now - started) / 360)
      const eased = 1 - (1 - t) ** 3
      camera.position.copy(fromCamera).lerp(destination, eased)
      controls.target.copy(fromTarget).lerp(target, eased)
      controls.update()
      drawRef.current?.()
      if (t < 1) frame = requestAnimationFrame(animate)
    }
    frame = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(frame)
  }, [focus, view, site, sample, mesh])

  return <section id="mission-3d" className="panel terrain-3d-panel">
    <div className="panel-heading"><div><span className="section-kicker">09 / EXPLORACIÓN ESPACIAL</span><h2>Relieve 3D y cuerpos celestes</h2><p className="panel-explainer">Terreno LOLA: muestra la forma de la zona elegida. Luna, Sol y Tierra: ayuda a entender sus direcciones en la hora seleccionada. Arrastra para girar y usa la rueda para acercar.</p></div><div className="terrain-view-toggle" role="group" aria-label="Vista tridimensional"><button className={view === 'local' ? 'active' : ''} onClick={() => setView('local')}>Terreno LOLA</button><button className={view === 'globe' ? 'active' : ''} onClick={() => setView('globe')}>Luna, Sol y Tierra</button></div></div>
    <div className="terrain-3d-status"><span>Resultado calculado: Sol {sample.sunVisible ? 'visible' : 'oculto'}</span><span>Tierra {sample.earthVisible ? 'visible' : 'oculta'}</span><span>La imagen 3D ilustra la geometría; no calcula estas ventanas.</span></div>
    <div className="terrain-quality"><span>Fluidez del visor (solo cambia la imagen)</span><div role="group" aria-label="Calidad del visor 3D"><button className={quality === 'auto' ? 'active' : ''} onClick={() => setQuality('auto')}>Automática</button><button className={quality === 'high' ? 'active' : ''} onClick={() => setQuality('high')}>Más detalle</button><button className={quality === 'save' ? 'active' : ''} onClick={() => setQuality('save')}>Más fluidez</button></div><small>{measuredFps == null ? 'Arrastra el visor para comprobar la fluidez' : `${measuredFps} imágenes por segundo${adaptiveLow.current ? ' · detalle reducido' : ''}`}{perfTelemetry ? ` · ${perfTelemetry.assetTier} (${perfTelemetry.loadMs} ms · ${perfTelemetry.tris.toLocaleString()} tris${perfTelemetry.heapMb != null ? ` · ${perfTelemetry.heapMb} MB Heap` : ''})` : ''}</small><button type="button" onClick={downloadTelemetry} disabled={measuredFps == null} title="Guarda los datos de rendimiento de este dispositivo sin enviarlos a un servidor">Descargar diagnóstico 3D</button></div>
    {view === 'globe' && <><div className="body-explorer" role="group" aria-label="Explorar cuerpos celestes">
      <button className={focus === 'moon' ? 'active' : ''} onClick={() => setFocus('moon')}><strong>Luna · sitio</strong><span>Enfocar {site.name}</span></button>
      <button className={focus === 'sun' ? 'active' : ''} onClick={() => setFocus('sun')}><strong>Sol · energía</strong><span>{sample.sunVisible ? 'Visible' : 'Oculto'} · {sample.sunElevation.toFixed(1)}°</span></button>
      <button className={focus === 'earth' ? 'active' : ''} onClick={() => setFocus('earth')}><strong>Tierra · enlace</strong><span>{sample.earthVisible ? 'Directo' : 'Bloqueado'} · {sample.earthElevation.toFixed(1)}°</span></button>
    </div><p className="body-explorer-detail">{focus === 'moon' ? `${site.name}: ${Math.abs(site.lat).toFixed(3)}° S, ${site.lon.toFixed(3)}° E. El marcador indica la ubicación evaluada.` : focus === 'sun' ? `Sol a ${sample.sunElevation.toFixed(1)}°; horizonte local a ${sample.horizonSun.toFixed(1)}°. ${sample.sunVisible ? 'La línea de vista solar está libre en esta muestra.' : 'El relieve bloquea la línea de vista solar en esta muestra.'}` : `Tierra a ${sample.earthElevation.toFixed(1)}°; horizonte local a ${sample.horizonEarth.toFixed(1)}°. ${sample.earthVisible ? 'Hay línea de vista directa en esta muestra.' : 'No hay línea de vista directa en esta muestra.'}`}</p></>}
    {view === 'local' && mesh?.gridSpacingM === 20 && <p className="terrain-3d-caution">Malla local de alta resolución (20 m/píxel). El horizonte de visibilidad combina LOLA 20 m en los primeros 5 km y 240 m hasta 250 km.</p>}
    {view === 'local' && textureError && <p className="terrain-3d-caution" role="status">{textureError}</p>}
    {view === 'local' && (meshError || !apiEnabled) ? <p className="terrain-3d-message">{meshError || 'Activa el backend y descarga el DEM LOLA para ver el terreno local.'}</p> : view === 'local' && !mesh ? <p className="terrain-3d-message">Cargando malla LOLA del sitio…</p> : null}
    <div ref={hostRef} className="terrain-3d-canvas" style={{ display: view === 'local' && !mesh ? 'none' : undefined }}/>
    {renderError && <p className="terrain-3d-message" role="alert">{renderError}</p>}
    <p className="terrain-3d-note">{view === 'local' ? `Ves unos ${((mesh?.spanM ?? 9600) / 1000).toFixed(1)} km alrededor del sitio. La altura se exagera para reconocer montañas y cráteres. ${textureInfo ? `Hay fotografía de detalle en aproximadamente ${(textureInfo.coverage * 100).toFixed(0)}% de esta vista.` : 'La fotografía de detalle no está disponible aquí; se usa una imagen regional.'}` : 'Los modelos muestran hacia dónde quedan el Sol y la Tierra desde el sitio. Sus tamaños y distancias no están a escala.'} La iluminación del dibujo es ilustrativa; los resultados de luz y visibilidad se calculan con los datos científicos.</p>
    <details className="terrain-3d-note"><summary>Ver escala y fuentes del visor</summary><p>{view === 'local' ? `Terreno: ${mesh?.source ?? 'LOLA'}; elevación vertical ×3; ${textureInfo ? `fotografía NAC ${textureInfo.pixelM.toFixed(1)} m/px` : `imagen WAC regional${textureError ? ' (sin cobertura NAC local)' : ''}`}.` : 'Modelos Blender de Luna, Sol y Tierra; direcciones aparentes de JPL Horizons.'}</p></details>
    <p className="terrain-3d-note">También puedes <a href="https://trek.nasa.gov/moon/" target="_blank" rel="noopener noreferrer">explorar el globo 3D oficial en NASA Moon Trek ↗</a>. En el portal elige «3D Globe»; el enlace no conserva automáticamente este sitio ni la hora.</p>
  </section>
}
