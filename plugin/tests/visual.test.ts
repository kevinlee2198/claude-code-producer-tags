import { describe, expect, test } from 'claude-code/testing'

import { BAR_GLYPHS, barsText, captionWordAt, levelsAt, progressOf, waveformLevels } from '../hooks/ui/visual'
import type { NowPlaying } from '../types'

const np = (over: Partial<NowPlaying> = {}): NowPlaying => ({
  token: 't', soundId: 'pt:x', key: 'git.commit', caption: 'one two three four', riff: 'r',
  claimedAt: 0, startedAt: 1000, endedAt: null, durationMs: 2000, deadline: 9999, peaks: [0, 0.5, 1, 0.25], toolUseId: null, ...over,
})

describe('visual', () => {
  test('progress and caption word follow the clip', () => {
    expect(progressOf(np(), 1000)).toBe(0)
    expect(progressOf(np(), 2000)).toBe(0.5)
    expect(progressOf(np(), 9000)).toBe(1)
    expect(captionWordAt(np(), 1000)).toBe(0)
    expect(captionWordAt(np(), 2100)).toBe(2)
    expect(captionWordAt(np(), 9000)).toBe(3)
    expect(captionWordAt(np({ durationMs: null }), 2000)).toBe(-1)
    expect(captionWordAt(np({ durationMs: 0 }), 2000)).toBe(-1)
  })
  test('levels stay in 0..7 and follow the peaks', () => {
    expect(levelsAt([0, 0, 0, 0], 0.5, 10, 3).every(l => l === 0)).toBe(true)
    const loud = levelsAt([1, 1, 1, 1], 0.5, 10, 3)
    expect(loud).toHaveLength(10)
    expect(loud.every(l => l >= 4 && l <= 7)).toBe(true)
    expect(levelsAt(null, 0.5, 10, 3).every(l => l >= 0 && l <= 7)).toBe(true)
  })
  test('bars and waveform text', () => {
    expect(barsText([0, 7, 3])).toBe(`${BAR_GLYPHS[0]}${BAR_GLYPHS[7]}${BAR_GLYPHS[3]}`)
    expect(waveformLevels([0, 1], 4)).toEqual([0, 0, 7, 7])
    expect(waveformLevels(null, 3)).toEqual([0, 0, 0])
  })
})
