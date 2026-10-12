import type { ImportedSound, NowPlaying, Settings, SoundId } from '../types'
import { END_TAIL_MS, MAX_CLIP_MS } from './constants'
import type { Host } from './host'
import { resolveSound, type ResolvedSound } from './library'
import { act, logError, toastOnce } from './notify'
import { detectPlatform } from './platform'
import { play, playDetached, type PlayEnd, type PlayHandle } from './player'
import { changeSettings, ensureLoaded } from './settings'
import { claimFor, clearAtOf, defaultSoundFor, isCoolingDown, isLive, startedEntry } from './stage'
import type { Hit } from './triggers'

/** The clip this module started; a reloaded module starts with none (recoverStage). */
let current: { token: string; handle: PlayHandle } | null = null

/** Changes `nowPlaying` only while it is still this clip's. */
function updateIfMine(host: Host, token: string, change: (np: NowPlaying) => NowPlaying | null): Promise<NowPlaying | null> {
  return host.state.nowPlaying.update(np => (np?.token === token ? change(np) : np))
}

async function setTag(host: Host, toolUseId: string | null, sound: SoundId | null): Promise<void> {
  if (toolUseId !== null) await host.tag(toolUseId, sound)
}

async function failPlayback(host: Host, token: string, toolUseId: string | null): Promise<void> {
  await updateIfMine(host, token, () => null)
  await setTag(host, toolUseId, null)
  await toastOnce(host, 'playback-failed', 'Producer Tags: this machine could not play the tag.')
}

async function resolveOrFallback(host: Host, hit: Hit, imports: readonly ImportedSound[]): Promise<ResolvedSound | null> {
  const wanted = resolveSound(hit.sound, imports)
  if (wanted !== null && (wanted.source.kind === 'asset' || (await host.exists(wanted.source.path)))) return wanted
  if (wanted !== null) await toastOnce(host, `missing:${wanted.id}`, `Producer Tags: ${wanted.caption} is missing, so the default plays.`)
  return resolveSound(defaultSoundFor(hit.key), imports)
}

/**
 * Plays a hit and answers whether it started. Triggers respect the cooldown and the claim;
 * previews (`key: 'preview'`) interrupt and skip the cooldown (spec §5).
 */
export async function fire(host: Host, hit: Hit, toolUseId: string | null = null): Promise<boolean> {
  const isPreview = hit.key === 'preview'
  const { settings, imports } = await ensureLoaded(host)
  if (settings.muted) return false
  const now = await host.now()
  if (!isPreview && isCoolingDown(await host.state.cooldowns.read(), hit.key, now)) return false
  const sound = await resolveOrFallback(host, hit, imports)
  if (sound === null) return false

  const mine = claimFor(sound, hit.key, now, toolUseId, Math.random().toString(36).slice(2, 8))
  const token = mine.token
  if (isPreview) {
    stopCurrent()
    await host.state.nowPlaying.update(() => mine)
  } else {
    const claimed = await host.state.nowPlaying.update(np => (isLive(np, now) ? np : mine))
    if (claimed?.token !== token) return false
    await host.state.cooldowns.update(cooldowns => ({ ...cooldowns, [hit.key]: now }))
  }

  const platform = await detectPlatform(host)
  if (platform.player === 'none') await toastOnce(host, 'no-player', 'Producer Tags: no audio player found, so tags show as captions only.')
  const handle = play(host, platform, { sound, gain: settings.volume / 100, maxMs: MAX_CLIP_MS })
  current = { token, handle }
  if (!(await handle.started)) {
    await failPlayback(host, token, null)
    return false
  }
  const startedAt = await host.now()
  await updateIfMine(host, token, np => startedEntry(np, startedAt))
  await setTag(host, toolUseId, sound.id)
  void handle.ended.then(result => act(host, 'finish', () => finish(host, token, toolUseId, result)))
  return true
}

async function finish(host: Host, token: string, toolUseId: string | null, result: PlayEnd): Promise<void> {
  if (current?.token === token) current = null
  if (result === 'failed') {
    await failPlayback(host, token, toolUseId)
    return
  }
  const endedAt = await host.now()
  await updateIfMine(host, token, np => ({ ...np, endedAt }))
  host.after(END_TAIL_MS, () => act(host, 'clear', () => updateIfMine(host, token, () => null)))
}

export function stopCurrent(): void {
  current?.handle.stop()
}

export function firePreview(host: Host, sound: SoundId): Promise<boolean> {
  return fire(host, { key: 'preview', sound })
}

/** Runs tag work in its own dispatch once the current one resolves (spec §3). */
export function schedule(host: Host, pick: (settings: Settings) => Hit | null, toolUseId: string | null = null): void {
  host.after(0, () =>
    act(host, 'trigger', async () => {
      const { settings } = await ensureLoaded(host)
      const hit = pick(settings)
      if (hit !== null) await fire(host, hit, toolUseId)
    }),
  )
}

/** The session.close outro: detached so it outlives the exit (spec §6.3). */
export async function fireDetached(host: Host, hit: Hit): Promise<void> {
  const { settings, imports } = await ensureLoaded(host)
  if (settings.muted) return
  const sound = resolveSound(hit.sound, imports) ?? resolveSound(defaultSoundFor(hit.key), imports)
  if (sound === null) return
  await playDetached(host, await detectPlatform(host), { sound, gain: settings.volume / 100, maxMs: MAX_CLIP_MS })
}

/** An atomic flip that stops the clip when muting. */
export async function toggleMute(host: Host): Promise<Settings> {
  const settings = await changeSettings(host, s => ({ ...s, muted: !s.muted }))
  if (settings.muted) stopCurrent()
  return settings
}

/** `/mute`'s answer, a few words because the model reads it too (spec §8.1). */
export async function muteAnswer(host: Host): Promise<{ text: string }> {
  try {
    const settings = await toggleMute(host)
    return { text: settings.muted ? 'Tags muted.' : 'Tags unmuted.' }
  } catch (error) {
    logError(host, 'mute', error)
    return { text: 'Producer Tags hit an error.' }
  }
}

/** Registers `/mute`, or `/tags-mute` when the name is refused, and answers which. */
export async function registerMute(host: Host): Promise<'mute' | 'tags-mute'> {
  const description = 'Mute or unmute Producer Tags'
  try {
    await host.registerCommand({ name: 'mute', description, immediate: true })
    return 'mute'
  } catch {
    await host.registerCommand({ name: 'tags-mute', description, immediate: true })
    return 'tags-mute'
  }
}

/**
 * On a (re)load the fresh module owns no player: forget the old handle, drop an entry already
 * past its end, and clear an unfinished one at its deadline so the band can never stick (spec §5).
 */
export async function recoverStage(host: Host): Promise<void> {
  current = null
  const np = await host.state.nowPlaying.read()
  if (np === null) return
  const now = await host.now()
  const clearAt = clearAtOf(np)
  if (now >= clearAt) {
    await updateIfMine(host, np.token, () => null)
    return
  }
  const token = np.token
  host.after(clearAt - now, () => act(host, 'recover', () => updateIfMine(host, token, () => null)))
}
