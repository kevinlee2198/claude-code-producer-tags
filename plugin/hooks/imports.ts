import type { AudioExt, ImportedSound, OsName, Platform, Settings, SoundId } from '../types'
import { decodeBase64 } from './codec'
import { FALLBACK_SOUND, MAX_IMPORT_BYTES, TRIGGERS } from './constants'
import type { Host } from './host'
import { logError } from './notify'
import { allowedExts, basename, extOf, parseWav, slugify } from './library'
import { detectPlatform } from './platform'
import { changeImports, changeSettings, ensureLoaded } from './settings'

export type ImportResult =
  | { ok: true; sound: ImportedSound; warning: string | null }
  | { ok: false; error: string }

const IMPORT_FAILED = 'Could not import that file.'

export const COPY_WARNING = 'Could not copy the file, so it is used from where it is; moving it will break this tag.'

function isDrivePath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path)
}

/** What a terminal pastes for a dropped file: maybe quoted, maybe with backslash-escaped spaces. */
export function cleanPastedPath(raw: string, os: OsName): string {
  let path = raw.trim()
  const first = path[0]
  if (path.length >= 2 && (first === "'" || first === '"') && path.endsWith(first)) path = path.slice(1, -1)
  if (os !== 'windows' && !isDrivePath(path) && !path.startsWith('\\\\')) path = path.replace(/\\(.)/g, '$1')
  return path
}

/** A leading `~` as the home directory. */
export function expandHome(path: string, home: string): string {
  return path === '~' || path.startsWith('~/') || path.startsWith('~\\') ? `${home}${path.slice(1)}` : path
}

/** A `C:\…` path typed on WSL, which `wslpath -u` turns into `/mnt/c/…`. */
export function isWindowsPathOnWsl(os: OsName, path: string): boolean {
  return os === 'wsl' && isDrivePath(path)
}

export function soundsDirOf(os: OsName, configDir: string | undefined, home: string): { dir: string; sep: '/' | '\\' } {
  const sep = os === 'windows' ? '\\' : '/'
  const config = configDir ?? `${home}${sep}.claude`
  return { dir: `${config}${sep}producer-tags${sep}sounds`, sep }
}

/** Why the file cannot be imported, or null when it can (spec §7.2, step 2). */
export function importProblem(
  path: string,
  stat: { kind: string; size: number } | null,
  ext: AudioExt | null,
  allowed: readonly AudioExt[],
): string | null {
  if (path === '') return 'Enter the path of an audio file.'
  if (stat === null || stat.kind !== 'file') return `No file at ${path}.`
  if (ext === null || !allowed.includes(ext)) return `Use one of: ${allowed.join(', ')}.`
  if (stat.size > MAX_IMPORT_BYTES) return 'Files must be 4 MB or smaller.'
  return null
}

/** The copy, with every path in env (never in the command text). */
export function copyCommand(os: OsName, source: string, dir: string, target: string): { argv: string[]; env: Record<string, string> } {
  const env = { PT_DIR: dir, PT_SRC: source, PT_DST: target }
  const argv =
    os === 'windows'
      ? ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', 'New-Item -ItemType Directory -Force -Path $env:PT_DIR | Out-Null; Copy-Item -LiteralPath $env:PT_SRC -Destination $env:PT_DST']
      : ['sh', '-c', 'mkdir -p -- "$PT_DIR" && cp -- "$PT_SRC" "$PT_DST"']
  return { argv, env }
}

