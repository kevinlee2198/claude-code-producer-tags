import { describe, expect, test } from 'claude-code/testing'

import { defaultSettings } from '../hooks/settings'
import {
  bashFacts,
  familyOf,
  hitFor,
  modelTrigger,
  pickBashHit,
  sessionCloseTrigger,
  sessionOpenTrigger,
  testsPassed,
  turnDoneTrigger,
  type BashFacts,
  type GitOperation,
} from '../hooks/triggers'
import type { CustomTrigger, Settings } from '../types'

const ok = (stdout = '', extra: Record<string, unknown> = {}) => ({ result: { stdout, stderr: '', interrupted: false, ...extra } })
const failed = (text = 'Exit code 1') => ({ isError: true, result: text, text })
const facts = (command: string, ran: Parameters<typeof bashFacts>[1] = ok(), background = false): BashFacts =>
  bashFacts({ command, run_in_background: background }, ran)!
const git = (operation: GitOperation) => ok('', { gitOperation: operation })
const allOn = (): Settings => {
  const s = defaultSettings()
  for (const id of Object.keys(s.triggers) as (keyof Settings['triggers'])[]) s.triggers[id].enabled = true
  return s
}

describe('git triggers come from gitOperation', () => {
  test('commit / push / merge / pr merge', () => {
    const s = allOn()
    expect(pickBashHit(s, facts('git -C repo commit -m x', git({ commit: { sha: 'a', kind: 'committed' } })))?.key).toBe('git.commit')
    expect(pickBashHit(s, facts('git commit --amend', git({ commit: { sha: 'a', kind: 'amended' } })))?.key).toBe('git.commit')
    expect(pickBashHit(s, facts('git push', git({ push: { branch: 'main' } })))?.key).toBe('git.push')
    expect(pickBashHit(s, facts('git merge dev', git({ branch: { ref: 'dev', action: 'merged' } })))?.key).toBe('git.merge')
    expect(pickBashHit(s, facts('gh pr merge 3', git({ pr: { number: 3, action: 'merged' } })))?.key).toBe('git.merge')
  })
  test('no gitOperation, rebase, auto-merge or "Already up to date" fire nothing', () => {
    const s = allOn()
    expect(pickBashHit(s, facts('git commit --dry-run -m x'))).toBeNull()
    expect(pickBashHit(s, facts('git merge dev', ok('Already up to date.')))).toBeNull()
    expect(pickBashHit(s, facts('git rebase main', git({ branch: { ref: 'main', action: 'rebased' } })))).toBeNull()
    expect(pickBashHit(s, facts('gh pr merge --auto 3', git({ pr: { number: 3, action: 'auto-merge-enabled' } })))).toBeNull()
  })
  test('priority: merge > push > commit > tests > fail', () => {
    const s = allOn()
    const all = git({ commit: { sha: 'a', kind: 'committed' }, push: { branch: 'main' } })
    expect(pickBashHit(s, facts('git commit -m x && git push', all))?.key).toBe('git.push')
    s.triggers['git.push'].enabled = false
    expect(pickBashHit(s, facts('git commit -m x && git push', all))?.key).toBe('git.commit')
    expect(pickBashHit(s, facts('git merge dev && git push', git({ push: { branch: 'main' }, branch: { ref: 'dev', action: 'merged' } })))?.key).toBe('git.merge')
  })
  test('commit beats tests.pass, tests.pass beats command.fail', () => {
    const s = allOn()
    const commit = git({ commit: { sha: 'a', kind: 'committed' } })
    expect(pickBashHit(s, facts('git commit -m x && npm test', commit))?.key).toBe('git.commit')
    s.triggers['git.commit'].enabled = false
    expect(pickBashHit(s, facts('git commit -m x && npm test', commit))?.key).toBe('tests.pass')
    s.triggers['tests.pass'].enabled = false
    expect(pickBashHit(s, facts('git commit -m x && npm test', commit))).toBeNull()
    expect(pickBashHit(s, facts('git commit -m x', failed()))?.key).toBe('command.fail')
  })
})

