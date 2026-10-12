const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const LOOKUP = new Int16Array(128).fill(-1)
for (let i = 0; i < ALPHABET.length; i++) LOOKUP[ALPHABET.charCodeAt(i)] = i

/** Standard padded base64 (the environment's Uint8Array helpers are not declared in this build). */
export function encodeBase64(bytes: Uint8Array): string {
  const parts: string[] = []
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0)
    parts.push(
      ALPHABET[(n >> 18) & 63]!,
      ALPHABET[(n >> 12) & 63]!,
      b === undefined ? '=' : ALPHABET[(n >> 6) & 63]!,
      c === undefined ? '=' : ALPHABET[n & 63]!,
    )
  }
  return parts.join('')
}

export function decodeBase64(text: string): Uint8Array {
  const out = new Uint8Array(Math.floor((text.length * 3) / 4) + 3)
  let buffer = 0
  let bits = 0
  let length = 0
  for (let i = 0; i < text.length; i++) {
    const value = LOOKUP[text.charCodeAt(i)] ?? -1
    if (value < 0) continue
    buffer = ((buffer << 6) | value) & 0xffffff
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[length++] = (buffer >> bits) & 0xff
    }
  }
  return out.slice(0, length)
}

/** What `powershell.exe -EncodedCommand` takes: the script as UTF-16LE, base64. */
export function encodeUtf16LeBase64(text: string): string {
  const bytes = new Uint8Array(text.length * 2)
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    bytes[i * 2] = code & 0xff
    bytes[i * 2 + 1] = code >> 8
  }
  return encodeBase64(bytes)
}
