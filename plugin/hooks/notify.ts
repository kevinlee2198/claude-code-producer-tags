import type { Host } from './host'

export type ToastCause = 'no-player' | 'playback-failed' | 'corrupt-settings' | `missing:${string}`

/** Shows `text` the first time `cause` happens in this session, never again. */
export async function toastOnce(host: Host, cause: ToastCause, text: string): Promise<void> {
  let isFirst = false
  await host.state.toasted.update(list => {
    isFirst = !list.includes(cause)
    return isFirst ? [...list, cause] : list
  })
  if (isFirst) host.toast(text)
}

export function logError(host: Host, where: string, error: unknown): void {
  const text = error instanceof Error ? error.message : String(error)
  host.log(`producer-tags: ${where}: ${text}`)
}

/** Starts work without awaiting it; a failure goes to the debug log, never up (spec §10). */
export function act(host: Host, where: string, work: () => Promise<unknown>): void {
  void Promise.resolve()
    .then(work)
    .catch(error => logError(host, where, error))
}
