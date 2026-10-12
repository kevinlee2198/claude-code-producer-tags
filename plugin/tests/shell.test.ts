import { describe, expect, test } from 'claude-code/testing'

import { commandSegments, splitCommand, startsWithTokens, stripHeredocs, stripPrefixes } from '../hooks/shell'

const words = (command: string) => commandSegments(command).map(s => s.words.join(' '))
const ops = (command: string) => commandSegments(command).map(s => s.op)

describe('stripHeredocs', () => {
  test('removes the body of a quoted heredoc used for a commit message', () => {
    const command = "git commit -m \"$(cat <<'EOF'\nfix: npm test; rm -rf it's fine\n\nCo-Authored-By: x\nEOF\n)\""
    expect(stripHeredocs(command)).toBe("git commit -m \"$(cat <<'EOF'\n)\"")
  })
  test('handles <<-, unquoted and two heredocs on one line', () => {
    expect(stripHeredocs('cat <<-A <<B\n\tbody\n\tA\nmore\nB\necho done')).toBe('cat <<-A <<B\necho done')
  })
  test('leaves here-strings alone', () => {
    expect(stripHeredocs('grep x <<< "$y"\nnpm test')).toBe('grep x <<< "$y"\nnpm test')
  })
})

describe('splitCommand', () => {
  test('quotes, escapes and $(…) stay inside one word', () => {
    expect(splitCommand(`echo 'a b' "c \\" d" e\\ f $(x | y) \`z;w\``)[0]!.words).toEqual([
      'echo', 'a b', 'c \\" d', 'e f', '$(x | y)', '`z;w`',
    ])
  })
  test('every separator, longest first', () => {
    const segments = splitCommand('a && b || c | d |& e ; f & g\nh')
    expect(segments.map(s => [s.words[0], s.op])).toEqual([
      ['a', '&&'], ['b', '||'], ['c', '|'], ['d', '|&'], ['e', ';'], ['f', '&'], ['g', ';'], ['h', null],
    ])
  })
  test('redirections with & are not separators', () => {
    expect(splitCommand('npm test 2>&1 &>/dev/null | tail -5').map(s => s.words)).toEqual([
      ['npm', 'test', '2>&1', '&>/dev/null'], ['tail', '-5'],
    ])
  })
  test('grouping and braces drop out', () => {
    expect(splitCommand('(cd x && make test) ; { npm test; }').map(s => s.words)).toEqual([
      ['cd', 'x'], ['make', 'test'], ['npm', 'test'],
    ])
  })
  test('CRLF line endings split like LF and leave no \\r in words', () => {
    expect(splitCommand('git status\r\nnpm test\r\n').map(s => s.words)).toEqual([['git', 'status'], ['npm', 'test']])
  })
})

describe('stripPrefixes', () => {
  test('assignments, env, wrappers with flags, timeout', () => {
    expect(stripPrefixes(['CI=1', 'FOO=bar', 'npm', 'test'])).toEqual(['npm', 'test'])
    expect(stripPrefixes(['env', '-i', 'A=1', 'pytest'])).toEqual(['pytest'])
    expect(stripPrefixes(['sudo', '-u', 'me', 'nice', '-n', '5', 'cargo', 'test'])).toEqual(['cargo', 'test'])
    expect(stripPrefixes(['timeout', '-s', 'KILL', '60', 'go', 'test'])).toEqual(['go', 'test'])
    expect(stripPrefixes(['time', 'nohup', 'exec', 'command', 'make', 'test'])).toEqual(['make', 'test'])
    expect(stripPrefixes(['time', '-p', 'npm', 'test'])).toEqual(['npm', 'test'])
    expect(stripPrefixes(['env', '-u', 'X', 'pytest'])).toEqual(['pytest'])
  })
})

describe('commandSegments', () => {
  test('recurses into bash -c and keeps the outer operator on the last inner segment', () => {
    expect(words('bash -c "npm test | tail -3" && echo ok')).toEqual(['npm test', 'tail -3', 'echo ok'])
    expect(ops('bash -c "npm test | tail -3" && echo ok')).toEqual(['|', '&&', null])
  })
  test('the heredoc commit message never becomes a segment', () => {
    const command = "git add -A && git commit -m \"$(cat <<'EOF'\nnpm test; deploy\nEOF\n)\""
    expect(words(command)).toEqual(['git add -A', "git commit -m $(cat <<'EOF'\n)"])
  })
})

describe('startsWithTokens', () => {
  test('matches whole tokens, never string prefixes', () => {
    expect(startsWithTokens(['npm', 'run', 'test'], ['npm', 'run', 'test'])).toBe(true)
    expect(startsWithTokens(['npm', 'run', 'test:unit'], ['npm', 'run', 'test'])).toBe(false)
    expect(startsWithTokens(['npm', 'run', 'testing-setup'], ['npm', 'run', 'test'])).toBe(false)
    expect(startsWithTokens(['npm'], ['npm', 'test'])).toBe(false)
  })
})
