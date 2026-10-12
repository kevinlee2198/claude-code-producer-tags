import { describe, expect, test } from 'claude-code/testing'

import { CATALOG } from '../hooks/catalog'
import { fire, firePreview, toggleMute } from '../hooks/pipeline'
import { LINUX_WRAPPER } from '../hooks/player'
import { defaultSettings } from '../hooks/settings'
import type { NowPlaying } from '../types'
import { fakeHost } from './fake-host'
import { START, bash, committed, world, type World } from './world'

const pushed = { result: { stdout: '', stderr: '', interrupted: false, gitOperation: { push: { branch: 'main' } } } }
const playing = (w: World) => w.state.get('nowPlaying') as NowPlaying | null | undefined
const asset = (id: string) => ({ asset: CATALOG.find(c => c.id === id)!.file })
const durationOf = (id: string) => CATALOG.find(c => c.id === id)!.durationMs
const run = (command: string) => ({ command, args: '' }) as never

describe('fire, through a Host', () => {
  test('muted, cooling down, or held by a live clip: nothing is claimed or played', async () => {
    const muted = fakeHost()
    await muted.state.settings.update(() => ({ ...defaultSettings(), muted: true }))
    await muted.state.imports.update(() => [])
    expect(await fire(muted, { key: 'git.commit', sound: 'pt:anthropic-trust' })).toBe(false)
    expect(await muted.state.nowPlaying.read()).toBeNull()

    const cooling = fakeHost()
    await cooling.state.cooldowns.update(() => ({ 'git.commit': 1_000_000 - 1000 }))
    expect(await fire(cooling, { key: 'git.commit', sound: 'pt:anthropic-trust' })).toBe(false)

    const held = fakeHost()
    const live = { token: 't', soundId: 'pt:riser', key: 'git.push' as const, caption: 'x', riff: 'r', claimedAt: 0, startedAt: 999_000, endedAt: null, durationMs: 2000, deadline: 1_002_000, peaks: null, toolUseId: null }
    await held.state.nowPlaying.update(() => live)
    expect(await fire(held, { key: 'git.commit', sound: 'pt:anthropic-trust' })).toBe(false)
    expect(await held.state.nowPlaying.read()).toEqual(live)
  })
})

