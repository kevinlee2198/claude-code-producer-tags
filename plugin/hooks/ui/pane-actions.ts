import type { CustomTrigger, PaneDraft, Settings, SoundId, TriggerId } from '../../types'
import { MAX_CUSTOM } from '../constants'
import type { Host } from '../host'
import { deleteImport, importSound } from '../imports'
import { changeSettings, validatePattern } from '../settings'
import { EMPTY_DRAFT } from '../state'

export function toggleTrigger(s: Settings, id: TriggerId): Settings {
  return { ...s, triggers: { ...s.triggers, [id]: { ...s.triggers[id], enabled: !s.triggers[id].enabled } } }
}

export function setTriggerSound(s: Settings, id: TriggerId, sound: SoundId): Settings {
  return { ...s, triggers: { ...s.triggers, [id]: { ...s.triggers[id], sound } } }
}

export function setVolume(s: Settings, volume: number): Settings {
  return { ...s, volume: Math.round(Math.min(100, Math.max(0, volume))) }
}

export function stepVolume(s: Settings, delta: number): Settings {
  return setVolume(s, s.volume + delta)
}

export function toggleStudio(s: Settings, key: 'band' | 'badges'): Settings {
  return { ...s, studio: { ...s.studio, [key]: !s.studio[key] } }
}

export function addCustom(s: Settings, trigger: CustomTrigger): Settings {
  return s.custom.length >= MAX_CUSTOM ? s : { ...s, custom: [...s.custom, trigger] }
}

export function removeCustom(s: Settings, id: string): Settings {
  return { ...s, custom: s.custom.filter(c => c.id !== id) }
}

export function toggleCustom(s: Settings, id: string): Settings {
  return { ...s, custom: s.custom.map(c => (c.id === id && !c.isInvalid ? { ...c, enabled: !c.enabled } : c)) }
}

export function setCustomSound(s: Settings, id: string, sound: SoundId): Settings {
  return { ...s, custom: s.custom.map(c => (c.id === id ? { ...c, sound } : c)) }
}

export function newCustomId(existing: readonly CustomTrigger[]): string {
  for (let n = 1; ; n++) if (!existing.some(c => c.id === `c${n}`)) return `c${n}`
}

export async function setDraft(host: Host, change: (draft: PaneDraft) => PaneDraft): Promise<void> {
  await host.state.paneDraft.update(change)
}

export async function saveCustom(host: Host, submitted: string | null): Promise<void> {
  const draft = await host.state.paneDraft.read()
  const pattern = (submitted ?? draft.customPattern).trim()
  const error = validatePattern(pattern)
  if (error !== null) {
    await setDraft(host, d => ({ ...d, customPattern: pattern, message: { kind: 'error', text: error } }))
    return
  }
  await changeSettings(host, s =>
    addCustom(s, { id: newCustomId(s.custom), pattern, outcome: draft.customOutcome, sound: draft.customSound, enabled: true, isInvalid: false }),
  )
  await setDraft(host, () => ({ ...EMPTY_DRAFT, message: { kind: 'ok', text: `Added /${pattern}/.` } }))
}

export async function runImport(host: Host, submitted: string | null): Promise<void> {
  const path = submitted ?? (await host.state.paneDraft.read()).importPath
  const result = await importSound(host, path)
  await setDraft(host, d =>
    result.ok
      ? { ...d, importPath: '', message: { kind: 'ok', text: result.warning ?? `Imported "${result.sound.name}".` } }
      : { ...d, importPath: path, message: { kind: 'error', text: result.error } },
  )
}

export async function removeImport(host: Host, id: SoundId): Promise<void> {
  await deleteImport(host, id)
  await setDraft(host, d => ({ ...d, message: { kind: 'ok', text: 'Removed.' } }))
}
