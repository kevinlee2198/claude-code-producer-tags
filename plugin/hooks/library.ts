import type { AudioExt, ImportedSound, OsName, PlayerName, SoundId } from '../types'
import { CATALOG } from './catalog'
import { WINDOWS_ENGINE } from './constants'

export const PEAK_COUNT = 64

export const MIME: Record<AudioExt, string> = {
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aiff: 'audio/aiff',
}

export function extOf(path: string): AudioExt | null {
  const ext = /\.([A-Za-z0-9]+)$/.exec(path)?.[1]?.toLowerCase()
  if (ext === 'aif') return 'aiff'
  return ext === 'wav' || ext === 'mp3' || ext === 'm4a' || ext === 'aiff' ? ext : null
}

export function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

export function allowedExts(os: OsName, player: PlayerName): AudioExt[] {
  if (os === 'mac') return ['wav', 'mp3', 'm4a', 'aiff']
  if (os === 'windows' || os === 'wsl') return WINDOWS_ENGINE === 'mediaplayer' ? ['wav', 'mp3'] : ['wav']
  if (player === 'ffplay') return ['wav', 'mp3', 'm4a', 'aiff']
  if (player === 'aplay') return ['wav']
  return ['wav', 'aiff']
}

export type WavInfo = { durationMs: number; peaks: number[] }

/** PCM 8/16/24-bit or float32, mono or stereo, WAVE_FORMAT_EXTENSIBLE; null for anything else or anything malformed. */
export function parseWav(bytes: Uint8Array): WavInfo | null {
  if (bytes.length < 12) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tag = (offset: number) => String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!)
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null
  let format = 0
  let channels = 0
  let bits = 0
  let byteRate = 0
  let blockAlign = 0
  let dataStart = -1
  let dataBytes = 0
  let offset = 12
  while (offset + 8 <= bytes.length) {
    const id = tag(offset)
    const size = view.getUint32(offset + 4, true)
    const body = offset + 8
    if (id === 'fmt ' && size >= 16) {
      if (body + 16 > bytes.length) return null
      format = view.getUint16(body, true)
      channels = view.getUint16(body + 2, true)
      byteRate = view.getUint32(body + 8, true)
      blockAlign = view.getUint16(body + 12, true)
      bits = view.getUint16(body + 14, true)
      if (format === 0xfffe && size >= 26) {
        if (body + 26 > bytes.length) return null
        format = view.getUint16(body + 24, true)
      }
    } else if (id === 'data') {
      dataStart = body
      dataBytes = Math.min(size, bytes.length - body)
      break
    }
    offset = body + size + (size % 2)
  }
  const isPcm = format === 1 && (bits === 8 || bits === 16 || bits === 24)
  const isFloat = format === 3 && bits === 32
  if (dataStart < 0 || byteRate === 0 || (!isPcm && !isFloat)) return null
  const bytesPerSample = bits / 8
  if ((channels !== 1 && channels !== 2) || blockAlign < channels * bytesPerSample) return null
  const readSample = (at: number): number => {
    if (isFloat) return view.getFloat32(at, true)
    if (bits === 8) return (view.getUint8(at) - 128) / 128
    if (bits === 16) return view.getInt16(at, true) / 32768
    return (view.getUint8(at) | (view.getUint8(at + 1) << 8) | (view.getInt8(at + 2) << 16)) / 8388608
  }
  // The loudest channel of the frame; non-finite samples are skipped so one NaN cannot blank the waveform.
  const sampleAt = (frame: number): number => {
    let loudest = 0
    for (let c = 0; c < channels; c++) {
      const level = Math.abs(readSample(dataStart + frame * blockAlign + c * bytesPerSample))
      if (Number.isFinite(level)) loudest = Math.max(loudest, level)
    }
    return loudest
  }
  let peaks: number[]
  try {
    peaks = peaksOf(Math.floor(dataBytes / blockAlign), sampleAt)
  } catch (error) {
    if (error instanceof RangeError) return null
    throw error
  }
  return {
    durationMs: Math.round((dataBytes / byteRate) * 1000),
    peaks,
  }
}

/** The loudest sample in each of `count` buckets, scaled so the loudest bucket is 1. */
export function peaksOf(frames: number, sampleAt: (i: number) => number, count = PEAK_COUNT): number[] {
  if (frames === 0) return new Array<number>(count).fill(0)
  const raw: number[] = []
  for (let b = 0; b < count; b++) {
    const start = Math.floor((b * frames) / count)
    const end = Math.max(start + 1, Math.floor(((b + 1) * frames) / count))
    const step = Math.max(1, Math.floor((end - start) / 256))
    let max = 0
    for (let i = start; i < end && i < frames; i += step) max = Math.max(max, Math.abs(sampleAt(i)))
    raw.push(max)
  }
  const top = Math.max(...raw)
  return raw.map(v => (top > 0 ? Math.round((v / top) * 100) / 100 : 0))
}

const RESERVED = new Set([
  'con', 'prn', 'aux', 'nul',
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
])

export function slugify(fileName: string, taken: ReadonlySet<string>): string {
  let base = fileName
    .replace(/\.[^.]*$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '')
  if (base === '') base = 'sound'
  if (RESERVED.has(base)) base = `${base}-1`
  const lowerTaken = new Set([...taken].map(name => name.toLowerCase()))
  if (!lowerTaken.has(base)) return base
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`
    if (!lowerTaken.has(candidate)) return candidate
  }
}

export type ResolvedSound = {
  id: SoundId
  caption: string
  riff: string
  durationMs: number | null
  peaks: number[] | null
  source: { kind: 'asset'; asset: string } | { kind: 'file'; path: string; ext: AudioExt }
}

export function resolveSound(id: SoundId, imports: readonly ImportedSound[]): ResolvedSound | null {
  const entry = CATALOG.find(c => c.id === id)
  if (entry !== undefined) {
    return {
      id,
      caption: entry.caption,
      riff: entry.riff,
      durationMs: entry.durationMs,
      peaks: entry.peaks.length > 0 ? entry.peaks : null,
      source: { kind: 'asset', asset: entry.file },
    }
  }
  const imported = imports.find(sound => sound.id === id)
  if (imported === undefined) return null
  return {
    id,
    caption: imported.name,
    riff: 'your own tag',
    durationMs: imported.durationMs,
    peaks: imported.peaks,
    source: { kind: 'file', path: imported.file, ext: imported.ext },
  }
}

export function soundOptions(imports: readonly ImportedSound[]): { value: string; label: string }[] {
  return [
    ...CATALOG.map(c => ({ value: c.id, label: c.id.slice('pt:'.length) })),
    ...imports.map(sound => ({ value: sound.id, label: `${sound.name} (yours)` })),
  ]
}

export function soundLabel(id: SoundId, imports: readonly ImportedSound[]): string {
  return soundOptions(imports).find(option => option.value === id)?.label ?? id
}

export function padSounds(): SoundId[] {
  return CATALOG.filter(c => c.isVoice).slice(0, 9).map(c => c.id)
}
