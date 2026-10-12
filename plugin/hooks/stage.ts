import type { NowPlaying, SoundId, TriggerKey } from '../types'
import { CLAIM_GRACE_MS, COOLDOWN_MS, END_TAIL_MS, FALLBACK_SOUND, MAX_CLIP_MS, TRIGGERS } from './constants'
import type { ResolvedSound } from './library'

/** Holds the stage for claims: not ended and not past its deadline (spec §5). */
export function isLive(np: NowPlaying | null, now: number): boolean {
  return np !== null && np.endedAt === null && now < np.deadline
}

/** Shown by the band: started, and neither past its tail nor past its deadline (spec §8.3). */
export function isOnStage(np: NowPlaying, now: number): boolean {
  if (np.startedAt === null || now >= np.deadline) return false
  return np.endedAt === null || now < np.endedAt + END_TAIL_MS
}

export function isCoolingDown(cooldowns: Partial<Record<TriggerKey, number>>, key: TriggerKey, now: number): boolean {
  const last = cooldowns[key]
  return last !== undefined && now - last < COOLDOWN_MS
}

export function defaultSoundFor(key: TriggerKey): SoundId {
  return TRIGGERS.find(t => t.id === key)?.sound ?? FALLBACK_SOUND
}

/** A fresh claim on the stage: live for CLAIM_GRACE_MS, which covers the player's startup. */
export function claimFor(sound: ResolvedSound, key: TriggerKey, now: number, toolUseId: string | null, nonce: string): NowPlaying {
  return {
    token: `${sound.id}:${now}:${nonce}`,
    soundId: sound.id,
    key,
    caption: sound.caption,
    riff: sound.riff,
    claimedAt: now,
    startedAt: null,
    endedAt: null,
    durationMs: sound.durationMs,
    deadline: now + CLAIM_GRACE_MS,
    peaks: sound.peaks,
    toolUseId,
  }
}

/** The entry once playback has started: live until its length (or the 15 s cap) plus the tail. */
export function startedEntry(np: NowPlaying, startedAt: number): NowPlaying {
  return { ...np, startedAt, deadline: startedAt + (np.durationMs ?? MAX_CLIP_MS) + END_TAIL_MS }
}

/** When a leftover entry stops counting: its deadline if its end was never reported, else after the tail. */
export function clearAtOf(np: NowPlaying): number {
  return np.endedAt === null ? np.deadline : np.endedAt + END_TAIL_MS
}
