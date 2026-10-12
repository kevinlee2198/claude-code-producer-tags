import { describe, expect, test } from 'claude-code/testing'

import { CATALOG } from '../hooks/catalog'
import { changeSettings, defaultSettings, ensureLoaded, knownSounds, loadFromStore, normalizeImports, normalizeSettings, validatePattern } from '../hooks/settings'
import { fakeHost } from './fake-host'
import { START, world } from './world'

const known = knownSounds([])

describe('normalizeSettings', () => {
  test('nothing stored gives the restrained defaults', () => {
    const { settings, isCorrupt } = normalizeSettings(undefined, known)
    expect(isCorrupt).toBe(false)
    expect(settings).toEqual(defaultSettings())
    expect(settings.triggers['turn.done'].enabled).toBe(false)
    expect(settings.triggers['session.open'].enabled).toBe(false)
    expect(settings.triggers['command.fail'].enabled).toBe(false)
    expect(settings.triggers['git.commit']).toEqual({ enabled: true, sound: 'pt:anthropic-trust' })
    expect(settings.volume).toBe(80)
  })
  test('a non-object is corrupt and falls back to defaults', () => {
    for (const raw of ['nope', 42, [1, 2], true]) {
      const { settings, isCorrupt } = normalizeSettings(raw, known)
      expect(isCorrupt).toBe(true)
      expect(settings).toEqual(defaultSettings())
    }
  })
  test('stored values merge over defaults; arrays replace; new triggers appear', () => {
    const raw = {
      version: 1,
      muted: true,
      volume: 140,
      triggers: { 'git.commit': { enabled: false, sound: 'pt:riser' }, 'git.push': { enabled: true, sound: 'user:gone' } },
      custom: [{ id: 'a', pattern: 'deploy', outcome: 'any', sound: 'pt:scratch', enabled: true }],
      studio: { band: false },
    }
    const { settings } = normalizeSettings(raw, known)
    expect(settings.muted).toBe(true)
    expect(settings.volume).toBe(100)
    expect(settings.triggers['git.commit']).toEqual({ enabled: false, sound: 'pt:riser' })
    expect(settings.triggers['git.push']).toEqual({ enabled: true, sound: 'pt:did-it-again' })
    expect(settings.triggers['model.fable']).toEqual({ enabled: true, sound: 'pt:fable-on-beat' })
    expect(settings.custom).toEqual([{ id: 'a', pattern: 'deploy', outcome: 'any', sound: 'pt:scratch', enabled: true, isInvalid: false }])
    expect(settings.studio).toEqual({ band: false, badges: true })
  })
  test('invalid stored patterns are disabled and marked, not thrown', () => {
    const raw = { custom: [{ id: 'b', pattern: '(unclosed', outcome: 'success', sound: 'pt:riser', enabled: true }] }
    expect(normalizeSettings(raw, known).settings.custom[0]).toMatchObject({ enabled: false, isInvalid: true })
  })
  test('settings from a newer release keep every field this release understands', () => {
    const raw = { version: 2, muted: true, volume: 30, futureThing: { x: 1 }, triggers: { 'git.push': { enabled: false, sound: 'pt:riser', color: 'red' } } }
    const { settings, isCorrupt } = normalizeSettings(raw, known)
    expect(isCorrupt).toBe(false)
    expect(settings.muted).toBe(true)
    expect(settings.volume).toBe(30)
    expect(settings.triggers['git.push']).toEqual({ enabled: false, sound: 'pt:riser' })
    expect(settings.version).toBe(1)
  })
})

describe('normalizeImports and validatePattern', () => {
  test('drops malformed import rows', () => {
    const good = { id: 'user:x', name: 'x', file: '/s/x.wav', ext: 'wav', bytes: 10, durationMs: 100, peaks: [0.5], isCopy: true }
    expect(normalizeImports([good, { id: 3 }, 'junk'])).toEqual([good])
    expect(normalizeImports('nope')).toEqual([])
  })
  test('pattern messages', () => {
    expect(validatePattern('')).toBe('Enter a pattern.')
    expect(validatePattern('x'.repeat(201))).toBe('Patterns are at most 200 characters.')
    expect(validatePattern('(')).toBe('That is not a valid regular expression.')
    expect(validatePattern('docker compose up')).toBeNull()
  })
  test('known sounds are the catalog plus imports', () => {
    const ids = knownSounds([{ id: 'user:mine', name: 'mine', file: '/x', ext: 'wav', bytes: 1, durationMs: null, peaks: null, isCopy: true }])
    expect(ids.has(CATALOG[0]!.id)).toBe(true)
    expect(ids.has('user:mine')).toBe(true)
  })
})

describe('loading through $', () => {
  test('session.start loads a corrupt store as defaults and toasts once', async ($, on) => {
    const w = world(on, { store: { settings: 'garbage' } })
    await $.session.start(START)
    await $.session.start(START)
    await w.clock.settle()
    expect(w.toasts.filter(t => t.includes('unreadable'))).toHaveLength(1)
    expect(w.state.get('settings')).toEqual(defaultSettings())
  })
})

describe('loading and saving through a Host', () => {
  test('a corrupt store loads as defaults with one toast; later reads come from state', async () => {
    const host = fakeHost({ store: { settings: 'garbage' } })
    expect((await loadFromStore(host)).settings).toEqual(defaultSettings())
    await loadFromStore(host)
    expect(host.toasts).toEqual(['Producer Tags: settings were unreadable, so the defaults are back.'])
    await host.state.settings.update(s => (s === null ? s : { ...s, volume: 10 }))
    expect((await ensureLoaded(host)).settings.volume).toBe(10)
  })
  test('changes go to state, and to the store unless persist is false', async () => {
    const host = fakeHost()
    await changeSettings(host, s => ({ ...s, volume: 30 }), { persist: false })
    expect((await host.state.settings.read())?.volume).toBe(30)
    expect(host.stored.has('settings')).toBe(false)
    await changeSettings(host, s => ({ ...s, muted: true }))
    expect(host.stored.get('settings')).toMatchObject({ volume: 30, muted: true })
  })
})
