import type { CustomTrigger, Settings, SoundId, TriggerId, TriggerKey } from '../types'
import { BASH_PRIORITY } from './constants'
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

/** The runner's exit status is the command's when only `&&` follows it and nothing reads its output. */
function isAttributable(segments: readonly Segment[], index: number): boolean {
  for (let k = index; k < segments.length - 1; k++) if (segments[k]!.op !== '&&') return false
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

export function bashCandidates(facts: BashFacts): TriggerId[] {
  const ids = gitTriggers(facts.git)
  if (testsPassed(facts)) ids.push('tests.pass')
  if (facts.isError) ids.push('command.fail')
  return ids
}

export function customMatches(trigger: CustomTrigger, facts: BashFacts): boolean {
  if (!trigger.enabled || trigger.isInvalid) return false
  if (trigger.outcome === 'success' && facts.isError) return false
  if (trigger.outcome === 'fail' && !facts.isError) return false
  return compilePattern(trigger.pattern)?.test(stripHeredocs(facts.command)) ?? false
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
