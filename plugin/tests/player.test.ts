import type { ProcessSpawnChunk } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

import type { Platform } from '../types'
import { CATALOG } from '../hooks/catalog'
import { encodeUtf16LeBase64 } from '../hooks/codec'
import { resolveSound } from '../hooks/library'
import { fakeHost, type FakeHost } from './fake-host'
import { LINUX_WRAPPER, DETACH_COMMAND, WINDOWS_ARGV, play, WINDOWS_SCRIPT, detachedLaunch, filePathOf, linuxPlayerArgv, startSignal, windowsEnv } from '../hooks/player'

describe('player argv and env', () => {
  test('linux players get their own volume flags', () => {
    expect(linuxPlayerArgv('pw-play', '/s/x.wav', 0.8)).toEqual(['pw-play', '--volume', '0.80', '/s/x.wav'])
    expect(linuxPlayerArgv('paplay', '/s/x.wav', 0.5)).toEqual(['paplay', '--volume=32768', '/s/x.wav'])
    expect(linuxPlayerArgv('ffplay', '/s/x.wav', 0.8)).toEqual(['ffplay', '-nodisp', '-autoexit', '-loglevel', 'quiet', '-volume', '80', '/s/x.wav'])
    expect(linuxPlayerArgv('aplay', '/s/x.wav', 0.8)).toEqual(['aplay', '-q', '/s/x.wav'])
  })
  test('windows env carries only data; WSL adds WSLENV with /p for the path; unknown length is PT_MS 0', () => {
    expect(windowsEnv('windows', 'C:\\s\\x.wav', 0.8, 2000, 15000, undefined)).toEqual({
      PT_FILE: 'C:\\s\\x.wav', PT_GAIN: '0.80', PT_MS: '2000', PT_CAP: '15000',
    })
    expect(windowsEnv('wsl', '/s/x.mp3', 1, null, 15000, 'USERPROFILE/p')).toEqual({
      PT_FILE: '/s/x.mp3', PT_GAIN: '1.00', PT_MS: '0', PT_CAP: '15000',
      WSLENV: 'USERPROFILE/p:PT_FILE/p:PT_GAIN:PT_MS:PT_CAP',
    })
  })
  test('PowerShell text holds no double quotes (it crosses Windows command-line quoting)', () => {
    expect(WINDOWS_SCRIPT).not.toContain('"')
    expect(DETACH_COMMAND).not.toContain('"')
  })
  test('bundled sounds are played from under the plugin root', () => {
    const sound = resolveSound(CATALOG[0]!.id, [])!
    expect(filePathOf('/plugins/producer-tags', sound)).toBe(`/plugins/producer-tags/${CATALOG[0]!.file}`)
  })
})

