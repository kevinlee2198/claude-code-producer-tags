/**
 * A linear-time matcher for custom triggers. It parses a subset of JavaScript regex syntax, compiles it to a
 * Thompson NFA and runs that as a set of states, so a test costs at most O(text length × states) whatever the
 * pattern. It matches as RegExp with only the i flag does: an unanchored search over UTF-16 code units, comparing
 * characters by their canonical case.
 */

export type Matcher = { test(text: string): boolean }
export type CompileResult = { ok: true; matcher: Matcher } | { ok: false; error: 'syntax' | 'unsupported'; detail: string }

/** The most states a pattern may compile to, which bounds a test of MAX_MATCH_INPUT characters. */
const MAX_STATES = 2000
const MAX_CODE = 0xffff

class Refusal {
  readonly error: 'syntax' | 'unsupported'
  readonly detail: string

  constructor(error: 'syntax' | 'unsupported', detail: string) {
    this.error = error
    this.detail = detail
  }
}
const syntax = (detail: string) => new Refusal('syntax', detail)
const unsupported = (detail: string) => new Refusal('unsupported', detail)

/** RegExp's Canonicalize for i without u: the upper case, unless that is several units or turns non-ASCII into ASCII. */
function canonical(code: number): number {
  const upper = String.fromCharCode(code).toUpperCase()
  if (upper.length !== 1) return code
  const folded = upper.charCodeAt(0)
  return code >= 128 && folded < 128 ? code : folded
}

let wideGroups: Map<number, number[]> | null = null

/** Every code unit with the same canonical form as `code`; the non-ASCII table is built on first use. */
function equivalents(code: number): readonly number[] {
  if (code < 128) {
    const lower = code | 0x20
    return lower >= 97 && lower <= 122 ? [lower & ~0x20, lower] : [code]
  }
  if (wideGroups === null) {
    const groups = new Map<number, number[]>()
    for (let c = 128; c <= MAX_CODE; c++) {
      const key = canonical(c)
      if (key === c) continue
      const group = groups.get(key)
      if (group === undefined) groups.set(key, [c])
      else group.push(c)
    }
    for (const [key, group] of groups) if (canonical(key) === key) group.push(key)
    wideGroups = groups
  }
  return wideGroups.get(canonical(code)) ?? [code]
}

/** Sorted, merged [lo, hi] pairs of code units. */
type Ranges = readonly number[]

function normalize(pairs: readonly number[]): number[] {
  const sorted: [number, number][] = []
  for (let i = 0; i < pairs.length; i += 2) sorted.push([pairs[i]!, pairs[i + 1]!])
  sorted.sort((a, b) => a[0] - b[0])
  const merged: number[] = []
  for (const [lo, hi] of sorted) {
    const last = merged.length - 1
    if (last > 0 && lo <= merged[last]! + 1) merged[last] = Math.max(merged[last]!, hi)
    else merged.push(lo, hi)
  }
  return merged
}

function complement(ranges: Ranges): number[] {
  const out: number[] = []
  let from = 0
  for (let i = 0; i < ranges.length; i += 2) {
    if (ranges[i]! > from) out.push(from, ranges[i]! - 1)
    from = ranges[i + 1]! + 1
  }
  if (from <= MAX_CODE) out.push(from, MAX_CODE)
  return out
}

const DIGIT: Ranges = [0x30, 0x39]
const WORD: Ranges = [0x30, 0x39, 0x41, 0x5a, 0x5f, 0x5f, 0x61, 0x7a]
/** JavaScript's WhiteSpace and LineTerminator. */
const SPACE: Ranges = normalize([
  0x09, 0x0d, 0x20, 0x20, 0xa0, 0xa0, 0x1680, 0x1680, 0x2000, 0x200a,
  0x2028, 0x2029, 0x202f, 0x202f, 0x205f, 0x205f, 0x3000, 0x3000, 0xfeff, 0xfeff,
])
const LINE_TERMINATORS: Ranges = [0x0a, 0x0a, 0x0d, 0x0d, 0x2028, 0x2029]

