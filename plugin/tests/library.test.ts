import { describe, expect, test } from 'claude-code/testing'

import { CATALOG } from '../hooks/catalog'
import { allowedExts, basename, extOf, padSounds, parseWav, resolveSound, slugify, soundOptions } from '../hooks/library'
import type { ImportedSound } from '../types'

/** A WAV with `frames` frames of the given format, optionally with a LIST chunk (odd size) before data. */
function wav(options: { format?: number; bits: number; channels?: number; rate?: number; frames: number; list?: boolean; extensible?: boolean }): Uint8Array {
  const channels = options.channels ?? 1
  const rate = options.rate ?? 22050
  const blockAlign = channels * (options.bits / 8)
  const dataBytes = options.frames * blockAlign
  const fmtSize = options.extensible ? 40 : 16
  const listBody = options.list ? 5 : 0
  const listBytes = options.list ? 8 + listBody + 1 : 0
  const total = 12 + 8 + fmtSize + listBytes + 8 + dataBytes
  const view = new DataView(new ArrayBuffer(total))
  const tag = (offset: number, text: string) => [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)))
  tag(0, 'RIFF'); view.setUint32(4, total - 8, true); tag(8, 'WAVE')
  tag(12, 'fmt '); view.setUint32(16, fmtSize, true)
  view.setUint16(20, options.extensible ? 0xfffe : (options.format ?? 1), true)
  view.setUint16(22, channels, true); view.setUint32(24, rate, true)
  view.setUint32(28, rate * blockAlign, true); view.setUint16(32, blockAlign, true); view.setUint16(34, options.bits, true)
  if (options.extensible) { view.setUint16(36, 22, true); view.setUint16(44, options.format ?? 1, true) }
  let offset = 20 + fmtSize
  if (options.list) { tag(offset, 'LIST'); view.setUint32(offset + 4, listBody, true); offset += 8 + listBody + 1 }
  tag(offset, 'data'); view.setUint32(offset + 4, dataBytes, true)
  const data = offset + 8
  for (let f = 0; f < options.frames; f++) {
    const value = f < options.frames / 2 ? 0.5 : 0.25
    const at = data + f * blockAlign
    if ((options.format ?? 1) === 3) view.setFloat32(at, value, true)
    else if (options.bits === 8) view.setUint8(at, Math.round(128 + value * 127))
    else if (options.bits === 16) view.setInt16(at, Math.round(value * 32767), true)
    else { const v = Math.round(value * 8388607); view.setUint8(at, v & 0xff); view.setUint8(at + 1, (v >> 8) & 0xff); view.setInt8(at + 2, v >> 16) }
  }
  return new Uint8Array(view.buffer)
}

describe('parseWav', () => {
  for (const [label, options] of [
    ['16-bit mono', { bits: 16, frames: 22050 }],
    ['8-bit', { bits: 8, frames: 22050 }],
    ['24-bit stereo', { bits: 24, channels: 2, frames: 22050 }],
    ['float32', { format: 3, bits: 32, frames: 22050 }],
    ['extensible with an odd LIST chunk', { bits: 16, frames: 22050, extensible: true, list: true }],
  ] as const) {
    test(label, () => {
      const info = parseWav(wav(options))
      expect(info?.durationMs).toBe(1000)
      expect(info?.peaks).toHaveLength(64)
      expect(info?.peaks[0]).toBe(1)
      expect(info?.peaks[63]).toBe(0.5)
    })
  }
  test('not a WAV, or an unsupported format', () => {
    expect(parseWav(new Uint8Array([1, 2, 3]))).toBeNull()
    expect(parseWav(wav({ format: 2, bits: 4, frames: 0 }))).toBeNull()
  })
})

describe('names and formats', () => {
  test('extOf, basename', () => {
    expect(extOf('/x/My Tag.WAV')).toBe('wav')
    expect(extOf('C:\\a\\b.aif')).toBe('aiff')
    expect(extOf('/x/notes.txt')).toBeNull()
    expect(basename('C:\\Users\\me\\tag.mp3')).toBe('tag.mp3')
    expect(basename('/home/me/My Tags/x.wav')).toBe('x.wav')
  })
  test('slugify: lowercase, dashes, 40 chars, reserved names, case-insensitive collisions', () => {
    expect(slugify('My Tag (final) v2.wav', new Set())).toBe('my-tag-final-v2')
    expect(slugify('Mi tag ✨ (final).wav', new Set())).toBe('mi-tag-final')
    expect(slugify('✨✨.mp3', new Set())).toBe('sound')
    expect(slugify('CON.wav', new Set())).toBe('con-1')
    expect(slugify('x'.repeat(60) + '.wav', new Set())).toHaveLength(40)
    expect(slugify('Tag.wav', new Set(['TAG', 'tag-2']))).toBe('tag-3')
  })
  test('allowed formats per platform', () => {
    expect(allowedExts('mac', 'audio')).toEqual(['wav', 'mp3', 'm4a', 'aiff'])
    expect(allowedExts('windows', 'powershell')).toEqual(['wav', 'mp3'])
    expect(allowedExts('linux', 'aplay')).toEqual(['wav'])
    expect(allowedExts('linux', 'pw-play')).toEqual(['wav', 'aiff'])
    expect(allowedExts('linux', 'ffplay')).toEqual(['wav', 'mp3', 'm4a', 'aiff'])
  })
})

describe('resolving sounds', () => {
  const mine: ImportedSound = { id: 'user:mine', name: 'mine', file: '/s/mine.mp3', ext: 'mp3', bytes: 10, durationMs: null, peaks: null, isCopy: true }
  test('bundled sounds resolve to assets; imports to files; unknown to null', () => {
    const first = CATALOG[0]!
    expect(resolveSound(first.id, [])).toMatchObject({ id: first.id, source: { kind: 'asset', asset: first.file } })
    expect(resolveSound('user:mine', [mine])).toMatchObject({ caption: 'mine', source: { kind: 'file', path: '/s/mine.mp3', ext: 'mp3' } })
    expect(resolveSound('user:gone', [mine])).toBeNull()
  })
  test('options list bundled then imports; pads are the first nine voice tags', () => {
    const options = soundOptions([mine])
    expect(options[0]!.value).toBe(CATALOG[0]!.id)
    expect(options[options.length - 1]).toEqual({ value: 'user:mine', label: 'mine (yours)' })
    expect(padSounds()).toHaveLength(9)
    expect(padSounds().every(id => CATALOG.find(c => c.id === id)?.isVoice)).toBe(true)
  })
})
