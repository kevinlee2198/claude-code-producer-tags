import { describe, expect, test } from 'claude-code/testing'

import { CATALOG } from '../hooks/catalog'
import { START, bash, committed, world } from './world'

const COMMIT = CATALOG.find(c => c.id === 'pt:anthropic-trust')!
const row = (id: string) => ({
  plugin: 'producer-tags',
  component: 'ToolUse' as const,
  requestId: id,
  props: { tool_use_id: id, tool: 'Bash', input: { command: 'git commit -m x' }, isRunning: false, isErrored: false, isInterrupted: false },
})

describe('tool-row badges', () => {
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    test(`a tagged row keeps the engine's row and adds a replayable chip (${surface})`, async ($, on) => {
      const w = world(on)
      await $.session.start(START)
      const id = await bash($, w, 'git commit -m x', committed())
      const ui = await $.ui.mount({ ...row(id), surface })
      expect(await ui.find({ text: 'ENGINE' })).toBeDefined()
      expect((await ui.find({ type: 'Button', key: 'pt-replay' }))?.text).toContain(COMMIT.riff)
      await w.clock.advance(1000)
      await ui.press({ key: 'pt-replay' })
      expect(w.plays).toHaveLength(2)
    })
  }

  test('untagged rows and Studio → badges off draw only the engine', async ($, on) => {
    const w = world(on, { store: { settings: { studio: { band: true, badges: false } } } })
    await $.session.start(START)
    const id = await bash($, w, 'git commit -m x', committed())
    expect(await (await $.ui.mount({ ...row(id), surface: 'terminal' })).find({ key: 'pt-replay' })).toBeUndefined()
    expect(await (await $.ui.mount({ ...row('other'), surface: 'terminal' })).find({ key: 'pt-replay' })).toBeUndefined()
  })

  test('a muted tag earns no badge', async ($, on) => {
    const w = world(on, { store: { settings: { muted: true } } })
    await $.session.start(START)
    const id = await bash($, w, 'git commit -m x', committed())
    expect(await (await $.ui.mount({ ...row(id), surface: 'terminal' })).find({ key: 'pt-replay' })).toBeUndefined()
  })

  test('the hover card holds the caption, hidden until hovered', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    const id = await bash($, w, 'git commit -m x', committed())
    const ui = await $.ui.mount({ ...row(id), surface: 'terminal' })
    expect((await ui.find({ type: 'Box', key: 'pt-card' }))?.props.display).toBe('none')
    expect(await ui.find({ type: 'Text', text: COMMIT.caption })).toBeDefined()
  })
})
