import { describe, expect, test } from 'claude-code/testing'

import { CATALOG } from '../hooks/catalog'
import { resolveSound } from '../hooks/library'
import { claimFor, clearAtOf, defaultSoundFor, isCoolingDown, isLive, isOnStage, startedEntry } from '../hooks/stage'

const sound = resolveSound(CATALOG[0]!.id, [])!

describe('the stage', () => {
  test('a claim is live for 5 s; once started, for its length plus 1 s', () => {
    const claim = claimFor(sound, 'git.commit', 1000, 'tu1', 'n')
    expect(claim).toMatchObject({ token: `${sound.id}:1000:n`, startedAt: null, deadline: 6000, toolUseId: 'tu1' })
    expect(isLive(claim, 5999)).toBe(true)
    expect(isLive(claim, 6000)).toBe(false)
    expect(isOnStage(claim, 2000)).toBe(false)
    const started = startedEntry(claim, 2000)
    expect(started.deadline).toBe(2000 + sound.durationMs! + 1000)
    expect(isOnStage(started, 2500)).toBe(true)
    expect(startedEntry({ ...claim, durationMs: null }, 2000).deadline).toBe(2000 + 15000 + 1000)
  })
  test('an ended entry stays on stage for the tail and stops counting after it', () => {
    const ended = { ...startedEntry(claimFor(sound, 'git.commit', 0, null, 'n'), 0), endedAt: 1500 }
    expect(isLive(ended, 1600)).toBe(false)
    expect(isOnStage(ended, 2499)).toBe(true)
    expect(isOnStage(ended, 2500)).toBe(false)
    expect(clearAtOf(ended)).toBe(2500)
    expect(clearAtOf(claimFor(sound, 'git.commit', 0, null, 'n'))).toBe(5000)
  })
  test('cooldowns are per key; previews and customs fall back to the 808', () => {
    expect(isCoolingDown({ 'git.commit': 1000 }, 'git.commit', 30_999)).toBe(true)
    expect(isCoolingDown({ 'git.commit': 1000 }, 'git.commit', 31_000)).toBe(false)
    expect(isCoolingDown({ 'git.commit': 1000 }, 'git.push', 2000)).toBe(false)
    expect(defaultSoundFor('git.push')).toBe('pt:did-it-again')
    expect(defaultSoundFor('custom:c1')).toBe('pt:808-boom')
  })
})
