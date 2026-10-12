import type { SoundId, TriggerId } from '../types'

export const PLUGIN = 'producer-tags'
export const PANE_ID = 'producer-tags'

/** Set from Task 0's R2 result: 'soundplayer' when MediaPlayer could not play headless. */
export const WINDOWS_ENGINE: 'mediaplayer' | 'soundplayer' = 'mediaplayer'

export type TriggerDef = {
  id: TriggerId
  label: string
  enabled: boolean
  sound: SoundId
}

export const TRIGGERS: readonly TriggerDef[] = [
  { id: 'git.commit', label: 'git commit', enabled: true, sound: 'pt:anthropic-trust' },
  { id: 'git.merge', label: 'git merge', enabled: true, sound: 'pt:just-merged' },
  { id: 'git.push', label: 'git push', enabled: true, sound: 'pt:did-it-again' },
  { id: 'tests.pass', label: 'tests pass', enabled: true, sound: 'pt:tests-passin' },
  { id: 'command.fail', label: 'command fails', enabled: false, sound: 'pt:tay-keith-fix' },
  { id: 'model.opus', label: '→ Opus', enabled: true, sound: 'pt:opus-come-out' },
  { id: 'model.fable', label: '→ Fable', enabled: true, sound: 'pt:fable-on-beat' },
  { id: 'model.sonnet', label: '→ Sonnet', enabled: true, sound: 'pt:sonnet-booth' },
  { id: 'model.haiku', label: '→ Haiku', enabled: true, sound: 'pt:haiku-quick' },
  { id: 'model.other', label: '→ other model', enabled: true, sound: 'pt:who-let-model' },
  { id: 'session.open', label: 'session start', enabled: false, sound: 'pt:khaled-claude' },
  { id: 'session.close', label: 'exit', enabled: true, sound: 'pt:claude-outta' },
  { id: 'turn.done', label: 'turn done', enabled: false, sound: 'pt:another-one' },
]

/** One sound per Bash event: the first enabled candidate in this order wins (after custom triggers). */
export const BASH_PRIORITY: readonly TriggerId[] = ['git.merge', 'git.push', 'git.commit', 'tests.pass', 'command.fail']

export const FALLBACK_SOUND: SoundId = 'pt:808-boom'
export const DEFAULT_VOLUME = 80
export const COOLDOWN_MS = 30_000
export const MAX_CLIP_MS = 15_000
export const CLAIM_GRACE_MS = 5_000
export const END_TAIL_MS = 1_000
export const FRAME_MS = 100
export const MAX_CUSTOM = 20
export const MAX_PATTERN_LENGTH = 200
export const MAX_MATCH_INPUT = 2048
export const MAX_IMPORT_BYTES = 4 * 1024 * 1024
