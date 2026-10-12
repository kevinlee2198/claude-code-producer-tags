import { describe, expect, test } from 'claude-code/testing'

import { compileMatcher, type Matcher } from '../hooks/match'

function matcher(pattern: string): Matcher {
  const result = compileMatcher(pattern)
  if (!result.ok) throw new Error(`${pattern} did not compile: ${result.error} (${result.detail})`)
  return result.matcher
}

// Every pattern here is safe for RegExp on these short inputs, so RegExp is the oracle.
const PATTERNS = [
  'docker compose up', 'npm (run )?build', '^deploy\\b', 'git (commit|push)',
  'abc', 'ABC', 'a.c', '^.$', '...', '[abc]', '[a-c]+', '[^a-c]', '[A-Z]', '[^A-Z]', '[a-z0-9_-]+$', '[Z-a]', '[]', '[^]',
  '\\d', '\\D', '\\d+', '\\w+', '\\W', '\\s', '\\S+', '[\\d.]+', '[^\\w]', '[\\s\\S]', '[\\d-z]', '[\\W\\d]',
  '\\bgit\\b', '\\Bit', 'it\\B', '\\b', '\\B', '^$', '^', '$', 'x$', '^\\s*$',
  'a|b|c', 'ab|cd', '(a|b)(c|d)', '((a)|b)+c', '(?:ab)+', '(?:x(?:y|z))*w', '()', 'a||b',
  'a?b', 'a*b', 'a+b', 'a{2}', 'a{2,}', 'a{1,3}b', '^a{2,3}$', 'a{0}b', '(ab){2}', '(a|bc){1,2}$',
  'a??b', 'a*?b', 'a+?b', 'a{1,3}?b', 'a{2,}?c',
  '\\.', '\\/', '\\(\\)', '\\[\\]', '\\{\\}', '\\*\\+\\?', '\\|', '\\^\\$', '\\-', '\\\\', 'a\\tb', 'a\\nb', '\\r', '\\x41', '\\u00e9', '\\cJ', '\\0',
  'a{', '{', 'x{1,', 'a{,3}', ']', '}', 'a{x}', '[\\b]', '[\\-a]', '[a-]', '[-a]', '[a-b-c]', '[.]', '[\\]]', '[\\\\]',
  'é', 'É', '[à-ö]+', 'σ', '[ς]', 'k', 'K', 's', 'ß', '[^k]', '\\u212a',
]

const INPUTS = [
  '', 'a', 'A', 'b', 'ab', 'aab', 'aaab', 'abc', 'ABC', 'aBc', 'xyz', 'c', 'cd', 'acd', 'bcbcc', 'abab',
  'docker compose up -d', 'DOCKER COMPOSE UP', 'npm run build', 'npm build', 'npm runbuild', 'deploy prod', 'deployment', ' deploy',
  'git commit -m x', 'git push', 'gitpush', 'it is', 'bit', 'git', 'w', 'xw', 'xyw', 'xzyw',
  '123', 'v1.2.3', '_', '-', ' ', '\t', '\n', '\r', 'a\tb', 'a\nb', 'line sep', ' ', 'x　y', '\u0000',
  '.', '/', '()', '[]', '{}', '*+?', '|', '^$', '\\', 'a{', 'x{1,', 'a{,3}', 'a{x}', ']', '}', '\b', 'Z', '[', '`', '^_',
  'é', 'É', 'ü', 'Ü', 'σ', 'Σ', 'ς', 'k', 'K', 'K', 's', 'S', 'ſ', 'ß', 'ẞ', 'aa', 'aaa', 'aaaa', 'aaaaa', 'bcbc',
]

// The answer for 'a'.repeat(2048) + '!' is derived by hand, never from RegExp, which backtracks for seconds on these.
// The input has no x or b, and it ends in '!', which nothing before a $ can consume; so every pattern fails except
// (\w+\s?)*$, whose group may repeat zero times, matching empty at the very end.
const HANGS: readonly (readonly [string, boolean])[] = [
  ['(a+)+$', false], ['(.*)*x', false], ['(a|aa)+$', false], ['((a|aa))+$', false], ['(a{1,5})+$', false],
  ['(a+){1,50}$', false], ['(a+){3}$', false], ['a+a+a+$', false], ['a*a*a*a*a*b', false], ['.*.*.*x', false],
  ['(\\w+\\s?)*$', true],
]

