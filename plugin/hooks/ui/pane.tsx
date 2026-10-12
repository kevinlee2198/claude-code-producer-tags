import type { Elements } from 'claude-code'

import type { ImportedSound, Outcome, PaneDraft, Settings, SoundId } from '../../types'
import { MAX_CUSTOM, TRIGGERS } from '../constants'
import type { Host } from '../host'
import { padSounds, resolveSound, soundLabel, soundOptions } from '../library'
import { act } from '../notify'
import { firePreview, toggleMute } from '../pipeline'
import { changeSettings } from '../settings'
import {
  removeCustom,
  removeImport,
  runImport,
  saveCustom,
  setCustomSound,
  setDraft,
  setTriggerSound,
  stepVolume,
  toggleCustom,
  toggleStudio,
  toggleTrigger,
} from './pane-actions'
import { barsText, waveformLevels } from './visual'

const WAVE_COLUMNS = 16
const OUTCOME_LABEL: Record<Outcome, string> = { success: 'on success', fail: 'on failure', any: 'either way' }
const OUTCOME_OPTIONS = Object.entries(OUTCOME_LABEL).map(([value, label]) => ({ value, label }))

export type PaneKit = Pick<Elements['terminal'], 'Box' | 'Button' | 'Input' | 'Select' | 'Text'>

/** What every section of the pane draws from; `host` is what its buttons act through. */
export type View = {
  host: Host
  els: PaneKit
  settings: Settings
  imports: ImportedSound[]
  draft: PaneDraft
  options: { value: string; label: string }[]
  preview: { soundId: SoundId; progress: number } | null
  isWide: boolean
  hasVolume: boolean
  fader: JSX.Element | null
}

const change = (v: View, where: string, fn: (s: Settings) => Settings) => () => act(v.host, where, () => changeSettings(v.host, fn))

function header(v: View): JSX.Element {
  const { Box, Button, Text } = v.els
  return (
    <Box key="header" gap={1}>
      <Text bold>Producer Tags</Text>
      {v.hasVolume && <Button key="vol-down" label="−" onPress={change(v, 'volume', s => stepVolume(s, -10))} />}
      {v.hasVolume && <Text>{v.settings.volume}%</Text>}
      {v.hasVolume && <Button key="vol-up" label="+" onPress={change(v, 'volume', s => stepVolume(s, 10))} />}
      {v.fader}
      <Button key="mute" label={v.settings.muted ? 'Unmute' : 'Mute'} onPress={() => act(v.host, 'mute', () => toggleMute(v.host))} />
    </Box>
  )
}

/** The clip's waveform; during its preview, the part already played is lit. */
function wave(v: View, soundId: SoundId, key: string): JSX.Element | null {
  if (!v.isWide) return null
  const { Box, Text } = v.els
  const bars = barsText(waveformLevels(resolveSound(soundId, v.imports)?.peaks ?? null, WAVE_COLUMNS))
  const played = v.preview?.soundId === soundId ? Math.ceil(v.preview.progress * WAVE_COLUMNS) : 0
  return (
    <Box key={key}>
      <Text color="claude">{bars.slice(0, played)}</Text>
      <Text dimColor>{bars.slice(played)}</Text>
    </Box>
  )
}

function triggerRows(v: View): JSX.Element[] {
  const { Box, Button, Select, Text } = v.els
  return TRIGGERS.map(t => {
    const setting = v.settings.triggers[t.id]
    return (
      <Box key={`row-${t.id}`} gap={1}>
        <Button key={`toggle-${t.id}`} plain label={setting.enabled ? '●' : '○'} onPress={change(v, 'toggle', s => toggleTrigger(s, t.id))} />
        <Text>{t.label.padEnd(16)}</Text>
        <Select key={`sound-${t.id}`} options={v.options} value={setting.sound} onSelect={value => change(v, 'sound', s => setTriggerSound(s, t.id, value))()} />
        <Button key={`play-${t.id}`} plain label="▶" onPress={() => act(v.host, 'preview', () => firePreview(v.host, setting.sound))} />
        {wave(v, setting.sound, `wave-${t.id}`)}
      </Box>
    )
  })
}

const MESSAGE_COLOR = { ok: 'success', warn: 'warning', error: 'error' } as const

/** The pane's one message line, drawn where its `where` says (custom form or imports). */
function messageLine(v: View, where: 'custom' | 'import'): JSX.Element | null {
  const { Box, Text } = v.els
  const message = v.draft.message
  if (message === null || message.where !== where) return null
  return (
    <Box key="pane-message">
      <Text color={MESSAGE_COLOR[message.kind]}>{message.text}</Text>
    </Box>
  )
}

