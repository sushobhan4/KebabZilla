/**
 * Silicon & Hardware Device Fingerprinting and Exact Device Naming.
 * DevTools-proof: Opening DevTools or resizing the browser window never mutates the hardware fingerprint.
 */

let cachedFingerprint: string | null = null

function getWebGLSignals(): string[] {
  if (typeof document === 'undefined') {
    return ['no-doc', 'no-doc', '0', '0', 'no-shading']
  }
  try {
    const canvas = document.createElement('canvas')
    const gl = (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null
    if (!gl) {
      return ['no-gl', 'no-gl', '0', '0', 'no-shading']
    }

    const dbgRenderInfo = gl.getExtension('WEBGL_debug_renderer_info')
    const vendor = dbgRenderInfo ? gl.getParameter(dbgRenderInfo.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR)
    const renderer = dbgRenderInfo ? gl.getParameter(dbgRenderInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE)
    const maxCubeMapSize = gl.getParameter(gl.MAX_CUBE_MAP_TEXTURE_SIZE)
    const shadingLanguage = gl.getParameter(gl.SHADING_LANGUAGE_VERSION)

    return [
      String(vendor || 'unknown-vendor'),
      String(renderer || 'unknown-renderer'),
      String(maxTextureSize || 0),
      String(maxCubeMapSize || 0),
      String(shadingLanguage || 'unknown-shading'),
    ]
  } catch {
    return ['gl-error', 'gl-error', '0', '0', 'gl-error']
  }
}

/**
 * Generates a stable, DevTools-proof SHA-256 hardware fingerprint.
 * Excludes transient layout attributes (screen width/height, innerWidth, pixelRatio, touchPoints).
 */
export async function getStableDeviceFingerprint(): Promise<string> {
  if (cachedFingerprint) {
    return cachedFingerprint
  }

  // 1. WebGL silicon & GPU attributes
  const webglSignals = getWebGLSignals()

  // 2. CPU Architecture & Bitness via Client Hints (Chromium)
  let archBitness = 'arch-unknown'
  const nav = typeof navigator !== 'undefined' ? (navigator as unknown as { userAgentData?: { getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string; bitness?: string }> } }) : null
  if (nav?.userAgentData && typeof nav.userAgentData.getHighEntropyValues === 'function') {
    try {
      const high = await nav.userAgentData.getHighEntropyValues(['architecture', 'bitness'])
      archBitness = `${high.architecture || 'unknown'}-${high.bitness || 'unknown'}`
    } catch {
      archBitness = 'arch-fallback'
    }
  }

  // 3. Hardware Concurrency
  const concurrency = typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency || 0) : 0

  // 4. Device Memory (GB)
  const memory = typeof navigator !== 'undefined' && 'deviceMemory' in navigator
    ? ((navigator as unknown as { deviceMemory?: number }).deviceMemory || 0)
    : 0

  // 5. Color Depth
  const colorDepth = typeof window !== 'undefined' && window.screen ? (window.screen.colorDepth || 0) : 0

  // 6. Configured Time Zone
  let timezone = 'unknown'
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown'
  } catch {
    timezone = 'unknown'
  }

  const components = [
    ...webglSignals,
    archBitness,
    String(concurrency),
    String(memory),
    String(colorDepth),
    timezone,
  ]

  const rawString = components.join('###')

  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const encoder = new TextEncoder()
      const data = encoder.encode(rawString)
      const hashBuffer = await crypto.subtle.digest('SHA-256', data)
      const hashArray = Array.from(new Uint8Array(hashBuffer))
      cachedFingerprint = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
      return cachedFingerprint
    } catch {
      // Fallback below
    }
  }

  // Simple string fallback if Web Crypto is unavailable
  let hash = 0
  for (let i = 0; i < rawString.length; i++) {
    hash = (hash << 5) - hash + rawString.charCodeAt(i)
    hash |= 0
  }
  cachedFingerprint = `fallback_${Math.abs(hash).toString(16).padStart(16, '0')}`
  return cachedFingerprint
}

/**
 * Resolves the exact human-readable device name to send to the backend.
 */
export async function getExactDeviceName(): Promise<string> {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  const nav = typeof navigator !== 'undefined' ? (navigator as unknown as { userAgentData?: { platform?: string; getHighEntropyValues?: (hints: string[]) => Promise<{ model?: string; platform?: string }> }; platform?: string }) : null

  // 1. Android Detection
  if (nav?.userAgentData && typeof nav.userAgentData.getHighEntropyValues === 'function') {
    try {
      const high = await nav.userAgentData.getHighEntropyValues(['model', 'platform'])
      if (high.platform === 'Android' && high.model && high.model.trim()) {
        const cleanModel = high.model.trim()
        if (cleanModel.toLowerCase() !== 'k' && cleanModel.toLowerCase() !== 'wv') {
          return cleanModel
        }
      }
    } catch {}
  }

  if (/Android/i.test(ua)) {
    const match = ua.match(/Android\s+[\d\.]+;\s*([^;)]+?)(?:\s+Build|\s*;|\))/i)
    if (match && match[1]) {
      const rawModel = match[1].replace(/\s+Build.*$/i, '').trim()
      if (rawModel && !['k', 'wv', 'mobile'].includes(rawModel.toLowerCase())) {
        return rawModel
      }
    }
    return 'Android device'
  }

  // 2. iPhone / iPad Exact Hardware Model Detection via Screen Metrics
  if (/iPad/i.test(ua) || (typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
    return 'iPad'
  }

  if (/iPhone/i.test(ua) && typeof window !== 'undefined' && window.screen) {
    const w = Math.min(window.screen.width, window.screen.height)
    const h = Math.max(window.screen.width, window.screen.height)
    const dpr = Math.round((window.devicePixelRatio || 1) * 10) / 10

    if (w === 440 && h === 956 && Math.round(dpr) === 3) return 'iPhone 16 Pro Max'
    if (w === 402 && h === 874 && Math.round(dpr) === 3) return 'iPhone 16 Pro'
    if (w === 430 && h === 932 && Math.round(dpr) === 3) return 'iPhone 15 Pro Max / 16 Plus'
    if (w === 393 && h === 852 && Math.round(dpr) === 3) return 'iPhone 15 / 15 Pro / 16'
    if (w === 428 && h === 926 && Math.round(dpr) === 3) return 'iPhone 13 Pro Max / 14 Plus'
    if (w === 390 && h === 844 && Math.round(dpr) === 3) return 'iPhone 13 / 14'
    if (w === 375 && h === 812 && Math.round(dpr) === 3) return 'iPhone X / XS / 11 Pro / 12 mini / 13 mini'
    if (w === 414 && h === 896 && Math.round(dpr) === 3) return 'iPhone XS Max / 11 Pro Max'
    if (w === 414 && h === 896 && Math.round(dpr) === 2) return 'iPhone XR / 11'
    if (w === 375 && h === 667 && Math.round(dpr) === 2) return 'iPhone SE'

    return 'iPhone'
  }

  // 3. Desktop OS Classification
  const platform = nav?.userAgentData?.platform || nav?.platform || ''
  if (/Win/i.test(platform) || /Windows/i.test(ua)) return 'Windows'
  if (/Mac/i.test(platform) || /Macintosh|Mac OS/i.test(ua)) return 'macOS'
  if (/Linux/i.test(platform) || /Linux/i.test(ua)) return 'Linux'

  return 'Desktop'
}
