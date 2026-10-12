import type { On } from 'claude-code'
import { describe, expect, test, type Engine } from 'claude-code/testing'

import { TRIGGERS } from '../hooks/constants'
import type { ImportedSound, NowPlaying, Settings } from '../types'
import { EMPTY_WAV, PANE, START, bash, committed, world, type WorldOptions } from './world'

const settingsOf = (w: { state: Map<string, unknown> }) => w.state.get('settings') as Settings
const importsOf = (w: { state: Map<string, unknown> }) => w.state.get('imports') as ImportedSound[]

async function openOn<S extends 'terminal' | 'desktop' | 'vscode' | 'mobile'>($: Engine, on: On, surface: S, options: WorldOptions = {}) {
  const w = world(on, options)
  await $.session.start(START)
  return { w, ui: await $.ui.mount({ ...PANE, surface }) }
}

describe('/tags', () => {
  test('registers, opens the pane and answers briefly', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    expect(w.registered).toContain('tags')
    expect((await $.command.run({ command: 'tags', args: '' } as never)).text).toBe('Opened Producer Tags.')
    expect(w.opened).toEqual(['producer-tags'])
  })
})

describe('pane on terminal and desktop', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`trigger rows toggle, pick sounds and preview (${surface})`, async ($, on) => {
      const { w, ui } = await openOn($, on, surface)
      for (const t of TRIGGERS) expect(await ui.find({ key: `toggle-${t.id}` }), t.id).toBeDefined()
      await ui.press({ key: 'toggle-git.commit' })
      expect(settingsOf(w).triggers['git.commit'].enabled).toBe(false)
      expect((w.stored.get('settings') as Settings).triggers['git.commit'].enabled).toBe(false)
      await ui.select({ key: 'sound-git.push', value: 'pt:riser' })
      expect(settingsOf(w).triggers['git.push'].sound).toBe('pt:riser')
      await ui.press({ key: 'play-git.push' })
      await ui.press({ key: 'play-git.push' })
      expect(w.plays).toHaveLength(2)
    })

    test(`volume buttons, mute and studio (${surface})`, async ($, on) => {
      const { w, ui } = await openOn($, on, surface)
      await ui.press({ key: 'vol-up' })
      expect(settingsOf(w).volume).toBe(90)
      await ui.press({ key: 'vol-down' })
      await ui.press({ key: 'vol-down' })
      expect(settingsOf(w).volume).toBe(70)
      await ui.press({ key: 'mute' })
      expect(settingsOf(w).muted).toBe(true)
      expect((await ui.find({ key: 'mute' }))?.props.label).toBe('Unmute')
      await ui.press({ key: 'studio-badges' })
      expect(settingsOf(w).studio.badges).toBe(false)
    })

    test(`custom triggers: invalid pattern errors inline, valid one is added and removable (${surface})`, async ($, on) => {
      const { w, ui } = await openOn($, on, surface)
      await ui.press({ key: 'custom-add' })
      await ui.input({ key: 'custom-pattern', text: '(' })
      expect(await ui.find({ type: 'Text', text: 'That is not a valid regular expression.' })).toBeDefined()
      expect(settingsOf(w).custom).toHaveLength(0)
      await ui.input({ key: 'custom-pattern', text: 'docker compose up' })
      expect(settingsOf(w).custom).toEqual([{ id: 'c1', pattern: 'docker compose up', outcome: 'success', sound: 'pt:808-boom', enabled: true, isInvalid: false }])
      expect(await ui.find({ text: /docker compose up/ })).toBeDefined()
      await ui.press({ key: 'cdel-c1' })
      expect(settingsOf(w).custom).toHaveLength(0)
    })

    test(`pads have hotkeys 1–9 and play (${surface})`, async ($, on) => {
      const { w, ui } = await openOn($, on, surface)
      for (let i = 1; i <= 9; i++) expect((await ui.find({ key: `pad-${i}` }))?.props.hotkey).toBe(String(i))
      await ui.press({ key: 'pad-1' })
      expect(w.plays).toHaveLength(1)
    })
  }

  test('a preview interrupts a playing tag and skips the cooldown', async ($, on) => {
    const w = world(on, { audioMs: 3000 })
    await $.session.start(START)
    await bash($, w, 'git commit -m x', committed())
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 'play-git.commit' })
    expect(w.plays).toHaveLength(2)
    expect((w.state.get('nowPlaying') as NowPlaying).key).toBe('preview')
    await ui.press({ key: 'play-git.commit' })
    expect(w.plays).toHaveLength(3)
  })

  test('waveforms are text on every surface; narrow panes hide them', async ($, on) => {
    world(on)
    await $.session.start(START)
    for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
      const ui = await $.ui.mount({ ...PANE, surface })
      expect((await ui.find({ key: 'wave-git.commit' }))?.type, surface).toBe('Box')
      await ui.unmount()
    }
    const narrow = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, bodyColumns: 60 } })
    expect(await narrow.find({ key: 'wave-git.commit' })).toBeUndefined()
  })
})

