import type { NowPlaying } from '../../types'

export const BAR_GLYPHS = '▁▂▃▄▅▆▇█'

/** How many bars the band's equalizer draws. */
export const EQ_COLUMNS = 10

export function progressOf(np: NowPlaying, now: number): number {
  if (np.startedAt === null || np.durationMs === null || np.durationMs <= 0) return 0
  return Math.min(1, Math.max(0, (now - np.startedAt) / np.durationMs))
}

function pseudoRandom(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

/** `count` bar heights (0–7) for this moment: the clip's loudness with a little per-bar motion. */
export function levelsAt(peaks: readonly number[] | null, progress: number, count: number, seed: number): number[] {
  return Array.from({ length: count }, (_, i) => {
    const wobble = 0.55 + 0.45 * pseudoRandom(seed * 31 + i)
    const loudness =
      peaks !== null && peaks.length > 0
        ? peaks[Math.min(peaks.length - 1, Math.floor(progress * peaks.length))]! * wobble
        : pseudoRandom(seed * 17 + i)
    return Math.min(7, Math.max(0, Math.round(loudness * 7)))
  })
}

export function barsText(levels: readonly number[]): string {
  return levels.map(level => BAR_GLYPHS[level]).join('')
}

/** The clip's peaks squeezed into `width` bars (0–7). */
export function waveformLevels(peaks: readonly number[] | null, width: number): number[] {
  if (peaks === null || peaks.length === 0) return new Array<number>(width).fill(0)
  return Array.from({ length: width }, (_, i) => {
    const from = Math.floor((i * peaks.length) / width)
    const to = Math.max(from + 1, Math.floor(((i + 1) * peaks.length) / width))
    return Math.min(7, Math.round(Math.max(...peaks.slice(from, to)) * 7))
  })
}

/** Which caption word is lit now; -1 when the clip's length is unknown (no highlight). */
export function captionWordAt(np: NowPlaying, now: number): number {
  if (np.durationMs === null || np.durationMs <= 0 || np.startedAt === null) return -1
  const words = np.caption.split(/\s+/).filter(Boolean).length
  return Math.min(words - 1, Math.floor(progressOf(np, now) * words))
}
