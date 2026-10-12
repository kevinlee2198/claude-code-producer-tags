import { update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { toastedAtom } from './state'

export type ToastCause = 'no-player' | 'playback-failed' | 'corrupt-settings' | `missing:${string}`

/** Shows `text` the first time `cause` happens in this session, never again. */
export async function toastOnce($: EngineInterface, cause: ToastCause, text: string): Promise<void> {
  let isFirst = false
  await update($, toastedAtom, list => {
    isFirst = !list.includes(cause)
    return isFirst ? [...list, cause] : list
  })
  if (isFirst) $.ui.toast(text)
}

export function logError($: EngineInterface, where: string, error: unknown): void {
  const text = error instanceof Error ? error.message : String(error)
  $.ui.log(`producer-tags: ${where}: ${text}`, { to: 'debug' })
}

/** Starts work without awaiting it; a failure goes to the debug log, never up (spec §10). */
export function act($: EngineInterface, where: string, work: () => Promise<unknown>): void {
  void Promise.resolve()
    .then(work)
    .catch(error => logError($, where, error))
}
