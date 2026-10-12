import { describe, expect, test } from 'claude-code/testing'

import { CATALOG } from '../hooks/catalog'
import { encodeUtf16LeBase64 } from '../hooks/codec'
import { resolveSound } from '../hooks/library'
import { DETACH_COMMAND, WINDOWS_SCRIPT, detachedLaunch, filePathOf, linuxPlayerArgv, startSignal, windowsEnv } from '../hooks/player'

describe('player argv and env', () => {
  test('linux players get their own volume flags', () => {
    expect(linuxPlayerArgv('pw-play', '/s/x.wav', 0.8)).toEqual(['pw-play', '--volume', '0.80', '/s/x.wav'])
    expect(linuxPlayerArgv('paplay', '/s/x.wav', 0.5)).toEqual(['paplay', '--volume=32768', '/s/x.wav'])
    expect(linuxPlayerArgv('ffplay', '/s/x.wav', 0.8)).toEqual(['ffplay', '-nodisp', '-autoexit', '-loglevel', 'quiet', '-volume', '80', '/s/x.wav'])
    expect(linuxPlayerArgv('aplay', '/s/x.wav', 0.8)).toEqual(['aplay', '-q', '/s/x.wav'])
  })
  test('windows env carries only data; WSL adds WSLENV with /p for the path; unknown length is PT_MS 0', () => {
    expect(windowsEnv('windows', 'C:\\s\\x.wav', 0.8, 2000, 15000, undefined)).toEqual({
      PT_FILE: 'C:\\s\\x.wav', PT_GAIN: '0.80', PT_MS: '2000', PT_CAP: '15000',
    })
    expect(windowsEnv('wsl', '/s/x.mp3', 1, null, 15000, 'USERPROFILE/p')).toEqual({
      PT_FILE: '/s/x.mp3', PT_GAIN: '1.00', PT_MS: '0', PT_CAP: '15000',
      WSLENV: 'USERPROFILE/p:PT_FILE/p:PT_GAIN:PT_MS:PT_CAP',
    })
  })
  test('PowerShell text holds no double quotes (it crosses Windows command-line quoting)', () => {
    expect(WINDOWS_SCRIPT).not.toContain('"')
    expect(DETACH_COMMAND).not.toContain('"')
  })
  test('bundled sounds are played from under the plugin root', () => {
    const sound = resolveSound(CATALOG[0]!.id, [])!
    expect(filePathOf('/plugins/producer-tags', sound)).toBe(`/plugins/producer-tags/${CATALOG[0]!.file}`)
  })
})

describe('what the player reads and launches', () => {
  const sound = resolveSound(CATALOG[0]!.id, [])!
  const request = { sound, gain: 0.8, maxMs: 15000 }
  test('the start of playback', () => {
    expect(startSignal('pid 4242\n')).toEqual({ isStarted: true, pid: '4242' })
    expect(startSignal('started\n')).toEqual({ isStarted: true, pid: null })
    expect(startSignal('t\n')).toEqual({ isStarted: false, pid: null })
  })
  test('the detached outro per platform', () => {
    expect(detachedLaunch({ os: 'mac', player: 'audio' }, '/p/x.wav', request, undefined)).toEqual({
      argv: ['sh', '-c', 'afplay -v "$PT_GAIN" "$PT_FILE" >/dev/null 2>&1 &'],
      env: { PT_FILE: '/p/x.wav', PT_GAIN: '0.80' },
    })
    expect(detachedLaunch({ os: 'linux', player: 'aplay' }, '/p/x.wav', request, undefined)?.argv).toEqual(['sh', '-c', '"$@" >/dev/null 2>&1 &', 'pt-play', 'aplay', '-q', '/p/x.wav'])
    const wsl = detachedLaunch({ os: 'wsl', player: 'powershell' }, '/p/x.wav', request, 'USERPROFILE/p')
    expect(wsl?.argv).toEqual(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', DETACH_COMMAND])
    expect(wsl?.env.WSLENV).toBe('USERPROFILE/p:PT_FILE/p:PT_GAIN:PT_MS:PT_CAP:PT_SCRIPT')
    expect(wsl?.env.PT_SCRIPT).toBe(encodeUtf16LeBase64(WINDOWS_SCRIPT))
    expect(detachedLaunch({ os: 'linux', player: 'none' }, '/p/x.wav', request, undefined)).toBeNull()
  })
})
