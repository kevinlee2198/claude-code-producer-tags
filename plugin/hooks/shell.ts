/** Best-effort shell reading: enough to find which commands a Bash call ran and how they were joined. */

export type Op = '&&' | '||' | '|' | '|&' | ';' | '&'
export type Segment = { words: string[]; op: Op | null }

const HEREDOC = /(?<!<)<<(?!<)(-?)\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/g

/** Drops heredoc bodies (and their terminator lines), keeping the line that opened them. */
export function stripHeredocs(command: string): string {
  const out: string[] = []
  const pending: string[] = []
  for (const line of command.split('\n')) {
    if (pending.length > 0) {
      if (line.trim() === pending[0]) pending.shift()
      continue
    }
    out.push(line)
    for (const match of line.matchAll(HEREDOC)) pending.push(match[3]!)
  }
  return out.join('\n')
}

function indexOrEnd(src: string, char: string, from: number): number {
  const at = src.indexOf(char, from)
  return at < 0 ? src.length : at
}

function readUntil(src: string, from: number, close: string): number {
  let i = from
  while (i < src.length && src[i] !== close) i += src[i] === '\\' ? 2 : 1
  return Math.min(i, src.length)
}

/** `from` is at the `(` after `$`; returns the index just past the matching `)`. */
function readSubstitution(src: string, from: number): number {
  let depth = 0
  let i = from
  while (i < src.length) {
    const c = src[i]
    if (c === '\\') i += 2
    else if (c === "'") i = indexOrEnd(src, "'", i + 1) + 1
    else if (c === '"') i = readDouble(src, i + 1) + 1
    else {
      if (c === '(') depth++
      if (c === ')' && --depth === 0) return i + 1
      i++
    }
  }
  return src.length
}

/** `from` is just inside a `"`; returns the index of the closing `"`. */
function readDouble(src: string, from: number): number {
  let i = from
  while (i < src.length) {
    const c = src[i]
    if (c === '\\') i += 2
    else if (c === '"') return i
    else if (c === '$' && src[i + 1] === '(') i = readSubstitution(src, i + 1)
    else if (c === '`') i = readUntil(src, i + 1, '`') + 1
    else i++
  }
  return src.length
}

export function splitCommand(command: string): Segment[] {
  const src = stripHeredocs(command)
  const segments: Segment[] = []
  let words: string[] = []
  let word = ''
  let isInWord = false
  const endWord = () => {
    if (isInWord) words.push(word)
    word = ''
    isInWord = false
  }
  const endSegment = (op: Op | null) => {
    endWord()
    const kept = words.filter(w => w !== '{' && w !== '}')
    if (kept.length > 0) segments.push({ words: kept, op })
    words = []
  }
  const take = (text: string) => {
    word += text
    isInWord = true
  }

  let i = 0
  while (i < src.length) {
    const c = src[i]!
    const next = src[i + 1]
    if (c === '\\') {
      if (next === '\n' || (next === '\r' && src[i + 2] === '\n')) {
        i += next === '\n' ? 2 : 3
        continue
      }
      if (next !== undefined) take(next)
      i += 2
    } else if (c === "'") {
      const end = indexOrEnd(src, "'", i + 1)
      take(src.slice(i + 1, end))
      i = end + 1
    } else if (c === '$' && next === "'") {
      const end = readUntil(src, i + 2, "'")
      take(src.slice(i + 2, end))
      i = end + 1
    } else if (c === '"') {
      const end = readDouble(src, i + 1)
      take(src.slice(i + 1, end))
      i = end + 1
    } else if (c === '$' && next === '(') {
      const end = readSubstitution(src, i + 1)
      take(src.slice(i, end))
      i = end
    } else if (c === '`') {
      const end = readUntil(src, i + 1, '`')
      take(src.slice(i, end + 1))
      i = end + 1
    } else if (c === ' ' || c === '\t' || c === '\r') {
      endWord()
      i++
    } else if (c === '\n' || c === ';') {
      endSegment(';')
      i++
    } else if (c === '&') {
      if (next === '&') {
        endSegment('&&')
        i += 2
      } else if (next === '>' || word.endsWith('>') || word.endsWith('<')) {
        take(c)
        i++
      } else {
        endSegment('&')
        i++
      }
    } else if (c === '|') {
      if (next === '|') {
        endSegment('||')
        i += 2
      } else if (next === '&') {
        endSegment('|&')
        i += 2
      } else {
        endSegment('|')
        i++
      }
    } else if (c === '(' || c === ')') {
      endWord()
      i++
    } else {
      take(c)
      i++
    }
  }
  endSegment(null)
  return segments
}

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

/** Wrapper commands and which of their flags take a value. A Map, so names like `toString` never match. */
const WRAPPERS = new Map<string, readonly string[]>([
  ['env', ['-u', '-C', '-S']],
  ['sudo', ['-u', '-g', '-p', '-C', '-D', '-h']],
  ['nice', ['-n']],
  ['timeout', ['-s', '-k']],
  ['exec', ['-a']],
  ['time', []],
  ['nohup', []],
  ['command', []],
])

/** Drops `VAR=x` assignments and wrapper commands with their flags (and `timeout`'s duration). */
export function stripPrefixes(words: readonly string[]): string[] {
  let i = 0
  while (i < words.length) {
    const word = words[i]!
    if (ASSIGNMENT.test(word)) {
      i++
      continue
    }
    const valueFlags = WRAPPERS.get(word)
    if (valueFlags === undefined) break
    i++
    while (i < words.length && words[i]!.startsWith('-')) i += valueFlags.includes(words[i]!) ? 2 : 1
    if (word === 'timeout') i++
  }
  return words.slice(i)
}

const SHELLS = new Set(['bash', 'sh', 'zsh'])

/** Segments with prefixes stripped; `bash|sh|zsh -c "…"` is read one level deep. */
export function commandSegments(command: string, depth = 0): Segment[] {
  return splitCommand(command).flatMap((segment): Segment[] => {
    const words = stripPrefixes(segment.words)
    if (words.length === 0) return []
    if (depth === 0 && SHELLS.has(words[0]!) && words[1] === '-c' && words[2] !== undefined) {
      const inner = commandSegments(words[2], 1)
      if (inner.length > 0) return [...inner.slice(0, -1), { ...inner[inner.length - 1]!, op: segment.op }]
    }
    return [{ words, op: segment.op }]
  })
}

export function startsWithTokens(words: readonly string[], tokens: readonly string[]): boolean {
  return tokens.every((token, i) => words[i] === token)
}