describe('skip rules', () => {
  test('background, auto-backgrounded, Ctrl+B and interrupted results fire nothing', () => {
    const s = allOn()
    const commit = { gitOperation: { commit: { sha: 'a', kind: 'committed' } } }
    expect(pickBashHit(s, facts('git commit -m x', ok('', commit), true))).toBeNull()
    expect(pickBashHit(s, facts('npm test', ok('5 passed', { backgroundTaskId: 'b1' })))).toBeNull()
    expect(pickBashHit(s, facts('npm test', ok('5 passed', { timedOutAfterMs: 120000 })))).toBeNull()
    expect(pickBashHit(s, facts('npm test', ok('5 passed', { backgroundedByUser: true })))).toBeNull()
    expect(pickBashHit(s, facts('git commit -m x', ok('', { ...commit, interrupted: true })))).toBeNull()
  })
  test('an interrupt that came back as an error fires nothing, not even command.fail', () => {
    const s = allOn()
    expect(pickBashHit(s, bashFacts({ command: 'make', isAborted: true }, failed('Interrupted by user')))).toBeNull()
  })
  test('a denied call is not a fact at all', () => {
    expect(bashFacts({ command: 'git push' }, { deny: 'no' })).toBeNull()
  })
})

describe('tests.pass', () => {
  test('attributable runner: exit status decides', () => {
    expect(testsPassed(facts('npm test'))).toBe(true)
    expect(testsPassed(facts('cd web && CI=1 npm run test && echo done'))).toBe(true)
    expect(testsPassed(facts('npm test', failed()))).toBe(false)
  })
  test('every runner form is recognised', () => {
    for (const command of [
      'npm t', 'pnpm run test', 'yarn run test', 'bun test', 'npx vitest run', 'bunx jest', 'npx playwright test',
      'vitest', 'mocha', 'pytest -q', 'python3 -m pytest', 'uv run pytest', 'poetry run pytest', 'cargo nextest run',
      'cargo test', 'go test ./...', 'dotnet test', 'mvn test', 'gradle test', './gradlew test', 'bundle exec rspec',
      'rspec', 'phpunit', 'mix test', 'make test',
    ]) expect(testsPassed(facts(command)), command).toBe(true)
  })
  test('non-runs and look-alikes are not test runs', () => {
    for (const command of ['npm test -- --help', 'npx jest --listTests', 'pytest --collect-only', 'npx vitest --watch', 'npm run test:unit', 'echo npm test', 'git log --grep test'])
      expect(testsPassed(facts(command)), command).toBe(false)
  })
  test('piped or ;-joined runners decide from the output', () => {
    expect(testsPassed(facts('npm test 2>&1 | tail -20', ok('Tests:  12 passed, 12 total')))).toBe(true)
    expect(testsPassed(facts('npm test 2>&1 | tail -20', ok('Tests:  1 failed, 11 passed')))).toBe(false)
    expect(testsPassed(facts('cargo test; echo done', ok('test result: ok. 3 passed')))).toBe(true)
    expect(testsPassed(facts('cargo test || true', ok('test result: FAILED. 1 failed')))).toBe(false)
    expect(testsPassed(facts('pytest | tail -1', ok('Traceback (most recent call last):')))).toBe(false)
    expect(testsPassed(facts('go test ./... | tail -1', ok('done')))).toBe(false)
  })
  test('command -v probes and backgrounded runners are not test runs', () => {
    expect(testsPassed(facts('command -v pytest'))).toBe(false)
    expect(testsPassed(facts('command -v jest && echo found'))).toBe(false)
    expect(testsPassed(facts('npm test &'))).toBe(false)
    expect(testsPassed(facts('pytest > log 2>&1 &'))).toBe(false)
    expect(testsPassed(facts('bash -c "npm test" &'))).toBe(false)
    expect(testsPassed(facts('npm test;'))).toBe(true)
    expect(testsPassed(facts('npm test\n'))).toBe(true)
  })
})