describe('macOS playback', () => {
  test('a commit plays its tag after the tool call settles, at 80%, and the result is untouched', async ($, on) => {
    const w = world(on, { audioMs: 3000 })
    await $.session.start(START)
    w.bash = committed()
    const result = await $.tool.call({ tool: 'Bash', command: 'git commit -m x' } as never)
    expect(result).toMatchObject(committed())
    expect(w.plays).toHaveLength(0)
    await w.clock.settle()
    expect(w.plays).toEqual([{ clip: asset('pt:anthropic-trust'), gain: 0.8 }])
    expect(playing(w)).toMatchObject({ key: 'git.commit', endedAt: null })
    expect(playing(w)?.startedAt).toBeGreaterThan(0)
    await w.clock.advance(3000)
    expect(playing(w)?.endedAt).toBeGreaterThan(0)
    await w.clock.advance(1000)
    expect(playing(w)).toBeNull()
  })

  test('the badge is written for the tool call that started a tag', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    const id = await bash($, w, 'git commit -m x', committed())
    expect(w.state.get(`tagged:${id}`)).toBe('pt:anthropic-trust')
  })

  test('30 s cooldown per trigger', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await bash($, w, 'git commit -m a', committed())
    await w.clock.advance(1000)
    await bash($, w, 'git commit -m b', committed())
    expect(w.plays).toHaveLength(1)
    await w.clock.advance(30_000)
    await bash($, w, 'git commit -m c', committed())
    expect(w.plays).toHaveLength(2)
  })

  test('a tag that fires while another plays is dropped, not queued', async ($, on) => {
    const w = world(on, { audioMs: 3000 })
    await $.session.start(START)
    await bash($, w, 'git commit -m x', committed())
    await bash($, w, 'git push', pushed)
    await w.clock.advance(6000)
    expect(w.plays).toHaveLength(1)
  })

  test('two tags claimed in the same tick: exactly one plays', async ($, on) => {
    const w = world(on, { audioMs: 3000 })
    await $.session.start(START)
    w.bashBy = { 'git commit -m x': committed(), 'git push': pushed }
    await Promise.all([
      $.tool.call({ tool: 'Bash', command: 'git commit -m x' } as never),
      $.tool.call({ tool: 'Bash', command: 'git push' } as never),
    ])
    await w.clock.settle()
    expect(w.plays).toHaveLength(1)
  })

  test('a clip that never reports its end stops blocking at its deadline; session.start clears it', async ($, on) => {
    const w = world(on, { audioMs: 600_000 })
    await $.session.start(START)
    await bash($, w, 'git commit -m x', committed())
    await w.clock.advance(durationOf('pt:anthropic-trust') + 1001)
    await $.session.start(START)
    expect(playing(w)).toBeNull()
    await bash($, w, 'git push', pushed)
    expect(w.plays).toHaveLength(2)
  })

  test('an entry orphaned by a reload mid-clip is cleared at its deadline', async ($, on) => {
    const w = world(on, { audioMs: 600_000 })
    await $.session.start(START)
    await bash($, w, 'git commit -m x', committed())
    await $.session.start(START)
    expect(playing(w)).not.toBeNull()
    await w.clock.advance(durationOf('pt:anthropic-trust') + 1001)
    expect(playing(w)).toBeNull()
  })

  test('/mute toggles and silences', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    expect(w.registered).toContain('mute')
    expect((await $.command.run(run('mute'))).text).toBe('Tags muted.')
    expect(w.stored.get('settings')).toMatchObject({ muted: true })
    await bash($, w, 'git commit -m x', committed())
    expect(w.plays).toHaveLength(0)
    expect((await $.command.run(run('mute'))).text).toBe('Tags unmuted.')
  })

  test('/tags-mute when /mute is taken', async ($, on) => {
    const w = world(on, { refuse: ['mute'] })
    await $.session.start(START)
    expect(w.registered).toContain('tags-mute')
    expect((await $.command.run(run('tags-mute'))).text).toBe('Tags muted.')
  })

  test('imports play as base64 with their MIME type; a missing import falls back and toasts once', async ($, on) => {
    const imports = [
      { id: 'user:mine', name: 'mine', file: '/x/mine.mp3', ext: 'mp3', bytes: 3, durationMs: null, peaks: null, isCopy: true },
      { id: 'user:gone', name: 'gone', file: '/x/gone.wav', ext: 'wav', bytes: 3, durationMs: 1000, peaks: null, isCopy: true },
    ]
    const w = world(on, {
      files: { '/x/mine.mp3': { base64: 'SUQz' } },
      store: { imports, settings: { triggers: { 'git.commit': { enabled: true, sound: 'user:mine' }, 'git.push': { enabled: true, sound: 'user:gone' } } } },
    })
    await $.session.start(START)
    await bash($, w, 'git commit -m x', committed())
    expect(w.plays[0]!.clip).toEqual({ base64: 'SUQz', mime: 'audio/mpeg' })
    await w.clock.advance(20_000)
    await bash($, w, 'git push', pushed)
    expect(w.plays[1]!.clip).toEqual(asset('pt:did-it-again'))
    expect(w.toasts.filter(t => t.includes('gone is missing'))).toHaveLength(1)
  })

  test('a failed play toasts once, clears the claim and removes the badge', async ($, on) => {
    const w = world(on, { audioFails: true })
    await $.session.start(START)
    const id = await bash($, w, 'git commit -m x', committed())
    await w.clock.advance(2000)
    expect(w.toasts.filter(t => t.includes('could not play'))).toHaveLength(1)
    expect(playing(w)).toBeNull()
    expect(w.state.get(`tagged:${id}`)).toBeNull()
  })

  test(
    'tool calls made by other plugins never fire tags',
    {
      plugins: [
        {
          name: 'other',
          register(on) {
            on('session.start', async ($, e, next) => {
              await $.tool.call({ tool: 'Bash', command: 'git commit -m x' } as never)
              return next(e)
            })
          },
        },
      ],
    },
    async ($, on) => {
      const w = world(on)
      w.bash = committed()
      await $.session.start(START)
      await w.clock.settle()
      expect(w.toolUseIds).toHaveLength(1)
      expect(w.plays).toHaveLength(0)
    },
  )
})

