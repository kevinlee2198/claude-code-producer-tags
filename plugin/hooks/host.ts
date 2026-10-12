import type {
  AudioClip,
  CommandSpec,
  FsBytes,
  FsEntry,
  FsStat,
  PaneOpenArgs,
  PlayOptions,
  ProcessRunInit,
  ProcessRunResult,
  ProcessSpawnChunk,
  ProcessSpawnRequest,
  TimerCall,
} from 'claude-code'

import type { ImportedSound, NowPlaying, PaneDraft, Platform, Settings, SoundId, TriggerKey } from '../types'

/** One `$.state` value as the plain modules see it: read it, or change it by compare-and-swap. */
export type Cell<T> = {
  read: () => Promise<T>
  update: (change: (value: T) => T) => Promise<T>
}

/**
 * The engine as `register.tsx` binds it from a hook's `$` (`hostOf`), each member spelled
 * `$.noun.event(...)` there. Every later hook, timer and button press reaches the engine through
 * this, so the rest of the mod is plain functions over a small interface a test can stand in for.
 */
export type Host = {
  /** `$.plugin.root`: the folder holding plugin.json, where the bundled sounds live. */
  root: string
  now: () => Promise<number>
  after: TimerCall
  every: TimerCall
  run: (argv: readonly string[], init?: ProcessRunInit) => Promise<ProcessRunResult>
  /** `$.process.spawn`: breaking out of the loop over it ends the process. */
  spawn: (request: ProcessSpawnRequest) => AsyncIterable<ProcessSpawnChunk>
  play: (clip: AudioClip, options?: PlayOptions) => Promise<void>
  readText: (path: string) => Promise<string>
  readBytes: (path: string) => Promise<FsBytes>
  exists: (path: string) => Promise<boolean>
  stat: (path: string) => Promise<FsStat>
  list: (path: string) => Promise<FsEntry[]>
  /** The environment variables the mod reads; `$.env.get` takes a literal name, so one member each. */
  env: {
    os: () => Promise<string | undefined>
    home: () => Promise<string | undefined>
    userProfile: () => Promise<string | undefined>
    configDir: () => Promise<string | undefined>
    wslEnv: () => Promise<string | undefined>
  }
  storeGet: (key: string) => Promise<unknown>
  storeSet: (key: string, value: unknown) => Promise<void>
  toast: (text: string) => void
  /** One line in the debug log. */
  log: (text: string) => void
  openPane: (pane: PaneOpenArgs) => Promise<unknown>
  registerCommand: (spec: CommandSpec) => Promise<unknown>
  /** The session values in `$.state` (spec §9.2); the render hooks read the same keys. */
  state: {
    settings: Cell<Settings | null>
    imports: Cell<ImportedSound[] | null>
    nowPlaying: Cell<NowPlaying | null>
    bandFrame: Cell<number>
    captionWord: Cell<number>
    platform: Cell<Platform | null>
    cooldowns: Cell<Partial<Record<TriggerKey, number>>>
    toasted: Cell<string[]>
    paneDraft: Cell<PaneDraft>
  }
  /** Writes `tagged[toolUseId]`: the sound a tool row's badge replays, or null for none. */
  tag: (toolUseId: string, sound: SoundId | null) => Promise<unknown>
}
