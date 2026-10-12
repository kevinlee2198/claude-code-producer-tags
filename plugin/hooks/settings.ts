import type { CustomTrigger, ImportedSound, Outcome, Settings, SoundId, TriggerId, TriggerSetting } from '../types'
import { CATALOG } from './catalog'
import { DEFAULT_VOLUME, FALLBACK_SOUND, MAX_CUSTOM, MAX_PATTERN_LENGTH, TRIGGERS } from './constants'
import type { Host } from './host'
import { toastOnce } from './notify'

export function defaultSettings(): Settings {
  const triggers = {} as Record<TriggerId, TriggerSetting>
  for (const t of TRIGGERS) triggers[t.id] = { enabled: t.enabled, sound: t.sound }
  return { version: 1, muted: false, volume: DEFAULT_VOLUME, triggers, custom: [], studio: { band: true, badges: true } }
}

/**
 * Whether a quantifier starts at `at`. A quantifier is unbounded for `+`, `*` and `{n,}`, and a
 * repeat for those plus `{n,m}` with m above 1; `?` and `{n}` count as neither. It is large when
 * it is unbounded or `{n,m}` with m above 3, enough to blow up a group that already repeats.
 */
function quantifierAt(pattern: string, at: number): { isUnbounded: boolean; isRepeat: boolean; isLarge: boolean } {
  const c = pattern[at]
  if (c === '+' || c === '*') return { isUnbounded: true, isRepeat: true, isLarge: true }
  const braces = c === '{' ? /^\{\d+,(\d*)\}/.exec(pattern.slice(at)) : null
  if (braces === null) return { isUnbounded: false, isRepeat: false, isLarge: false }
  const isUnbounded = braces[1] === ''
  return { isUnbounded, isRepeat: isUnbounded || Number(braces[1]) > 1, isLarge: isUnbounded || Number(braces[1]) > 3 }
}

/**
 * A heuristic for patterns that can backtrack catastrophically: a group holding a repeat or an
 * alternation (at any depth) that is itself repeated without bound or many times, like (a+)+, (.*)*x, (a|aa)+
 * or ((a|aa))+. It cannot see polynomial blowup such as .*.*.*x.
 */
function canHang(pattern: string): boolean {
  const groups: { hasRepeat: boolean; hasAlternation: boolean }[] = [{ hasRepeat: false, hasAlternation: false }]
  let inClass = false
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!
    const top = groups[groups.length - 1]!
    if (c === '\\') {
      i++
    } else if (inClass) {
      if (c === ']') inClass = false
    } else if (c === '[') {
      inClass = true
    } else if (c === '(') {
      groups.push({ hasRepeat: false, hasAlternation: false })
    } else if (c === '|') {
      top.hasAlternation = true
    } else if (c === ')' && groups.length > 1) {
      const closed = groups.pop()!
      const parent = groups[groups.length - 1]!
      const quantifier = quantifierAt(pattern, i + 1)
      if (quantifier.isLarge && (closed.hasRepeat || closed.hasAlternation)) return true
      if (closed.hasRepeat || quantifier.isRepeat) parent.hasRepeat = true
      if (closed.hasAlternation) parent.hasAlternation = true
    } else if (quantifierAt(pattern, i).isRepeat) {
      top.hasRepeat = true
    }
  }
  return false
}

/** A custom pattern as a case-insensitive regex, or null when it is empty, too long, hang-prone or invalid. */
export function compilePattern(pattern: string): RegExp | null {
  if (pattern.length === 0 || pattern.length > MAX_PATTERN_LENGTH || canHang(pattern)) return null
  try {
    return new RegExp(pattern, 'i')
  } catch {
    return null
  }
}

export const SETTINGS_KEY = 'settings'
export const IMPORTS_KEY = 'imports'

