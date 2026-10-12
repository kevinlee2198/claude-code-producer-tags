import { describe, expect, test } from 'claude-code/testing'

import { defaultSettings } from '../hooks/settings'
import { addCustom, newCustomId, setVolume, stepVolume, toggleCustom } from '../hooks/ui/pane-actions'
import type { CustomTrigger } from '../types'

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
