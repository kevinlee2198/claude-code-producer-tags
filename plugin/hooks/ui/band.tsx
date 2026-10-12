import type { Elements } from 'claude-code'

import type { NowPlaying } from '../../types'
import { EQ_COLUMNS, barsText, levelsAt, progressOf } from './visual'

export type BandKit = Pick<Elements['terminal'], 'Box' | 'Text'>

/** The now-playing line above the engine's own band content (spec §8.3). */
export function bandView(kit: BandKit, np: NowPlaying, now: number, frame: number, word: number, engine: JSX.Element): JSX.Element {
  const { Box, Text } = kit
  const bars = barsText(levelsAt(np.peaks, progressOf(np, now), EQ_COLUMNS, frame))
  const words = np.caption.split(/\s+/).filter(Boolean)
  const lit = word < 0 ? 0 : word + 1
  return (
    <Box flexDirection="column">
      <Box key="pt-band" gap={1}>
        <Text color="claude">♫ {bars}</Text>
        <Text>
          "<Text bold>{words.slice(0, lit).join(' ')}</Text>
          {lit > 0 && lit < words.length ? ' ' : ''}
          <Text dimColor={word >= 0}>{words.slice(lit).join(' ')}</Text>"
        </Text>
        <Text dimColor>— riffing on {np.riff}</Text>
      </Box>
      {engine}
    </Box>
  )
}
