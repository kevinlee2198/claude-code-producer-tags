import type { ClientModule } from 'claude-code'

type Props = { volume: number }
type State = { volume: number; isDragging: boolean }

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)))

/** Drag (or ←/→ once clicked) to set the volume: posts live values while dragging, and a final one on release or key. */
const Fader: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const state = surface.state ?? { volume: props.volume, isDragging: false }
  const width = Math.max(4, surface.columns - 5)

  // Set again on every call (each replaces the last), so they read this call's props.
  surface.onPointer(event => {
    const now = surface.state ?? state
    if (event.type === 'down' || (event.type === 'move' && event.button === 'left')) {
      const volume = clamp(((event.fine?.x ?? event.x) / width) * 100)
      surface.setState({ volume, isDragging: true })
      surface.post({ volume, isFinal: false })
    } else if (event.type === 'up' && now.isDragging) {
      surface.setState({ ...now, isDragging: false })
      surface.post({ volume: now.volume, isFinal: true })
    }
  })
  surface.onKey(event => {
    const step = event.key === 'right' ? 5 : event.key === 'left' ? -5 : 0
    if (step === 0) return
    const volume = clamp(props.volume + step)
    surface.setState({ volume, isDragging: false })
    surface.post({ volume, isFinal: true })
  })

  const volume = state.isDragging ? state.volume : props.volume
  const filled = Math.round((volume / 100) * width)
  return (
    <Box>
      <Text color="claude">{'━'.repeat(filled)}</Text>
      <Text>●</Text>
      <Text dimColor>{'─'.repeat(Math.max(0, width - filled))}</Text>
      <Text> {String(volume).padStart(3)}%</Text>
    </Box>
  )
}

export default Fader
