import { describe, expect, test } from 'claude-code/testing'

import { defaultSettings } from '../hooks/settings'
import { addCustom, newCustomId, removeImport, runImport, saveCustom, setDraft, setVolume, stepVolume, toggleCustom } from '../hooks/ui/pane-actions'
import type { CustomTrigger } from '../types'
import { fakeHost } from './fake-host'

const custom = (id: string, over: Partial<CustomTrigger> = {}): CustomTrigger => ({ id, pattern: 'x', outcome: 'any', sound: 'pt:riser', enabled: true, isInvalid: false, ...over })

describe('pane state transforms', () => {
  test('volume is clamped to 0..100 and rounded', () => {
    expect(stepVolume(stepVolume(defaultSettings(), 10), 50).volume).toBe(100)
    expect(stepVolume(defaultSettings(), -200).volume).toBe(0)
    expect(setVolume(defaultSettings(), 47.6).volume).toBe(48)
  })
  test('at most 20 custom triggers; ids fill gaps', () => {
    let s = defaultSettings()
    for (let i = 0; i < 25; i++) s = addCustom(s, custom(newCustomId(s.custom)))
    expect(s.custom).toHaveLength(20)
    expect(newCustomId([custom('c1'), custom('c3')])).toBe('c2')
  })
  test('an invalid custom trigger never toggles on', () => {
    const s = { ...defaultSettings(), custom: [custom('c9', { enabled: false, isInvalid: true })] }
    expect(toggleCustom(s, 'c9').custom[0]!.enabled).toBe(false)
  })
})

describe('pane messages', () => {
  test('saving a custom trigger answers where it was asked, once, and respects the cap', async () => {
    const host = fakeHost()
    await saveCustom(host, 'make it')
    expect((await host.state.paneDraft.read()).message).toEqual({ kind: 'ok', where: 'custom', text: 'Added /make it/.' })
    await saveCustom(host, 'make it')
    expect((await host.state.settings.read())?.custom).toHaveLength(1)
    expect((await host.state.paneDraft.read()).message).toEqual({ kind: 'error', where: 'custom', text: 'That pattern is already a trigger.' })
    await saveCustom(host, '(')
    expect((await host.state.paneDraft.read()).message).toMatchObject({ kind: 'error', where: 'custom' })
    for (let i = 0; i < 25; i++) await saveCustom(host, `p${i}`)
    expect((await host.state.settings.read())?.custom).toHaveLength(20)
    expect((await host.state.paneDraft.read()).message).toEqual({ kind: 'error', where: 'custom', text: '20 custom triggers is the limit.' })
  })
  test('removing a sound that is not there is an import error, not "Removed."', async () => {
    const host = fakeHost()
    await removeImport(host, 'user:nope')
    expect((await host.state.paneDraft.read()).message).toEqual({ kind: 'error', where: 'import', text: 'Could not remove that sound.' })
  })
  test('a copy warning is a warn message in the import area', async () => {
    const host = fakeHost({ files: { '/a/x.wav': { base64: 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAIlYAAESsAAACABAAZGF0YQAAAAA=' } }, run: argv => ({ exitCode: argv[0] === 'sh' ? 1 : 0 }) })
    await setDraft(host, d => d)
    await runImport(host, '/a/x.wav')
    expect((await host.state.paneDraft.read()).message).toMatchObject({ kind: 'warn', where: 'import' })
  })
})