describe('compileMatcher agrees with RegExp', () => {
  test('a corpus of supported patterns against many inputs, case-insensitively', () => {
    expect(PATTERNS.length).toBeGreaterThanOrEqual(40)
    const mismatches: string[] = []
    for (const pattern of PATTERNS) {
      const ours = matcher(pattern)
      const theirs = new RegExp(pattern, 'i')
      for (const input of INPUTS) {
        if (ours.test(input) !== theirs.test(input)) mismatches.push(`/${pattern}/i on ${JSON.stringify(input)}`)
      }
    }
    expect(mismatches).toEqual([])
  })
  test('the search is unanchored and case-insensitive', () => {
    expect(matcher('compose').test('docker COMPOSE up')).toBe(true)
    expect(matcher('[A-Z]').test('a')).toBe(true)
    expect(matcher('[A-Z]').test('A')).toBe(true)
    expect(matcher('[a-z]').test('Q')).toBe(true)
    expect(matcher('^deploy\\b').test('deployment')).toBe(false)
  })
})

describe('compileMatcher stays linear', () => {
  test('patterns that hang RegExp finish fast with the right answer', () => {
    const input = `${'a'.repeat(2048)}!`
    for (const [pattern, expected] of HANGS) {
      const m = matcher(pattern)
      const start = Date.now()
      const result = m.test(input)
      const elapsed = Date.now() - start
      expect({ pattern, result }).toEqual({ pattern, result: expected })
      expect(elapsed).toBeLessThan(250)
    }
  })
  test('a pattern near the state cap finishes fast on the longest input', () => {
    const m = matcher('(?:[a-z]|\\d){1,450}!x')
    const start = Date.now()
    expect(m.test(`${'a'.repeat(2048)}!`)).toBe(false)
    expect(m.test(`${'a'.repeat(2047)}!x`)).toBe(true)
    expect(Date.now() - start).toBeLessThan(500)
  })
})

describe('compileMatcher refuses what it does not support', () => {
  test('backreferences, lookarounds and the rest are unsupported', () => {
    const cases: readonly (readonly [string, string])[] = [
      ['(a)\\1', 'backreferences'], ['\\k<x>', 'backreferences'],
      ['(?=a)', 'lookarounds'], ['(?!a)', 'lookarounds'], ['(?<=a)', 'lookarounds'], ['(?<!a)', 'lookarounds'],
      ['(?<n>a)', 'named groups'], ['(?i:a)', 'inline flags'], ['\\p{L}', 'Unicode property escapes'], ['\\u{41}', 'the \\u escape'],
    ]
    for (const [pattern, detail] of cases) expect({ pattern, result: compileMatcher(pattern) }).toEqual({ pattern, result: { ok: false, error: 'unsupported', detail } })
  })
  test('malformed patterns are syntax errors, as RegExp says', () => {
    for (const pattern of ['(', 'a)', '[a', '*a', 'a{2,1}', 'a**', '+', '?', 'a|*', '(*a)', '{2}', 'a{2}{3}', '^*', '\\b+', 'a\\', '[b-a]', '(?x)']) {
      const result = compileMatcher(pattern)
      expect({ pattern, error: result.ok ? null : result.error }).toEqual({ pattern, error: 'syntax' })
      expect(() => new RegExp(pattern, 'i')).toThrow()
    }
  })
  test('the compiled size is bounded', () => {
    expect(compileMatcher('(a{1,100}){1,100}')).toEqual({ ok: false, error: 'unsupported', detail: 'too many repeats' })
    expect(compileMatcher('a{99999999}')).toEqual({ ok: false, error: 'unsupported', detail: 'too many repeats' })
    expect(compileMatcher('a{1,500}').ok).toBe(true)
  })
})
