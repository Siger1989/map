import { useEffect, useRef, useState } from 'react'

export interface DeviceSkyLocation {
  latitude: number
  longitude: number
  altitude?: number | null
  altitudeSource?: 'gps-msl' | 'dem-eye'
}

export interface DeviceSkyPose {
  azimuth: number
  altitude: number
  roll: number
}

export interface DeviceSkyOptics {
  horizontalFov: number
  verticalFov: number
}

export interface DeviceSkyCameraState {
  source: 'native' | 'browser'
  status: 'idle' | 'starting' | 'ready' | 'denied' | 'unavailable' | 'error'
  pose: DeviceSkyPose | null
  poseTimestampMs?: number
  optics: DeviceSkyOptics | null
  poseStatus: 'waiting' | 'ready' | 'unavailable' | 'location' | 'magnetic'
  altitudeMeters: number | null
  altitudeSource: 'barometer-gps-msl' | 'barometer-dem-eye' | null
}

interface NativeSkyCamera {
  setActive(active: boolean, preview: boolean): void
  setLocation(latitude: number, longitude: number, altitude: number): void
  setAltitudeReference?(latitude: number, longitude: number, altitude: number, source: string): void
  clearLocation(): void
}

function getBridge() {
  return typeof window === 'undefined' ? undefined :
    (window as Window & { ShantuSkyCamera?: NativeSkyCamera }).ShantuSkyCamera
}

function cameraStatus(error: unknown): DeviceSkyCameraState['status'] {
  const name = (error as DOMException | null)?.name
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'unavailable'
  return 'error'
}

function initialState(source: DeviceSkyCameraState['source']): DeviceSkyCameraState {
  return {
    source, status: 'idle', pose: null, optics: null, poseStatus: source === 'native' ? 'waiting' : 'unavailable',
    altitudeMeters: null, altitudeSource: null,
  }
}

function syncLocation(bridge: NativeSkyCamera, location: DeviceSkyLocation | null) {
  if (!location) {
    bridge.clearLocation()
    return
  }
  const { latitude, longitude, altitude, altitudeSource } = location
  bridge.setLocation(latitude, longitude, altitude ?? 0)
  bridge.setAltitudeReference?.(latitude, longitude, altitude ?? 0, altitude != null ? altitudeSource ?? '' : '')
}