describe('other platforms', () => {
  test('linux: pw-play inside the tick wrapper; mute kills the pid and ends the process', { timeoutMs: 20_000 }, async ($, on) => {
    const w = world(on, { os: 'linux', linuxPlayer: 'pw-play', spawnTicks: 50 })
    await $.session.start(START)
    await bash($, w, 'git commit -m x', committed())
    const spawn = w.spawns[0]!
    expect(spawn.argv.slice(0, 4)).toEqual(['sh', '-c', LINUX_WRAPPER, 'pt-play'])
    expect(spawn.argv.slice(4)).toEqual(['pw-play', '--volume', '0.80', expect.stringMatching(/sounds\/anthropic-trust\.wav$/)])
    await $.command.run(run('mute'))
    await w.clock.advance(100)
    expect(w.runs.some(r => r.argv[0] === 'kill' && r.argv[1] === '4242')).toBe(true)
    expect(spawn.isEnded).toBe(true)
  })

  test('a clip still playing at 15 s is stopped (the cap)', { timeoutMs: 20_000 }, async ($, on) => {
    const w = world(on, { os: 'linux', spawnTicks: 400 })
    await $.session.start(START)
    await bash($, w, 'git commit -m x', committed())
    await w.clock.advance(15_200)
    expect(w.spawns[0]!.isEnded).toBe(true)
    expect(w.runs.some(r => r.argv[0] === 'kill')).toBe(true)
    expect(playing(w)?.endedAt ?? 0).toBeGreaterThan(0)
  })

  test('linux without a player: captions only, one toast', async ($, on) => {
    const w = world(on, { os: 'linux', linuxPlayer: 'none' })
    await $.session.start(START)
    await bash($, w, 'git commit -m x', committed())
    expect(w.spawns).toHaveLength(0)
    expect(playing(w)?.startedAt).toBeGreaterThan(0)
    expect(w.toasts.filter(t => t.includes('no audio player'))).toHaveLength(1)
  })

  test('wsl: powershell -STA -EncodedCommand with data in env and WSLENV path translation', async ($, on) => {
    const w = world(on, { os: 'wsl', env: { WSLENV: 'USERPROFILE/p' } })
    await $.session.start(START)
    await bash($, w, 'git commit -m x', committed())
    const spawn = w.spawns[0]!
    expect(spawn.argv.slice(0, 5)).toEqual(['powershell.exe', '-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand'])
    expect(spawn.env).toMatchObject({ PT_GAIN: '0.80', PT_CAP: '15000', WSLENV: 'USERPROFILE/p:PT_FILE/p:PT_GAIN:PT_MS:PT_CAP' })
    expect(spawn.env?.PT_FILE).toMatch(/sounds\/anthropic-trust\.wav$/)
  })

  test('windows: powershell without WSLENV', async ($, on) => {
    const w = world(on, { os: 'windows' })
    await $.session.start(START)
    await bash($, w, 'git commit -m x', committed())
    expect(w.spawns[0]!.argv[0]).toBe('powershell.exe')
    expect(w.spawns[0]!.env?.WSLENV).toBeUndefined()
  })
})