describe('command.fail and custom triggers', () => {
  test('command.fail fires on isError only when enabled', () => {
    const s = defaultSettings()
    expect(pickBashHit(s, facts('make', failed()))).toBeNull()
    s.triggers['command.fail'].enabled = true
    expect(pickBashHit(s, facts('make', failed()))?.key).toBe('command.fail')
  })
  test('custom triggers win, honour outcome, ignore heredoc bodies and invalid patterns', () => {
    const s = allOn()
    const custom = (over: Partial<CustomTrigger>): CustomTrigger => ({ id: 'c1', pattern: 'docker compose up', outcome: 'success', sound: 'pt:808-boom', enabled: true, isInvalid: false, ...over })
    s.custom = [custom({})]
    expect(pickBashHit(s, facts('docker compose up -d'))).toEqual({ key: 'custom:c1', sound: 'pt:808-boom' })
    expect(pickBashHit(s, facts('docker compose up -d', failed()))?.key).toBe('command.fail')
    s.custom = [custom({ outcome: 'fail' })]
    expect(pickBashHit(s, facts('docker compose up -d', failed()))?.key).toBe('custom:c1')
    s.custom = [custom({ pattern: 'deploy' })]
    expect(pickBashHit(s, facts("git commit -m \"$(cat <<'EOF'\ndeploy fix\nEOF\n)\""))).toBeNull()
    s.custom = [custom({ pattern: '(', isInvalid: true })]
    expect(pickBashHit(s, facts('('))).toBeNull()
  })
})

describe('model switches', () => {
  const sw = (from_model: string, to_model: string, source = 'command') => modelTrigger({ from_model, to_model, source })
  test('family changes fire the family trigger', () => {
    expect(sw('claude-opus-5-5', 'claude-fable-5-1')).toBe('model.fable')
    expect(sw('claude-fable-5-1', 'claude-opus-5-5[1m]', 'picker')).toBe('model.opus')
    expect(sw('claude-opus-5-5', 'claude-sonnet-5-5', 'sdk')).toBe('model.sonnet')
    expect(sw('claude-sonnet-5-5', 'claude-haiku-5-5')).toBe('model.haiku')
  })
  test('same family, suffix-only changes, resume and auto fire nothing', () => {
    expect(sw('claude-opus-5', 'claude-opus-5-5')).toBeNull()
    expect(sw('claude-sonnet-5-5[1m]', 'claude-sonnet-5-5')).toBeNull()
    expect(sw('claude-opus-5-5', 'claude-fable-5-1', 'resume')).toBeNull()
    expect(sw('claude-opus-5-5', 'claude-fable-5-1', 'auto')).toBeNull()
  })
  test('odd ids: empty from, opusplan, default, unknown models', () => {
    expect(sw('', 'claude-opus-5-5')).toBe('model.opus')
    expect(familyOf('opusplan')).toBe('opus')
    expect(sw('claude-opus-5-5', 'default')).toBe('model.other')
    expect(sw('default', 'default')).toBeNull()
    expect(sw('acme-llm-1', 'acme-llm-2')).toBe('model.other')
    expect(sw('acme-llm-1[1m]', 'acme-llm-1')).toBeNull()
  })
})

describe('session and turn triggers', () => {
  test('open on startup/resume, close on exit/logout, turn.done unless a stop hook is looping', () => {
    expect(sessionOpenTrigger('startup')).toBe('session.open')
    expect(sessionOpenTrigger('resume')).toBe('session.open')
    expect(sessionOpenTrigger('clear')).toBeNull()
    expect(sessionOpenTrigger('compact')).toBeNull()
    expect(sessionCloseTrigger('prompt_input_exit')).toBe('session.close')
    expect(sessionCloseTrigger('logout')).toBe('session.close')
    for (const reason of ['clear', 'resume', 'other']) expect(sessionCloseTrigger(reason)).toBeNull()
    expect(turnDoneTrigger(false)).toBe('turn.done')
    expect(turnDoneTrigger(true)).toBeNull()
  })
  test('hitFor respects enabled', () => {
    const s = defaultSettings()
    expect(hitFor(s, 'session.open')).toBeNull()
    expect(hitFor(s, 'session.close')).toEqual({ key: 'session.close', sound: 'pt:claude-outta' })
    expect(hitFor(s, null)).toBeNull()
  })
})