function customSection(v: View): JSX.Element {
  const { Box, Button, Input, Select, Text } = v.els
  let footer: JSX.Element
  if (v.draft.isAdding) {
    footer = (
      <Box key="custom-form" gap={1}>
        <Input
          key="custom-pattern"
          label="pattern"
          placeholder="docker compose up"
          value={v.draft.customPattern}
          onInput={value => act(v.host, 'draft', () => setDraft(v.host, d => ({ ...d, customPattern: value })))}
          onSubmit={value => act(v.host, 'custom', () => saveCustom(v.host, value))}
        />
        <Select key="custom-outcome" options={OUTCOME_OPTIONS} value={v.draft.customOutcome} onSelect={value => act(v.host, 'draft', () => setDraft(v.host, d => ({ ...d, customOutcome: value as Outcome })))} />
        <Select key="custom-sound" options={v.options} value={v.draft.customSound} onSelect={value => act(v.host, 'draft', () => setDraft(v.host, d => ({ ...d, customSound: value })))} />
        <Button key="custom-save" label="Save" variant="primary" onPress={() => act(v.host, 'custom', () => saveCustom(v.host, null))} />
        <Button key="custom-cancel" label="Cancel" onPress={() => act(v.host, 'draft', () => setDraft(v.host, d => ({ ...d, isAdding: false, customPattern: '', message: null })))} />
      </Box>
    )
  } else if (v.settings.custom.length < MAX_CUSTOM) {
    footer = <Button key="custom-add" label="+ Add" onPress={() => act(v.host, 'draft', () => setDraft(v.host, d => ({ ...d, isAdding: true, message: null })))} />
  } else {
    footer = <Text dimColor>20 custom triggers is the limit.</Text>
  }
  return (
    <Box key="custom" flexDirection="column">
      <Text bold>Custom</Text>
      {v.settings.custom.map(c => (
        <Box key={`custom-${c.id}`} gap={1}>
          <Button key={`ctoggle-${c.id}`} plain label={c.enabled ? '●' : '○'} onPress={change(v, 'custom', s => toggleCustom(s, c.id))} />
          <Text>
            /{c.pattern}/ · {OUTCOME_LABEL[c.outcome]}
          </Text>
          {c.isInvalid && <Text color="error">⚠ invalid</Text>}
          <Select key={`csound-${c.id}`} options={v.options} value={c.sound} onSelect={value => change(v, 'custom', s => setCustomSound(s, c.id, value))()} />
          <Button key={`cplay-${c.id}`} plain label="▶" onPress={() => act(v.host, 'preview', () => firePreview(v.host, c.sound))} />
          <Button key={`cdel-${c.id}`} plain label="✕" onPress={change(v, 'custom', s => removeCustom(s, c.id))} />
        </Box>
      ))}
      {footer}
      {messageLine(v, 'custom')}
    </Box>
  )
}

function importSection(v: View): JSX.Element {
  const { Box, Button, Input, Text } = v.els
  return (
    <Box key="imports" flexDirection="column">
      <Text bold>Import</Text>
      <Box key="import" gap={1}>
        <Input
          key="import-path"
          placeholder="~/Music/mytag.wav"
          value={v.draft.importPath}
          onInput={value => act(v.host, 'draft', () => setDraft(v.host, d => ({ ...d, importPath: value })))}
          onSubmit={value => act(v.host, 'import', () => runImport(v.host, value))}
        />
        <Button key="import-go" label="Import" onPress={() => act(v.host, 'import', () => runImport(v.host, null))} />
      </Box>
      {v.imports.map(sound => (
        <Box key={`imp-${sound.id}`} gap={1}>
          <Text>{sound.name}</Text>
          <Button key={`impplay-${sound.id}`} plain label="▶" onPress={() => act(v.host, 'preview', () => firePreview(v.host, sound.id))} />
          <Button key={`impdel-${sound.id}`} plain label="✕" onPress={() => act(v.host, 'delete', () => removeImport(v.host, sound.id))} />
        </Box>
      ))}
      {messageLine(v, 'import')}
    </Box>
  )
}

function padsAndStudio(v: View): JSX.Element {
  const { Box, Button, Text } = v.els
  return (
    <Box key="pads-studio" flexDirection="column">
      <Text bold>Pads</Text>
      <Box key="pads" gap={1}>
        {padSounds().map((id, i) => (
          <Button key={`pad-${i + 1}`} hotkey={String(i + 1)} label={soundLabel(id, v.imports)} onPress={() => act(v.host, 'pad', () => firePreview(v.host, id))} />
        ))}
      </Box>
      <Text bold>Studio</Text>
      <Box key="studio" gap={1}>
        <Button key="studio-band" plain label={`${v.settings.studio.band ? '●' : '○'} now-playing band`} onPress={change(v, 'studio', s => toggleStudio(s, 'band'))} />
        <Button key="studio-badges" plain label={`${v.settings.studio.badges ? '●' : '○'} tool badges`} onPress={change(v, 'studio', s => toggleStudio(s, 'badges'))} />
      </Box>
    </Box>
  )
}

/** The whole pane on terminal, desktop and VS Code (spec §8.2). */
export function paneView(v: View): JSX.Element {
  const { Box } = v.els
  return (
    <Box flexDirection="column">
      {header(v)}
      {triggerRows(v)}
      {customSection(v)}
      {importSection(v)}
      {padsAndStudio(v)}
    </Box>
  )
}

/** Mobile: one line, and the mute button. */
export function mobilePaneView(kit: Pick<PaneKit, 'Box' | 'Button' | 'Text'>, host: Host, settings: Settings): JSX.Element {
  const { Box, Button, Text } = kit
  return (
    <Box flexDirection="column">
      <Text>Open /tags in the terminal or desktop app to edit.</Text>
      <Button key="mute" label={settings.muted ? 'Unmute' : 'Mute'} onPress={() => act(host, 'mute', () => toggleMute(host))} />
    </Box>
  )
}
