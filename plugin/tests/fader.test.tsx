import { describe, expect, test } from 'claude-code/testing'

import type { Settings } from '../types'
import { PANE, START, world } from './world'

describe('fader', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`drag updates live, persists on release; arrows step by 5 from the current volume (${surface})`, async ($, on) => {
      const w = world(on)
      await $.session.start(START)
      const ui = await $.ui.mount({ ...PANE, surface })
      await ui.resize({ columns: 24, rows: 1, in: 'fader' })
      await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'fader' })
      await ui.pointer({ type: 'move', x: 19, y: 0, button: 'left', in: 'fader' })
      expect((w.state.get('settings') as Settings).volume).toBe(100)
      expect((w.stored.get('settings') as Settings | undefined)?.volume).not.toBe(100)
      await ui.pointer({ type: 'up', x: 19, y: 0, button: 'left', in: 'fader' })
      expect((w.stored.get('settings') as Settings).volume).toBe(100)
      await ui.key({ key: 'left', in: 'fader' })
      expect((w.stored.get('settings') as Settings).volume).toBe(95)
      await ui.press({ key: 'vol-down' })
      await ui.key({ key: 'right', in: 'fader' })
      expect((w.stored.get('settings') as Settings).volume).toBe(90)
    })
  }

  test('vscode and mobile have no pointer fader', async ($, on) => {
    world(on)
    await $.session.start(START)
    for (const surface of ['vscode', 'mobile'] as const) {
      expect(await (await $.ui.mount({ ...PANE, surface })).find({ key: 'fader' }), surface).toBeUndefined()
    }
  })
})
