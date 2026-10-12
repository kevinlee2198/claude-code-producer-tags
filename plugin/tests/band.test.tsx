import { describe, expect, test } from 'claude-code/testing'

import { CATALOG } from '../hooks/catalog'
import { BAND, START, bash, committed, world } from './world'

const COMMIT = CATALOG.find(c => c.id === 'pt:anthropic-trust')!
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const RIFF = new RegExp(`riffing on ${escape(COMMIT.riff)}`)
const FIRST_WORD = new RegExp(escape(COMMIT.caption.split(/\s+/)[0]!))

describe('now-playing band', () => {
  test('nothing playing: only the engine draws', async ($, on) => {
    world(on)
    await $.session.start(START)
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await ui.find({ text: /riffing on/ })).toBeUndefined()
    expect(await ui.find({ text: 'ENGINE' })).toBeDefined()
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    test(`a playing tag shows caption, riff and equalizer bars (${surface}), then leaves after the tail`, { timeoutMs: 20_000 }, async ($, on) => {
      const w = world(on, { audioMs: COMMIT.durationMs })
      await $.session.start(START)
      await bash($, w, 'git commit -m x', committed())
      const ui = await $.ui.mount({ ...BAND, surface })
      expect(await ui.find({ text: RIFF })).toBeDefined()
      expect(await ui.find({ text: FIRST_WORD })).toBeDefined()
      expect(await ui.find({ text: /[▁▂▃▄▅▆▇█]{10}/ })).toBeDefined()
      expect(await ui.find({ text: 'ENGINE' })).toBeDefined()
      await w.clock.advance(COMMIT.durationMs + 1100)
      expect(await ui.find({ text: /riffing on/ })).toBeUndefined()
    })
  }

  test('the frame counter and caption highlight move forward while the clip plays', { timeoutMs: 20_000 }, async ($, on) => {
    const w = world(on, { audioMs: COMMIT.durationMs })
    await $.session.start(START)
    await bash($, w, 'git commit -m x', committed())
    await $.ui.mount({ ...BAND, surface: 'terminal' })
    await w.clock.advance(100)
    const early = { frame: w.state.get('bandFrame') as number, word: w.state.get('captionWord') as number }
    await w.clock.advance(Math.floor(COMMIT.durationMs * 0.8))
    expect(w.state.get('bandFrame') as number).toBeGreaterThan(early.frame)
    expect(w.state.get('captionWord') as number).toBeGreaterThan(early.word)
  })

  test('an entry past its deadline is not shown, even if its end was never reported', { timeoutMs: 20_000 }, async ($, on) => {
    const w = world(on, { audioMs: 600_000 })
    await $.session.start(START)
    await bash($, w, 'git commit -m x', committed())
    await w.clock.advance(COMMIT.durationMs + 1001)
    expect(await (await $.ui.mount({ ...BAND, surface: 'terminal' })).find({ text: /riffing on/ })).toBeUndefined()
  })

  test('hidden when Studio → band is off', async ($, on) => {
    const w = world(on, { audioMs: 3000, store: { settings: { studio: { band: false, badges: true } } } })
    await $.session.start(START)
    await bash($, w, 'git commit -m x', committed())
    expect(await (await $.ui.mount({ ...BAND, surface: 'terminal' })).find({ text: /riffing on/ })).toBeUndefined()
  })

  test('a survey wins over the band', async ($, on) => {
    const w = world(on, { audioMs: 3000 })
    await $.session.start(START)
    await bash($, w, 'git commit -m x', committed())
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, hasSurvey: true } })
    expect(await ui.find({ text: /riffing on/ })).toBeUndefined()
  })
})

describe('mode label', () => {
  test('adds ♫ tags, or ♫ muted', async ($, on) => {
    world(on)
    await $.session.start(START)
    const mode = { plugin: 'producer-tags', component: 'SessionMode' as const, props: { modes: ['plan'] } }
    expect((await (await $.ui.mount({ ...mode, surface: 'terminal' })).find({ type: 'Text' }))?.text).toBe('plan | ♫ tags')
    await $.command.run({ command: 'mute', args: '' } as never)
    expect((await (await $.ui.mount({ ...mode, surface: 'desktop' })).find({ type: 'Text' }))?.text).toBe('plan | ♫ muted')
  })
})
