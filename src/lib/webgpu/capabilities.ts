/**
 * webgpu/capabilities.ts
 *
 * Detects GPU and codec capabilities available in the current browser.
 * Results are cached for the lifetime of the page — capabilities don't change
 * at runtime. Falls back gracefully to Canvas2D when WebGPU is unavailable,
 * satisfying the decision: "require modern Chromium OR degrade gracefully."
 */

import type { GPUCapability } from '../../types'
export type { GPUCapability }

export interface GPUCapabilities {
  /** True when navigator.gpu exists and an adapter can be requested. */
  webgpu: boolean
  /** True when VideoDecoder / VideoEncoder are available (Chrome 94+). */
  webcodecs: boolean
  /** True when the browser can hardware-decode H.264 at 1080p. */
  hardwareDecoding: boolean
  /** Best-effort VRAM estimate in megabytes. */
  vramEstimateMB: number
  /** Convenience: the rendering mode to use for the preview stage. */
  renderMode: GPUCapability
}

// ─── probe helpers ────────────────────────────────────────────────────────────

async function probeWebGPU(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !('gpu' in navigator) || !navigator.gpu) {
      return false
    }
    const adapter = await navigator.gpu.requestAdapter()
    return adapter !== null
  } catch {
    return false
  }
}

function probeWebCodecs(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof VideoDecoder !== 'undefined' &&
    typeof VideoEncoder !== 'undefined' &&
    typeof VideoFrame !== 'undefined'
  )
}

/**
 * Probes whether the browser reports hardware-accelerated support for H.264.
 * Uses `VideoDecoder.isConfigSupported` — a capability check that does NOT
 * decode any video, so it is safe to call on page load.
 */
async function probeHardwareDecoder(codec = 'avc1.4d0034'): Promise<boolean> {
  try {
    if (!probeWebCodecs()) return false
    const result = await VideoDecoder.isConfigSupported({
      codec,
      codedWidth: 1920,
      codedHeight: 1080,
      hardwareAcceleration: 'prefer-hardware',
    })
    return result.supported === true
  } catch {
    return false
  }
}

/**
 * Estimates usable VRAM in MB.
 *
 * Heuristic: navigator.deviceMemory reports RAM in GB (rounded to a power of
 * two). Integrated graphics typically share 25–50% of system RAM as VRAM.
 * We use a conservative 20% to avoid over-allocation.
 *
 * A manual override can be supplied by calling setVRAMOverrideMB() before
 * the first detectGPUCapabilities() call.
 */
let _vramOverrideMB: number | null = null

export function setVRAMOverrideMB(mb: number): void {
  _vramOverrideMB = Math.max(64, mb)
}

function estimateVRAM(): number {
  if (_vramOverrideMB !== null) return _vramOverrideMB
  if (typeof navigator === 'undefined') return 1024
  const deviceMemoryGB: number = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 4
  // 20% of system RAM, clamped between 256 MB and 4 GB
  return Math.min(4096, Math.max(256, Math.round(deviceMemoryGB * 1024 * 0.2)))
}

// ─── cached result ─────────────────────────────────────────────────────────────

let _cachedPromise: Promise<GPUCapabilities> | null = null

/**
 * Detects all GPU capabilities. The result is cached after the first call.
 * Concurrent callers share the same underlying Promise.
 *
 * @example
 * const caps = await detectGPUCapabilities()
 * if (caps.webgpu) { // use WebGPU compositor }
 * else             { // fall back to Canvas2D   }
 */
export function detectGPUCapabilities(): Promise<GPUCapabilities> {
  if (_cachedPromise) return _cachedPromise

  _cachedPromise = (async () => {
    const [webgpu, hardwareDecoding] = await Promise.all([
      probeWebGPU(),
      probeHardwareDecoder(),
    ])
    const webcodecs = probeWebCodecs()

    const renderMode: GPUCapability = webgpu ? 'webgpu' : webcodecs ? 'canvas2d' : 'unknown'

    return {
      webgpu,
      webcodecs,
      hardwareDecoding,
      vramEstimateMB: estimateVRAM(),
      renderMode,
    }
  })()

  return _cachedPromise
}

/** Clears the cached result (useful in tests). */
export function _resetCapabilitiesCache(): void {
  _cachedPromise = null
}
