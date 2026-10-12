import { describe, expect, test } from 'claude-code/testing'

import { detectPlatform, linuxPlayerFrom } from '../hooks/platform'
import { fakeHost } from './fake-host'

const kernel = (name: string, player = 'pw-play') => (argv: readonly string[]) =>
  argv[0] === 'uname' ? { stdout: `${name}\n` } : argv[0] === 'sh' ? { stdout: `${player}\n` } : {}

describe('detectPlatform', () => {
  test('macOS plays through the engine; the answer is kept in state and probed once', async () => {
    const host = fakeHost({ run: kernel('Darwin') })
    expect(await detectPlatform(host)).toEqual({ os: 'mac', player: 'audio' })
    expect(await detectPlatform(host)).toEqual({ os: 'mac', player: 'audio' })
    expect(host.runs).toHaveLength(1)
    expect(await host.state.platform.read()).toEqual({ os: 'mac', player: 'audio' })
  })
  test('Linux finds its player; WSL is Linux with microsoft in /proc/version; Windows is OS=Windows_NT', async () => {
    expect(await detectPlatform(fakeHost({ run: kernel('Linux', 'paplay'), files: { '/proc/version': 'Linux version 6.8.0' } }))).toEqual({ os: 'linux', player: 'paplay' })
    expect(await detectPlatform(fakeHost({ run: kernel('Linux', 'none'), files: { '/proc/version': 'Linux version 6.8.0' } }))).toEqual({ os: 'linux', player: 'none' })
    expect(await detectPlatform(fakeHost({ run: kernel('Linux'), files: { '/proc/version': 'Linux 6.6-microsoft-standard-WSL2' } }))).toEqual({ os: 'wsl', player: 'powershell' })
    expect(await detectPlatform(fakeHost({ env: { OS: 'Windows_NT' } }))).toEqual({ os: 'windows', player: 'powershell' })
  })
  test('the probe answer', () => {
    expect(linuxPlayerFrom('paplay\n')).toBe('paplay')
    expect(linuxPlayerFrom('none\n')).toBe('none')
    expect(linuxPlayerFrom(undefined)).toBe('none')
  })
})
