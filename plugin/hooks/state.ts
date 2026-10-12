import type { PaneDraft } from '../types'
import { FALLBACK_SOUND } from './constants'

// Each hook file declares the atoms it reads or writes in a const of its own: the engine lists a
// module's state from `atom({ plugin, key } as const, initial)` calls written in that file, and
// refuses an imported atom. Those declarations take their initial values from here, so every
// file reads the same value before anything is written.

/** `captionWord` before a clip has a lit word. */
export const NO_WORD = -1

export const EMPTY_DRAFT: PaneDraft = {
  isAdding: false,
  customPattern: '',
  customOutcome: 'success',
  customSound: FALLBACK_SOUND,
  importPath: '',
  message: null,
}
