import type { LinuxPlayer, Platform } from '../types'
import type { Host } from './host'

/** Prints the first Linux player found, or `none` (spec §6.1). */
export const FIND_PLAYER =
  'for p in pw-play paplay ffplay aplay; do if command -v "$p" >/dev/null 2>&1; then echo "$p"; exit 0; fi; done; echo none'

export function linuxPlayerFrom(stdout: string | undefined): LinuxPlayer | 'none' {
  const name = stdout?.trim()
  return name === 'pw-play' || name === 'paplay' || name === 'ffplay' || name === 'aplay' ? name : 'none'
}

let probing: Promise<Platform> | null = null

/** Which OS this is and how it plays sound: probed once (spec §6.1), then kept in state for the pane. */
export async function detectPlatform(host: Host): Promise<Platform> {
  const cached = await host.state.platform.read()
  if (cached !== null) return cached
  probing ??= probe(host)
    .then(async platform => {
      await host.state.platform.update(() => platform)
      return platform
    })
    .finally(() => {
      probing = null
    })
  return probing
}

async function probe(host: Host): Promise<Platform> {
  if ((await host.env.os()) === 'Windows_NT') return { os: 'windows', player: 'powershell' }
  const uname = await host.run(['uname', '-s']).catch(() => null)
  const kernel = uname?.stdout.trim()
  if (kernel === 'Darwin') return { os: 'mac', player: 'audio' }
  if (kernel === 'Linux') {
    const version = await host.readText('/proc/version').catch(() => '')
    if (/microsoft/i.test(version)) return { os: 'wsl', player: 'powershell' }
    const found = await host.run(['sh', '-c', FIND_PLAYER]).catch(() => null)
    return { os: 'linux', player: linuxPlayerFrom(found?.stdout) }
  }
  return { os: 'linux', player: 'none' }
}