export function useDeviceSkyCamera(
  active: boolean,
  viewport: HTMLElement | null,
  video: HTMLVideoElement | null,
  location: DeviceSkyLocation | null,
  cameraEnabled = true,
): DeviceSkyCameraState {
  const bridge = getBridge()
  const source = bridge ? 'native' : 'browser'
  const [state, setState] = useState(() => initialState(source))
  const currentCameraEnabled = useRef(cameraEnabled)
  currentCameraEnabled.current = cameraEnabled
  const currentLocation = useRef(location)
  currentLocation.current = location

  useEffect(() => {
    if (!active || !viewport || !bridge) return

    const native = bridge
    let timer: number | undefined
    let latestSample: number | undefined

    function stateUpdate(event: Event) {
      const detail = (event as CustomEvent<Partial<DeviceSkyCameraState>>).detail
      if (detail.status) {
        const resetPose = detail.status === 'starting' && detail.poseStatus !== 'ready'
        if (resetPose) {
          window.clearTimeout(timer)
          latestSample = undefined
        }
        setState(previous => ({ ...previous, ...detail, pose: resetPose ? null : previous.pose,
          poseTimestampMs: resetPose ? undefined : previous.poseTimestampMs }))
      } else if ('altitudeMeters' in detail) {
        setState(previous => ({
          ...previous, altitudeMeters: detail.altitudeMeters ?? null, altitudeSource: detail.altitudeSource ?? null,
        }))
      } else if ('pose' in detail) {
        const timestamp = Number.isFinite(detail.poseTimestampMs) ? detail.poseTimestampMs : undefined
        if (detail.pose && timestamp !== undefined && latestSample !== undefined && timestamp < latestSample) return
        const poseTimestampMs = detail.pose ? timestamp : undefined
        latestSample = poseTimestampMs
        window.clearTimeout(timer)
        setState(previous => ({ ...previous, pose: detail.pose ?? null, poseTimestampMs }))
        if (detail.pose) timer = window.setTimeout(() => {
          latestSample = undefined
          setState(previous => ({ ...previous, pose: null, poseTimestampMs: undefined, poseStatus: 'waiting' }))
        }, 1000)
      } else if (detail.poseStatus) {
        const poseStatus = detail.poseStatus
        setState(previous => ({ ...previous, poseStatus }))
      }
    }

    function stopPage() {
      native.setActive(false, false)
    }

    function resume() {
      syncLocation(native, currentLocation.current)
      native.setActive(true, currentCameraEnabled.current)
    }

    function restorePage(event: PageTransitionEvent) {
      if (event.persisted) resume()
    }

    window.addEventListener('shantu:sky-camera', stateUpdate)
    window.addEventListener('shantu:native-map-resume', resume)
    window.addEventListener('pagehide', stopPage)
    window.addEventListener('pageshow', restorePage)
    setState({ ...initialState('native'), status: 'starting' })
    syncLocation(native, currentLocation.current)

    return () => {
      stopPage()
      window.removeEventListener('shantu:sky-camera', stateUpdate)
      window.removeEventListener('shantu:native-map-resume', resume)
      window.removeEventListener('pagehide', stopPage)
      window.removeEventListener('pageshow', restorePage)
      window.clearTimeout(timer)
    }
  }, [active, bridge, viewport])

  useEffect(() => {
    if (!active || !bridge || !viewport) return
    bridge.setActive(true, cameraEnabled)
  }, [active, bridge, cameraEnabled, viewport])

  useEffect(() => {
    if (!active || bridge || !cameraEnabled) return
    function startState(status: DeviceSkyCameraState['status']) {
      setState({ ...initialState('browser'), status })
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      startState('unavailable')
      return
    }
    if (!video) return
    const player = video
    let stream: MediaStream | null = null
    let attempt = 0
    let pending = false
    function stopPreview() {
      attempt++
      pending = false
      stream?.getTracks().forEach(track => track.stop())
      stream = null
      player.srcObject = null
    }
    async function startPreview() {
      if (pending || stream) return
      pending = true
      const generation = ++attempt
      startState('starting')
      try {
        const granted = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { exact: 'environment' } },
        })
        if (generation !== attempt) {
          granted.getTracks().forEach(track => track.stop())
          return
        }
        pending = false
        stream = granted
        for (const track of stream.getVideoTracks()) {
          track.addEventListener('ended', () => {
            if (generation !== attempt) return
            stopPreview()
            startState('error')
          }, { once: true })
        }
        player.srcObject = stream
        await player.play()
        // Web media APIs do not expose calibrated camera intrinsics or a reliable
        // relationship between device orientation and the video frame.
        if (generation === attempt) startState('ready')
      } catch (error) {
        if (generation === attempt) {
          stopPreview()
          startState(cameraStatus(error))
        }
      }
    }
    function updateVisibility() {
      if (document.hidden) {
        stopPreview()
        startState('starting')
      } else {
        void startPreview()
      }
    }
    document.addEventListener('visibilitychange', updateVisibility)
    window.addEventListener('pagehide', stopPreview)
    window.addEventListener('pageshow', updateVisibility)
    updateVisibility()
    return () => {
      stopPreview()
      document.removeEventListener('visibilitychange', updateVisibility)
      window.removeEventListener('pagehide', stopPreview)
      window.removeEventListener('pageshow', updateVisibility)
    }
  }, [active, bridge, cameraEnabled, video])

  const latitude = location?.latitude
  const longitude = location?.longitude
  const altitude = location?.altitude
  const altitudeSource = location?.altitudeSource
  useEffect(() => {
    if (!active || !bridge) return
    syncLocation(bridge, latitude == null || longitude == null ? null : { latitude, longitude, altitude, altitudeSource })
  }, [active, altitude, altitudeSource, bridge, latitude, longitude])

  if (!active || (!bridge && !cameraEnabled)) return initialState(source)
  const expectedAltitudeSource = altitudeSource ? `barometer-${altitudeSource}` : null
  if (!cameraEnabled || state.altitudeSource !== expectedAltitudeSource) {
    return { ...state, altitudeMeters: null, altitudeSource: null }
  }
  return state
}
