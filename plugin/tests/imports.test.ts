import { describe, expect, test } from 'claude-code/testing'

import {
  COPY_WARNING,
  cleanPastedPath,
  copyCommand,
  deleteCommand,
  deleteImport,
  expandHome,
  importProblem,
  importSound,
  isWindowsPathOnWsl,
  resetSound,
  soundsDirOf,
} from '../hooks/imports'
import { defaultSettings } from '../hooks/settings'
import { fakeHost } from './fake-host'
import { EMPTY_WAV } from './world'

describe('cleanPastedPath', () => {
  test('drag-and-drop: surrounding quotes, escaped spaces and brackets, stray whitespace', () => {
    expect(cleanPastedPath("  '/Users/me/My Tags/x.wav' ", 'mac')).toBe('/Users/me/My Tags/x.wav')
    expect(cleanPastedPath('"/Users/me/My Tags/x.wav"', 'linux')).toBe('/Users/me/My Tags/x.wav')
    expect(cleanPastedPath('/Users/me/My\\ Tags/tag\\ \\(final\\).wav', 'mac')).toBe('/Users/me/My Tags/tag (final).wav')
  })
  test('windows paths keep their backslashes', () => {
    expect(cleanPastedPath('"C:\\Users\\me\\My Tags\\x.wav"', 'windows')).toBe('C:\\Users\\me\\My Tags\\x.wav')
  })
  test('a lone quote is not unquoted', () => {
    expect(cleanPastedPath("'", 'mac')).toBe("'")
  })
})

describe('where imports go and how they are checked', () => {
  test('~ and WSL paths', () => {
    expect(expandHome('~/Music/x.wav', '/home/dev')).toBe('/home/dev/Music/x.wav')
    expect(expandHome('/a/~x.wav', '/home/dev')).toBe('/a/~x.wav')
    expect(isWindowsPathOnWsl('wsl', 'C:\\m\\x.wav')).toBe(true)
    expect(isWindowsPathOnWsl('linux', 'C:\\m\\x.wav')).toBe(false)
  })
  test('the sounds folder: CLAUDE_CONFIG_DIR, else ~/.claude', () => {
    expect(soundsDirOf('mac', undefined, '/home/dev')).toEqual({ dir: '/home/dev/.claude/producer-tags/sounds', sep: '/' })
    expect(soundsDirOf('linux', '/cfg', '/home/dev')).toEqual({ dir: '/cfg/producer-tags/sounds', sep: '/' })
    expect(soundsDirOf('windows', undefined, 'C:\\Users\\dev')).toEqual({ dir: 'C:\\Users\\dev\\.claude\\producer-tags\\sounds', sep: '\\' })
  })
  test('problems, in order', () => {
    const file = { kind: 'file', size: 10 }
    expect(importProblem('', null, null, ['wav'])).toBe('Enter the path of an audio file.')
    expect(importProblem('/a/x.wav', null, 'wav', ['wav'])).toBe('No file at /a/x.wav.')
    expect(importProblem('/a', { kind: 'dir', size: 0 }, null, ['wav'])).toBe('No file at /a.')
    expect(importProblem('/a/x.txt', file, null, ['wav', 'mp3'])).toBe('Use one of: wav, mp3.')
    expect(importProblem('/a/x.wav', { kind: 'file', size: 5_000_000 }, 'wav', ['wav'])).toBe('Files must be 4 MB or smaller.')
    expect(importProblem('/a/x.wav', file, 'wav', ['wav'])).toBeNull()
  })
  test('copy and delete pass every path in env or argv, never in a command string', () => {
    expect(copyCommand('mac', '/a/x.wav', '/d', '/d/x.wav')).toEqual({
      argv: ['sh', '-c', 'mkdir -p -- "$PT_DIR" && cp -- "$PT_SRC" "$PT_DST"'],
      env: { PT_DIR: '/d', PT_SRC: '/a/x.wav', PT_DST: '/d/x.wav' },
    })
    const windows = copyCommand('windows', 'C:\\m\\[x].wav', 'C:\\d', 'C:\\d\\x.wav')
    expect(windows.argv[4]).toContain('Copy-Item -LiteralPath $env:PT_SRC')
    expect(windows.env.PT_SRC).toBe('C:\\m\\[x].wav')
    expect(deleteCommand('linux', '/d/x.wav')).toEqual({ argv: ['rm', '-f', '--', '/d/x.wav'] })
    expect(deleteCommand('windows', 'C:\\d\\x.wav').env).toEqual({ PT_DST: 'C:\\d\\x.wav' })
  })
})

describe('resetSound', () => {
  test('points triggers and custom triggers using a deleted sound back at their defaults', () => {
    const s = defaultSettings()
    s.triggers['git.push'].sound = 'user:x'
    s.custom = [{ id: 'c1', pattern: 'x', outcome: 'any', sound: 'user:x', enabled: true, isInvalid: false }]
    const reset = resetSound(s, 'user:x')
    expect(reset.triggers['git.push'].sound).toBe('pt:did-it-again')
    expect(reset.custom[0]!.sound).toBe('pt:808-boom')
    expect(reset.triggers['git.commit']).toEqual(s.triggers['git.commit'])
  })
})

describe('importSound and deleteImport through a Host', () => {
  const mac = (argv: readonly string[]) => (argv[0] === 'uname' ? { stdout: 'Darwin\n' } : {})
  test('copies under ~/.claude with every path in env, records the import, and deleting removes the copy', async () => {
    const host = fakeHost({ run: mac, files: { '/home/dev/Music/My Tag.wav': { base64: EMPTY_WAV } } })
    const result = await importSound(host, "'~/Music/My Tag.wav'")
    expect(result).toMatchObject({ ok: true, warning: null, sound: { id: 'user:my-tag', file: '/home/dev/.claude/producer-tags/sounds/my-tag.wav', isCopy: true } })
    expect(host.runs.find(r => r.argv[0] === 'sh')?.env).toEqual({
      PT_DIR: '/home/dev/.claude/producer-tags/sounds',
      PT_SRC: '/home/dev/Music/My Tag.wav',
      PT_DST: '/home/dev/.claude/producer-tags/sounds/my-tag.wav',
    })
    expect(host.stored.get('imports')).toHaveLength(1)
    expect(await deleteImport(host, 'user:my-tag')).toBe(true)
    expect(host.runs.at(-1)?.argv).toEqual(['rm', '-f', '--', '/home/dev/.claude/producer-tags/sounds/my-tag.wav'])
    expect(host.stored.get('imports')).toEqual([])
  })
  test('a failed copy keeps the original with a warning; a missing file is an inline error', async () => {
    const host = fakeHost({ run: argv => (argv[0] === 'uname' ? { stdout: 'Darwin\n' } : { exitCode: argv[0] === 'sh' ? 1 : 0 }), files: { '/a/x.wav': { base64: EMPTY_WAV } } })
    expect(await importSound(host, '/a/x.wav')).toMatchObject({ ok: true, warning: COPY_WARNING, sound: { file: '/a/x.wav', isCopy: false } })
    expect(await importSound(host, '/a/none.wav')).toEqual({ ok: false, error: 'No file at /a/none.wav.' })
  })
})
