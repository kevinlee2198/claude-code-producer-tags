import type { On } from 'claude-code'
import { mock, type Engine } from 'claude-code/testing'

import type { OsName } from '../types'

/** A 44-byte WAV header with no samples: parses, 0 ms long. */
export const EMPTY_WAV = 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAIlYAAESsAAACABAAZGF0YQAAAAA='

export const PANE = {
  plugin: 'producer-tags',
  component: 'Pane' as const,
  requestId: 'producer-tags',
  props: { title: 'Producer Tags', isFocused: true, bodyColumns: 100, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 80 }, view: {} },
}

export const BAND = {
  plugin: 'producer-tags',
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 120, scroll: { offset: 0, bodyRows: 4 }, view: {} },
}

/** What `$.session.start` takes in a test: the session as a REPL in /repo. */
export const START = { cwd: '/repo', surface: 'terminal', isInteractive: true } as const

export type BashAnswer =
  | { result: Record<string, unknown> }
  | { isError: true; result: unknown; text: string }

export type WorldOptions = {
  os?: OsName
  /** What `command -v` finds on linux. */
  linuxPlayer?: string
  /** How long (mock clock) a fake `$.audio.play` takes; 0 resolves at once. */
  audioMs?: number
  /** How many 100 ms `t` ticks a fake spawned player prints before exiting. */
  spawnTicks?: number
  store?: Record<string, unknown>
  env?: Record<string, string>
  files?: Record<string, string | { base64: string }>
  /** Exit code for a `$.process.run` the world does not special-case. */
  runExit?: (argv: readonly string[]) => number
  /** Command names `command.register` refuses (as a built-in or another plugin's would be). */
  refuse?: string[]
  /** `$.audio.play` rejects, as on a machine that cannot play the clip. */
  audioFails?: boolean
}

export type World = {
  clock: ReturnType<typeof mock.clock>
  plays: { clip: Record<string, unknown>; gain: number | undefined }[]
  runs: { argv: readonly string[]; env: Record<string, string> | undefined }[]
  spawns: { argv: readonly string[]; env: Record<string, string> | undefined; isEnded: boolean }[]
  toasts: string[]
  /** What the plugin wrote to the debug log. */
  logs: string[]
  state: Map<string, unknown>
  opened: string[]
  registered: string[]
  toolUseIds: string[]
  files: Map<string, string | { base64: string }>
  /** What the plugin last wrote to `$.store`, by key. */
  stored: Map<string, unknown>
  /** The Bash answer for every call, unless `bashBy` has one for that exact command. */
  bash: BashAnswer
  bashBy: Record<string, BashAnswer>
}

export const OK: BashAnswer = { result: { stdout: '', stderr: '', interrupted: false } }

export const committed = (kind = 'committed'): BashAnswer => ({
  result: { stdout: '', stderr: '', interrupted: false, gitOperation: { commit: { sha: 'abc1234', kind } } },
})

const ran = (stdout: string, exitCode = 0) => ({
  exitCode,
  stdout,
  stderr: '',
  isStdoutTruncated: false,
  isStderrTruncated: false,
})

