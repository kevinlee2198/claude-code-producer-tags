import type { LinuxPlayer, OsName, Platform } from '../types'
import { encodeUtf16LeBase64 } from './codec'
import { WINDOWS_ENGINE } from './constants'
import type { Host } from './host'
import { MIME, type ResolvedSound } from './library'

export type PlayRequest = { sound: ResolvedSound; gain: number; maxMs: number }
export type PlayEnd = 'ok' | 'stopped' | 'failed'
export type PlayHandle = { started: Promise<boolean>; ended: Promise<PlayEnd>; stop: () => void }

/** WPF MediaPlayer: wav and mp3 with volume. Data only from env; prints `started`, then `t` every 100 ms. */
const MEDIAPLAYER_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "$ProgressPreference = 'SilentlyContinue'",
  'Add-Type -AssemblyName PresentationCore',
  '$player = New-Object System.Windows.Media.MediaPlayer',
  '$player.Open([Uri]::new($env:PT_FILE))',
  '$player.Volume = [double]$env:PT_GAIN',
  '$player.Play()',
  "[Console]::Out.WriteLine('started'); [Console]::Out.Flush()",
  '$limit = [int]$env:PT_MS',
  '$clock = [Diagnostics.Stopwatch]::StartNew()',
  'while ($clock.ElapsedMilliseconds -lt [int]$env:PT_CAP) {',
  '  if ($limit -gt 0 -and $clock.ElapsedMilliseconds -ge $limit) { break }',
  '  if ($limit -le 0 -and $player.NaturalDuration.HasTimeSpan -and $player.Position -ge $player.NaturalDuration.TimeSpan) { break }',
  '  Start-Sleep -Milliseconds 100',
  "  [Console]::Out.WriteLine('t'); [Console]::Out.Flush()",
  '}',
  '$player.Stop(); $player.Close()',
].join('\n')

/** Fallback when MediaPlayer cannot play headless (Task 0, R2): wav only, no volume. */
const SOUNDPLAYER_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "$ProgressPreference = 'SilentlyContinue'",
  '$player = New-Object System.Media.SoundPlayer $env:PT_FILE',
  '$player.Load()',
  '$player.Play()',
  "[Console]::Out.WriteLine('started'); [Console]::Out.Flush()",
  '$limit = [int]$env:PT_MS',
  'if ($limit -le 0) { $limit = [int]$env:PT_CAP }',
  '$clock = [Diagnostics.Stopwatch]::StartNew()',
  "while ($clock.ElapsedMilliseconds -lt $limit) { Start-Sleep -Milliseconds 100; [Console]::Out.WriteLine('t'); [Console]::Out.Flush() }",
  '$player.Stop()',
].join('\n')

export const WINDOWS_SCRIPT = WINDOWS_ENGINE === 'mediaplayer' ? MEDIAPLAYER_SCRIPT : SOUNDPLAYER_SCRIPT

/** How Windows and WSL start the play script. */
export const WINDOWS_ARGV: readonly string[] = ['powershell.exe', '-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', encodeUtf16LeBase64(WINDOWS_SCRIPT)]

/** Runs "$@" in the background and prints its pid, then a tick every 100 ms while it lives; kills it if killed itself. */
export const LINUX_WRAPPER =
  '"$@" >/dev/null 2>&1 & p=$!; trap \'kill "$p" 2>/dev/null\' EXIT HUP TERM PIPE; echo "pid $p"; while kill -0 "$p" 2>/dev/null; do sleep 0.1; echo t; done'

/** Starts the play script in a hidden process that outlives Claude Code (the session.close outro). */
export const DETACH_COMMAND =
  "Start-Process -WindowStyle Hidden -FilePath powershell.exe -ArgumentList '-NoProfile','-NonInteractive','-STA','-EncodedCommand',$env:PT_SCRIPT"

export function filePathOf(root: string, sound: ResolvedSound): string {
  return sound.source.kind === 'asset' ? `${root}/${sound.source.asset}` : sound.source.path
}

export function linuxPlayerArgv(player: LinuxPlayer, path: string, gain: number): string[] {
  switch (player) {
    case 'pw-play':
      return ['pw-play', '--volume', gain.toFixed(2), path]
    case 'paplay':
      return ['paplay', `--volume=${Math.round(gain * 65536)}`, path]
    case 'ffplay':
      return ['ffplay', '-nodisp', '-autoexit', '-loglevel', 'quiet', '-volume', String(Math.round(gain * 100)), path]
    case 'aplay':
      return ['aplay', '-q', path]
  }
}

/** The play script's inputs. `PT_MS` 0 means "length unknown: stop at NaturalDuration". */
export function windowsEnv(
  os: OsName,
  path: string,
  gain: number,
  durationMs: number | null,
  maxMs: number,
  existingWslEnv: string | undefined,
): Record<string, string> {
  const env: Record<string, string> = {
    PT_FILE: path,
    PT_GAIN: gain.toFixed(2),
    PT_MS: String(durationMs ?? 0),
    PT_CAP: String(maxMs),
  }
  if (os === 'wsl') env.WSLENV = [existingWslEnv, 'PT_FILE/p', 'PT_GAIN', 'PT_MS', 'PT_CAP'].filter(Boolean).join(':')
  return env
}

/** What a player's output says once it is playing: `started` (PowerShell) or `pid <n>` (the Linux wrapper). */
export function startSignal(text: string): { isStarted: boolean; pid: string | null } {
  const pid = /pid (\d+)/.exec(text)?.[1] ?? null
  return { isStarted: pid !== null || text.includes('started'), pid }
}