describe('importing through the pane', () => {
  test('copies into the config dir with env-passed paths; the row deletes the copy', async ($, on) => {
    const { w, ui } = await openOn($, on, 'terminal', { files: { '/home/dev/Music/My Tag.wav': { base64: EMPTY_WAV } } })
    await ui.input({ key: 'import-path', text: '~/Music/My Tag.wav' })
    expect(await ui.find({ type: 'Text', text: 'Imported "My Tag".' })).toBeDefined()
    expect(importsOf(w)).toEqual([
      expect.objectContaining({ id: 'user:my-tag', ext: 'wav', isCopy: true, file: '/home/dev/.claude/producer-tags/sounds/my-tag.wav' }),
    ])
    expect(w.runs.find(r => r.argv[0] === 'sh' && r.argv[2]?.includes('cp --'))?.env).toEqual({
      PT_DIR: '/home/dev/.claude/producer-tags/sounds',
      PT_SRC: '/home/dev/Music/My Tag.wav',
      PT_DST: '/home/dev/.claude/producer-tags/sounds/my-tag.wav',
    })
    await ui.press({ key: 'impdel-user:my-tag' })
    expect(w.runs.some(r => r.argv.join(' ') === 'rm -f -- /home/dev/.claude/producer-tags/sounds/my-tag.wav')).toBe(true)
    expect(importsOf(w)).toEqual([])
    expect(w.stored.get('imports')).toEqual([])
  })

  test('CLAUDE_CONFIG_DIR wins over HOME', async ($, on) => {
    const { w, ui } = await openOn($, on, 'terminal', { env: { CLAUDE_CONFIG_DIR: '/cfg' }, files: { '/a/x.wav': { base64: EMPTY_WAV } } })
    await ui.input({ key: 'import-path', text: '/a/x.wav' })
    expect(importsOf(w)[0]?.file).toBe('/cfg/producer-tags/sounds/x.wav')
  })

  test('emoji names get clean slugs; the same name again gets -2', async ($, on) => {
    const { w, ui } = await openOn($, on, 'terminal', { files: { '/a/Mi tag ✨ (final).wav': { base64: EMPTY_WAV } } })
    await ui.input({ key: 'import-path', text: '/a/Mi tag ✨ (final).wav' })
    await ui.input({ key: 'import-path', text: '/a/Mi tag ✨ (final).wav' })
    expect(importsOf(w).map(s => s.id)).toEqual(['user:mi-tag-final', 'user:mi-tag-final-2'])
  })

  test('validation errors show inline', async ($, on) => {
    const { ui } = await openOn($, on, 'terminal', { files: { '/a/notes.txt': 'hi', '/a/big.wav': { base64: 'A'.repeat(6_000_000) } } })
    for (const [path, message] of [
      ['', 'Enter the path of an audio file.'],
      ['/a/none.wav', 'No file at /a/none.wav.'],
      ['/a/notes.txt', 'Use one of: wav, mp3, m4a, aiff.'],
      ['/a/big.wav', 'Files must be 4 MB or smaller.'],
    ] as const) {
      await ui.input({ key: 'import-path', text: path })
      expect(await ui.find({ type: 'Text', text: message }), path).toBeDefined()
    }
    expect((await ui.find({ key: 'imports' }))?.text).toContain('Files must be 4 MB or smaller.')
  })

  test('a failed copy keeps the original with a warning, and deleting it removes nothing from disk', async ($, on) => {
    const { w, ui } = await openOn($, on, 'terminal', { files: { '/a/x.wav': { base64: EMPTY_WAV } }, runExit: argv => (argv[0] === 'sh' ? 1 : 0) })
    await ui.input({ key: 'import-path', text: '/a/x.wav' })
    expect(importsOf(w)[0]).toMatchObject({ file: '/a/x.wav', isCopy: false })
    expect(await ui.find({ type: 'Text', text: /Could not copy the file/ })).toBeDefined()
    await ui.press({ key: 'impdel-user:x' })
    expect(w.runs.some(r => r.argv[0] === 'rm')).toBe(false)
  })

  test('wsl converts a pasted C:\\ path', async ($, on) => {
    const { w, ui } = await openOn($, on, 'terminal', { os: 'wsl', files: { '/mnt/c/m/x.wav': { base64: EMPTY_WAV } } })
    await ui.input({ key: 'import-path', text: 'C:\\m\\x.wav' })
    expect(importsOf(w)[0]?.name).toBe('x')
  })
})

describe('other surfaces', () => {
  test('vscode: the buttons set volume', async ($, on) => {
    const { w, ui } = await openOn($, on, 'vscode')
    await ui.press({ key: 'vol-up' })
    expect(settingsOf(w).volume).toBe(90)
  })
  test('mobile: one line and a mute button', async ($, on) => {
    const { w, ui } = await openOn($, on, 'mobile')
    expect(await ui.find({ text: 'Open /tags in the terminal or desktop app to edit.' })).toBeDefined()
    await ui.press({ key: 'mute' })
    expect(settingsOf(w).muted).toBe(true)
  })
})

describe('where pane messages draw', () => {
  test('a custom-form error shows in the custom section, not under Import', async ($, on) => {
    const { ui } = await openOn($, on, 'terminal')
    await ui.press({ key: 'custom-add' })
    await ui.input({ key: 'custom-pattern', text: '(' })
    expect((await ui.find({ key: 'custom' }))?.text).toContain('That is not a valid regular expression.')
    expect((await ui.find({ key: 'imports' }))?.text).not.toContain('That is not a valid regular expression.')
  })
  test('the copy warning is drawn in the warning colour', async ($, on) => {
    const { ui } = await openOn($, on, 'terminal', { files: { '/a/x.wav': { base64: EMPTY_WAV } }, runExit: argv => (argv[0] === 'sh' ? 1 : 0) })
    await ui.input({ key: 'import-path', text: '/a/x.wav' })
    expect((await ui.find({ type: 'Text', text: /Could not copy the file/ }))?.props.color).toBe('warning')
  })
})
