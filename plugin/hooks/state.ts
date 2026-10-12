import { atom } from 'claude-code'

import type { PaneDraft } from '../types'
import { FALLBACK_SOUND } from './constants'

export const settingsAtom = atom({ plugin: 'producer-tags', key: 'settings' } as const, null)
export const importsAtom = atom({ plugin: 'producer-tags', key: 'imports' } as const, null)
export const nowPlayingAtom = atom({ plugin: 'producer-tags', key: 'nowPlaying' } as const, null)
export const bandFrameAtom = atom({ plugin: 'producer-tags', key: 'bandFrame' } as const, 0)
export const captionWordAtom = atom({ plugin: 'producer-tags', key: 'captionWord' } as const, -1)
export const taggedAtom = atom({ plugin: 'producer-tags', key: 'tagged' } as const, null)
export const platformAtom = atom({ plugin: 'producer-tags', key: 'platform' } as const, null)
export const cooldownsAtom = atom({ plugin: 'producer-tags', key: 'cooldowns' } as const, {})
export const toastedAtom = atom({ plugin: 'producer-tags', key: 'toasted' } as const, [])

export const EMPTY_DRAFT: PaneDraft = {
  isAdding: false,
  customPattern: '',
  customOutcome: 'success',
  customSound: FALLBACK_SOUND,
  importPath: '',
  message: null,
}
export const paneDraftAtom = atom({ plugin: 'producer-tags', key: 'paneDraft' } as const, EMPTY_DRAFT)
