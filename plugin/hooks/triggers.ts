import type { CustomTrigger, Settings, SoundId, TriggerId, TriggerKey } from '../types'
import { BASH_PRIORITY, MAX_MATCH_INPUT } from './constants'
import { compilePattern } from './settings'
import { commandSegments, startsWithTokens, stripHeredocs, type Segment } from './shell'

export type GitOperation = {
  commit?: { sha: string; kind: string }
  push?: { branch: string }
  branch?: { ref: string; action: string }
  pr?: { number: number; action: string }
}

export type BashFacts = {
  command: string
  isBackground: boolean
  isInterrupted: boolean
  isError: boolean
  output: string
  git: GitOperation | null
}

export type Hit = { key: TriggerKey; sound: SoundId }

export type ToolRun = { deny?: string; isError?: boolean; result?: unknown; text?: string }

type BashRecord = {
  stdout?: string
  stderr?: string
  interrupted?: boolean
  backgroundTaskId?: string
  backgroundedByUser?: boolean
  timedOutAfterMs?: number
  gitOperation?: GitOperation
}

export function bashFacts(input: { command: string; run_in_background?: boolean; isAborted?: boolean }, ran: ToolRun): BashFacts | null {
  if (ran.deny !== undefined) return null
  const isError = ran.isError === true
  const record = (isError ? undefined : ran.result) as BashRecord | undefined
  return {
    command: input.command,
    isBackground:
      input.run_in_background === true ||
      record?.backgroundTaskId !== undefined ||
      record?.backgroundedByUser === true ||
      record?.timedOutAfterMs !== undefined,
    isInterrupted: input.isAborted === true || record?.interrupted === true,
    isError,
    output: isError ? (ran.text ?? '') : `${record?.stdout ?? ''}\n${record?.stderr ?? ''}`,
    git: record?.gitOperation ?? null,
  }
}

export function gitTriggers(git: GitOperation | null): TriggerId[] {
  if (git === null) return []
  const ids: TriggerId[] = []
  if (git.branch?.action === 'merged' || git.pr?.action === 'merged') ids.push('git.merge')
  if (git.push !== undefined) ids.push('git.push')
  if (git.commit !== undefined) ids.push('git.commit')
  return ids
}

const RUNNERS: readonly (readonly string[])[] = [
  ['npm', 'test'], ['npm', 't'], ['npm', 'run', 'test'],
  ['pnpm', 'test'], ['pnpm', 'run', 'test'], ['yarn', 'test'], ['yarn', 'run', 'test'], ['bun', 'test'],
  ['npx', 'jest'], ['npx', 'vitest'], ['npx', 'mocha'], ['npx', 'playwright', 'test'],
  ['bunx', 'jest'], ['bunx', 'vitest'], ['bunx', 'mocha'], ['bunx', 'playwright', 'test'],
  ['jest'], ['vitest'], ['mocha'],
  ['pytest'], ['python', '-m', 'pytest'], ['python3', '-m', 'pytest'], ['uv', 'run', 'pytest'], ['poetry', 'run', 'pytest'],
  ['cargo', 'test'], ['cargo', 'nextest', 'run'], ['go', 'test'], ['dotnet', 'test'],
  ['mvn', 'test'], ['gradle', 'test'], ['./gradlew', 'test'],
  ['rspec'], ['bundle', 'exec', 'rspec'], ['phpunit'], ['mix', 'test'], ['make', 'test'],
]
const NON_RUN_FLAGS = new Set(['--help', '-h', '--listTests', '--collect-only', '--watch', '-w'])
const FAIL_MARKERS = [/\b[1-9]\d* (failed|failing|errors?)\b/i, /^FAIL\b/m, /\bFAILED\b/, /panicked at/, /^Traceback/m, /test result: FAILED/]
const PASS_MARKERS = [/\b\d+ (passed|passing)\b/i, /test result: ok/, /^ok\s/m, /^PASS\b/m, /\bOK \(\d+ tests?\)/, /Tests:\s+\d+ passed/]

export function isTestRunner(words: readonly string[]): boolean {
  return RUNNERS.some(runner => startsWithTokens(words, runner)) && !words.some(w => NON_RUN_FLAGS.has(w))
}

/** The runner's exit status is the command's when only `&&` follows it, nothing reads its output and nothing backgrounds it. */
function isAttributable(segments: readonly Segment[], index: number): boolean {
  for (let k = index; k < segments.length; k++) {
    const op = segments[k]!.op
    if (k === segments.length - 1 ? op !== null && op !== ';' : op !== '&&') return false
  }
  return true
}

export function testsPassed(facts: BashFacts): boolean {
  const segments = commandSegments(facts.command)
  const runner = segments.findLastIndex(segment => isTestRunner(segment.words))
  if (runner < 0) return false
  if (isAttributable(segments, runner)) return !facts.isError
  if (FAIL_MARKERS.some(marker => marker.test(facts.output))) return false
  return PASS_MARKERS.some(marker => marker.test(facts.output))
}