export function validatePattern(pattern: string): string | null {
  if (pattern.trim().length === 0) return 'Enter a pattern.'
  if (pattern.length > MAX_PATTERN_LENGTH) return `Patterns are at most ${MAX_PATTERN_LENGTH} characters.`
  if (canHang(pattern)) return 'That pattern can hang; avoid repeating a group that holds a repeat or |, like (a+)+ or (a|b)+.'
  return compilePattern(pattern) === null ? 'That is not a valid regular expression.' : null
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Version 1 is the first stored shape; later versions convert to it here, before the merge. */
export function migrate(raw: unknown): unknown {
  return raw
}

export const OUTCOMES: readonly Outcome[] = ['success', 'fail', 'any']

export function normalizeSettings(raw: unknown, known: ReadonlySet<SoundId>): { settings: Settings; isCorrupt: boolean } {
  const base = defaultSettings()
  if (raw === undefined || raw === null) return { settings: base, isCorrupt: false }
  const value = migrate(raw)
  if (!isRecord(value)) return { settings: base, isCorrupt: true }
  const sound = (candidate: unknown, fallback: SoundId): SoundId =>
    typeof candidate === 'string' && known.has(candidate) ? candidate : fallback

  const triggers = { ...base.triggers }
  const storedTriggers = isRecord(value.triggers) ? value.triggers : {}
  for (const t of TRIGGERS) {
    const entry = storedTriggers[t.id]
    if (!isRecord(entry)) continue
    triggers[t.id] = {
      enabled: typeof entry.enabled === 'boolean' ? entry.enabled : t.enabled,
      sound: sound(entry.sound, t.sound),
    }
  }

  const custom: CustomTrigger[] = []
  for (const entry of Array.isArray(value.custom) ? value.custom.filter(isRecord) : []) {
    if (custom.length >= MAX_CUSTOM) break
    if (typeof entry.id !== 'string' || typeof entry.pattern !== 'string') continue
    const isInvalid = compilePattern(entry.pattern) === null
    custom.push({
      id: entry.id,
      pattern: entry.pattern,
      outcome: OUTCOMES.includes(entry.outcome as Outcome) ? (entry.outcome as Outcome) : 'success',
      sound: sound(entry.sound, FALLBACK_SOUND),
      enabled: entry.enabled !== false && !isInvalid,
      isInvalid,
    })
  }

  const studio = isRecord(value.studio) ? value.studio : {}
  const volume =
    typeof value.volume === 'number' && Number.isFinite(value.volume)
      ? Math.round(Math.min(100, Math.max(0, value.volume)))
      : base.volume
  return {
    settings: {
      version: 1,
      muted: typeof value.muted === 'boolean' ? value.muted : base.muted,
      volume,
      triggers,
      custom,
      studio: {
        band: typeof studio.band === 'boolean' ? studio.band : base.studio.band,
        badges: typeof studio.badges === 'boolean' ? studio.badges : base.studio.badges,
      },
    },
    isCorrupt: false,
  }
}

const EXTS = new Set(['wav', 'mp3', 'm4a', 'aiff'])

export function normalizeImports(raw: unknown): ImportedSound[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(isRecord).flatMap((entry): ImportedSound[] =>
    typeof entry.id === 'string' &&
    typeof entry.name === 'string' &&
    typeof entry.file === 'string' &&
    typeof entry.ext === 'string' &&
    EXTS.has(entry.ext)
      ? [
          {
            id: entry.id,
            name: entry.name,
            file: entry.file,
            ext: entry.ext as ImportedSound['ext'],
            bytes: typeof entry.bytes === 'number' ? entry.bytes : 0,
            durationMs: typeof entry.durationMs === 'number' ? entry.durationMs : null,
            peaks: Array.isArray(entry.peaks) ? entry.peaks.filter((p): p is number => typeof p === 'number') : null,
            isCopy: entry.isCopy === true,
          },
        ]
      : [],
  )
}

export function knownSounds(imports: readonly ImportedSound[]): Set<SoundId> {
  return new Set([...CATALOG.map(entry => entry.id), ...imports.map(sound => sound.id)])
}

export type Loaded = { settings: Settings; imports: ImportedSound[] }

export async function loadFromStore(host: Host): Promise<Loaded> {
  const imports = normalizeImports(await host.storeGet(IMPORTS_KEY))
  const { settings, isCorrupt } = normalizeSettings(await host.storeGet(SETTINGS_KEY), knownSounds(imports))
  await host.state.imports.update(() => imports)
  await host.state.settings.update(() => settings)
  if (isCorrupt) await toastOnce(host, 'corrupt-settings', 'Producer Tags: settings were unreadable, so the defaults are back.')
  return { settings, imports }
}

/** Settings and imports from session state, loading them from the store the first time (spec §9.1). */
export async function ensureLoaded(host: Host): Promise<Loaded> {
  const settings = await host.state.settings.read()
  const imports = await host.state.imports.read()
  if (settings !== null && imports !== null) return { settings, imports }
  return loadFromStore(host)
}

/** Writes state first, then the store (spec §9.3); `persist: false` writes state only. */
export async function changeSettings(
  host: Host,
  change: (settings: Settings) => Settings,
  options: { persist?: boolean } = {},
): Promise<Settings> {
  const loaded = await ensureLoaded(host)
  const next = (await host.state.settings.update(current => change(current ?? loaded.settings))) ?? loaded.settings
  if (options.persist !== false) await host.storeSet(SETTINGS_KEY, next)
  return next
}

export async function changeImports(host: Host, change: (imports: ImportedSound[]) => ImportedSound[]): Promise<ImportedSound[]> {
  const loaded = await ensureLoaded(host)
  const next = (await host.state.imports.update(current => change(current ?? loaded.imports))) ?? []
  await host.storeSet(IMPORTS_KEY, next)
  return next
}