describe('non-Bash triggers', () => {
  test('model switch to Fable plays; turn.done and session.open are off by default', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await $.classic.PostModelSwitch({ from_model: 'claude-opus-5-5', to_model: 'claude-fable-5-1', requested_model: 'fable', source: 'command', context_tokens: 0 } as never)
    await w.clock.settle()
    expect(w.plays.map(p => p.clip)).toEqual([asset('pt:fable-on-beat')])
    await w.clock.advance(2000)
    await $.classic.Stop({ stop_hook_active: false } as never)
    await $.classic.SessionStart({ source: 'startup' } as never)
    await w.clock.settle()
    expect(w.plays).toHaveLength(1)
  })

  test('exit plays the outro detached through afplay; /clear does not', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await $.session.end({ reason: 'clear', sessionId: 's', resume: {} } as never)
    await w.clock.settle()
    expect(w.runs.filter(r => r.argv[2]?.includes('afplay'))).toHaveLength(0)
    await $.session.end({ reason: 'prompt_input_exit', sessionId: 's', resume: {} } as never)
    await w.clock.settle()
    const outro = w.runs.find(r => r.argv[0] === 'sh' && r.argv[2]?.includes('afplay'))
    expect(outro?.env).toMatchObject({ PT_GAIN: '0.80' })
    expect(outro?.env?.PT_FILE).toMatch(/claude-outta\.wav$/)
  })
})

declare function setTimeout(fn: () => void, ms: number): unknown
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))
const commit = { key: 'git.commit' as const, sound: 'pt:anthropic-trust' as const }
const push = { key: 'git.push' as const, sound: 'pt:did-it-again' as const }

/** A fake Host whose platform read is slow and whose clips play until aborted (or `endAfter` ms). */
function slowRig(options: { delay?: number } = {}) {
  const host = fakeHost()
  const active = new Set<object>()
  const plays: string[] = []
  const platform = { os: 'mac', player: 'audio' }
  host.state.platform = { read: async () => (await sleep(options.delay ?? 20), platform as never), update: async () => platform as never }
  host.play = (clip, init) =>
    new Promise<void>(resolve => {
      const id = {}
      active.add(id)
      plays.push(JSON.stringify(clip))
      init?.signal?.addEventListener('abort', () => (active.delete(id), resolve()))
    })
  return { host, active, plays }
}