/**
 * The fire-and-forget launch of the session.close outro (spec §6.3), or null where nothing plays.
 * `path` is the clip's file; `existingWslEnv` is `$WSLENV` on WSL.
 */
export function detachedLaunch(
  platform: Platform,
  path: string,
  request: PlayRequest,
  existingWslEnv: string | undefined,
): { argv: string[]; env: Record<string, string> } | null {
  const gain = request.gain.toFixed(2)
  if (platform.player === 'audio') {
    return { argv: ['sh', '-c', 'afplay -v "$PT_GAIN" "$PT_FILE" >/dev/null 2>&1 &'], env: { PT_FILE: path, PT_GAIN: gain } }
  }
  if (platform.player === 'powershell') {
    const env = windowsEnv(platform.os, path, request.gain, request.sound.durationMs, request.maxMs, existingWslEnv)
    env.PT_SCRIPT = encodeUtf16LeBase64(WINDOWS_SCRIPT)
    if (env.WSLENV !== undefined) env.WSLENV += ':PT_SCRIPT'
    return { argv: ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', DETACH_COMMAND], env }
  }
  if (platform.player === 'none') return null
  return { argv: ['sh', '-c', '"$@" >/dev/null 2>&1 &', 'pt-play', ...linuxPlayerArgv(platform.player, path, request.gain)], env: {} }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => {
    resolve = r
  })
  return { promise, resolve }
}

export function play(host: Host, platform: Platform, request: PlayRequest): PlayHandle {
  switch (platform.player) {
    case 'audio':
      return playWithEngine(host, request)
    case 'none':
      return playSilently(host, request.sound.durationMs ?? 3000)
    case 'powershell':
      return playPowerShell(host, platform, request)
    default: {
      const path = filePathOf(host.root, request.sound)
      const argv = ['sh', '-c', LINUX_WRAPPER, 'pt-play', ...linuxPlayerArgv(platform.player, path, request.gain)]
      return playProcess(host, argv, {}, request.maxMs, true)
    }
  }
}

function playWithEngine(host: Host, request: PlayRequest): PlayHandle {
  const controller = new AbortController()
  const started = deferred<boolean>()
  const ended = (async (): Promise<PlayEnd> => {
    const timer = host.after(request.maxMs, () => controller.abort())
    try {
      const { source } = request.sound
      const clip =
        source.kind === 'asset'
          ? { asset: source.asset }
          : { base64: (await host.readBytes(source.path)).base64, mime: MIME[source.ext] }
      started.resolve(true)
      await host.play(clip, { gain: request.gain, signal: controller.signal })
      return controller.signal.aborted ? 'stopped' : 'ok'
    } catch {
      return controller.signal.aborted ? 'stopped' : 'failed'
    } finally {
      timer.cancel()
      started.resolve(false)
    }
  })()
  return { started: started.promise, ended, stop: () => controller.abort() }
}

function playSilently(host: Host, ms: number): PlayHandle {
  const ended = deferred<PlayEnd>()
  const timer = host.after(ms, () => ended.resolve('ok'))
  return {
    started: Promise.resolve(true),
    ended: ended.promise,
    stop: () => {
      timer.cancel()
      ended.resolve('stopped')
    },
  }
}

async function powershellEnv(host: Host, platform: Platform, request: PlayRequest): Promise<Record<string, string>> {
  const existing = platform.os === 'wsl' ? await host.env.wslEnv() : undefined
  return windowsEnv(platform.os, filePathOf(host.root, request.sound), request.gain, request.sound.durationMs, request.maxMs, existing)
}

function playPowerShell(host: Host, platform: Platform, request: PlayRequest): PlayHandle {
  const handle = powershellEnv(host, platform, request).then(env => playProcess(host, [...WINDOWS_ARGV], env, request.maxMs, false))
  return {
    started: handle.then(h => h.started),
    ended: handle.then(h => h.ended),
    stop: () => void handle.then(h => h.stop()),
  }
}

/** A player process that prints `started` (or `pid <n>`) then ticks; stopping breaks the loop, which ends it. */
function playProcess(host: Host, argv: string[], env: Record<string, string>, maxMs: number, killsPid: boolean): PlayHandle {
  const started = deferred<boolean>()
  let isStopped = false
  let pid: string | null = null
  const kill = async () => {
    if (killsPid && pid !== null) await host.run(['kill', pid]).catch(() => undefined)
  }
  const stop = () => {
    if (isStopped) return
    isStopped = true
    void kill()
  }
  const ended = (async (): Promise<PlayEnd> => {
    const timer = host.after(maxMs, stop)
    let hasStarted = false
    try {
      for await (const chunk of host.spawn({ argv, env })) {
        if (!hasStarted) {
          const signal = startSignal(chunk.text)
          pid = signal.pid ?? pid
          if (signal.isStarted) {
            hasStarted = true
            started.resolve(true)
          }
        }
        if (isStopped) {
          await kill()
          break
        }
      }
    } catch {
      if (!isStopped) return 'failed'
    } finally {
      timer.cancel()
      started.resolve(false)
    }
    if (isStopped) return 'stopped'
    return hasStarted ? 'ok' : 'failed'
  })()
  return { started: started.promise, ended, stop }
}

/** Fire-and-forget playback that survives the session ending (spec §6.3). */
export async function playDetached(host: Host, platform: Platform, request: PlayRequest): Promise<void> {
  const existing = platform.os === 'wsl' ? await host.env.wslEnv() : undefined
  const launch = detachedLaunch(platform, filePathOf(host.root, request.sound), request, existing)
  if (launch !== null) await host.run(launch.argv, { env: launch.env })
}
