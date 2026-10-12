export type TriggerId =
  | 'git.commit'
  | 'git.push'
  | 'git.merge'
  | 'tests.pass'
  | 'command.fail'
  | 'model.opus'
  | 'model.fable'
  | 'model.sonnet'
  | 'model.haiku'
  | 'model.other'
  | 'session.open'
  | 'session.close'
  | 'turn.done'

/** Cooldown and now-playing key: a built-in trigger, `custom:<id>`, or a preview. */
export type TriggerKey = TriggerId | `custom:${string}` | 'preview'

/** `pt:<id>` for a bundled sound, `user:<slug>` for an import. */
export type SoundId = string

export type Outcome = 'success' | 'fail' | 'any'

export type CustomTrigger = {
  id: string
  pattern: string
  outcome: Outcome
  sound: SoundId
  enabled: boolean
  isInvalid: boolean
}

export type TriggerSetting = { enabled: boolean; sound: SoundId }

export type Settings = {
  version: 1
  muted: boolean
  volume: number
  triggers: Record<TriggerId, TriggerSetting>
  custom: CustomTrigger[]
  studio: { band: boolean; badges: boolean }
}

export type AudioExt = 'wav' | 'mp3' | 'm4a' | 'aiff'

export type ImportedSound = {
  id: SoundId
  name: string
  file: string
  ext: AudioExt
  bytes: number
  durationMs: number | null
  peaks: number[] | null
  isCopy: boolean
}

export type CatalogEntry = {
  id: SoundId
  file: string
  caption: string
  riff: string
  durationMs: number
  peaks: number[]
  isVoice: boolean
}

export type NowPlaying = {
  token: string
  soundId: SoundId
  key: TriggerKey
  caption: string
  riff: string
  claimedAt: number
  startedAt: number | null
  endedAt: number | null
  durationMs: number | null
  deadline: number
  peaks: number[] | null
  toolUseId: string | null
}

export type OsName = 'mac' | 'linux' | 'wsl' | 'windows'
export type LinuxPlayer = 'pw-play' | 'paplay' | 'ffplay' | 'aplay'
export type PlayerName = 'audio' | 'powershell' | LinuxPlayer | 'none'
export type Platform = { os: OsName; player: PlayerName }

export type PaneMessage = { kind: 'ok' | 'warn' | 'error'; where: 'custom' | 'import'; text: string }

export type PaneDraft = {
  isAdding: boolean
  customPattern: string
  customOutcome: Outcome
  customSound: SoundId
  importPath: string
  message: PaneMessage | null
}

/**
 * The settings type under a name of its own: inside `declare module 'claude-code'` below, `Settings`
 * would name the engine's settings type instead, and the settings atom would lose its type.
 */
export type ProducerTagsSettings = Settings

declare module 'claude-code' {
  interface PluginState {
    'producer-tags': {
      settings: ProducerTagsSettings | null
      imports: ImportedSound[] | null
      nowPlaying: NowPlaying | null
      bandFrame: number
      captionWord: number
      tagged: StateFamily<SoundId | null>
      platform: Platform | null
      cooldowns: Partial<Record<TriggerKey, number>>
      paneDraft: PaneDraft
      toasted: string[]
    }
  }
}