describe('what the player reads and launches', () => {
  const sound = resolveSound(CATALOG[0]!.id, [])!
  const request = { sound, gain: 0.8, maxMs: 15000 }
  test('the start of playback', () => {
    expect(startSignal('pid 4242\n')).toEqual({ isStarted: true, pid: '4242' })
    expect(startSignal('started\n')).toEqual({ isStarted: true, pid: null })
    expect(startSignal('t\n')).toEqual({ isStarted: false, pid: null })
  })
  test('the detached outro per platform', () => {
    expect(detachedLaunch({ os: 'mac', player: 'audio' }, '/p/x.wav', request, undefined)).toEqual({
      argv: ['sh', '-c', 'afplay -t "$PT_SECS" -v "$PT_GAIN" "$PT_FILE" >/dev/null 2>&1 &'],
      env: { PT_FILE: '/p/x.wav', PT_GAIN: '0.80', PT_SECS: '15' },
    })
    const linux = detachedLaunch({ os: 'linux', player: 'aplay' }, '/p/x.wav', request, undefined)
    expect(linux?.argv.slice(3)).toEqual(['pt-play', 'aplay', '-q', '/p/x.wav'])
    expect(linux?.argv[2]).toContain('sleep "$PT_SECS"')
    expect(linux?.argv[2]).toContain('kill "$p"')
    expect(linux?.env).toEqual({ PT_SECS: '15' })
    const wsl = detachedLaunch({ os: 'wsl', player: 'powershell' }, '/p/x.wav', request, 'USERPROFILE/p')
    expect(wsl?.argv).toEqual(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', DETACH_COMMAND])
    expect(wsl?.env.WSLENV).toBe('USERPROFILE/p:PT_FILE/p:PT_GAIN:PT_MS:PT_CAP:PT_SCRIPT')
    expect(wsl?.env.PT_SCRIPT).toBe(encodeUtf16LeBase64(WINDOWS_SCRIPT))
    expect(detachedLaunch({ os: 'linux', player: 'none' }, '/p/x.wav', request, undefined)).toBeNull()
  })
})

const sound = resolveSound(CATALOG[0]!.id, [])!
const request = { sound, gain: 0.8, maxMs: 15000 }

// Lifecycles over a scripted Host: spawn yields what the test pushes, timers fire when the test says.
function script() {
  const queue: (ProcessSpawnChunk | 'end')[] = []
  let wake: (() => void) | null = null
  const push = (...items: (string | 'end')[]) => {
    for (const item of items) queue.push(item === 'end' ? 'end' : ({ text: item } as ProcessSpawnChunk))
    wake?.()
  }
  async function* spawn(): AsyncGenerator<ProcessSpawnChunk> {
    for (;;) {
      while (queue.length === 0) await new Promise<void>(r => (wake = r))
      const next = queue.shift()!
      if (next === 'end') return
      yield next
    }
  }
  return { push, spawn }
}

function scripted(player: Platform['player'], extra: Partial<FakeHost> = {}) {
  const s = script()
  const timers: (() => void)[] = []
  const host: FakeHost = {
    ...fakeHost(),
    spawn: s.spawn,
    after: (_ms: number, fn: () => void) => {
      timers.push(fn)
      return { cancel: () => undefined }
    },
    ...extra,
  } as FakeHost
  const platform = { os: player === 'powershell' ? 'windows' : player === 'audio' ? 'mac' : 'linux', player } as Platform
  return { host, s, timers, platform }
}

const killed = (host: FakeHost) => host.runs.filter(r => r.argv[0] === 'kill').map(r => r.argv[1])
const tick = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

describe('play lifecycles', () => {
  test('linux: pid then ticks is started; stop kills the pid once and ends stopped', async () => {
    const { host, s, platform } = scripted('aplay')
    const handle = play(host, platform, request)
    s.push('pid 7\n')
    expect(await handle.started).toBe(true)
    handle.stop()
    handle.stop()
    s.push('t\n')
    expect(await handle.ended).toBe('stopped')
    expect(killed(host).length).toBeGreaterThanOrEqual(1)
    expect(new Set(killed(host))).toEqual(new Set(['7']))
    expect(LINUX_WRAPPER).toContain('echo "pid $p"')
  })
  test('stop before any output: ended stopped, and the pid is killed once it appears', async () => {
    const { host, s, platform } = scripted('aplay')
    const handle = play(host, platform, request)
    handle.stop()
    expect(killed(host)).toEqual([])
    s.push('pid 9\n')
    expect(await handle.ended).toBe('stopped')
    expect(killed(host)).toContain('9')
  })
  test('stop before output and the child ends without a pid: no kill', async () => {
    const { host, s, platform } = scripted('aplay')
    const handle = play(host, platform, request)
    handle.stop()
    s.push('end')
    expect(await handle.ended).toBe('stopped')
    expect(killed(host)).toEqual([])
  })
  test('a child that exits without printing started or pid fails', async () => {
    const { host, s, platform } = scripted('aplay')
    const handle = play(host, platform, request)
    s.push('end')
    expect(await handle.started).toBe(false)
    expect(await handle.ended).toBe('failed')
  })
  test('the cap timer stops playback', async () => {
    const { host, s, timers, platform } = scripted('aplay')
    const handle = play(host, platform, request)
    s.push('pid 5\n')
    await handle.started
    timers[0]!()
    s.push('t\n')
    expect(await handle.ended).toBe('stopped')
    expect(killed(host)).toContain('5')
  })
  test('mac: play resolving is ok, stop aborts to stopped, rejection is failed', async () => {
    const mac = { os: 'mac', player: 'audio' } as Platform
    const ok = play(scripted('audio').host, mac, request)
    expect(await ok.started).toBe(true)
    expect(await ok.ended).toBe('ok')

    const hanging = scripted('audio', {
      play: (_clip, options) => new Promise<void>((_, reject) => options?.signal?.addEventListener('abort', () => reject(new Error('aborted')))),
    })
    const handle = play(hanging.host, mac, request)
    await handle.started
    handle.stop()
    expect(await handle.ended).toBe('stopped')

    const bad = play(scripted('audio', { play: async () => Promise.reject(new Error('boom')) }).host, mac, request)
    expect(await bad.ended).toBe('failed')
  })
  test('none: ends ok after the sound length, 3000 when unknown; stop is stopped', async () => {
    const none = { os: 'linux', player: 'none' } as Platform
    const asked: number[] = []
    const run = (sound: typeof request.sound, stop: boolean) => {
      const { host, timers } = scripted('none', { after: ((ms: number, fn: () => void) => (asked.push(ms), timers.push(fn), { cancel: () => undefined })) as FakeHost['after'] })
      const handle = play(host, none, { ...request, sound })
      if (stop) handle.stop()
      else timers[0]!()
      return handle.ended
    }
    expect(await run({ ...sound, durationMs: 1234 }, false)).toBe('ok')
    expect(await run({ ...sound, durationMs: null }, false)).toBe('ok')
    expect(asked).toEqual([1234, 3000])
    expect(await run(sound, true)).toBe('stopped')
  })
  test('none: a long import is held no longer than maxMs', async () => {
    const none = { os: 'linux', player: 'none' } as Platform
    const asked: number[] = []
    const { host } = scripted('none', { after: ((ms: number) => (asked.push(ms), { cancel: () => undefined })) as FakeHost['after'] })
    play(host, none, { ...request, sound: { ...sound, durationMs: 60000 } })
    expect(asked).toEqual([15000])
  })
  test('powershell: spawns the windows argv with the windows env; w lines are not started; ticks end ok', async () => {
    const wsl = { os: 'wsl', player: 'powershell' } as Platform
    const spawned: { argv: readonly string[]; env?: Record<string, string> }[] = []
    const s = script()
    const base = fakeHost({ env: { WSLENV: 'USERPROFILE/p' } })
    const host = { ...base, spawn: (r: { argv: readonly string[]; env?: Record<string, string> }) => (spawned.push(r), s.spawn()) } as FakeHost
    const handle = play(host, wsl, request)
    s.push('w\n', 'w\n')
    await tick()
    let isStarted = false
    void handle.started.then(v => (isStarted = v))
    await tick()
    expect(isStarted).toBe(false)
    s.push('started\n', 't\n', 'end')
    expect(await handle.started).toBe(true)
    expect(await handle.ended).toBe('ok')
    expect(spawned[0]!.argv).toEqual([...WINDOWS_ARGV])
    expect(spawned[0]!.argv.slice(0, 5)).toEqual(['powershell.exe', '-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand'])
    expect(spawned[0]!.env).toMatchObject({ PT_GAIN: '0.80', PT_CAP: '15000', WSLENV: 'USERPROFILE/p:PT_FILE/p:PT_GAIN:PT_MS:PT_CAP' })
  })
  test('powershell: stop breaks on the next chunk without a kill', async () => {
    const { host, s, platform } = scripted('powershell')
    const handle = play(host, platform, request)
    s.push('started\n')
    expect(await handle.started).toBe(true)
    handle.stop()
    s.push('t\n')
    expect(await handle.ended).toBe('stopped')
    expect(killed(host)).toEqual([])
  })
  test('powershell: only w lines then exit is failed', async () => {
    const { host, s, platform } = scripted('powershell')
    const handle = play(host, platform, request)
    s.push('w\n', 'w\n', 'end')
    expect(await handle.started).toBe(false)
    expect(await handle.ended).toBe('failed')
  })
  test('powershell: a failing WSLENV lookup is failed, not an unhandled rejection', async () => {
    const wsl = { os: 'wsl', player: 'powershell' } as Platform
    const base = fakeHost()
    const host = { ...base, env: { ...base.env, wslEnv: () => Promise.reject(new Error('no env')) } } as FakeHost
    const handle = play(host, wsl, request)
    expect(await handle.started).toBe(false)
    expect(await handle.ended).toBe('failed')
    expect(() => handle.stop()).not.toThrow()
    await tick()
  })
})
