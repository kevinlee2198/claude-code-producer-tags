import type { Cell, Host } from '../hooks/host'
import { EMPTY_DRAFT, NO_WORD } from '../hooks/state'
import type { ImportedSound, NowPlaying, Platform, Settings, TriggerKey } from '../types'

/** A `$.state` value held in memory. */
export function cell<T>(initial: T): Cell<T> {
  let value = initial
  return {
    read: async () => value,
    update: async change => (value = change(value)),
  }
}

export type FakeHostOptions = {
  env?: { OS?: string; HOME?: string; USERPROFILE?: string; CLAUDE_CONFIG_DIR?: string; WSLENV?: string }
  store?: Record<string, unknown>
  /** Text files (`readText`) and byte files (`readBytes`, as base64) by path. */
  files?: Record<string, string | { base64: string }>
  /** Answers `run`; the default exits 0 with no output. */
  run?: (argv: readonly string[]) => { exitCode?: number; stdout?: string }
}

/** What a fake Host recorded. */
export type FakeHost = Host & {
  toasts: string[]
  logs: string[]
  runs: { argv: readonly string[]; env: Record<string, string> | undefined }[]
  stored: Map<string, unknown>
  tags: Map<string, string | null>
}

const missing = (path: string) => Promise.reject(new Error(`ENOENT: ${path}`))

/**
 * A Host with no engine beneath: state, store and files in memory, a clock that stands still at
 * 1 000 000 and timers that never fire. For the plain modules' unit tests; flows that need the
 * clock to move go through the engine with `world()` instead.
 */
export function fakeHost(options: FakeHostOptions = {}): FakeHost {
  const store = new Map(Object.entries(options.store ?? {}))
  const files = new Map(Object.entries(options.files ?? {}))
  const env = options.env ?? { HOME: '/home/dev' }
  const timer = { cancel: () => undefined }
  const host: FakeHost = {
    toasts: [],
    logs: [],
    runs: [],
    stored: new Map(),
    tags: new Map(),
    root: '/plugin',
    now: async () => 1_000_000,
    after: () => timer,
    every: () => timer,
    run: async (argv, init) => {
      host.runs.push({ argv, env: init?.env })
      const answer = options.run?.(argv) ?? {}
      return { exitCode: answer.exitCode ?? 0, stdout: answer.stdout ?? '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
    },
    spawn: () => {
      throw new Error('fakeHost: spawn is not faked; test playback through world()')
    },
    play: async () => undefined,
    readText: async path => {
      const file = files.get(path)
      return typeof file === 'string' ? file : missing(path)
    },
    readBytes: async path => {
      const file = files.get(path)
      return file !== undefined && typeof file !== 'string' ? file : missing(path)
    },
    exists: async path => files.has(path),
    stat: async path => {
      const file = files.get(path)
      if (file === undefined) return missing(path)
      return { kind: 'file', size: typeof file === 'string' ? file.length : Math.floor((file.base64.length * 3) / 4), mtimeMs: 0, isLink: false }
    },
    list: async () => [],
    env: {
      os: async () => env.OS,
      home: async () => env.HOME,
      userProfile: async () => env.USERPROFILE,
      configDir: async () => env.CLAUDE_CONFIG_DIR,
      wslEnv: async () => env.WSLENV,
    },
    storeGet: async key => store.get(key),
    storeSet: async (key, value) => {
      store.set(key, value)
      host.stored.set(key, value)
    },
    toast: text => void host.toasts.push(text),
    log: text => void host.logs.push(text),
    openPane: async () => ({ isPlaced: true }),
    registerCommand: async spec => ({ command: spec.name }),
    state: {
      settings: cell<Settings | null>(null),
      imports: cell<ImportedSound[] | null>(null),
      nowPlaying: cell<NowPlaying | null>(null),
      bandFrame: cell(0),
      captionWord: cell(NO_WORD),
      platform: cell<Platform | null>(null),
      cooldowns: cell<Partial<Record<TriggerKey, number>>>({}),
      toasted: cell<string[]>([]),
      paneDraft: cell(EMPTY_DRAFT),
    },
    tag: async (toolUseId, sound) => void host.tags.set(toolUseId, sound),
  }
  return host
}
