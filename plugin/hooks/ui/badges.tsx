import type { Elements } from 'claude-code'

import type { ResolvedSound } from '../library'

export type BadgeKit = Pick<Elements['terminal'], 'Box' | 'Button' | 'Text'>

/** The engine's tool row with a replayable chip under it, and the caption in a hover card (spec §8.4). */
export function badgeView(kit: BadgeKit, engine: JSX.Element, sound: ResolvedSound, scope: string, onReplay: () => void): JSX.Element {
  const { Box, Button, Text } = kit
  return (
    <Box flexDirection="column">
      {engine}
      <Box key="pt-badge" flexDirection="column">
        <Button key="pt-replay" plain hover={{ scope, bold: true }} onPress={onReplay}>
          ♫ {sound.riff} ▶
        </Button>
        <Box key="pt-card" display="none" hover={{ scope, display: 'flex' }}>
          <Text dimColor>{sound.caption}</Text>
        </Box>
      </Box>
    </Box>
  )
}