/** Git global options that take a value as the next word (the `--opt=value` forms are one word). */
const GIT_VALUE_OPTIONS = new Set(['-C', '-c', '--git-dir', '--work-tree'])

/** The subcommand and its arguments, past git's global options; null when the segment is not git. */
function gitSubcommand(words: readonly string[]): { name: string; args: string[] } | null {
  if (words[0] !== 'git') return null
  let i = 1
  while (i < words.length && words[i]!.startsWith('-')) i += GIT_VALUE_OPTIONS.has(words[i]!) ? 2 : 1
  const name = words[i]
  return name === undefined ? null : { name, args: words.slice(i + 1) }
}

function hasFlag(args: readonly string[], long: string, short: string): boolean {
  return args.some(arg => arg === long || (/^-[a-zA-Z]+$/.test(arg) && arg.includes(short)))
}

/**
 * The engine builds `gitOperation` from git's own output, which `-q` silences. Only for a quiet commit or push
 * that is attributable and succeeded: without `-q`, a missing gitOperation means nothing happened. Merge is not
 * covered, since a quiet "already up to date" merge exits 0 too.
 */
function quietGitTriggers(facts: BashFacts): TriggerId[] {
  if (facts.isError) return []
  const segments = commandSegments(facts.command)
  const ids: TriggerId[] = []
  segments.forEach((segment, index) => {
    const sub = gitSubcommand(segment.words)
    if (sub === null || (sub.name !== 'commit' && sub.name !== 'push')) return
    if (!hasFlag(sub.args, '--quiet', 'q') || sub.args.includes('--dry-run') || !isAttributable(segments, index)) return
    if (sub.name === 'commit') {
      ids.push('git.commit')
    } else if (!hasFlag(sub.args, '--dry-run', 'n')) {
      ids.push('git.push')
    }
  })
  return ids
}

export function bashCandidates(facts: BashFacts): TriggerId[] {
  const ids = facts.git === null ? quietGitTriggers(facts) : gitTriggers(facts.git)
  if (testsPassed(facts)) ids.push('tests.pass')
  if (facts.isError) ids.push('command.fail')
  return ids
}

const compiled = new Map<string, RegExp | null>()

function cachedPattern(pattern: string): RegExp | null {
  if (!compiled.has(pattern)) compiled.set(pattern, compilePattern(pattern))
  return compiled.get(pattern) ?? null
}

export function customMatches(trigger: CustomTrigger, facts: BashFacts): boolean {
  if (!trigger.enabled || trigger.isInvalid) return false
  if (trigger.outcome === 'success' && facts.isError) return false
  if (trigger.outcome === 'fail' && !facts.isError) return false
  return cachedPattern(trigger.pattern)?.test(stripHeredocs(facts.command).slice(0, MAX_MATCH_INPUT)) ?? false
}

export function pickBashHit(settings: Settings, facts: BashFacts | null): Hit | null {
  if (facts === null || facts.isBackground || facts.isInterrupted) return null
  const custom = settings.custom.find(trigger => customMatches(trigger, facts))
  if (custom !== undefined) return { key: `custom:${custom.id}`, sound: custom.sound }
  const candidates = new Set(bashCandidates(facts))
  for (const id of BASH_PRIORITY) {
    const setting = settings.triggers[id]
    if (candidates.has(id) && setting.enabled) return { key: id, sound: setting.sound }
  }
  return null
}

const FAMILIES = ['opus', 'fable', 'sonnet', 'haiku'] as const
export type Family = (typeof FAMILIES)[number]

export function familyOf(model: string): Family | null {
  const id = model.toLowerCase()
  return FAMILIES.find(family => id.includes(family)) ?? null
}

export function normalizeModel(model: string): string {
  return model.replace(/\[[^\]]*\]/g, '').trim().toLowerCase()
}

export function modelTrigger(e: { from_model: string; to_model: string; source: string }): TriggerId | null {
  if (e.source !== 'command' && e.source !== 'picker' && e.source !== 'sdk') return null
  const to = familyOf(e.to_model)
  if (to !== null) return to === familyOf(e.from_model) ? null : `model.${to}`
  return normalizeModel(e.to_model) === normalizeModel(e.from_model) ? null : 'model.other'
}

export function sessionOpenTrigger(source: string): TriggerId | null {
  return source === 'startup' || source === 'resume' ? 'session.open' : null
}

export function sessionCloseTrigger(reason: string): TriggerId | null {
  return reason === 'prompt_input_exit' || reason === 'logout' ? 'session.close' : null
}

export function turnDoneTrigger(stopHookActive: boolean): TriggerId | null {
  return stopHookActive ? null : 'turn.done'
}

export function hitFor(settings: Settings, id: TriggerId | null): Hit | null {
  if (id === null) return null
  const setting = settings.triggers[id]
  return setting.enabled ? { key: id, sound: setting.sound } : null
}
