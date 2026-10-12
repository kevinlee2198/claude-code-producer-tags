import { describe, expect, test } from 'claude-code/testing'

import { CATALOG } from '../hooks/catalog'
import { fire } from '../hooks/pipeline'
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
