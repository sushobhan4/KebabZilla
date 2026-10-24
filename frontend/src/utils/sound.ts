/**
 * Sound notification manager for incoming orders across Kitchen and Admin queues.
 * Plays /notification_sound.mp3, with Web Audio API dual-tone chime fallback.
 */

let cachedAudio: HTMLAudioElement | null = null
let audioUnlocked = false

/**
 * Pre-warms or unlocks the browser audio context on user interaction.
 */
export function unlockAudio() {
  if (audioUnlocked) return
  audioUnlocked = true
  try {
    if (!cachedAudio) {
      cachedAudio = new Audio('/notification_sound.mp3')
      cachedAudio.preload = 'auto'
    }
    cachedAudio.load()
  } catch {
    // Ignore unlock errors
  }
}

// Auto-register user interaction listener to satisfy browser autoplay policies
if (typeof window !== 'undefined') {
  const unlockEvents = ['click', 'touchstart', 'keydown']
  const onInteract = () => {
    unlockAudio()
    unlockEvents.forEach((evt) => window.removeEventListener(evt, onInteract))
  }
  unlockEvents.forEach((evt) => window.addEventListener(evt, onInteract, { once: true, passive: true }))
}

/**
 * Plays the order notification sound.
 * Tries /notification_sound.mp3 first; falls back to Web Audio API synthesized chime.
 */
export function playOrderNotificationSound() {
  try {
    if (!cachedAudio) {
      cachedAudio = new Audio('/notification_sound.mp3')
      cachedAudio.preload = 'auto'
    }
    cachedAudio.currentTime = 0
    const p = cachedAudio.play()
    if (p !== undefined) {
      p.catch(() => {
        // Autoplay policy or missing audio file fallback
        playChimeFallback()
      })
    }
  } catch {
    playChimeFallback()
  }
}

/**
 * Web Audio API synthesizer fallback:
 * Emits an energetic high-pitch dual chime (C6 @ 1046.5Hz followed by E6 @ 1318.5Hz).
 */
function playChimeFallback() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!AudioCtx) return
    const ctx = new AudioCtx()
    if (ctx.state === 'suspended') {
      void ctx.resume()
    }
    const now = ctx.currentTime

    const playTone = (freq: number, start: number, duration: number) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, start)
      gain.gain.setValueAtTime(0.25, start)
      gain.gain.exponentialRampToValueAtTime(0.001, start + duration)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(start)
      osc.stop(start + duration)
    }

    playTone(1046.5, now, 0.35)
    playTone(1318.51, now + 0.12, 0.45)
  } catch {
    // Ignore audio context errors
  }
}
