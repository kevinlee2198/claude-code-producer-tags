import { describe, expect, test } from 'claude-code/testing'

import { decodeBase64, encodeBase64, encodeUtf16LeBase64 } from '../hooks/codec'

const bytes = (...values: number[]) => new Uint8Array(values)

describe('codec', () => {
  test('encodes with padding', () => {
    expect(encodeBase64(bytes())).toBe('')
    expect(encodeBase64(bytes(0x66))).toBe('Zg==')
    expect(encodeBase64(bytes(0x66, 0x6f))).toBe('Zm8=')
    expect(encodeBase64(bytes(0x66, 0x6f, 0x6f))).toBe('Zm9v')
    expect(encodeBase64(bytes(0xff, 0x00, 0xfe, 0x01))).toBe('/wD+AQ==')
  })

  test('decodes what it encodes, ignoring whitespace', () => {
    const original = new Uint8Array(1000).map((_, i) => (i * 37) % 256)
    const text = encodeBase64(original)
    expect([...decodeBase64(text)]).toEqual([...original])
    expect([...decodeBase64('Zm9v\nYmFy')]).toEqual([...new TextEncoder().encode('foobar')])
  })

  test('UTF-16LE base64 matches what powershell -EncodedCommand expects', () => {
    expect(encodeUtf16LeBase64('ab')).toBe('YQBiAA==')
    expect(encodeUtf16LeBase64('$env:X')).toBe('JABlAG4AdgA6AFgA')
  })
})