const isWordCode = (c: number) => (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || c === 0x5f || (c >= 0x61 && c <= 0x7a)

/** A character class, matched as RegExp's CharacterSetMatcher does: some member has the character's canonical form. */
class CharSet {
  private readonly ranges: Ranges
  private readonly isNegated: boolean
  private readonly ascii = new Uint8Array(128)
  private readonly wide = new Map<number, boolean>()

  constructor(ranges: Ranges, isNegated: boolean) {
    this.ranges = ranges
    this.isNegated = isNegated
    for (let c = 0; c < 128; c++) this.ascii[c] = this.found(c) ? 1 : 0
  }

  private found(code: number): boolean {
    const hit = equivalents(code).some(member => {
      for (let i = 0; i < this.ranges.length; i += 2) if (member >= this.ranges[i]! && member <= this.ranges[i + 1]!) return true
      return false
    })
    return hit !== this.isNegated
  }

  has(code: number): boolean {
    if (code < 128) return this.ascii[code] === 1
    let hit = this.wide.get(code)
    if (hit === undefined) this.wide.set(code, (hit = this.found(code)))
    return hit
  }
}

const literal = (code: number) => new CharSet([code, code], false)
const DOT = new CharSet(complement(LINE_TERMINATORS), false)

const START = 0
const END = 1
const BOUNDARY = 2
const NON_BOUNDARY = 3

type Node =
  | { kind: 'set'; set: CharSet }
  | { kind: 'assert'; assertion: number }
  | { kind: 'seq'; items: Node[] }
  | { kind: 'alt'; items: Node[] }
  | { kind: 'repeat'; item: Node; min: number; max: number }

function shorthand(letter: string): Ranges | null {
  switch (letter) {
    case 'd': return DIGIT
    case 'D': return complement(DIGIT)
    case 'w': return WORD
    case 'W': return complement(WORD)
    case 's': return SPACE
    case 'S': return complement(SPACE)
    default: return null
  }
}

/** A recursive-descent parser for the supported subset, following the Annex B (non-u) grammar where they differ. */
class Parser {
  private readonly source: string
  private at = 0

  constructor(source: string) {
    this.source = source
  }

  parse(): Node {
    const node = this.alternation()
    if (this.at < this.source.length) throw syntax('unmatched )')
    return node
  }

  private peek(offset = 0): string | undefined {
    return this.source[this.at + offset]
  }

  private alternation(): Node {
    const items = [this.sequence()]
    while (this.peek() === '|') {
      this.at++
      items.push(this.sequence())
    }
    return items.length === 1 ? items[0]! : { kind: 'alt', items }
  }

  private sequence(): Node {
    const items: Node[] = []
    while (this.at < this.source.length && this.peek() !== '|' && this.peek() !== ')') items.push(this.quantified())
    return { kind: 'seq', items }
  }

  private quantified(): Node {
    const item = this.atom()
    const bounds = this.quantifier()
    if (bounds === null) return item
    if (item.kind === 'assert') throw syntax('nothing to repeat')
    // A lazy repeat matches the same strings, and a test only asks whether there is a match.
    if (this.peek() === '?') this.at++
    return { kind: 'repeat', item, ...bounds }
  }

  /** `{n}`, `{n,}` or `{n,m}` at `at`; anything else there is literal text, as in Annex B. */
  private braces(at: number): { length: number; min: number; max: number } | null {
    const found = /^\{(\d+)(,(\d*))?\}/.exec(this.source.slice(at))
    if (found === null) return null
    const min = Number(found[1])
    const max = found[2] === undefined ? min : found[3] === '' ? Infinity : Number(found[3])
    if (min > max) throw syntax('numbers out of order in {} quantifier')
    return { length: found[0].length, min, max }
  }

  private quantifier(): { min: number; max: number } | null {
    const c = this.peek()
    const simple = c === '*' ? { min: 0, max: Infinity } : c === '+' ? { min: 1, max: Infinity } : c === '?' ? { min: 0, max: 1 } : null
    if (simple !== null) {
      this.at++
      return simple
    }
    const braces = c === '{' ? this.braces(this.at) : null
    if (braces === null) return null
    this.at += braces.length
    return { min: braces.min, max: braces.max }
  }

  private atom(): Node {
    const c = this.source[this.at++]!
    switch (c) {
      case '(': return this.group()
      case '[': return this.characterClass()
      case '.': return { kind: 'set', set: DOT }
      case '^': return { kind: 'assert', assertion: START }
      case '$': return { kind: 'assert', assertion: END }
      case '\\': return this.atomEscape()
      case '*':
      case '+':
      case '?':
        throw syntax('nothing to repeat')
      case '{':
        if (this.braces(this.at - 1) !== null) throw syntax('nothing to repeat')
    }
    return { kind: 'set', set: literal(c.charCodeAt(0)) }
  }

  private group(): Node {
    if (this.peek() === '?') {
      const next = this.peek(1)
      if (next === '=' || next === '!') throw unsupported('lookarounds')
      if (next === '<') throw unsupported(this.peek(2) === '=' || this.peek(2) === '!' ? 'lookarounds' : 'named groups')
      if (next !== ':') throw /^[ims]*(-[ims]*)?:/.test(this.source.slice(this.at + 1)) ? unsupported('inline flags') : syntax('invalid group')
      this.at += 2
    }
    const node = this.alternation()
    if (this.peek() !== ')') throw syntax('unterminated group')
    this.at++
    return node
  }

  private atomEscape(): Node {
    const c = this.source[this.at++]
    if (c === undefined) throw syntax('\\ at end of pattern')
    if (c === 'b') return { kind: 'assert', assertion: BOUNDARY }
    if (c === 'B') return { kind: 'assert', assertion: NON_BOUNDARY }
    const ranges = shorthand(c)
    if (ranges !== null) return { kind: 'set', set: new CharSet(ranges, false) }
    if (c >= '1' && c <= '9') throw unsupported('backreferences')
    return { kind: 'set', set: literal(this.characterEscape(c)) }
  }

  private hex(digits: number): number | null {
    const text = this.source.slice(this.at, this.at + digits)
    if (text.length !== digits || !/^[0-9a-fA-F]+$/.test(text)) return null
    this.at += digits
    return parseInt(text, 16)
  }

  /** The code unit an escape outside the shorthands stands for, `c` being the character after the backslash. */
  private characterEscape(c: string): number {
    switch (c) {
      case 't': return 0x09
      case 'n': return 0x0a
      case 'v': return 0x0b
      case 'f': return 0x0c
      case 'r': return 0x0d
      case '0':
        if (!/[0-9]/.test(this.peek() ?? '')) return 0
        throw unsupported('octal escapes')
      case 'c': {
        const letter = this.peek() ?? ''
        if (!/^[A-Za-z]$/.test(letter)) break
        this.at++
        return letter.charCodeAt(0) % 32
      }
      case 'x':
      case 'u': {
        const code = this.hex(c === 'x' ? 2 : 4)
        if (code !== null) return code
        break
      }
      case 'k': throw unsupported('backreferences')
      case 'p':
      case 'P':
        throw unsupported('Unicode property escapes')
    }
    if (/[A-Za-z0-9]/.test(c)) throw unsupported(`the \\${c} escape`)
    return c.charCodeAt(0)
  }

  private characterClass(): Node {
    const isNegated = this.peek() === '^'
    if (isNegated) this.at++
    const pairs: number[] = []
    const add = (atom: number | Ranges) => (typeof atom === 'number' ? pairs.push(atom, atom) : pairs.push(...atom))
    for (;;) {
      const c = this.peek()
      if (c === undefined) throw syntax('unterminated character class')
      if (c === ']') break
      const first = this.classAtom()
      if (this.peek() !== '-' || this.peek(1) === undefined || this.peek(1) === ']') {
        add(first)
        continue
      }
      this.at++
      const second = this.classAtom()
      if (typeof first === 'number' && typeof second === 'number') {
        if (first > second) throw syntax('range out of order in character class')
        pairs.push(first, second)
      } else {
        // A range with a shorthand at either end is the two ends and a literal -, as in Annex B.
        add(first)
        add(0x2d)
        add(second)
      }
    }
    this.at++
    return { kind: 'set', set: new CharSet(normalize(pairs), isNegated) }
  }

  private classAtom(): number | Ranges {
    const c = this.source[this.at++]!
    if (c !== '\\') return c.charCodeAt(0)
    const e = this.source[this.at++]
    if (e === undefined) throw syntax('\\ at end of pattern')
    if (e === 'b') return 0x08
    if (e === '-') return 0x2d
    if (e >= '1' && e <= '9') throw unsupported('octal escapes')
    return shorthand(e) ?? this.characterEscape(e)
  }
}

const CHAR = 0
const SPLIT = 1
const ASSERT = 2
const MATCH = 3

type Nfa = { kind: Uint8Array; out: Int32Array; alt: Int32Array; sets: (CharSet | null)[]; start: number }

/**
 * Compiles the tree back to front, so each piece is built knowing its continuation. A CHAR state reads one character
 * into `out`; a SPLIT goes to both `out` and `alt`; an ASSERT goes to `out` when assertion `alt` holds.
 */
class Builder {
  readonly kind: number[] = [MATCH]
  readonly out: number[] = [-1]
  readonly alt: number[] = [-1]
  readonly sets: (CharSet | null)[] = [null]

  private add(kind: number, out: number, alt: number, set: CharSet | null): number {
    if (this.kind.length >= MAX_STATES) throw unsupported('too many repeats')
    this.kind.push(kind)
    this.out.push(out)
    this.alt.push(alt)
    this.sets.push(set)
    return this.kind.length - 1
  }

  compile(node: Node, next: number): number {
    switch (node.kind) {
      case 'set':
        return this.add(CHAR, next, -1, node.set)
      case 'assert':
        return this.add(ASSERT, next, node.assertion, null)
      case 'seq':
        return node.items.reduceRight((start, item) => this.compile(item, start), next)
      case 'alt': {
        let start = this.compile(node.items[node.items.length - 1]!, next)
        for (let i = node.items.length - 2; i >= 0; i--) start = this.add(SPLIT, this.compile(node.items[i]!, next), start, null)
        return start
      }
      case 'repeat':
        return this.repeat(node.item, node.min, node.max, next)
    }
  }

  /** Copies the item once per required repeat and nests the optional ones: x{2,4} is x x (x (x)?)?. */
  private repeat(item: Node, min: number, max: number, next: number): number {
    let start = next
    let copies = min
    if (max === Infinity) {
      const loop = this.add(SPLIT, -1, next, null)
      const body = this.compile(item, loop)
      this.out[loop] = body
      start = min > 0 ? body : loop
      copies = min - 1
    } else {
      for (let i = min; i < max; i++) start = this.add(SPLIT, this.compile(item, start), next, null)
    }
    for (let i = 0; i < copies; i++) {
      const size = this.kind.length
      start = this.compile(item, start)
      // An item that compiles to nothing matches only the empty string, so more copies change nothing.
      if (this.kind.length === size) break
    }
    return start
  }
}

function build(node: Node): Nfa {
  const builder = new Builder()
  const start = builder.compile(node, 0)
  return {
    kind: Uint8Array.from(builder.kind),
    out: Int32Array.from(builder.out),
    alt: Int32Array.from(builder.alt),
    sets: builder.sets,
    start,
  }
}

/** Runs the NFA over every position at once, keeping each state at most once per position. */
function search(nfa: Nfa, text: string): boolean {
  const { kind, out, alt, sets, start } = nfa
  const size = kind.length
  const addedAt = new Int32Array(size).fill(-1)
  const stack = new Int32Array(size)
  let current = new Int32Array(size)
  let next = new Int32Array(size)
  let list = current
  let count = 0
  const isWordAt = (i: number) => i >= 0 && i < text.length && isWordCode(text.charCodeAt(i))
  const holds = (assertion: number, pos: number) => {
    switch (assertion) {
      case START: return pos === 0
      case END: return pos === text.length
      case BOUNDARY: return isWordAt(pos - 1) !== isWordAt(pos)
      default: return isWordAt(pos - 1) === isWordAt(pos)
    }
  }

  /** Adds `state` and what it reaches without reading to `list` at `pos`; true once that reaches MATCH. */
  let top = 0
  const push = (state: number, pos: number) => {
    if (addedAt[state] === pos) return
    addedAt[state] = pos
    stack[top++] = state
  }
  const close = (state: number, pos: number): boolean => {
    top = 0
    push(state, pos)
    while (top > 0) {
      const s = stack[--top]!
      const k = kind[s]
      if (k === MATCH) return true
      if (k === CHAR) {
        list[count++] = s
      } else if (k === SPLIT) {
        push(alt[s]!, pos)
        push(out[s]!, pos)
      } else if (holds(alt[s]!, pos)) {
        push(out[s]!, pos)
      }
    }
    return false
  }

  for (let pos = 0; ; pos++) {
    if (close(start, pos)) return true
    if (pos === text.length) return false
    const code = text.charCodeAt(pos)
    const reading = current
    const total = count
    list = next
    count = 0
    for (let i = 0; i < total; i++) {
      const s = reading[i]!
      if (sets[s]!.has(code) && close(out[s]!, pos + 1)) return true
    }
    current = next
    next = reading
  }
}

export function compileMatcher(pattern: string): CompileResult {
  try {
    const nfa = build(new Parser(pattern).parse())
    return { ok: true, matcher: { test: text => search(nfa, text) } }
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, error: error.error, detail: error.detail }
    throw error
  }
}