describe('fire, races between claim and play', () => {
  test('a preview landing between a trigger claim and its play wins: one clip, no stale badge', async () => {
    const { host, active } = slowRig()
    const trigger = fire(host, commit, 'tu1')
    await sleep(5)
    const preview = firePreview(host, 'pt:808-boom')
    expect([await trigger, await preview]).toEqual([false, true])
    await sleep(5)
    expect(active.size).toBe(1)
    expect((await host.state.nowPlaying.read())?.key).toBe('preview')
    expect(host.tags.get('tu1') ?? null).toBeNull()
    await toggleMute(host)
    await sleep(5)
    expect(active.size).toBe(0)
  })

  test('/mute landing between a claim and its play plays nothing', async () => {
    const { host, active } = slowRig()
    const trigger = fire(host, commit, 'tu1')
    await sleep(5)
    await toggleMute(host)
    expect(await trigger).toBe(false)
    expect(active.size).toBe(0)
    expect(await host.state.nowPlaying.read()).toBeNull()
  })

  test('a tag that bails at the re-check starts no cooldown', async () => {
    const { host } = slowRig()
    const trigger = fire(host, commit, 'tu1')
    await sleep(5)
    await toggleMute(host)
    await trigger
    expect((await host.state.cooldowns.read())['git.commit']).toBeUndefined()
  })

  test('two tags claimed together interleave at the claim: exactly one plays', async () => {
    const { host, plays } = slowRig()
    const slowRead = host.state.settings.read
    host.state.settings.read = async () => (await sleep(10), slowRead())
    const results = await Promise.all([fire(host, commit, 'a'), fire(host, push, 'b')])
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(plays).toHaveLength(1)
  })

  test('a dropped tag starts no cooldown: it plays once the winner ends', async () => {
    const { host, active } = slowRig({ delay: 0 })
    expect(await fire(host, commit, 'a')).toBe(true)
    expect(await fire(host, push, 'b')).toBe(false)
    expect((await host.state.cooldowns.read())['git.push']).toBeUndefined()
    await toggleMute(host)
    await toggleMute(host)
    await sleep(5)
    expect(active.size).toBe(0)
    await host.state.nowPlaying.update(() => null)
    expect(await fire(host, push, 'b')).toBe(true)
  })

  test('a play that never starts writes no badge and toasts once', async () => {
    const { host } = slowRig({ delay: 0 })
    host.state.platform = { read: async () => ({ os: 'linux', player: 'aplay' }) as never, update: async () => ({}) as never }
    host.spawn = async function* () {}
    expect(await fire(host, commit, 'tu1')).toBe(false)
    expect(host.tags.get('tu1') ?? null).toBeNull()
    expect(await host.state.nowPlaying.read()).toBeNull()
    expect(host.toasts.filter(t => t.includes('could not play'))).toHaveLength(1)
  })

  test('a preview while a trigger plays stops the old clip', async () => {
    const { host, active, plays } = slowRig({ delay: 0 })
    expect(await fire(host, commit, 'a')).toBe(true)
    expect(await firePreview(host, 'pt:808-boom')).toBe(true)
    await sleep(5)
    expect(plays).toHaveLength(2)
    expect(active.size).toBe(1)
  })

  test('a trigger taking over a stale entry stops the old clip first', async () => {
    const { host, active } = slowRig({ delay: 0 })
    expect(await fire(host, commit, 'a')).toBe(true)
    await host.state.nowPlaying.update(np => (np === null ? np : { ...np, deadline: 0 }))
    expect(await fire(host, push, 'b')).toBe(true)
    await sleep(5)
    expect(active.size).toBe(1)
  })
})

describe('fire and mute timing', () => {
  test('/mute stops the clip even when saving the setting fails', async () => {
    const { host, active } = slowRig({ delay: 0 })
    expect(await fire(host, commit, 'a')).toBe(true)
    expect(active.size).toBe(1)
    host.storeSet = async () => Promise.reject(new Error('disk full'))
    await expect(toggleMute(host)).rejects.toThrow()
    await sleep(5)
    expect(active.size).toBe(0)
    expect((await host.state.settings.read())?.muted).toBe(true)
  })

  test('a /mute whose state write lands between the owner read and the settings read plays nothing', async () => {
    const { host, active, plays } = slowRig({ delay: 0 })
    const read = host.state.nowPlaying.read
    let armed = false
    host.state.nowPlaying.read = async () => {
      const np = await read()
      if (armed && np !== null) {
        armed = false
        await host.state.settings.update(s => (s === null ? s : { ...s, muted: true }))
      }
      return np
    }
    await fire(host, push, 'warm')
    await host.state.nowPlaying.update(() => null)
    plays.length = 0
    await host.state.cooldowns.update(() => ({}))
    armed = true
    expect(await fire(host, commit, 'tu1')).toBe(false)
    expect(plays).toHaveLength(0)
    expect(active.size).toBe(1)
  })

  test('a clip stopped during startup clears quietly: no toast, no badge', async () => {
    const { host } = slowRig({ delay: 0 })
    host.state.platform = { read: async () => ({ os: 'linux', player: 'aplay' }) as never, update: async () => ({}) as never }
    host.spawn = async function* () {
      await sleep(50)
    }
    const trigger = fire(host, commit, 'tu1')
    await sleep(10)
    await toggleMute(host)
    expect(await trigger).toBe(false)
    expect(host.toasts.filter(t => t.includes('could not play'))).toHaveLength(0)
    expect(host.tags.get('tu1') ?? null).toBeNull()
    expect(await host.state.nowPlaying.read()).toBeNull()
  })
})