/** Removing a copied import: argv with no shell, or PowerShell with the path in env. */
export function deleteCommand(os: OsName, file: string): { argv: string[]; env?: Record<string, string> } {
  return os === 'windows'
    ? { argv: ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', 'Remove-Item -LiteralPath $env:PT_DST -Force'], env: { PT_DST: file } }
    : { argv: ['rm', '-f', '--', file] }
}

export function stripExt(name: string): string {
  return name.replace(/\.[^.]*$/, '')
}

export function resetSound(settings: Settings, id: SoundId): Settings {
  const triggers = { ...settings.triggers }
  for (const t of TRIGGERS) if (triggers[t.id].sound === id) triggers[t.id] = { ...triggers[t.id], sound: t.sound }
  return {
    ...settings,
    triggers,
    custom: settings.custom.map(c => (c.sound === id ? { ...c, sound: FALLBACK_SOUND } : c)),
  }
}

/** The home folder, or null when the environment has none (an empty value counts as unset). */
async function home(host: Host, platform: Platform): Promise<string | null> {
  const value = platform.os === 'windows' ? await host.env.userProfile() : await host.env.home()
  return value === undefined || value === '' ? null : value
}

/** Where imported copies live; an empty CLAUDE config dir counts as unset. */
async function soundsDir(host: Host, platform: Platform, homeDir: string): Promise<{ dir: string; sep: '/' | '\\' }> {
  const configDir = await host.env.configDir()
  return soundsDirOf(platform.os, configDir === '' ? undefined : configDir, homeDir)
}

/** A pasted path cleaned, `~` expanded, and on WSL a `C:\` path converted with `wslpath -u`. */
export async function expandPath(host: Host, raw: string, platform: Platform): Promise<string> {
  const path = expandHome(cleanPastedPath(raw, platform.os), (await home(host, platform)) ?? '')
  if (!isWindowsPathOnWsl(platform.os, path)) return path
  const converted = await host.run(['wslpath', '-u', path]).catch(() => null)
  return converted?.exitCode === 0 ? converted.stdout.trim() : path
}

let importQueue: Promise<unknown> = Promise.resolve()

/** One import at a time, so each slug is chosen after the previous import is recorded. */
export function importSound(host: Host, rawPath: string): Promise<ImportResult> {
  const run = importQueue.then(() => importOne(host, rawPath)).catch((error): ImportResult => {
    logError(host, 'importSound', error)
    return { ok: false, error: IMPORT_FAILED }
  })
  importQueue = run
  return run
}

async function importOne(host: Host, rawPath: string): Promise<ImportResult> {
  const platform = await detectPlatform(host)
  const path = await expandPath(host, rawPath, platform)
  const stat = path === '' ? null : await host.stat(path).catch(() => null)
  const ext = extOf(path)
  const problem = importProblem(path, stat, ext, allowedExts(platform.os, platform.player))
  if (problem !== null || stat === null || ext === null) return { ok: false, error: problem ?? `No file at ${path}.` }

  const homeDir = await home(host, platform)
  if (homeDir === null) return { ok: false, error: 'Could not find your home folder.' }
  const { imports } = await ensureLoaded(host)
  const { dir, sep } = await soundsDir(host, platform, homeDir)
  const onDisk = (await host.list(dir).catch(() => [])).map(entry => stripExt(entry.name))
  const name = basename(path)
  const slug = slugify(name, new Set([...imports.map(sound => sound.id.slice('user:'.length)), ...onDisk]))
  const target = `${dir}${sep}${slug}.${ext}`
  const copy = copyCommand(platform.os, path, dir, target)
  const isCopy = (await host.run(copy.argv, { env: copy.env }).catch(() => null))?.exitCode === 0
  const file = isCopy ? target : path

  let info: { durationMs: number; peaks: number[] } | null = null
  if (ext === 'wav') {
    const bytes = await host.readBytes(file).catch(() => host.readBytes(path).catch(() => null))
    info = bytes === null ? null : parseWav(decodeBase64(bytes.base64))
  }
  const sound: ImportedSound = {
    id: `user:${slug}`,
    name: stripExt(name),
    file,
    ext,
    bytes: stat.size,
    durationMs: info?.durationMs ?? null,
    peaks: info?.peaks ?? null,
    isCopy,
  }
  let isDuplicate = false
  await changeImports(host, list => {
    isDuplicate = list.some(s => s.id === sound.id)
    return isDuplicate ? list : [...list, sound]
  })
  if (isDuplicate) return { ok: false, error: IMPORT_FAILED }
  return { ok: true, sound, warning: isCopy ? null : COPY_WARNING }
}

/** Whether `file` lies inside `dir` (separator-aware prefix check). */
function isInside(file: string, dir: string, sep: string): boolean {
  return file.startsWith(dir + sep) && !file.slice(dir.length + 1).split(/[\\/]/).includes('..')
}

/** Removes the import, its copy on disk (never the original), and every use of it (spec §7.2). */
export async function deleteImport(host: Host, id: SoundId): Promise<boolean> {
  try {
    const { imports } = await ensureLoaded(host)
    const sound = imports.find(s => s.id === id)
    if (sound === undefined) return false
    if (sound.isCopy) {
      const platform = await detectPlatform(host)
      const homeDir = await home(host, platform)
      const { dir, sep } = await soundsDir(host, platform, homeDir ?? '')
      if (isInside(sound.file, dir, sep)) {
        const remove = deleteCommand(platform.os, sound.file)
        await host.run(remove.argv, remove.env === undefined ? undefined : { env: remove.env }).catch(() => null)
      }
    }
    await changeSettings(host, settings => resetSound(settings, id))
    await changeImports(host, list => list.filter(s => s.id !== id))
    return true
  } catch (error) {
    logError(host, 'deleteImport', error)
    return false
  }
}
