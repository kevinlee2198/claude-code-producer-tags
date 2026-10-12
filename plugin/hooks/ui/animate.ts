import type { Timer } from 'claude-code'

import { FRAME_MS } from '../constants'
import type { Host } from '../host'
import { act } from '../notify'
import { isOnStage } from '../stage'
import { NO_WORD } from '../state'
import { captionWordAt } from './visual'

let running: { token: string; timer: Timer } | null = null

export function stopAnimation(): void {
  running?.timer.cancel()
  running = null
}

/** Redraws the band (and a previewing pane row) from state 10 times a second until the clip leaves the stage (spec §8.3). */
export function startAnimation(host: Host, token: string): void {
  stopAnimation()
  act(host, 'band frame', async () => {
    if ((await host.state.captionWord.read()) !== NO_WORD) await host.state.captionWord.update(() => NO_WORD)
  })
  running = { token, timer: host.every(FRAME_MS, () => act(host, 'band frame', () => frame(host, token))) }
}

async function frame(host: Host, token: string): Promise<void> {
  const np = await host.state.nowPlaying.read()
  const now = await host.now()
  if (np === null || np.token !== token || !isOnStage(np, now)) {
    if (running?.token !== token) return
    stopAnimation()
    await host.state.bandFrame.update(n => n + 1) // one last redraw, so a band past its deadline hides
    return
  }
  await host.state.bandFrame.update(n => n + 1)
  const word = captionWordAt(np, now)
  if (word !== (await host.state.captionWord.read())) await host.state.captionWord.update(() => word)
}