/** Fakes every `$` noun the mod touches, beneath the plugin. Call before the test's first `$` call. */
export function world(on: On, options: WorldOptions = {}): World {
  const os = options.os ?? 'mac'
  const clock = mock.clock(on, { now: 1_000_000 })
  // The world owns the store, so what the plugin wrote is known whatever order hooks nest in.
  const store = new Map<string, unknown>(Object.entries(options.store ?? {}))
  const stored = new Map<string, unknown>()
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => {
    store.set(e.key, e.value)
    stored.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.delete', ($, e) => {
    store.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  mock.env(on, {
    ...(os === 'windows' ? { OS: 'Windows_NT', USERPROFILE: 'C:\\Users\\dev' } : { HOME: '/home/dev' }),
    ...(options.env ?? {}),
  })
  const files = new Map(Object.entries(options.files ?? {}))
  if (os === 'wsl') files.set('/proc/version', 'Linux version 6.6.87.2-microsoft-standard-WSL2')
  if (os === 'linux') files.set('/proc/version', 'Linux version 6.8.0-45-generic')
  const w: World = {
    clock,
    plays: [],
    runs: [],
    spawns: [],
    toasts: [],
    logs: [],
    state: new Map(),
    opened: [],
    registered: [],
    toolUseIds: [],
    files,
    stored,
    bash: OK,
    bashBy: {},
  }

  on('process.run', ($, e) => {
    w.runs.push({ argv: e.argv, env: e.init?.env })
    const [command, ...rest] = e.argv
    if (command === 'uname') return { value: ran(os === 'mac' ? 'Darwin\n' : 'Linux\n') }
    if (command === 'sh' && rest[1]?.includes('command -v')) return { value: ran(`${options.linuxPlayer ?? 'pw-play'}\n`) }
    if (command === 'wslpath') return { value: ran(`/mnt/c/${rest[1]!.slice(3).replaceAll('\\', '/')}\n`) }
    return { value: ran('', options.runExit?.(e.argv) ?? 0) }
  })
  on('process.spawn', async function* ($, e) {
    const record = { argv: e.argv, env: e.env, isEnded: false }
    w.spawns.push(record)
    try {
      yield { stream: 'stdout' as const, text: e.argv[0] === 'sh' ? 'pid 4242\n' : 'started\n' }
      for (let i = 0; i < (options.spawnTicks ?? 20); i++) {
        await clock.sleep(100)
        yield { stream: 'stdout' as const, text: 't\n' }
      }
      return { value: { code: 0, signal: null } }
    } finally {
      record.isEnded = true
    }
  })
  on('audio.play', async ($, e) => {
    w.plays.push({ clip: e.clip as Record<string, unknown>, gain: e.gain })
    if (options.audioFails) return { deny: 'cannot play this clip' }
    if (options.audioMs) await clock.sleep(options.audioMs)
    return { value: undefined }
  })
  on('fs.read', ($, e) => {
    const file = files.get(e.path)
    if (file === undefined) return { deny: `ENOENT: ${e.path}` }
    if (e.as === 'bytes') return { value: typeof file === 'string' ? { base64: '' } : file }
    return { value: typeof file === 'string' ? file : '' }
  })
  on('fs.exists', ($, e) => ({ value: files.has(e.path) }))
  on('fs.stat', ($, e) => {
    const file = files.get(e.path)
    if (file === undefined) return { deny: `ENOENT: ${e.path}` }
    const size = typeof file === 'string' ? file.length : Math.floor((file.base64.length * 3) / 4)
    return { value: { kind: 'file' as const, size, mtimeMs: 0, isLink: false } }
  })
  on('fs.list', () => ({ value: [] }))
  on('ui.toast', ($, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', ($, e) => {
    w.logs.push(e.text)
    return { value: undefined }
  })
  on('ui.open', ($, e) => {
    w.opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('command.register', ($, e) => {
    if (options.refuse?.includes(e.name)) return { deny: `/${e.name} is taken` }
    w.registered.push(e.name)
    return { value: { command: e.name } }
  })
  on('state.set', async ($, e, next) => {
    const result = await next(e)
    w.state.set(e.id === undefined ? e.key : `${e.key}:${e.id}`, e.value)
    return result
  })
  on('tool.call', { tool: 'Bash' }, ($, e) => {
    w.toolUseIds.push(e.tool_use_id)
    return (w.bashBy[e.command] ?? w.bash) as never
  })
  on('classic.PostModelSwitch', () => ({}) as never)
  on('classic.SessionStart', () => ({}) as never)
  on('classic.Stop', () => ({}) as never)
  on('session.start', () => ({ cwd: '/repo' }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    if (e.component === 'SessionMode') return <Text>{(e.props as { modes: string[] }).modes.join(' | ')}</Text>
    return <Text>ENGINE</Text>
  })
  return w
}

/** Runs a Bash call through the engine with the world's answer, then lets scheduled tag work run. */
export async function bash($: Engine, w: World, command: string, answer: BashAnswer = OK): Promise<string> {
  w.bash = answer
  await $.tool.call({ tool: 'Bash', command } as never)
  await w.clock.settle()
  return w.toolUseIds[w.toolUseIds.length - 1]!
}
