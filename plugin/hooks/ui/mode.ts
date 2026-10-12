import type { Settings } from '../../types'

/** The session's mode labels with ours added: `♫ tags`, or `♫ muted` (spec §8.5). */
export function modesWith(modes: readonly string[], settings: Settings): string[] {
  return [...modes, settings.muted ? '♫ muted' : '♫ tags']
}
