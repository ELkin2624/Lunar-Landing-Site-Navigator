import * as THREE from 'three'

/** Unit vector of a selenographic point in the frame of the lunar GLB models. */
export function bodyVector(latitude: number, longitude: number): THREE.Vector3 {
  const lat = THREE.MathUtils.degToRad(latitude)
  const lon = THREE.MathUtils.degToRad(longitude)
  return new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon))
}

/** Converts a topocentric azimuth/elevation seen from a site into a direction in the globe frame. */
export function globeDirection(latitude: number, longitude: number, azimuthDeg: number, elevationDeg: number): THREE.Vector3 {
  const az = THREE.MathUtils.degToRad(azimuthDeg)
  const el = THREE.MathUtils.degToRad(elevationDeg)
  const lat = THREE.MathUtils.degToRad(latitude)
  const lon = THREE.MathUtils.degToRad(longitude)
  const up = bodyVector(latitude, longitude)
  const east = new THREE.Vector3(-Math.sin(lon), 0, -Math.cos(lon))
  const north = new THREE.Vector3(-Math.sin(lat) * Math.cos(lon), Math.cos(lat), Math.sin(lat) * Math.sin(lon))
  return east.multiplyScalar(Math.cos(el) * Math.sin(az))
    .add(north.multiplyScalar(Math.cos(el) * Math.cos(az)))
    .add(up.multiplyScalar(Math.sin(el))).normalize()
}
