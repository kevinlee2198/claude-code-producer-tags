import type { Settings, TriggerId, TriggerSetting } from '../types'
import { DEFAULT_VOLUME, MAX_PATTERN_LENGTH, TRIGGERS } from './constants'

export function defaultSettings(): Settings {
  const triggers = {} as Record<TriggerId, TriggerSetting>
  for (const t of TRIGGERS) triggers[t.id] = { enabled: t.enabled, sound: t.sound }
  return { version: 1, muted: false, volume: DEFAULT_VOLUME, triggers, custom: [], studio: { band: true, badges: true } }
}

/** A custom pattern as a case-insensitive regex, or null when it is empty, too long or invalid. */
export function compilePattern(pattern: string): RegExp | null {
  if (pattern.length === 0 || pattern.length > MAX_PATTERN_LENGTH) return null
  try {
    return new RegExp(pattern, 'i')
  } catch {
    return null
  }
}
