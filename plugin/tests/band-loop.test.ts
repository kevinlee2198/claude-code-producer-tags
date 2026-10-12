import { describe, expect, test } from 'claude-code/testing'

import { FRAME_MS } from '../hooks/constants'
import { fire, firePreview, recoverStage } from '../hooks/pipeline'
import { stopAnimation } from '../hooks/ui/animate'
import type { NowPlaying } from '../types'
import { fakeHost } from './fake-host'

// The fake Host's clock stands at 1 000 000 and its timers never fire; these tests run in the
// test file's own module instance, so `animate.ts` state is shared with the pipeline they call.
type LoopTimer = { ms: number; isCancelled: boolean; cancel: () => void }

function hostWithLoops() {
  const host = fakeHost()
  const loops: LoopTimer[] = []
  host.every = (ms, _fn) => {
    const timer: LoopTimer = { ms, isCancelled: false, cancel: () => void (timer.isCancelled = true) }
    loops.push(timer)
    return timer
  }
  return { host, loops }
}

const entry = (over: Partial<NowPlaying> = {}): NowPlaying => ({
  token: 'old', soundId: 'pt:anthropic-trust', key: 'git.commit', caption: 'one two', riff: 'r',
  claimedAt: 998_000, startedAt: 999_000, endedAt: null, durationMs: 3000, deadline: 1_004_000, peaks: null, toolUseId: null, ...over,
})

describe('recoverStage and the band loop', () => {
  test('a started entry still on stage gets its loop back after a reload', async () => {
    stopAnimation()
    const { host, loops } = hostWithLoops()
    await host.state.nowPlaying.update(() => entry())
    await recoverStage(host)
    expect(loops.filter(l => l.ms === FRAME_MS && !l.isCancelled)).toHaveLength(1)
    stopAnimation()
  })

  test('no loop for an entry past its deadline, past its tail, or not started', async () => {
    for (const stale of [entry({ deadline: 999_500 }), entry({ endedAt: 990_000 }), entry({ startedAt: null })]) {
      stopAnimation()
      const { host, loops } = hostWithLoops()
      await host.state.nowPlaying.update(() => stale)
      await recoverStage(host)
      expect(loops).toHaveLength(0)
    }
  })
})

describe('start versus badge race', () => {
  test('a clip that loses the stage while its badge is written does not stop the winner\'s loop', async () => {
    stopAnimation()
    const { host, loops } = hostWithLoops()
    await host.state.platform.update(() => ({ os: 'mac', player: 'audio' }))
    host.play = () => new Promise(() => undefined) // plays until stopped
    let release!: () => void
    const gate = new Promise<void>(resolve => void (release = resolve))
    host.tag = async () => gate

    const first = fire(host, { key: 'git.commit', sound: 'pt:anthropic-trust' }, 'tool-1')
    for (let i = 0; i < 50; i++) await Promise.resolve() // first clip is now inside the slow badge write
    expect(await firePreview(host, 'pt:riser')).toBe(true)
    const winner = loops[loops.length - 1]!
    expect(winner.isCancelled).toBe(false)
    release()
    await first
    expect(winner.isCancelled).toBe(false)
    stopAnimation()
  })
})
