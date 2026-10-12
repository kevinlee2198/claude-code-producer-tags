# Producer Tags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and ship the Producer Tags Claude Code mod. It plays parody producer tags when Claude commits, pushes, merges, passes tests, switches models, or exits. It includes a `/tags` pane, a now-playing band, tool-row badges, and user imports.

**Architecture:** The mod is a single function-hooks plugin under `plugin/`. It is split into small units:
- `shell` and `triggers`: pure functions that turn events into trigger hits.
- `settings`: store load, migrate, and merge.
- `library`: sounds and WAV parsing.
- `platform` and `player`: OS routing for playback.
- `stage` and `pipeline`: claim, cooldown, play, and finish.
- `imports`: user audio files.
- `ui/*`: pane, band, badges, and mode label.

`register.tsx` only wires these units to events. Default tags are rendered offline by a Python (stdlib-only) generator into committed WAVs plus a generated `hooks/catalog.ts`.

**Tech Stack:** TypeScript with JSX through the global `h`, in the Claude Code 2.1.296 mod API. Tests use `claude-code/testing` via `claude plugin test`. Type-checking uses `tsc` 5.6 against a vendored `claude-code.d.ts`. The generator is Python 3 (stdlib only) and renders voices with Windows SAPI via `powershell.exe` (WSL or Windows) or macOS `say`.

**Spec:** `docs/superpowers/specs/2026-10-10-producer-tags-design.md` (rev 3). Read it before starting any task.

## Global Constraints

- **Plugin name:** `producer-tags`. Every `$.state` reference uses `{ plugin: 'producer-tags', key: <literal> } as const`.
- **Install line (README):** `/plugin install producer-tags --marketplace kevinlee2198/claude-code-producer-tags`.
- **Platform tiers:**
  - Tier 1: macOS.
  - Tier 2: Linux.
  - Tier 3: Windows/WSL. Rough edges there are documented, not release blockers.
- **The `tool.call` hook:**
  - Always returns `await next(e)` unchanged.
  - Never denies a call, and never awaits tag work.
  - Tag work is scheduled with `$.clock.after(0, …)`.
- **No network, no telemetry.**
- **Command answers:**
  - `/tags` answers exactly `Opened Producer Tags.`
  - `/mute` answers `Tags muted.` or `Tags unmuted.`
- **Toasts:** at most one per cause per session. The causes are `no-player`, `playback-failed`, `corrupt-settings`, and `missing:<soundId>`.
- **Timing constants:**

  | Constant | Value |
  |---|---|
  | `COOLDOWN_MS` | 30000 |
  | `MAX_CLIP_MS` | 15000 |
  | `CLAIM_GRACE_MS` | 5000 |
  | `END_TAIL_MS` | 1000 |
  | `FRAME_MS` | 100 |

- **Limits:** at most 20 custom triggers, patterns of at most 200 characters, and imports of at most 4 MiB.
- **Default volume** is 80. Gain is `volume / 100`.
- **Captions are provisional.** Lines are finalized with the user in Task 5's listening review before anything is committed.
- **Unofficial parody disclaimer, verbatim:** "Unofficial parody fan project. Not affiliated with or endorsed by Anthropic or any producer or artist."
- **Module rules:** a hooks module and everything it imports must be `.ts`/`.tsx`. JSON can't be imported, so the catalog is generated as `hooks/catalog.ts`.
- **Environment:** there is no `import()`, no Node, and no timers. Waiting uses `$.clock`, and base64 uses `hooks/codec.ts`.
- **Commits:** end every commit message with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

These inputs are implied by the spec but no task's main tests cover them. Each one is pinned by an extra test in the task named in brackets:

1. **Drag-and-dropped import paths.** Terminals paste them quoted (`'/Users/me/My Tags/x.wav'`) or with escaped spaces (`/Users/me/My\ Tags/x.wav`). Import should find the file instead of reporting "No file". [Task 9]
2. **Non-ASCII and emoji file names** (`Mi tag ✨ (final).wav`). These should get a clean slug (`mi-tag-final`), and the copy should not break on spaces or quotes. [Task 12]
3. **Settings written by a newer release** (`version: 2` with unknown keys), read after a downgrade. Load should keep every field it understands and must not reset to defaults or toast "corrupt". [Task 4]
4. **Odd model IDs in `PostModelSwitch`:**
   - An empty `from_model`, as on the first switch, should fire.
   - `opusplan`, `default`, or `claude-sonnet-5-5[1m]` → `claude-sonnet-5-5` should be classified sensibly, without firing on suffix-only changes.

   [Task 3]
5. **Windows `\r\n` line endings** in a Bash command. `git status\r\nnpm test` should still split, and `\r` must not end up glued to a word such as `test\r`. [Task 2]

---

## File map

```
.claude-plugin/marketplace.json        marketplace listing (source ./plugin)
.github/workflows/ci.yml               typecheck + python + plugin validate/test
.gitignore
package.json, tsconfig.json            dev-only: TypeScript for type-checking
typings/claude-code.d.ts               vendored API snapshot (2.1.296), not shipped
plugin/.claude-plugin/plugin.json
plugin/hooks/hooks.json                { "modules": ["./register.tsx"] }
plugin/hooks/register.tsx              wiring only
plugin/hooks/constants.ts              ids, defaults, timings, trigger table
plugin/hooks/state.ts                  $.state atoms
plugin/hooks/notify.ts                 toastOnce, logError
plugin/hooks/codec.ts                  base64 + UTF-16LE base64
plugin/hooks/shell.ts                  heredoc strip, tokenizer, prefix strip
plugin/hooks/triggers.ts               event → Hit (pure)
plugin/hooks/settings.ts               defaults, normalize, ensureLoaded, change*
plugin/hooks/catalog.ts                GENERATED by tools/generate-tags
plugin/hooks/library.ts                WAV parse, peaks, slug, resolveSound
plugin/hooks/platform.ts               OS + player detection
plugin/hooks/player.ts                 play / playDetached per OS
plugin/hooks/stage.ts                  isLive / isOnStage (pure)
plugin/hooks/pipeline.ts               fire, finish, stopCurrent, fireDetached, toggleMute, recoverStage
plugin/hooks/imports.ts                importSound, deleteImport
plugin/hooks/ui/visual.ts              bars, waveform, caption word (pure)
plugin/hooks/ui/animate.ts             the 10 fps band frame loop
plugin/hooks/ui/band.tsx               AbovePrompt band
plugin/hooks/ui/badges.tsx             ToolUse badges
plugin/hooks/ui/mode.tsx               SessionMode label
plugin/hooks/ui/pane-actions.ts        pane state transforms + actions
plugin/hooks/ui/pane.tsx               /tags pane (and the fader's ui.message)
plugin/hooks/ui/fader.client.tsx       Client volume fader
plugin/types/index.d.ts                shared types + PluginState contract
plugin/sounds/*.wav                    GENERATED
plugin/tests/world.tsx                 test fakes (shared by $-level tests)
plugin/tests/*.test.ts(x)
tools/generate-tags/{tags.json,audio.py,fx.py,generate.py,smoke_test.py,test_audio.py}
tools/generate-tags/voices/{__init__.py,sapi.py,say.py}
docs/ROADMAP.md, README.md, CHANGELOG.md, LICENSE
```

**Commands used throughout** (run from the repo root):

| Command | Purpose |
|---|---|
| `claude plugin test plugin` | runs every `plugin/**/*.test.ts(x)`; exits 1 on any failure; has no per-file filter, so read the per-file lines |
| `claude plugin validate plugin` | validates the plugin |
| `npx tsc -p .` | type-checks |
| `python3 -I -m unittest discover -s tools/generate-tags -p 'test_*.py'` | generator unit tests |
| `python3 -I tools/generate-tags/smoke_test.py` | generator smoke test |

---

### Task 0: Runtime spike (throwaway): verify spec §14 before building

The answers here change constants and fallbacks in later tasks, so this task comes first. Nothing from it is kept except the recorded results.

**Files:**
- Create (throwaway, gitignored): `.spike/.claude-plugin/plugin.json`, `.spike/hooks/hooks.json`, `.spike/hooks/register.tsx`, `.spike/hooks/fader.tsx`, `.spike/check-mediaplayer.sh`, `.spike/test.wav` (generated)
- Modify: `docs/superpowers/specs/2026-10-10-producer-tags-design.md` §14 (record the results)
- Create: `.gitignore`

**Interfaces:**
- Produces:
  - the **`WINDOWS_ENGINE`** value (`'mediaplayer'` or `'soundplayer'`) used in Task 1's `constants.ts`
  - a results table in spec §14
  - a go/no-go for Task 8 (R1)

- [ ] **Step 1: Create `.gitignore`**

```gitignore
.spike/
node_modules/
plugin/.claude-plugin/types/
__pycache__/
*.pyc
```

- [ ] **Step 2: Write the spike mod**

`.spike/.claude-plugin/plugin.json`:
```json
{ "name": "pt-spike", "version": "0.0.0", "description": "Producer Tags runtime spike (throwaway)" }
```

`.spike/hooks/hooks.json`:
```json
{ "modules": ["./register.tsx"] }
```

`.spike/hooks/fader.tsx`:
```tsx
import type { ClientModule } from 'claude-code'

type State = { x: number; events: number }

const Fader: ClientModule<Record<string, never>, State> = (_props, surface) => {
  const { Text } = surface.elements
  const state = surface.state ?? { x: 0, events: 0 }
  surface.onPointer(event => {
    const now = surface.state ?? state
    surface.setState({ x: event.x, events: now.events + 1 })
    surface.post({ pointer: event.type, x: event.x })
  })
  return <Text>pointer events: {state.events} x={state.x}</Text>
}

export default Fader
```

`.spike/hooks/register.tsx`:
```tsx
import type { Register } from 'claude-code'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'spike-pane', description: 'pt spike: pane' })
    try {
      await $.command.register({ name: 'mute', description: 'pt spike mute', immediate: true })
      $.ui.toast('R5: /mute registered with immediate')
    } catch (error) {
      $.ui.toast(`R5: /mute refused: ${String(error)}`)
    }
    return next(e)
  })

  // R1: does clock.after(0) run after the tool call, outside its signal, for > 10 s?
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (e.command.includes('pt-spike-r1')) {
      $.clock.after(0, () => {
        void (async () => {
          const started = await $.clock.now()
          await $.process.run(['sleep', '12'], { timeoutMs: 20000 })
          const done = await $.clock.now()
          $.ui.toast(`R1: after(0) callback ran ${Math.round((done - started) / 1000)}s`)
          void $.process.run(['sleep', '1']).then(() => $.ui.toast('R1: continuation after the callback works'))
        })()
      })
    }
    return ran
  })

  // R4: pointer and hover on the main screen and in fullscreen
  on('command.run', { command: 'spike-pane' }, async $ => {
    await $.ui.open({ id: 'pt-spike', title: 'pt spike', focus: true, closeOnEscape: true })
    return { text: 'pane open' }
  })
  on('ui.render', { component: 'Pane', requestId: 'pt-spike' }, async ($, e, next) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)
    const { Box, Text, Client } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Client key="fader" module="./fader.tsx" width={30} height={1} />
        <Box key="hoverbox" gap={1}>
          <Text hover={{ scope: 'spike', bold: true, color: 'claude' }}>R4: hover me</Text>
          <Box display="none" hover={{ scope: 'spike', display: 'flex' }}>
            <Text>hover card visible</Text>
          </Box>
        </Box>
      </Box>
    )
  })
  on('ui.message', async ($, e) => {
    $.ui.toast(`R4: ${JSON.stringify(e.data)} element=${e.element}`)
    return {}
  })

  // R3: does a detached child, launched without awaiting it, survive exit? (the pattern Task 8 ships)
  on('session.end', ($, e, next) => {
    const marker = '/tmp/pt-spike-detached'
    void $.process.run(['sh', '-c', `rm -f ${marker}; (sleep 3; echo "${e.reason}" > ${marker}) >/dev/null 2>&1 &`])
    return next(e)
  })
}
```

- [ ] **Step 3: Validate the spike**

Run: `claude plugin validate .spike`
Expected: `✔ Validation passed` (an author warning is fine).

- [ ] **Step 4: Run the live checks (interactive; the user drives the terminal)**

Ask the user to run `claude --plugin-dir .spike` in a terminal at least 144 columns wide. Start **not** in fullscreen mode, then:

| Check | Action | Expected / record |
|---|---|---|
| R1 | Ask Claude to run `echo pt-spike-r1` | After about 12 s, a toast reads "R1: after(0) callback ran 12s", followed by the "R1: continuation…" toast. Record yes/no. |
| R4 | `/spike-pane`, then click and drag on the fader line, and hover "hover me" | Do pointer toasts appear? Does the hover card show? Record both, then repeat in fullscreen mode. |
| R5 | Read the toast at startup | Record "registered" or "refused". |
| R3 | `/exit`, wait 4 s, then run `cat /tmp/pt-spike-detached` | `prompt_input_exit` means detached children survive exit. |

Repeat R1, R3, and R4 on a Mac (tier 1) before Task 15. If no Mac is available now, record "pending (mac)".

- [ ] **Step 5: Check Windows MediaPlayer from this machine (WSL; R2)**

`.spike/check-mediaplayer.sh`:
```bash
#!/usr/bin/env bash
# R2: can powershell.exe play a WAV headless with MediaPlayer, -STA, ticks, volume?
set -uo pipefail
cd "$(dirname "$0")"
python3 -I - <<'PY'
import math, struct, wave
with wave.open('test.wav', 'wb') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(22050)
    w.writeframes(b''.join(struct.pack('<h', int(12000 * math.sin(2 * math.pi * 440 * i / 22050))) for i in range(22050)))
PY
SCRIPT=$(cat <<'PS'
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName PresentationCore
$player = New-Object System.Windows.Media.MediaPlayer
$player.Open([Uri]::new($env:PT_FILE))
$player.Volume = [double]$env:PT_GAIN
$player.Play()
[Console]::Out.WriteLine('started'); [Console]::Out.Flush()
$clock = [Diagnostics.Stopwatch]::StartNew()
while ($clock.ElapsedMilliseconds -lt [int]$env:PT_MS) { Start-Sleep -Milliseconds 100; [Console]::Out.WriteLine('t'); [Console]::Out.Flush() }
$player.Stop(); $player.Close()
PS
)
ENCODED=$(printf '%s' "$SCRIPT" | iconv -t UTF-16LE | base64 -w0)
for GAIN in 0.2 1.0; do
  echo "--- gain $GAIN"
  PT_FILE="$PWD/test.wav" PT_GAIN=$GAIN PT_MS=1000 WSLENV="${WSLENV:+$WSLENV:}PT_FILE/p:PT_GAIN:PT_MS" \
    powershell.exe -NoProfile -NonInteractive -STA -EncodedCommand "$ENCODED"
  echo "exit=$?"
done
```

Run: `bash .spike/check-mediaplayer.sh`

Expected, twice: `started`, then about 10 `t` lines, then `exit=0`. The user should hear a quiet tone and then a loud one.

Record:
- whether it was audible
- whether the second play was clearly louder, which means volume works
- whether the `\\wsl.localhost` path worked

If it is silent or errors, set `WINDOWS_ENGINE = 'soundplayer'` in Task 1.

- [ ] **Step 6: Check CI without credentials (R6)**

Run: `HOME="$(mktemp -d)" claude plugin validate .spike; HOME="$(mktemp -d)" claude plugin test .spike; echo "exit=$?"`

Expected: validation passes, and `test` reports 0 tests without an auth error. Record yes/no.

- [ ] **Step 7: Record the results in spec §14 and commit**

Append a table `| Risk | Result (WSL) | Result (macOS) | Consequence |` to spec §14, with one row per R0–R7:
- R0 is deferred until a Windows install is available; Task 15 handles it.
- R7 is deferred to Task 5's listening review.

Each "no" names its consequence:

- **R1 no:** stop and re-plan with the user before Task 8. The pipeline cannot run in the tool call's dispatch.
- **R2 no:** set `WINDOWS_ENGINE = 'soundplayer'`. If only the UNC path failed, Task 15 adds the `%TEMP%` copy.
- **R3 no:** README documents the exit outro as best-effort.
- **R4 no:** apply the "If R4 no" steps in Task 11 (no hover card) and Task 13 (fader only in fullscreen).
- **R5 refused:** nothing to change. The plan already falls back to `/tags-mute`.
- **R6 no:** in Task 14, set the CI plugin job to `continue-on-error: true` and keep the comment explaining why.

```bash
git add .gitignore docs/superpowers/specs/2026-10-10-producer-tags-design.md
git commit -m "docs: record runtime spike results in spec §14

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 1: Scaffold, shared types, constants, state, codec

**Files:**
- Create:
  - `package.json`, `tsconfig.json`, `typings/claude-code.d.ts`
  - `.claude-plugin/marketplace.json`
  - `plugin/.claude-plugin/plugin.json`, `plugin/hooks/hooks.json`
  - `plugin/types/index.d.ts`
  - `plugin/hooks/constants.ts`, `plugin/hooks/state.ts`, `plugin/hooks/notify.ts`, `plugin/hooks/codec.ts`
  - `plugin/hooks/register.tsx` (minimal), `plugin/hooks/catalog.ts` (bootstrap)
- Test: `plugin/tests/codec.test.ts`

**Interfaces:**
- **Produces:**
  - All the types in `plugin/types/index.d.ts` (below).
  - From `constants.ts`: `PLUGIN`, `PANE_ID`, `TRIGGERS`, `TriggerDef`, `BASH_PRIORITY`, `FALLBACK_SOUND`, the timing constants, and `WINDOWS_ENGINE`.
  - From `state.ts`, these atoms: `settingsAtom`, `importsAtom`, `nowPlayingAtom`, `bandFrameAtom`, `captionWordAtom`, `taggedAtom`, `platformAtom`, `cooldownsAtom`, `toastedAtom`, `paneDraftAtom`, plus `EMPTY_DRAFT`.
  - From `notify.ts`: `toastOnce($, cause, text)`, `logError($, where, error)`, and `act($, where, work: () => Promise<unknown>)`, the one fire-and-forget helper (failures go to the debug log).
  - From `codec.ts`: `encodeBase64(bytes)`, `decodeBase64(text)`, and `encodeUtf16LeBase64(text)`.

- [ ] **Step 1: Dev tooling**

`package.json`:
```json
{
  "name": "claude-code-producer-tags",
  "private": true,
  "scripts": {
    "typecheck": "tsc -p .",
    "test": "claude plugin test plugin",
    "validate": "claude plugin validate plugin"
  },
  "devDependencies": {
    "typescript": "5.6.3"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "es2023",
    "lib": ["es2023"],
    "types": [],
    "module": "esnext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "jsx": "react",
    "jsxFactory": "h",
    "jsxFragmentFactory": "Fragment"
  },
  "include": ["typings", "plugin/hooks", "plugin/types", "plugin/tests"]
}
```

Vendor the API snapshot. The engine writes the types file to a temp folder whose name changes every time Claude Code restarts, so never hard-code the path. Use one of these sources:
- Load the `plugin-authoring` skill. It names this process's copy: `/tmp/claude-1000/bundled-skills/2.1.296/<hash>/plugin-authoring/types/claude-code.d.ts`.
- Or, after Task 0's live session has loaded the spike with `--plugin-dir`, copy `.spike/.claude-plugin/types/claude-code/index.d.ts`.

`claude plugin validate` and `claude plugin test` do not write it.

```bash
mkdir -p typings
cp "<path from above>" typings/claude-code.d.ts
head -1 typings/claude-code.d.ts   # must print: // Written by Claude Code 2.1.296.
npm install
```

- [ ] **Step 2: Manifests**

`.claude-plugin/marketplace.json`:
```json
{
  "name": "producer-tags",
  "owner": { "name": "Kevin Lee" },
  "plugins": [{ "name": "producer-tags", "source": "./plugin" }]
}
```

`plugin/.claude-plugin/plugin.json`:
```json
{
  "name": "producer-tags",
  "version": "0.1.0",
  "description": "Parody producer tags when Claude Code commits, pushes, merges, passes tests, switches models or exits.",
  "author": { "name": "Kevin Lee" },
  "types": "./types/index.d.ts"
}
```

`plugin/hooks/hooks.json`:
```json
{ "modules": ["./register.tsx"] }
```

- [ ] **Step 3: Shared types and state contract**

`plugin/types/index.d.ts`:
```ts
export type TriggerId =
  | 'git.commit'
  | 'git.push'
  | 'git.merge'
  | 'tests.pass'
  | 'command.fail'
  | 'model.opus'
  | 'model.fable'
  | 'model.sonnet'
  | 'model.haiku'
  | 'model.other'
  | 'session.open'
  | 'session.close'
  | 'turn.done'

/** Cooldown and now-playing key: a built-in trigger, `custom:<id>`, or a preview. */
export type TriggerKey = TriggerId | `custom:${string}` | 'preview'

/** `pt:<id>` for a bundled sound, `user:<slug>` for an import. */
export type SoundId = string

export type Outcome = 'success' | 'fail' | 'any'

export type CustomTrigger = {
  id: string
  pattern: string
  outcome: Outcome
  sound: SoundId
  enabled: boolean
  isInvalid: boolean
}

export type TriggerSetting = { enabled: boolean; sound: SoundId }

export type Settings = {
  version: 1
  muted: boolean
  volume: number
  triggers: Record<TriggerId, TriggerSetting>
  custom: CustomTrigger[]
  studio: { band: boolean; badges: boolean }
}

export type AudioExt = 'wav' | 'mp3' | 'm4a' | 'aiff'

export type ImportedSound = {
  id: SoundId
  name: string
  file: string
  ext: AudioExt
  bytes: number
  durationMs: number | null
  peaks: number[] | null
  isCopy: boolean
}

export type CatalogEntry = {
  id: SoundId
  file: string
  caption: string
  riff: string
  durationMs: number
  peaks: number[]
  isVoice: boolean
}

export type NowPlaying = {
  token: string
  soundId: SoundId
  key: TriggerKey
  caption: string
  riff: string
  claimedAt: number
  startedAt: number | null
  endedAt: number | null
  durationMs: number | null
  deadline: number
  peaks: number[] | null
  toolUseId: string | null
}

export type OsName = 'mac' | 'linux' | 'wsl' | 'windows'
export type LinuxPlayer = 'pw-play' | 'paplay' | 'ffplay' | 'aplay'
export type PlayerName = 'audio' | 'powershell' | LinuxPlayer | 'none'
export type Platform = { os: OsName; player: PlayerName }

export type PaneMessage = { kind: 'ok' | 'error'; text: string }

export type PaneDraft = {
  isAdding: boolean
  customPattern: string
  customOutcome: Outcome
  customSound: SoundId
  importPath: string
  message: PaneMessage | null
}

declare module 'claude-code' {
  interface PluginState {
    'producer-tags': {
      settings: Settings | null
      imports: ImportedSound[] | null
      nowPlaying: NowPlaying | null
      bandFrame: number
      captionWord: number
      tagged: StateFamily<SoundId | null>
      platform: Platform | null
      cooldowns: Partial<Record<TriggerKey, number>>
      paneDraft: PaneDraft
      toasted: string[]
    }
  }
}
```

- [ ] **Step 4: Constants, state atoms, notify**

`plugin/hooks/constants.ts`:
```ts
import type { SoundId, TriggerId } from '../types'

export const PLUGIN = 'producer-tags'
export const PANE_ID = 'producer-tags'

/** Set from Task 0's R2 result: 'soundplayer' when MediaPlayer could not play headless. */
export const WINDOWS_ENGINE: 'mediaplayer' | 'soundplayer' = 'mediaplayer'

export type TriggerDef = {
  id: TriggerId
  label: string
  enabled: boolean
  sound: SoundId
}

export const TRIGGERS: readonly TriggerDef[] = [
  { id: 'git.commit', label: 'git commit', enabled: true, sound: 'pt:anthropic-trust' },
  { id: 'git.merge', label: 'git merge', enabled: true, sound: 'pt:just-merged' },
  { id: 'git.push', label: 'git push', enabled: true, sound: 'pt:did-it-again' },
  { id: 'tests.pass', label: 'tests pass', enabled: true, sound: 'pt:tests-passin' },
  { id: 'command.fail', label: 'command fails', enabled: false, sound: 'pt:tay-keith-fix' },
  { id: 'model.opus', label: '→ Opus', enabled: true, sound: 'pt:opus-come-out' },
  { id: 'model.fable', label: '→ Fable', enabled: true, sound: 'pt:fable-on-beat' },
  { id: 'model.sonnet', label: '→ Sonnet', enabled: true, sound: 'pt:sonnet-booth' },
  { id: 'model.haiku', label: '→ Haiku', enabled: true, sound: 'pt:haiku-quick' },
  { id: 'model.other', label: '→ other model', enabled: true, sound: 'pt:who-let-model' },
  { id: 'session.open', label: 'session start', enabled: false, sound: 'pt:khaled-claude' },
  { id: 'session.close', label: 'exit', enabled: true, sound: 'pt:claude-outta' },
  { id: 'turn.done', label: 'turn done', enabled: false, sound: 'pt:another-one' },
]

/** One sound per Bash event: the first enabled candidate in this order wins (after custom triggers). */
export const BASH_PRIORITY: readonly TriggerId[] = ['git.merge', 'git.push', 'git.commit', 'tests.pass', 'command.fail']

export const FALLBACK_SOUND: SoundId = 'pt:808-boom'
export const DEFAULT_VOLUME = 80
export const COOLDOWN_MS = 30_000
export const MAX_CLIP_MS = 15_000
export const CLAIM_GRACE_MS = 5_000
export const END_TAIL_MS = 1_000
export const FRAME_MS = 100
export const MAX_CUSTOM = 20
export const MAX_PATTERN_LENGTH = 200
export const MAX_IMPORT_BYTES = 4 * 1024 * 1024
```

`plugin/hooks/state.ts`:
```ts
import { atom } from 'claude-code'

import type { PaneDraft } from '../types'
import { FALLBACK_SOUND } from './constants'

export const settingsAtom = atom({ plugin: 'producer-tags', key: 'settings' } as const, null)
export const importsAtom = atom({ plugin: 'producer-tags', key: 'imports' } as const, null)
export const nowPlayingAtom = atom({ plugin: 'producer-tags', key: 'nowPlaying' } as const, null)
export const bandFrameAtom = atom({ plugin: 'producer-tags', key: 'bandFrame' } as const, 0)
export const captionWordAtom = atom({ plugin: 'producer-tags', key: 'captionWord' } as const, -1)
export const taggedAtom = atom({ plugin: 'producer-tags', key: 'tagged' } as const, null)
export const platformAtom = atom({ plugin: 'producer-tags', key: 'platform' } as const, null)
export const cooldownsAtom = atom({ plugin: 'producer-tags', key: 'cooldowns' } as const, {})
export const toastedAtom = atom({ plugin: 'producer-tags', key: 'toasted' } as const, [])

export const EMPTY_DRAFT: PaneDraft = {
  isAdding: false,
  customPattern: '',
  customOutcome: 'success',
  customSound: FALLBACK_SOUND,
  importPath: '',
  message: null,
}
export const paneDraftAtom = atom({ plugin: 'producer-tags', key: 'paneDraft' } as const, EMPTY_DRAFT)
```

`plugin/hooks/notify.ts`:
```ts
import { update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { toastedAtom } from './state'

export type ToastCause = 'no-player' | 'playback-failed' | 'corrupt-settings' | `missing:${string}`

/** Shows `text` the first time `cause` happens in this session, never again. */
export async function toastOnce($: EngineInterface, cause: ToastCause, text: string): Promise<void> {
  let isFirst = false
  await update($, toastedAtom, list => {
    isFirst = !list.includes(cause)
    return isFirst ? [...list, cause] : list
  })
  if (isFirst) $.ui.toast(text)
}

export function logError($: EngineInterface, where: string, error: unknown): void {
  const text = error instanceof Error ? error.message : String(error)
  $.ui.log(`producer-tags: ${where}: ${text}`, { to: 'debug' })
}

/** Starts work without awaiting it; a failure goes to the debug log, never up (spec §10). */
export function act($: EngineInterface, where: string, work: () => Promise<unknown>): void {
  void Promise.resolve()
    .then(work)
    .catch(error => logError($, where, error))
}
```

- [ ] **Step 5: Write the failing codec test**

`plugin/tests/codec.test.ts`:
```ts
import { describe, expect, test } from 'claude-code/testing'

import { decodeBase64, encodeBase64, encodeUtf16LeBase64 } from '../hooks/codec'

const bytes = (...values: number[]) => new Uint8Array(values)

describe('codec', () => {
  test('encodes with padding', () => {
    expect(encodeBase64(bytes())).toBe('')
    expect(encodeBase64(bytes(0x66))).toBe('Zg==')
    expect(encodeBase64(bytes(0x66, 0x6f))).toBe('Zm8=')
    expect(encodeBase64(bytes(0x66, 0x6f, 0x6f))).toBe('Zm9v')
    expect(encodeBase64(bytes(0xff, 0x00, 0xfe, 0x01))).toBe('/wD+AQ==')
  })

  test('decodes what it encodes, ignoring whitespace', () => {
    const original = new Uint8Array(1000).map((_, i) => (i * 37) % 256)
    const text = encodeBase64(original)
    expect([...decodeBase64(text)]).toEqual([...original])
    expect([...decodeBase64('Zm9v\nYmFy')]).toEqual([...new TextEncoder().encode('foobar')])
  })

  test('UTF-16LE base64 matches what powershell -EncodedCommand expects', () => {
    expect(encodeUtf16LeBase64('ab')).toBe('YQBiAA==')
    expect(encodeUtf16LeBase64('$env:X')).toBe('JABlAG4AdgA6AFgA')
  })
})
```

- [ ] **Step 6: Run it to see it fail**

Run: `claude plugin test plugin`
Expected: FAIL. `tests/codec.test.ts` cannot resolve `../hooks/codec`.

- [ ] **Step 7: Implement the codec, the bootstrap catalog, and a minimal register**

`plugin/hooks/codec.ts`:
```ts
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
```

`plugin/hooks/catalog.ts` is a bootstrap until Task 5 regenerates it. Entries have empty peaks and no files on disk yet.
```ts
// Bootstrap catalog: replaced by tools/generate-tags/generate.py in Task 5.
import type { CatalogEntry } from '../types'

const entry = (id: string, caption: string, riff: string, isVoice = true): CatalogEntry => ({
  id: `pt:${id}`,
  file: `sounds/${id}.wav`,
  caption,
  riff,
  durationMs: 2000,
  peaks: [],
  isVoice,
})

export const CATALOG: readonly CatalogEntry[] = [
  entry('anthropic-trust', "If Anthropic don't trust you, I'm gon' shoot you", 'Metro Boomin'),
  entry('just-merged', 'Oh Lord, Claude just merged another one', 'Jetsonmade'),
  entry('did-it-again', 'Claude Code, you did it again', 'Mike WiLL Made-It'),
  entry('tests-passin', "We got tests passin' on the track", 'original'),
  entry('opus-come-out', 'Yo Opus, you wanna come out here?', "Pi'erre Bourne"),
  entry('fable-on-beat', "Fable on the beat, so it's a banger", 'Murda Beatz'),
  entry('sonnet-booth', 'Sonnet in the booth, write it down', 'original'),
  entry('haiku-quick', 'Haiku on the beat, make it quick', 'original'),
  entry('who-let-model', 'Who let this model on the track?', 'original'),
  entry('claude-outta', 'Claude outta here', 'Wheezy'),
  entry('khaled-claude', 'Claude Code, Claude Code, Claude Code-ah', 'DJ Khaled'),
  entry('another-one', 'Another one', 'DJ Khaled'),
  entry('tay-keith-fix', 'Tay Keith, fix this', 'Tay Keith'),
  entry('808-boom', '808 boom', 'studio', false),
  entry('riser', 'Riser', 'studio', false),
  entry('scratch', 'Scratch', 'studio', false),
]
```

`plugin/hooks/register.tsx` is a minimal placeholder that loads and does nothing. Task 8 fills it.
```tsx
import type { Register } from 'claude-code'

export const register: Register = () => {}
```

- [ ] **Step 8: Run tests, type-check, validate**

Run: `claude plugin test plugin && npx tsc -p . && claude plugin validate plugin`
Expected:
- the tests report `3 pass`
- `tsc` prints nothing and exits 0
- validation prints `✔ Validation passed`

If `tsc` reports `atom` initial-value type errors for `null`/`{}`/`[]`, annotate the initial with its declared type, for example `null as Settings | null` (import the type from `../types`). The declared contract is the authority.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json tsconfig.json typings .claude-plugin plugin
git commit -m "feat: scaffold producer-tags mod with shared types, state and codec

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Shell tokenizer (`shell.ts`)

**Files:**
- Create: `plugin/hooks/shell.ts`
- Test: `plugin/tests/shell.test.ts`

**Interfaces:**
- **Consumes:** nothing.
- **Produces:**
  - `type Op = '&&' | '||' | '|' | '|&' | ';' | '&'`
  - `type Segment = { words: string[]; op: Op | null }`, where `op` is the operator *after* the segment
  - `stripHeredocs(command: string): string`
  - `splitCommand(command: string): Segment[]`, which returns raw words
  - `stripPrefixes(words: readonly string[]): string[]`
  - `commandSegments(command: string, depth?: number): Segment[]`, which strips prefixes, recurses one level into `bash|sh|zsh -c`, and drops empty segments
  - `startsWithTokens(words: readonly string[], tokens: readonly string[]): boolean`

- [ ] **Step 1: Write the failing tests**

`plugin/tests/shell.test.ts`:
```ts
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
```


- [ ] **Step 2: Run the tests to see them fail**

Run: `claude plugin test plugin`
Expected: FAIL. `tests/shell.test.ts` cannot resolve `../hooks/shell`.

- [ ] **Step 3: Implement**

`plugin/hooks/shell.ts`:
```ts
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
```


- [ ] **Step 4: Run the tests to see them pass**

Run: `claude plugin test plugin`
Expected: `tests/shell.test.ts` all pass, and `codec` still passes.

- [ ] **Step 5: Type-check and commit**

Run: `npx tsc -p .` (expected: exit 0)
```bash
git add plugin/hooks/shell.ts plugin/tests/shell.test.ts
git commit -m "feat: add heredoc-aware shell tokenizer for trigger matching

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Trigger detection (`triggers.ts`)

**Files:**
- Create: `plugin/hooks/triggers.ts`
- Create (minimal, completed in Task 4): `plugin/hooks/settings.ts`, containing `compilePattern` and `defaultSettings` only
- Test: `plugin/tests/triggers.test.ts`

**Interfaces:**
- **Consumes:**
  - from `shell.ts`: `commandSegments`, `startsWithTokens`, `stripHeredocs`, `Segment`
  - from `constants.ts`: `BASH_PRIORITY`, `TRIGGERS`, `MAX_PATTERN_LENGTH`
- **Produces (types):**
  - `type GitOperation = { commit?: { sha: string; kind: string }; push?: { branch: string }; branch?: { ref: string; action: string }; pr?: { number: number; action: string } }`
  - `type BashFacts = { command: string; isBackground: boolean; isInterrupted: boolean; isError: boolean; output: string; git: GitOperation | null }`
  - `type Hit = { key: TriggerKey; sound: SoundId }`
  - `type ToolRun = { deny?: string; isError?: boolean; result?: unknown; text?: string }`
- **Produces (functions):**
  - `bashFacts(input: { command: string; run_in_background?: boolean; isAborted?: boolean }, ran: ToolRun): BashFacts | null`. `isAborted` is the tool call's `next.signal.aborted`.
  - `isTestRunner(words): boolean`, `testsPassed(facts): boolean`, `gitTriggers(git): TriggerId[]`, `bashCandidates(facts): TriggerId[]`
  - `customMatches(trigger: CustomTrigger, facts: BashFacts): boolean`
  - `pickBashHit(settings: Settings, facts: BashFacts | null): Hit | null`
  - `familyOf(model: string)`, `normalizeModel(model: string)`, `modelTrigger(e: { from_model: string; to_model: string; source: string }): TriggerId | null`
  - `sessionOpenTrigger(source: string)`, `sessionCloseTrigger(reason: string)`, `turnDoneTrigger(stopHookActive: boolean)`
  - `hitFor(settings: Settings, id: TriggerId | null): Hit | null`
  - From `settings.ts` (partial): `compilePattern(pattern: string): RegExp | null` and `defaultSettings(): Settings`

- [ ] **Step 1: Create the minimal `settings.ts` that triggers depend on**

`plugin/hooks/settings.ts`:
```ts
import type { Settings, TriggerId, TriggerSetting } from '../types'
import { DEFAULT_VOLUME, MAX_PATTERN_LENGTH, TRIGGERS } from './constants'

export function defaultSettings(): Settings {
  const triggers = {} as Record<TriggerId, TriggerSetting>
  for (const t of TRIGGERS) triggers[t.id] = { enabled: t.enabled, sound: t.sound }
  return { version: 1, muted: false, volume: DEFAULT_VOLUME, triggers, custom: [], studio: { band: true, badges: true } }
}

/** A custom pattern as a case-insensitive regex, or null when it is empty, too long or invalid. */
export function compilePattern(pattern: string): RegExp | null {
  if (pattern.length === 0 || pattern.length > MAX_PATTERN_LENGTH) return null
  try {
    return new RegExp(pattern, 'i')
  } catch {
    return null
  }
}
```

- [ ] **Step 2: Write the failing tests**

`plugin/tests/triggers.test.ts`:
```ts
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
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `claude plugin test plugin`
Expected: FAIL. `tests/triggers.test.ts` cannot resolve `../hooks/triggers`.

- [ ] **Step 4: Implement**

`plugin/hooks/triggers.ts`:
```ts
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
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `claude plugin test plugin`
Expected: `tests/triggers.test.ts` all pass; earlier files still pass.

- [ ] **Step 6: Type-check and commit**

Run: `npx tsc -p .` (expected: exit 0)
```bash
git add plugin/hooks/triggers.ts plugin/hooks/settings.ts plugin/tests/triggers.test.ts
git commit -m "feat: detect git, test, model, session and custom triggers

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Settings: normalize, migrate, load, change

**Files:**
- Modify: `plugin/hooks/settings.ts` (complete it)
- Test: `plugin/tests/settings.test.ts`, `plugin/tests/world.tsx` (shared fakes, first version)

**Interfaces:**
- **Consumes:**
  - `CATALOG` (`catalog.ts`)
  - `toastOnce` (`notify.ts`)
  - `settingsAtom`, `importsAtom` (`state.ts`)
  - constants
- **Produces:**
  - `SETTINGS_KEY = 'settings'`, `IMPORTS_KEY = 'imports'`
  - `validatePattern(pattern): string | null`, which returns an error message or null
  - `migrate(raw: unknown): unknown`
  - `normalizeSettings(raw: unknown, known: ReadonlySet<SoundId>): { settings: Settings; isCorrupt: boolean }`
  - `normalizeImports(raw: unknown): ImportedSound[]`
  - `knownSounds(imports): Set<SoundId>`
  - `type Loaded = { settings: Settings; imports: ImportedSound[] }`
  - `ensureLoaded($): Promise<Loaded>` and `loadFromStore($): Promise<Loaded>`
  - `changeSettings($, change: (s: Settings) => Settings, options?: { persist?: boolean }): Promise<Settings>`
  - `changeImports($, change: (list: ImportedSound[]) => ImportedSound[]): Promise<ImportedSound[]>`
  - Test helpers in `tests/world.tsx`: `world(on, options)`, `bash($, w, command, answer?)`, `committed(kind?)`, the `OK` answer, the fixtures `PANE`, `BAND`, `EMPTY_WAV`, and the types `World` and `WorldOptions`
  - `World` records `plays`, `runs`, `spawns`, `toasts`, `state`, `stored`, `opened`, `registered` and `toolUseIds`, and answers Bash from `bash` or the per-command `bashBy`
  - `WorldOptions` covers `os`, `linuxPlayer`, `audioMs`, `audioFails`, `spawnTicks`, `store`, `env`, `files`, `runExit` and `refuse`

- [ ] **Step 1: Write the shared test world**

`plugin/tests/world.tsx`. Later tasks reuse it; when a later task touches a new `$` noun, add its fake here beside the others:
```tsx
import type { On } from 'claude-code'
import { mock, type Engine } from 'claude-code/testing'

import type { OsName } from '../types'

/** A 44-byte WAV header with no samples: parses, 0 ms long. */
export const EMPTY_WAV = 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAIlYAAESsAAACABAAZGF0YQAAAAA='

export const PANE = {
  plugin: 'producer-tags',
  component: 'Pane' as const,
  requestId: 'producer-tags',
  props: { title: 'Producer Tags', isFocused: true, bodyColumns: 100, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 80 }, view: {} },
}

export const BAND = {
  plugin: 'producer-tags',
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 120, scroll: { offset: 0, bodyRows: 4 }, view: {} },
}

export type BashAnswer =
  | { result: Record<string, unknown> }
  | { isError: true; result: unknown; text: string }

export type WorldOptions = {
  os?: OsName
  /** What `command -v` finds on linux. */
  linuxPlayer?: string
  /** How long (mock clock) a fake `$.audio.play` takes; 0 resolves at once. */
  audioMs?: number
  /** How many 100 ms `t` ticks a fake spawned player prints before exiting. */
  spawnTicks?: number
  store?: Record<string, unknown>
  env?: Record<string, string>
  files?: Record<string, string | { base64: string }>
  /** Exit code for a `$.process.run` the world does not special-case. */
  runExit?: (argv: readonly string[]) => number
  /** Command names `command.register` refuses (as a built-in or another plugin's would be). */
  refuse?: string[]
  /** `$.audio.play` rejects, as on a machine that cannot play the clip. */
  audioFails?: boolean
}

export type World = {
  clock: ReturnType<typeof mock.clock>
  plays: { clip: Record<string, unknown>; gain: number | undefined }[]
  runs: { argv: readonly string[]; env: Record<string, string> | undefined }[]
  spawns: { argv: readonly string[]; env: Record<string, string> | undefined; isEnded: boolean }[]
  toasts: string[]
  state: Map<string, unknown>
  opened: string[]
  registered: string[]
  toolUseIds: string[]
  files: Map<string, string | { base64: string }>
  /** What the plugin last wrote to `$.store`, by key. */
  stored: Map<string, unknown>
  /** The Bash answer for every call, unless `bashBy` has one for that exact command. */
  bash: BashAnswer
  bashBy: Record<string, BashAnswer>
}

export const OK: BashAnswer = { result: { stdout: '', stderr: '', interrupted: false } }

export const committed = (kind = 'committed'): BashAnswer => ({
  result: { stdout: '', stderr: '', interrupted: false, gitOperation: { commit: { sha: 'abc1234', kind } } },
})

const ran = (stdout: string, exitCode = 0) => ({
  exitCode,
  stdout,
  stderr: '',
  isStdoutTruncated: false,
  isStderrTruncated: false,
})

/** Fakes every `$` noun the mod touches, beneath the plugin. Call before the test's first `$` call. */
export function world(on: On, options: WorldOptions = {}): World {
  const os = options.os ?? 'mac'
  const clock = mock.clock(on, { now: 1_000_000 })
  // The world owns the store, so what the plugin wrote is known whatever order hooks nest in.
  const store = new Map<string, unknown>(Object.entries(options.store ?? {}))
  const stored = new Map<string, unknown>()
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => {
    store.set(e.key, e.value)
    stored.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.delete', ($, e) => {
    store.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  mock.env(on, {
    ...(os === 'windows' ? { OS: 'Windows_NT', USERPROFILE: 'C:\\Users\\dev' } : { HOME: '/home/dev' }),
    ...(options.env ?? {}),
  })
  const files = new Map(Object.entries(options.files ?? {}))
  if (os === 'wsl') files.set('/proc/version', 'Linux version 6.6.87.2-microsoft-standard-WSL2')
  if (os === 'linux') files.set('/proc/version', 'Linux version 6.8.0-45-generic')
  const w: World = {
    clock,
    plays: [],
    runs: [],
    spawns: [],
    toasts: [],
    state: new Map(),
    opened: [],
    registered: [],
    toolUseIds: [],
    files,
    stored,
    bash: OK,
    bashBy: {},
  }

  on('process.run', ($, e) => {
    w.runs.push({ argv: e.argv, env: e.init?.env })
    const [command, ...rest] = e.argv
    if (command === 'uname') return { value: ran(os === 'mac' ? 'Darwin\n' : 'Linux\n') }
    if (command === 'sh' && rest[1]?.includes('command -v')) return { value: ran(`${options.linuxPlayer ?? 'pw-play'}\n`) }
    if (command === 'wslpath') return { value: ran(`/mnt/c/${rest[1]!.slice(3).replaceAll('\\', '/')}\n`) }
    return { value: ran('', options.runExit?.(e.argv) ?? 0) }
  })
  on('process.spawn', async function* ($, e) {
    const record = { argv: e.argv, env: e.env, isEnded: false }
    w.spawns.push(record)
    try {
      yield { stream: 'stdout' as const, text: e.argv[0] === 'sh' ? 'pid 4242\n' : 'started\n' }
      for (let i = 0; i < (options.spawnTicks ?? 20); i++) {
        await clock.sleep(100)
        yield { stream: 'stdout' as const, text: 't\n' }
      }
      return { code: 0, signal: null }
    } finally {
      record.isEnded = true
    }
  })
  on('audio.play', async ($, e) => {
    w.plays.push({ clip: e.clip as Record<string, unknown>, gain: e.gain })
    if (options.audioFails) return { deny: 'cannot play this clip' }
    if (options.audioMs) await clock.sleep(options.audioMs)
    return { value: undefined }
  })
  on('fs.read', ($, e) => {
    const file = files.get(e.path)
    if (file === undefined) return { deny: `ENOENT: ${e.path}` }
    if (e.as === 'bytes') return { value: typeof file === 'string' ? { base64: '' } : file }
    return { value: typeof file === 'string' ? file : '' }
  })
  on('fs.exists', ($, e) => ({ value: files.has(e.path) }))
  on('fs.stat', ($, e) => {
    const file = files.get(e.path)
    if (file === undefined) return { deny: `ENOENT: ${e.path}` }
    const size = typeof file === 'string' ? file.length : Math.floor((file.base64.length * 3) / 4)
    return { value: { kind: 'file' as const, size, mtimeMs: 0, isLink: false } }
  })
  on('fs.list', () => ({ value: [] }))
  on('ui.toast', ($, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  on('ui.open', ($, e) => {
    w.opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('command.register', ($, e) => {
    if (options.refuse?.includes(e.name)) return { deny: `/${e.name} is taken` }
    w.registered.push(e.name)
    return { value: { command: e.name } }
  })
  on('state.set', async ($, e, next) => {
    const result = await next(e)
    w.state.set(e.id === undefined ? e.key : `${e.key}:${e.id}`, e.value)
    return result
  })
  on('tool.call', { tool: 'Bash' }, ($, e) => {
    w.toolUseIds.push(e.tool_use_id)
    return (w.bashBy[e.command] ?? w.bash) as never
  })
  on('classic.PostModelSwitch', () => ({}) as never)
  on('classic.SessionStart', () => ({}) as never)
  on('classic.Stop', () => ({}) as never)
  on('session.start', () => ({ cwd: '/repo' }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    if (e.component === 'SessionMode') return <Text>{(e.props as { modes: string[] }).modes.join(' | ')}</Text>
    return <Text>ENGINE</Text>
  })
  return w
}

/** Runs a Bash call through the engine with the world's answer, then lets scheduled tag work run. */
export async function bash($: Engine, w: World, command: string, answer: BashAnswer = OK): Promise<string> {
  w.bash = answer
  await $.tool.call({ tool: 'Bash', command } as never)
  await w.clock.settle()
  return w.toolUseIds[w.toolUseIds.length - 1]!
}
```

- [ ] **Step 2: Write the failing tests**

`plugin/tests/settings.test.ts`:
```ts
import { describe, expect, test } from 'claude-code/testing'

import { CATALOG } from '../hooks/catalog'
import { defaultSettings, knownSounds, normalizeImports, normalizeSettings, validatePattern } from '../hooks/settings'
import { world } from './world'

const known = knownSounds([])

describe('normalizeSettings', () => {
  test('nothing stored gives the restrained defaults', () => {
    const { settings, isCorrupt } = normalizeSettings(undefined, known)
    expect(isCorrupt).toBe(false)
    expect(settings).toEqual(defaultSettings())
    expect(settings.triggers['turn.done'].enabled).toBe(false)
    expect(settings.triggers['session.open'].enabled).toBe(false)
    expect(settings.triggers['command.fail'].enabled).toBe(false)
    expect(settings.triggers['git.commit']).toEqual({ enabled: true, sound: 'pt:anthropic-trust' })
    expect(settings.volume).toBe(80)
  })
  test('a non-object is corrupt and falls back to defaults', () => {
    for (const raw of ['nope', 42, [1, 2], true]) {
      const { settings, isCorrupt } = normalizeSettings(raw, known)
      expect(isCorrupt).toBe(true)
      expect(settings).toEqual(defaultSettings())
    }
  })
  test('stored values merge over defaults; arrays replace; new triggers appear', () => {
    const raw = {
      version: 1,
      muted: true,
      volume: 140,
      triggers: { 'git.commit': { enabled: false, sound: 'pt:riser' }, 'git.push': { enabled: true, sound: 'user:gone' } },
      custom: [{ id: 'a', pattern: 'deploy', outcome: 'any', sound: 'pt:scratch', enabled: true }],
      studio: { band: false },
    }
    const { settings } = normalizeSettings(raw, known)
    expect(settings.muted).toBe(true)
    expect(settings.volume).toBe(100)
    expect(settings.triggers['git.commit']).toEqual({ enabled: false, sound: 'pt:riser' })
    expect(settings.triggers['git.push']).toEqual({ enabled: true, sound: 'pt:did-it-again' })
    expect(settings.triggers['model.fable']).toEqual({ enabled: true, sound: 'pt:fable-on-beat' })
    expect(settings.custom).toEqual([{ id: 'a', pattern: 'deploy', outcome: 'any', sound: 'pt:scratch', enabled: true, isInvalid: false }])
    expect(settings.studio).toEqual({ band: false, badges: true })
  })
  test('invalid stored patterns are disabled and marked, not thrown', () => {
    const raw = { custom: [{ id: 'b', pattern: '(unclosed', outcome: 'success', sound: 'pt:riser', enabled: true }] }
    expect(normalizeSettings(raw, known).settings.custom[0]).toMatchObject({ enabled: false, isInvalid: true })
  })
  test('settings from a newer release keep every field this release understands', () => {
    const raw = { version: 2, muted: true, volume: 30, futureThing: { x: 1 }, triggers: { 'git.push': { enabled: false, sound: 'pt:riser', color: 'red' } } }
    const { settings, isCorrupt } = normalizeSettings(raw, known)
    expect(isCorrupt).toBe(false)
    expect(settings.muted).toBe(true)
    expect(settings.volume).toBe(30)
    expect(settings.triggers['git.push']).toEqual({ enabled: false, sound: 'pt:riser' })
    expect(settings.version).toBe(1)
  })
})

describe('normalizeImports and validatePattern', () => {
  test('drops malformed import rows', () => {
    const good = { id: 'user:x', name: 'x', file: '/s/x.wav', ext: 'wav', bytes: 10, durationMs: 100, peaks: [0.5], isCopy: true }
    expect(normalizeImports([good, { id: 3 }, 'junk'])).toEqual([good])
    expect(normalizeImports('nope')).toEqual([])
  })
  test('pattern messages', () => {
    expect(validatePattern('')).toBe('Enter a pattern.')
    expect(validatePattern('x'.repeat(201))).toBe('Patterns are at most 200 characters.')
    expect(validatePattern('(')).toBe('That is not a valid regular expression.')
    expect(validatePattern('docker compose up')).toBeNull()
  })
  test('known sounds are the catalog plus imports', () => {
    const ids = knownSounds([{ id: 'user:mine', name: 'mine', file: '/x', ext: 'wav', bytes: 1, durationMs: null, peaks: null, isCopy: true }])
    expect(ids.has(CATALOG[0]!.id)).toBe(true)
    expect(ids.has('user:mine')).toBe(true)
  })
})

describe('loading through $', () => {
  test('session.start loads a corrupt store as defaults and toasts once', async ($, on) => {
    const w = world(on, { store: { settings: 'garbage' } })
    await $.session.start({} as never)
    await $.session.start({} as never)
    await w.clock.settle()
    expect(w.toasts.filter(t => t.includes('unreadable'))).toHaveLength(1)
    expect(w.state.get('settings')).toEqual(defaultSettings())
  })
})
```

The last test needs `register.tsx` to load settings in `session.start`. Until Task 8, add this to the minimal register, then keep it in Task 8:
```tsx
import type { Register } from 'claude-code'

import { logError } from './notify'
import { loadFromStore } from './settings'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await loadFromStore($)
    } catch (error) {
      logError($, 'session.start', error)
    }
    return next(e)
  })
}
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `claude plugin test plugin`
Expected: FAIL. `tests/settings.test.ts` reports that `normalizeSettings` (and the others) are not exported.

- [ ] **Step 4: Complete `settings.ts`**

Replace `plugin/hooks/settings.ts` with:
```ts
import { read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { CustomTrigger, ImportedSound, Outcome, Settings, SoundId, TriggerId, TriggerSetting } from '../types'
import { CATALOG } from './catalog'
import { DEFAULT_VOLUME, FALLBACK_SOUND, MAX_CUSTOM, MAX_PATTERN_LENGTH, TRIGGERS } from './constants'
import { toastOnce } from './notify'
import { importsAtom, settingsAtom } from './state'

export const SETTINGS_KEY = 'settings'
export const IMPORTS_KEY = 'imports'

export function defaultSettings(): Settings {
  const triggers = {} as Record<TriggerId, TriggerSetting>
  for (const t of TRIGGERS) triggers[t.id] = { enabled: t.enabled, sound: t.sound }
  return { version: 1, muted: false, volume: DEFAULT_VOLUME, triggers, custom: [], studio: { band: true, badges: true } }
}

/** A custom pattern as a case-insensitive regex, or null when it is empty, too long or invalid. */
export function compilePattern(pattern: string): RegExp | null {
  if (pattern.length === 0 || pattern.length > MAX_PATTERN_LENGTH) return null
  try {
    return new RegExp(pattern, 'i')
  } catch {
    return null
  }
}

export function validatePattern(pattern: string): string | null {
  if (pattern.trim().length === 0) return 'Enter a pattern.'
  if (pattern.length > MAX_PATTERN_LENGTH) return `Patterns are at most ${MAX_PATTERN_LENGTH} characters.`
  return compilePattern(pattern) === null ? 'That is not a valid regular expression.' : null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Version 1 is the first stored shape; later versions convert to it here, before the merge. */
export function migrate(raw: unknown): unknown {
  return raw
}

const OUTCOMES: readonly Outcome[] = ['success', 'fail', 'any']

export function normalizeSettings(raw: unknown, known: ReadonlySet<SoundId>): { settings: Settings; isCorrupt: boolean } {
  const base = defaultSettings()
  if (raw === undefined || raw === null) return { settings: base, isCorrupt: false }
  const value = migrate(raw)
  if (!isRecord(value)) return { settings: base, isCorrupt: true }
  const sound = (candidate: unknown, fallback: SoundId): SoundId =>
    typeof candidate === 'string' && known.has(candidate) ? candidate : fallback

  const triggers = { ...base.triggers }
  const storedTriggers = isRecord(value.triggers) ? value.triggers : {}
  for (const t of TRIGGERS) {
    const entry = storedTriggers[t.id]
    if (!isRecord(entry)) continue
    triggers[t.id] = {
      enabled: typeof entry.enabled === 'boolean' ? entry.enabled : t.enabled,
      sound: sound(entry.sound, t.sound),
    }
  }

  const custom: CustomTrigger[] = []
  for (const entry of Array.isArray(value.custom) ? value.custom.filter(isRecord) : []) {
    if (custom.length >= MAX_CUSTOM) break
    if (typeof entry.id !== 'string' || typeof entry.pattern !== 'string') continue
    const isInvalid = compilePattern(entry.pattern) === null
    custom.push({
      id: entry.id,
      pattern: entry.pattern,
      outcome: OUTCOMES.includes(entry.outcome as Outcome) ? (entry.outcome as Outcome) : 'success',
      sound: sound(entry.sound, FALLBACK_SOUND),
      enabled: entry.enabled !== false && !isInvalid,
      isInvalid,
    })
  }

  const studio = isRecord(value.studio) ? value.studio : {}
  const volume =
    typeof value.volume === 'number' && Number.isFinite(value.volume)
      ? Math.round(Math.min(100, Math.max(0, value.volume)))
      : base.volume
  return {
    settings: {
      version: 1,
      muted: typeof value.muted === 'boolean' ? value.muted : base.muted,
      volume,
      triggers,
      custom,
      studio: {
        band: typeof studio.band === 'boolean' ? studio.band : true,
        badges: typeof studio.badges === 'boolean' ? studio.badges : true,
      },
    },
    isCorrupt: false,
  }
}

const EXTS = new Set(['wav', 'mp3', 'm4a', 'aiff'])

export function normalizeImports(raw: unknown): ImportedSound[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(isRecord).flatMap((entry): ImportedSound[] =>
    typeof entry.id === 'string' &&
    typeof entry.name === 'string' &&
    typeof entry.file === 'string' &&
    typeof entry.ext === 'string' &&
    EXTS.has(entry.ext)
      ? [
          {
            id: entry.id,
            name: entry.name,
            file: entry.file,
            ext: entry.ext as ImportedSound['ext'],
            bytes: typeof entry.bytes === 'number' ? entry.bytes : 0,
            durationMs: typeof entry.durationMs === 'number' ? entry.durationMs : null,
            peaks: Array.isArray(entry.peaks) ? entry.peaks.filter((p): p is number => typeof p === 'number') : null,
            isCopy: entry.isCopy === true,
          },
        ]
      : [],
  )
}

export function knownSounds(imports: readonly ImportedSound[]): Set<SoundId> {
  return new Set([...CATALOG.map(entry => entry.id), ...imports.map(sound => sound.id)])
}

export type Loaded = { settings: Settings; imports: ImportedSound[] }

export async function loadFromStore($: EngineInterface): Promise<Loaded> {
  const imports = normalizeImports(await $.store.get(IMPORTS_KEY))
  const { settings, isCorrupt } = normalizeSettings(await $.store.get(SETTINGS_KEY), knownSounds(imports))
  await update($, importsAtom, () => imports)
  await update($, settingsAtom, () => settings)
  if (isCorrupt) await toastOnce($, 'corrupt-settings', 'Producer Tags: settings were unreadable, so the defaults are back.')
  return { settings, imports }
}

/** Settings and imports from session state, loading them from the store the first time. */
export async function ensureLoaded($: EngineInterface): Promise<Loaded> {
  const settings = await read($, settingsAtom)
  const imports = await read($, importsAtom)
  if (settings !== null && imports !== null) return { settings, imports }
  return loadFromStore($)
}

export async function changeSettings(
  $: EngineInterface,
  change: (settings: Settings) => Settings,
  options: { persist?: boolean } = {},
): Promise<Settings> {
  await ensureLoaded($)
  const next = (await update($, settingsAtom, current => change(current ?? defaultSettings()))) as Settings
  if (options.persist !== false) await $.store.set(SETTINGS_KEY, next)
  return next
}

export async function changeImports(
  $: EngineInterface,
  change: (imports: ImportedSound[]) => ImportedSound[],
): Promise<ImportedSound[]> {
  await ensureLoaded($)
  const next = (await update($, importsAtom, current => change(current ?? []))) as ImportedSound[]
  await $.store.set(IMPORTS_KEY, next)
  return next
}
```

Update `plugin/hooks/register.tsx` to the version shown under Step 2.

- [ ] **Step 5: Run the tests to see them pass**

Run: `claude plugin test plugin`
Expected: `tests/settings.test.ts` all pass; earlier files still pass.

- [ ] **Step 6: Type-check, validate, commit**

Run: `npx tsc -p . && claude plugin validate plugin`
```bash
git add plugin/hooks/settings.ts plugin/hooks/register.tsx plugin/tests/settings.test.ts plugin/tests/world.tsx
git commit -m "feat: load, migrate and normalize stored settings

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Default tag generator, the sounds, and the listening review

**Files:**
- Create:
  - `tools/generate-tags/tags.json`
  - `tools/generate-tags/audio.py`, `tools/generate-tags/fx.py`, `tools/generate-tags/generate.py`
  - `tools/generate-tags/voices/__init__.py`, `tools/generate-tags/voices/sapi.py`, `tools/generate-tags/voices/say.py`, `tools/generate-tags/voices/elevenlabs.py`
  - `tools/generate-tags/smoke_test.py`
- Test: `tools/generate-tags/test_audio.py`
- Generated: `plugin/sounds/*.wav`; `plugin/hooks/catalog.ts` (overwrites the bootstrap)

**Interfaces:**
- **Produces:** the `CATALOG: readonly CatalogEntry[]` shape that Task 1 defined. Rules:
  - IDs are `pt:<id>`, and `file` is `sounds/<id>.wav`.
  - `durationMs` is the real length and `peaks` has 64 values.
  - Voice tags come first, in `tags.json` order. The pads in Task 12 use the first nine `isVoice` entries.

- [ ] **Step 1: Write the failing DSP tests**

`tools/generate-tags/test_audio.py`:
```python
"""Unit tests for the generator's audio helpers (python3 -I -m unittest discover -s tools/generate-tags)."""
import math
import random
import tempfile
import unittest
from pathlib import Path

import audio
import fx


def tone(ms: int, freq: float = 440.0, amp: float = 0.5) -> list[float]:
    n = int(audio.SAMPLE_RATE * ms / 1000)
    return [amp * math.sin(2 * math.pi * freq * i / audio.SAMPLE_RATE) for i in range(n)]


class AudioTest(unittest.TestCase):
    def test_wav_round_trip(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'x.wav'
            audio.write_wav(path, tone(100))
            back = audio.read_wav(path)
            self.assertEqual(len(back), int(audio.SAMPLE_RATE * 0.1))
            self.assertAlmostEqual(max(back), 0.5, places=2)

    def test_peaks_are_64_and_normalised(self):
        peaks = audio.peaks(tone(500) + [0.0] * 1000)
        self.assertEqual(len(peaks), 64)
        self.assertEqual(max(peaks), 1.0)
        self.assertEqual(peaks[-1], 0.0)

    def test_pitch_down_lengthens(self):
        self.assertGreater(len(audio.pitch(tone(200), -2)), len(tone(200)))

    def test_normalize_hits_minus_one_dbfs(self):
        out = audio.normalize(tone(100, amp=0.1), -1.0)
        self.assertAlmostEqual(max(abs(s) for s in out), 10 ** (-1 / 20), places=3)

    def test_mix_offsets_and_extends(self):
        out = audio.mix(([1.0] * 10, 0, 0.5), ([1.0] * 10, 15, 1.0))
        self.assertEqual(len(out), 25)
        self.assertEqual(out[0], 0.5)
        self.assertEqual(out[12], 0.0)
        self.assertEqual(out[20], 1.0)

    def test_effects_have_expected_lengths(self):
        random.seed(7)
        self.assertEqual(audio.duration_ms(fx.boom_808(900)), 900)
        self.assertEqual(audio.duration_ms(fx.riser(1200)), 1200)
        self.assertEqual(audio.duration_ms(fx.scratch(500)), 500)
        base = tone(600)
        self.assertGreater(len(fx.echo_tail(base)), len(base))
        self.assertGreater(len(fx.reverb(base)), len(base))


if __name__ == '__main__':
    unittest.main()
```

Run: `python3 -I -m unittest discover -s tools/generate-tags -p 'test_*.py'`
Expected: FAIL with `ModuleNotFoundError: No module named 'audio'`.

- [ ] **Step 2: Implement `audio.py` and `fx.py`**

`tools/generate-tags/audio.py`:
```python
"""Mono float audio at 22.05 kHz: WAV I/O, resampling, mixing, envelopes, peaks."""
from __future__ import annotations

import array
import math
import wave
from pathlib import Path

SAMPLE_RATE = 22050


def read_wav(path: Path) -> list[float]:
    with wave.open(str(path), 'rb') as w:
        channels, width, rate = w.getnchannels(), w.getsampwidth(), w.getframerate()
        raw = w.readframes(w.getnframes())
    if width != 2:
        raise ValueError(f'{path}: expected 16-bit PCM, got {width * 8}-bit')
    data = array.array('h')
    data.frombytes(raw)
    mono = [sum(data[i:i + channels]) / channels / 32768 for i in range(0, len(data), channels)]
    return resample(mono, rate, SAMPLE_RATE) if rate != SAMPLE_RATE else mono


def write_wav(path: Path, samples: list[float]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    pcm = array.array('h', (int(max(-1.0, min(1.0, s)) * 32767) for s in samples))
    with wave.open(str(path), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(pcm.tobytes())


def _at(samples: list[float], position: float) -> float:
    i = int(position)
    if i + 1 >= len(samples):
        return samples[-1] if samples else 0.0
    frac = position - i
    return samples[i] * (1 - frac) + samples[i + 1] * frac


def resample(samples: list[float], src_rate: int, dst_rate: int) -> list[float]:
    ratio = src_rate / dst_rate
    return [_at(samples, i * ratio) for i in range(int(len(samples) / ratio))]


def pitch(samples: list[float], semitones: float) -> list[float]:
    """Tape-style shift: down is slower and lower, up is faster and higher."""
    ratio = 2 ** (semitones / 12)
    return [_at(samples, i * ratio) for i in range(int(len(samples) / ratio))]


def mix(*layers: tuple[list[float], int, float]) -> list[float]:
    """Each layer is (samples, offset in samples, gain)."""
    length = max(offset + len(samples) for samples, offset, _ in layers)
    out = [0.0] * length
    for samples, offset, gain in layers:
        for i, s in enumerate(samples):
            out[offset + i] += s * gain
    return out


def normalize(samples: list[float], peak_db: float = -1.0) -> list[float]:
    top = max((abs(s) for s in samples), default=0.0)
    if top == 0:
        return samples
    gain = (10 ** (peak_db / 20)) / top
    return [s * gain for s in samples]


def fade(samples: list[float], ms: int = 10) -> list[float]:
    n = min(len(samples) // 2, int(SAMPLE_RATE * ms / 1000))
    out = list(samples)
    for i in range(n):
        k = i / n
        out[i] *= k
        out[-1 - i] *= k
    return out



def duration_ms(samples: list[float]) -> int:
    return round(len(samples) * 1000 / SAMPLE_RATE)


def peaks(samples: list[float], count: int = 64) -> list[float]:
    if not samples:
        return [0.0] * count
    raw = []
    for b in range(count):
        start = b * len(samples) // count
        end = max(start + 1, (b + 1) * len(samples) // count)
        raw.append(max(abs(s) for s in samples[start:end]))
    top = max(raw)
    return [round(v / top, 2) if top else 0.0 for v in raw]


def ms_to_samples(ms: float) -> int:
    return int(SAMPLE_RATE * ms / 1000)


```

`tools/generate-tags/fx.py`:
```python
"""Producer-tag effects, synthesized in plain Python. Randomness comes from `random`, seeded by the caller."""
from __future__ import annotations

import math
import random

from audio import SAMPLE_RATE, ms_to_samples


def echo_tail(samples: list[float], tail_ms: int = 350, repeats: int = 3, gap_ms: int = 170, decay: float = 0.55) -> list[float]:
    """The classic tag stutter: the last word repeats, quieter each time ("you-you-you")."""
    tail = samples[-ms_to_samples(tail_ms):]
    gap = ms_to_samples(gap_ms)
    out = list(samples) + [0.0] * (gap * repeats + len(tail))
    for r in range(1, repeats + 1):
        start = len(samples) - len(tail) + gap * r
        gain = decay ** r
        for i, s in enumerate(tail):
            out[start + i] += s * gain
    return out


def _comb(samples: list[float], delay: int, feedback: float) -> list[float]:
    out = [0.0] * len(samples)
    for i, s in enumerate(samples):
        out[i] = s + (out[i - delay] * feedback if i >= delay else 0.0)
    return out


def _allpass(samples: list[float], delay: int, gain: float = 0.5) -> list[float]:
    out = [0.0] * len(samples)
    for i, s in enumerate(samples):
        delayed_in = samples[i - delay] if i >= delay else 0.0
        delayed_out = out[i - delay] if i >= delay else 0.0
        out[i] = -gain * s + delayed_in + gain * delayed_out
    return out


def reverb(samples: list[float], wet: float = 0.25, tail_ms: int = 600) -> list[float]:
    """A small Schroeder reverb: four combs into two allpasses."""
    padded = list(samples) + [0.0] * ms_to_samples(tail_ms)
    scale = SAMPLE_RATE / 44100
    combs = [_comb(padded, int(d * scale), 0.78) for d in (1116, 1188, 1277, 1356)]
    summed = [sum(values) / 4 for values in zip(*combs)]
    for d in (556, 441):
        summed = _allpass(summed, int(d * scale))
    return [dry * (1 - wet) + wetv * wet for dry, wetv in zip(padded, summed)]


def boom_808(ms: int = 900, f_start: float = 110.0, f_end: float = 45.0) -> list[float]:
    n = ms_to_samples(ms)
    out, phase = [], 0.0
    for i in range(n):
        t = i / n
        freq = f_end + (f_start - f_end) * math.exp(-t * 8)
        phase += 2 * math.pi * freq / SAMPLE_RATE
        out.append(math.tanh(2.2 * math.sin(phase)) * math.exp(-t * 4))
    return out


def riser(ms: int = 1200) -> list[float]:
    n = ms_to_samples(ms)
    out, low = [], 0.0
    for i in range(n):
        t = i / n
        alpha = 0.02 + 0.6 * t * t
        low += alpha * (random.uniform(-1, 1) - low)
        out.append(low * (0.15 + 0.85 * t))
    return out


def scratch(ms: int = 500) -> list[float]:
    n = ms_to_samples(ms)
    out, phase = [], 0.0
    for i in range(n):
        t = i / n
        freq = 180 + 900 * abs(math.sin(2 * math.pi * 3 * t))
        phase += freq / SAMPLE_RATE
        saw = 2 * (phase % 1) - 1
        out.append((0.7 * saw + 0.3 * random.uniform(-1, 1)) * abs(math.sin(2 * math.pi * 6 * t)))
    return out
```

Run: `python3 -I -m unittest discover -s tools/generate-tags -p 'test_*.py'`
Expected: `OK` (6 tests).

- [ ] **Step 3: Voice backends**

`tools/generate-tags/voices/__init__.py`:
```python
"""Text-to-speech backends: each exposes render(text, out_wav) -> None, writing a WAV file."""
from __future__ import annotations

from typing import Callable
from pathlib import Path

from . import elevenlabs, sapi, say

Backend = Callable[[str, Path], None]

BACKENDS: dict[str, Backend] = {'sapi': sapi.render, 'say': say.render, 'elevenlabs': elevenlabs.render}
```

`tools/generate-tags/voices/sapi.py`:
```python
"""Windows SAPI voices through powershell.exe, from Windows or WSL. Text and paths travel in env vars."""
from __future__ import annotations

import base64
import os
import subprocess
from pathlib import Path

VOICE = os.environ.get('PT_SAPI_VOICE', 'Microsoft David Desktop')
RATE = os.environ.get('PT_SAPI_RATE', '0')

SCRIPT = r'''
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voices = $s.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name }
if ($env:PT_VOICE -and ($voices -contains $env:PT_VOICE)) { $s.SelectVoice($env:PT_VOICE) }
$s.Rate = [int]$env:PT_RATE
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(22050, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$s.SetOutputToWaveFile($env:PT_OUT, $format)
$s.Speak($env:PT_TEXT)
$s.Dispose()
'''


def _is_wsl() -> bool:
    try:
        return 'microsoft' in Path('/proc/version').read_text().lower()
    except OSError:
        return False


def render(text: str, out: Path) -> None:
    env = {**os.environ, 'PT_TEXT': text, 'PT_OUT': str(out.resolve()), 'PT_VOICE': VOICE, 'PT_RATE': RATE}
    if _is_wsl():
        env['WSLENV'] = ':'.join(filter(None, [os.environ.get('WSLENV', ''), 'PT_TEXT', 'PT_OUT/p', 'PT_VOICE', 'PT_RATE']))
    encoded = base64.b64encode(SCRIPT.encode('utf-16-le')).decode()
    done = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
                          env=env, capture_output=True, text=True)
    if done.returncode != 0:
        raise SystemExit(f'sapi failed for {text!r}:\n{done.stderr.strip()}')
```

`tools/generate-tags/voices/say.py`:
```python
"""macOS `say`, rendered straight to 22.05 kHz 16-bit WAV."""
from __future__ import annotations

import os
import subprocess
from pathlib import Path

VOICE = os.environ.get('PT_SAY_VOICE', 'Fred')


def render(text: str, out: Path) -> None:
    subprocess.run(['say', '-v', VOICE, '--file-format=WAVE', '--data-format=LEI16@22050', '-o', str(out), text], check=True)
```

`tools/generate-tags/voices/elevenlabs.py`:
```python
"""Neural TTS, for later (spec §11): the slot exists so a voice pack can be re-rendered with one flag."""
from __future__ import annotations

from pathlib import Path


def render(text: str, out: Path) -> None:
    raise SystemExit('elevenlabs: not implemented yet; set ELEVENLABS_API_KEY and implement voices/elevenlabs.py')
```

- [ ] **Step 4: The tag list**

`tools/generate-tags/tags.json`. `caption` is what the band shows and, unless `say` is given, what the voice speaks.
```json
{
  "seed": 20261010,
  "tags": [
    { "id": "anthropic-trust", "caption": "If Anthropic don't trust you, I'm gon' shoot you", "say": "If Anthropic don't trust you, I'm gonna shoot you", "riff": "Metro Boomin", "preset": "dark" },
    { "id": "just-merged", "caption": "Oh Lord, Claude just merged another one", "riff": "Jetsonmade", "preset": "hype" },
    { "id": "did-it-again", "caption": "Claude Code, you did it again", "riff": "Mike WiLL Made-It", "preset": "tag" },
    { "id": "tests-passin", "caption": "We got tests passin' on the track", "say": "We got tests passing on the track", "riff": "original", "preset": "hype" },
    { "id": "opus-come-out", "caption": "Yo Opus, you wanna come out here?", "riff": "Pi'erre Bourne", "preset": "tag" },
    { "id": "fable-on-beat", "caption": "Fable on the beat, so it's a banger", "riff": "Murda Beatz", "preset": "hype" },
    { "id": "sonnet-booth", "caption": "Sonnet in the booth, write it down", "riff": "original", "preset": "tag" },
    { "id": "haiku-quick", "caption": "Haiku on the beat, make it quick", "riff": "original", "preset": "quick" },
    { "id": "who-let-model", "caption": "Who let this model on the track?", "riff": "original", "preset": "tag" },
    { "id": "claude-outta", "caption": "Claude outta here", "riff": "Wheezy", "preset": "dark" },
    { "id": "khaled-claude", "caption": "Claude Code, Claude Code, Claude Code-ah", "say": "Claude Code, Claude Code, Claude Code ah", "riff": "DJ Khaled", "preset": "hype" },
    { "id": "another-one", "caption": "Another one", "riff": "DJ Khaled", "preset": "quick" },
    { "id": "tay-keith-fix", "caption": "Tay Keith, fix this", "riff": "Tay Keith", "preset": "dark" }
  ],
  "effects": [
    { "id": "808-boom", "caption": "808 boom", "kind": "808" },
    { "id": "riser", "caption": "Riser", "kind": "riser" },
    { "id": "scratch", "caption": "Scratch", "kind": "scratch" }
  ]
}
```

- [ ] **Step 5: The generator and smoke test**

`tools/generate-tags/generate.py`:
```python
"""Renders Producer Tags' default sounds and the plugin's hooks/catalog.ts.

python3 -I tools/generate-tags/generate.py [--voice sapi|say] [--only <id> ...]
"""
from __future__ import annotations

import argparse
import json
import random
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import audio  # noqa: E402
import fx  # noqa: E402
import voices  # noqa: E402

ROOT = HERE.parent.parent
SOUNDS = ROOT / 'plugin' / 'sounds'
CATALOG = ROOT / 'plugin' / 'hooks' / 'catalog.ts'


def preset(name: str, voice: list[float]) -> list[float]:
    if name == 'dark':
        body = fx.reverb(fx.echo_tail(audio.pitch(voice, -4)), wet=0.32)
        return audio.mix((fx.boom_808(1100, 90, 38), 0, 0.9), (body, audio.ms_to_samples(60), 1.0))
    if name == 'hype':
        body = fx.reverb(fx.echo_tail(audio.pitch(voice, -1), repeats=2), wet=0.22)
        lead = audio.ms_to_samples(500)
        return audio.mix((fx.riser(600), 0, 0.35), (fx.boom_808(800), lead, 0.8), (body, lead, 1.0))
    if name == 'quick':
        body = fx.echo_tail(audio.pitch(voice, -2), tail_ms=250, repeats=2, gap_ms=130)
        return audio.mix((fx.boom_808(600), 0, 0.7), (body, 0, 1.0))
    body = fx.reverb(fx.echo_tail(audio.pitch(voice, -2)), wet=0.25)
    return audio.mix((fx.boom_808(), 0, 0.8), (body, audio.ms_to_samples(40), 1.0))


def effect(kind: str) -> list[float]:
    if kind == '808':
        return fx.boom_808(1200)
    if kind == 'riser':
        return fx.riser(1500)
    return fx.scratch(600)


def finish(samples: list[float]) -> list[float]:
    return audio.fade(audio.normalize(samples, -1.0), 10)


def entry(sound_id: str, caption: str, riff: str, is_voice: bool) -> dict:
    samples = audio.read_wav(SOUNDS / f'{sound_id}.wav')
    return {
        'id': f'pt:{sound_id}',
        'file': f'sounds/{sound_id}.wav',
        'caption': caption,
        'riff': riff,
        'durationMs': audio.duration_ms(samples),
        'peaks': audio.peaks(samples),
        'isVoice': is_voice,
    }


def write_catalog(entries: list[dict]) -> None:
    lines = [
        '// Generated by tools/generate-tags/generate.py. Do not edit by hand.',
        "import type { CatalogEntry } from '../types'",
        '',
        'export const CATALOG: readonly CatalogEntry[] = [',
        *(f'  {json.dumps(e, ensure_ascii=False)},' for e in entries),
        ']',
        '',
    ]
    CATALOG.write_text('\n'.join(lines), encoding='utf-8')


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--voice', default='sapi', choices=sorted(voices.BACKENDS))
    parser.add_argument('--only', action='append', help='render just these ids (the catalog is always rebuilt)')
    args = parser.parse_args(argv)
    spec = json.loads((HERE / 'tags.json').read_text(encoding='utf-8'))
    render = voices.BACKENDS[args.voice]
    wanted = set(args.only or [])

    with tempfile.TemporaryDirectory() as tmp:
        for tag in spec['tags']:
            if wanted and tag['id'] not in wanted:
                continue
            random.seed(f"{spec['seed']}:{tag['id']}")
            raw = Path(tmp) / f"{tag['id']}.wav"
            render(tag.get('say', tag['caption']), raw)
            audio.write_wav(SOUNDS / f"{tag['id']}.wav", finish(preset(tag['preset'], audio.read_wav(raw))))
            print(f"rendered {tag['id']}")
    for item in spec['effects']:
        if wanted and item['id'] not in wanted:
            continue
        random.seed(f"{spec['seed']}:{item['id']}")
        audio.write_wav(SOUNDS / f"{item['id']}.wav", finish(effect(item['kind'])))
        print(f"rendered {item['id']}")

    entries = [entry(t['id'], t['caption'], t['riff'], True) for t in spec['tags']]
    entries += [entry(e['id'], e['caption'], 'studio', False) for e in spec['effects']]
    write_catalog(entries)
    print(f'wrote {CATALOG.relative_to(ROOT)} ({len(entries)} sounds)')


if __name__ == '__main__':
    main()
```

`tools/generate-tags/smoke_test.py`:
```python
"""Checks the committed sounds against tags.json and catalog.ts: python3 -I tools/generate-tags/smoke_test.py"""
from __future__ import annotations

import json
import sys
import wave
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent


def main() -> int:
    spec = json.loads((HERE / 'tags.json').read_text(encoding='utf-8'))
    ids = [t['id'] for t in spec['tags']] + [e['id'] for e in spec['effects']]
    catalog_lines = (ROOT / 'plugin' / 'hooks' / 'catalog.ts').read_text(encoding='utf-8').splitlines()
    catalog = {e['id']: e for e in (json.loads(line.strip().rstrip(',')) for line in catalog_lines if line.strip().startswith('{'))}
    problems = []
    for sound_id in ids:
        path = ROOT / 'plugin' / 'sounds' / f'{sound_id}.wav'
        if not path.exists():
            problems.append(f'{sound_id}: missing {path}')
            continue
        with wave.open(str(path), 'rb') as w:
            if (w.getnchannels(), w.getsampwidth(), w.getframerate()) != (1, 2, 22050):
                problems.append(f'{sound_id}: not 22.05 kHz 16-bit mono')
            ms = round(w.getnframes() * 1000 / w.getframerate())
        if ms >= 6000:
            problems.append(f'{sound_id}: {ms} ms is not under 6 s')
        entry = catalog.get(f'pt:{sound_id}')
        if entry is None:
            problems.append(f'{sound_id}: not in catalog.ts')
        elif abs(entry['durationMs'] - ms) > 1 or len(entry['peaks']) != 64:
            problems.append(f'{sound_id}: catalog durationMs/peaks out of date')
    for problem in problems:
        print(problem)
    print('ok' if not problems else f'{len(problems)} problem(s)')
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main())
```

- [ ] **Step 6: Render the sounds and run the smoke test**

Run: `python3 -I tools/generate-tags/generate.py --voice sapi && python3 -I tools/generate-tags/smoke_test.py`
Expected: one `rendered <id>` line per sound (16 total), `wrote plugin/hooks/catalog.ts (16 sounds)`, then `ok`.

If a voice tag is 6 s or longer, shorten its caption (or its `say` text) or switch its preset to `quick`, then rerun with `--only <id>`.

- [ ] **Step 7: Listening review with the user (gate)**

Stop and ask the user to listen to every file in `plugin/sounds/`. They can open the folder in Explorer from WSL with `explorer.exe plugin/sounds`, or play one file with `powershell.exe -c "(New-Object Media.SoundPlayer '$(wslpath -w plugin/sounds/anthropic-trust.wav)').PlaySync()"`. For each tag, ask: keep, rewrite the line, change the preset, or try a different SAPI voice (`PT_SAPI_VOICE='Microsoft Zira Desktop'`). Apply the edits to `tags.json` and re-render with `--only`. Repeat until the user approves. Record the approved lines. The captions in `tags.json` are now final, and the spec's §7.1 table must match them, so edit the spec too.

- [ ] **Step 8: Re-run the plugin tests against the real catalog**

Run: `claude plugin test plugin && npx tsc -p .`
Expected: all pass. Every catalog id is unchanged, and the settings tests depend only on those ids.

- [ ] **Step 9: Commit**

```bash
git add tools/generate-tags plugin/sounds plugin/hooks/catalog.ts docs/superpowers/specs/2026-10-10-producer-tags-design.md
git commit -m "feat: generate the default producer tags and catalog

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Sound library (`library.ts`)

**Files:**
- Create: `plugin/hooks/library.ts`
- Test: `plugin/tests/library.test.ts`

**Interfaces:**
- **Consumes:**
  - `CATALOG`
  - `decodeBase64` (`codec.ts`)
  - `WINDOWS_ENGINE`
  - the types `AudioExt`, `ImportedSound`, `OsName`, `PlayerName`, `SoundId`
- **Produces:**
  - `PEAK_COUNT = 64`
  - `MIME: Record<AudioExt, string>`
  - `extOf(path: string): AudioExt | null`
  - `allowedExts(os: OsName, player: PlayerName): AudioExt[]`
  - `type WavInfo = { durationMs: number; peaks: number[] }`
  - `parseWav(bytes: Uint8Array): WavInfo | null`
  - `peaksOf(frames: number, sampleAt: (i: number) => number, count?: number): number[]`
  - `slugify(fileName: string, taken: ReadonlySet<string>): string`
  - `basename(path: string): string`
  - `type ResolvedSound = { id: SoundId; caption: string; riff: string; durationMs: number | null; peaks: number[] | null; source: { kind: 'asset'; asset: string } | { kind: 'file'; path: string; ext: AudioExt } }`
  - `resolveSound(id: SoundId, imports: readonly ImportedSound[]): ResolvedSound | null`
  - `soundOptions(imports): { value: string; label: string }[]`
  - `soundLabel(id: SoundId, imports): string`
  - `padSounds(): SoundId[]`, which returns the first nine voice tags

- [ ] **Step 1: Write the failing tests**

`plugin/tests/library.test.ts`:
```ts
import { describe, expect, test } from 'claude-code/testing'

import { CATALOG } from '../hooks/catalog'
import { allowedExts, basename, extOf, padSounds, parseWav, resolveSound, slugify, soundOptions } from '../hooks/library'
import type { ImportedSound } from '../types'

/** A WAV with `frames` frames of the given format, optionally with a LIST chunk (odd size) before data. */
function wav(options: { format?: number; bits: number; channels?: number; rate?: number; frames: number; list?: boolean; extensible?: boolean }): Uint8Array {
  const channels = options.channels ?? 1
  const rate = options.rate ?? 22050
  const blockAlign = channels * (options.bits / 8)
  const dataBytes = options.frames * blockAlign
  const fmtSize = options.extensible ? 40 : 16
  const listBody = options.list ? 5 : 0
  const listBytes = options.list ? 8 + listBody + 1 : 0
  const total = 12 + 8 + fmtSize + listBytes + 8 + dataBytes
  const view = new DataView(new ArrayBuffer(total))
  const tag = (offset: number, text: string) => [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)))
  tag(0, 'RIFF'); view.setUint32(4, total - 8, true); tag(8, 'WAVE')
  tag(12, 'fmt '); view.setUint32(16, fmtSize, true)
  view.setUint16(20, options.extensible ? 0xfffe : (options.format ?? 1), true)
  view.setUint16(22, channels, true); view.setUint32(24, rate, true)
  view.setUint32(28, rate * blockAlign, true); view.setUint16(32, blockAlign, true); view.setUint16(34, options.bits, true)
  if (options.extensible) { view.setUint16(36, 22, true); view.setUint16(44, options.format ?? 1, true) }
  let offset = 20 + fmtSize
  if (options.list) { tag(offset, 'LIST'); view.setUint32(offset + 4, listBody, true); offset += 8 + listBody + 1 }
  tag(offset, 'data'); view.setUint32(offset + 4, dataBytes, true)
  const data = offset + 8
  for (let f = 0; f < options.frames; f++) {
    const value = f < options.frames / 2 ? 0.5 : 0.25
    const at = data + f * blockAlign
    if ((options.format ?? 1) === 3) view.setFloat32(at, value, true)
    else if (options.bits === 8) view.setUint8(at, Math.round(128 + value * 127))
    else if (options.bits === 16) view.setInt16(at, Math.round(value * 32767), true)
    else { const v = Math.round(value * 8388607); view.setUint8(at, v & 0xff); view.setUint8(at + 1, (v >> 8) & 0xff); view.setInt8(at + 2, v >> 16) }
  }
  return new Uint8Array(view.buffer)
}

describe('parseWav', () => {
  for (const [label, options] of [
    ['16-bit mono', { bits: 16, frames: 22050 }],
    ['8-bit', { bits: 8, frames: 22050 }],
    ['24-bit stereo', { bits: 24, channels: 2, frames: 22050 }],
    ['float32', { format: 3, bits: 32, frames: 22050 }],
    ['extensible with an odd LIST chunk', { bits: 16, frames: 22050, extensible: true, list: true }],
  ] as const) {
    test(label, () => {
      const info = parseWav(wav(options))
      expect(info?.durationMs).toBe(1000)
      expect(info?.peaks).toHaveLength(64)
      expect(info?.peaks[0]).toBe(1)
      expect(info?.peaks[63]).toBe(0.5)
    })
  }
  test('not a WAV, or an unsupported format', () => {
    expect(parseWav(new Uint8Array([1, 2, 3]))).toBeNull()
    expect(parseWav(wav({ format: 2, bits: 4, frames: 0 }))).toBeNull()
  })
})

describe('names and formats', () => {
  test('extOf, basename', () => {
    expect(extOf('/x/My Tag.WAV')).toBe('wav')
    expect(extOf('C:\\a\\b.aif')).toBe('aiff')
    expect(extOf('/x/notes.txt')).toBeNull()
    expect(basename('C:\\Users\\me\\tag.mp3')).toBe('tag.mp3')
    expect(basename('/home/me/My Tags/x.wav')).toBe('x.wav')
  })
  test('slugify: lowercase, dashes, 40 chars, reserved names, case-insensitive collisions', () => {
    expect(slugify('My Tag (final) v2.wav', new Set())).toBe('my-tag-final-v2')
    expect(slugify('Mi tag ✨ (final).wav', new Set())).toBe('mi-tag-final')
    expect(slugify('✨✨.mp3', new Set())).toBe('sound')
    expect(slugify('CON.wav', new Set())).toBe('con-1')
    expect(slugify('x'.repeat(60) + '.wav', new Set())).toHaveLength(40)
    expect(slugify('Tag.wav', new Set(['TAG', 'tag-2']))).toBe('tag-3')
  })
  test('allowed formats per platform', () => {
    expect(allowedExts('mac', 'audio')).toEqual(['wav', 'mp3', 'm4a', 'aiff'])
    expect(allowedExts('windows', 'powershell')).toEqual(['wav', 'mp3'])
    expect(allowedExts('linux', 'aplay')).toEqual(['wav'])
    expect(allowedExts('linux', 'pw-play')).toEqual(['wav', 'aiff'])
    expect(allowedExts('linux', 'ffplay')).toEqual(['wav', 'mp3', 'm4a', 'aiff'])
  })
})

describe('resolving sounds', () => {
  const mine: ImportedSound = { id: 'user:mine', name: 'mine', file: '/s/mine.mp3', ext: 'mp3', bytes: 10, durationMs: null, peaks: null, isCopy: true }
  test('bundled sounds resolve to assets; imports to files; unknown to null', () => {
    const first = CATALOG[0]!
    expect(resolveSound(first.id, [])).toMatchObject({ id: first.id, source: { kind: 'asset', asset: first.file } })
    expect(resolveSound('user:mine', [mine])).toMatchObject({ caption: 'mine', source: { kind: 'file', path: '/s/mine.mp3', ext: 'mp3' } })
    expect(resolveSound('user:gone', [mine])).toBeNull()
  })
  test('options list bundled then imports; pads are the first nine voice tags', () => {
    const options = soundOptions([mine])
    expect(options[0]!.value).toBe(CATALOG[0]!.id)
    expect(options[options.length - 1]).toEqual({ value: 'user:mine', label: 'mine (yours)' })
    expect(padSounds()).toHaveLength(9)
    expect(padSounds().every(id => CATALOG.find(c => c.id === id)?.isVoice)).toBe(true)
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `claude plugin test plugin`
Expected: FAIL. `tests/library.test.ts` cannot resolve `../hooks/library`.

- [ ] **Step 3: Implement**

`plugin/hooks/library.ts`:
```ts
import type { AudioExt, ImportedSound, OsName, PlayerName, SoundId } from '../types'
import { CATALOG } from './catalog'
import { WINDOWS_ENGINE } from './constants'

export const PEAK_COUNT = 64

export const MIME: Record<AudioExt, string> = {
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aiff: 'audio/aiff',
}

export function extOf(path: string): AudioExt | null {
  const ext = /\.([A-Za-z0-9]+)$/.exec(path)?.[1]?.toLowerCase()
  if (ext === 'aif') return 'aiff'
  return ext === 'wav' || ext === 'mp3' || ext === 'm4a' || ext === 'aiff' ? ext : null
}

export function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

export function allowedExts(os: OsName, player: PlayerName): AudioExt[] {
  if (os === 'mac') return ['wav', 'mp3', 'm4a', 'aiff']
  if (os === 'windows' || os === 'wsl') return WINDOWS_ENGINE === 'mediaplayer' ? ['wav', 'mp3'] : ['wav']
  if (player === 'ffplay') return ['wav', 'mp3', 'm4a', 'aiff']
  if (player === 'aplay') return ['wav']
  return ['wav', 'aiff']
}

export type WavInfo = { durationMs: number; peaks: number[] }

/** PCM 8/16/24-bit, float32, mono or more channels, WAVE_FORMAT_EXTENSIBLE; null for anything else. */
export function parseWav(bytes: Uint8Array): WavInfo | null {
  if (bytes.length < 12) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tag = (offset: number) => String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!)
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null
  let format = 0
  let bits = 0
  let byteRate = 0
  let blockAlign = 0
  let dataStart = -1
  let dataBytes = 0
  let offset = 12
  while (offset + 8 <= bytes.length) {
    const id = tag(offset)
    const size = view.getUint32(offset + 4, true)
    const body = offset + 8
    if (id === 'fmt ' && size >= 16) {
      format = view.getUint16(body, true)
      byteRate = view.getUint32(body + 8, true)
      blockAlign = view.getUint16(body + 12, true)
      bits = view.getUint16(body + 14, true)
      if (format === 0xfffe && size >= 26) format = view.getUint16(body + 24, true)
    } else if (id === 'data') {
      dataStart = body
      dataBytes = Math.min(size, bytes.length - body)
      break
    }
    offset = body + size + (size % 2)
  }
  const isPcm = format === 1 && (bits === 8 || bits === 16 || bits === 24)
  const isFloat = format === 3 && bits === 32
  if (dataStart < 0 || byteRate === 0 || blockAlign === 0 || (!isPcm && !isFloat)) return null
  const sampleAt = (frame: number): number => {
    const at = dataStart + frame * blockAlign
    if (isFloat) return view.getFloat32(at, true)
    if (bits === 8) return (view.getUint8(at) - 128) / 128
    if (bits === 16) return view.getInt16(at, true) / 32768
    return (view.getUint8(at) | (view.getUint8(at + 1) << 8) | (view.getInt8(at + 2) << 16)) / 8388608
  }
  return {
    durationMs: Math.round((dataBytes / byteRate) * 1000),
    peaks: peaksOf(Math.floor(dataBytes / blockAlign), sampleAt),
  }
}

/** The loudest sample in each of `count` buckets, scaled so the loudest bucket is 1. */
export function peaksOf(frames: number, sampleAt: (i: number) => number, count = PEAK_COUNT): number[] {
  if (frames === 0) return new Array<number>(count).fill(0)
  const raw: number[] = []
  for (let b = 0; b < count; b++) {
    const start = Math.floor((b * frames) / count)
    const end = Math.max(start + 1, Math.floor(((b + 1) * frames) / count))
    const step = Math.max(1, Math.floor((end - start) / 256))
    let max = 0
    for (let i = start; i < end && i < frames; i += step) max = Math.max(max, Math.abs(sampleAt(i)))
    raw.push(max)
  }
  const top = Math.max(...raw)
  return raw.map(v => (top > 0 ? Math.round((v / top) * 100) / 100 : 0))
}

const RESERVED = new Set([
  'con', 'prn', 'aux', 'nul',
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
])

export function slugify(fileName: string, taken: ReadonlySet<string>): string {
  let base = fileName
    .replace(/\.[^.]*$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '')
  if (base === '') base = 'sound'
  if (RESERVED.has(base)) base = `${base}-1`
  const lowerTaken = new Set([...taken].map(name => name.toLowerCase()))
  if (!lowerTaken.has(base)) return base
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`
    if (!lowerTaken.has(candidate)) return candidate
  }
}

export type ResolvedSound = {
  id: SoundId
  caption: string
  riff: string
  durationMs: number | null
  peaks: number[] | null
  source: { kind: 'asset'; asset: string } | { kind: 'file'; path: string; ext: AudioExt }
}

export function resolveSound(id: SoundId, imports: readonly ImportedSound[]): ResolvedSound | null {
  const entry = CATALOG.find(c => c.id === id)
  if (entry !== undefined) {
    return {
      id,
      caption: entry.caption,
      riff: entry.riff,
      durationMs: entry.durationMs,
      peaks: entry.peaks.length > 0 ? entry.peaks : null,
      source: { kind: 'asset', asset: entry.file },
    }
  }
  const imported = imports.find(sound => sound.id === id)
  if (imported === undefined) return null
  return {
    id,
    caption: imported.name,
    riff: 'your own tag',
    durationMs: imported.durationMs,
    peaks: imported.peaks,
    source: { kind: 'file', path: imported.file, ext: imported.ext },
  }
}

export function soundOptions(imports: readonly ImportedSound[]): { value: string; label: string }[] {
  return [
    ...CATALOG.map(c => ({ value: c.id, label: c.id.slice('pt:'.length) })),
    ...imports.map(sound => ({ value: sound.id, label: `${sound.name} (yours)` })),
  ]
}

export function soundLabel(id: SoundId, imports: readonly ImportedSound[]): string {
  return soundOptions(imports).find(option => option.value === id)?.label ?? id
}

export function padSounds(): SoundId[] {
  return CATALOG.filter(c => c.isVoice).slice(0, 9).map(c => c.id)
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `claude plugin test plugin`
Expected: `tests/library.test.ts` all pass. The `peaks[63]` expectation of `0.5` holds because the second half of each fixture is at half amplitude.

- [ ] **Step 5: Type-check and commit**

```bash
npx tsc -p . && git add plugin/hooks/library.ts plugin/tests/library.test.ts
git commit -m "feat: parse WAVs, slug imports and resolve sounds

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Platform detection and playback (`platform.ts`, `player.ts`)

**Files:**
- Create: `plugin/hooks/platform.ts`, `plugin/hooks/player.ts`
- Test: `plugin/tests/player.test.ts` (pure pieces; `play()` and `detectPlatform()` are covered end to end in Task 8)

**Interfaces:**
- **Consumes:**
  - from `library.ts`: `ResolvedSound`, `MIME`
  - from `codec.ts`: `encodeUtf16LeBase64`
  - from `constants.ts`: `WINDOWS_ENGINE`
  - from `state.ts`: `platformAtom`
- **Produces from `platform.ts`:** `detectPlatform($): Promise<Platform>`. It is memoized per module and cached in `$.state.platform`.
- **Produces from `player.ts`, types:**
  - `type PlayRequest = { sound: ResolvedSound; gain: number; maxMs: number }`
  - `type PlayEnd = 'ok' | 'stopped' | 'failed'`
  - `type PlayHandle = { started: Promise<boolean>; ended: Promise<PlayEnd>; stop: () => void }`
- **Produces from `player.ts`, functions and constants:**
  - `play($, platform: Platform, request: PlayRequest): PlayHandle`. For `'none'`, it returns a silent handle that "plays" for `durationMs ?? 3000`.
  - `playDetached($, platform, request): Promise<void>`
  - `filePathOf(root: string, sound: ResolvedSound): string`
  - `linuxPlayerArgv(player: LinuxPlayer, path: string, gain: number): string[]`
  - `windowsEnv(os: OsName, path: string, gain: number, durationMs: number | null, maxMs: number, existingWslEnv: string | undefined): Record<string, string>`
  - `WINDOWS_SCRIPT`, `LINUX_WRAPPER`, `DETACH_COMMAND`

- [ ] **Step 1: Write the failing tests**

`plugin/tests/player.test.ts`:
```ts
import { describe, expect, test } from 'claude-code/testing'

import { CATALOG } from '../hooks/catalog'
import { resolveSound } from '../hooks/library'
import { DETACH_COMMAND, WINDOWS_SCRIPT, filePathOf, linuxPlayerArgv, windowsEnv } from '../hooks/player'

describe('player argv and env', () => {
  test('linux players get their own volume flags', () => {
    expect(linuxPlayerArgv('pw-play', '/s/x.wav', 0.8)).toEqual(['pw-play', '--volume', '0.80', '/s/x.wav'])
    expect(linuxPlayerArgv('paplay', '/s/x.wav', 0.5)).toEqual(['paplay', '--volume=32768', '/s/x.wav'])
    expect(linuxPlayerArgv('ffplay', '/s/x.wav', 0.8)).toEqual(['ffplay', '-nodisp', '-autoexit', '-loglevel', 'quiet', '-volume', '80', '/s/x.wav'])
    expect(linuxPlayerArgv('aplay', '/s/x.wav', 0.8)).toEqual(['aplay', '-q', '/s/x.wav'])
  })
  test('windows env carries only data; WSL adds WSLENV with /p for the path; unknown length is PT_MS 0', () => {
    expect(windowsEnv('windows', 'C:\\s\\x.wav', 0.8, 2000, 15000, undefined)).toEqual({
      PT_FILE: 'C:\\s\\x.wav', PT_GAIN: '0.80', PT_MS: '2000', PT_CAP: '15000',
    })
    expect(windowsEnv('wsl', '/s/x.mp3', 1, null, 15000, 'USERPROFILE/p')).toEqual({
      PT_FILE: '/s/x.mp3', PT_GAIN: '1.00', PT_MS: '0', PT_CAP: '15000',
      WSLENV: 'USERPROFILE/p:PT_FILE/p:PT_GAIN:PT_MS:PT_CAP',
    })
  })
  test('PowerShell text holds no double quotes (it crosses Windows command-line quoting)', () => {
    expect(WINDOWS_SCRIPT).not.toContain('"')
    expect(DETACH_COMMAND).not.toContain('"')
  })
  test('bundled sounds are played from under the plugin root', () => {
    const sound = resolveSound(CATALOG[0]!.id, [])!
    expect(filePathOf('/plugins/producer-tags', sound)).toBe(`/plugins/producer-tags/${CATALOG[0]!.file}`)
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `claude plugin test plugin`
Expected: FAIL. `tests/player.test.ts` cannot resolve `../hooks/player`.

- [ ] **Step 3: Implement `platform.ts`**

`plugin/hooks/platform.ts`:
```ts
import { read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { LinuxPlayer, Platform } from '../types'
import { platformAtom } from './state'

const FIND_PLAYER =
  'for p in pw-play paplay ffplay aplay; do if command -v "$p" >/dev/null 2>&1; then echo "$p"; exit 0; fi; done; echo none'

let probing: Promise<Platform> | null = null

/** Which OS this is and how it plays sound: probed once (spec §6.1), then kept in state for the pane. */
export async function detectPlatform($: EngineInterface): Promise<Platform> {
  const cached = await read($, platformAtom)
  if (cached !== null) return cached
  probing ??= probe($)
    .then(async platform => {
      await update($, platformAtom, () => platform)
      return platform
    })
    .finally(() => {
      probing = null
    })
  return probing
}

async function probe($: EngineInterface): Promise<Platform> {
  if ((await $.env.get('OS')) === 'Windows_NT') return { os: 'windows', player: 'powershell' }
  const uname = await $.process.run(['uname', '-s']).catch(() => null)
  const kernel = uname?.stdout.trim()
  if (kernel === 'Darwin') return { os: 'mac', player: 'audio' }
  if (kernel === 'Linux') {
    const version = await $.fs.read('/proc/version').catch(() => '')
    if (typeof version === 'string' && /microsoft/i.test(version)) return { os: 'wsl', player: 'powershell' }
    return { os: 'linux', player: await findLinuxPlayer($) }
  }
  return { os: 'linux', player: 'none' }
}

async function findLinuxPlayer($: EngineInterface): Promise<LinuxPlayer | 'none'> {
  const found = await $.process.run(['sh', '-c', FIND_PLAYER]).catch(() => null)
  const name = found?.stdout.trim()
  return name === 'pw-play' || name === 'paplay' || name === 'ffplay' || name === 'aplay' ? name : 'none'
}
```

- [ ] **Step 4: Implement `player.ts`**

`plugin/hooks/player.ts`:
```ts
import type { EngineInterface } from 'claude-code'

import type { LinuxPlayer, OsName, Platform } from '../types'
import { encodeUtf16LeBase64 } from './codec'
import { WINDOWS_ENGINE } from './constants'
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

async function powershellEnv($: EngineInterface, platform: Platform, request: PlayRequest): Promise<Record<string, string>> {
  const existing = platform.os === 'wsl' ? await $.env.get('WSLENV') : undefined
  return windowsEnv(platform.os, filePathOf($.plugin.root, request.sound), request.gain, request.sound.durationMs, request.maxMs, existing)
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => {
    resolve = r
  })
  return { promise, resolve }
}

export function play($: EngineInterface, platform: Platform, request: PlayRequest): PlayHandle {
  switch (platform.player) {
    case 'audio':
      return playWithEngine($, request)
    case 'none':
      return playSilently($, request.sound.durationMs ?? 3000)
    case 'powershell':
      return playPowerShell($, platform, request)
    default: {
      const path = filePathOf($.plugin.root, request.sound)
      const argv = ['sh', '-c', LINUX_WRAPPER, 'pt-play', ...linuxPlayerArgv(platform.player, path, request.gain)]
      return playProcess($, argv, {}, request.maxMs, pid => $.process.run(['kill', pid]))
    }
  }
}

function playWithEngine($: EngineInterface, request: PlayRequest): PlayHandle {
  const controller = new AbortController()
  const started = deferred<boolean>()
  const ended = (async (): Promise<PlayEnd> => {
    const timer = $.clock.after(request.maxMs, () => controller.abort())
    try {
      const { source } = request.sound
      const clip =
        source.kind === 'asset'
          ? { asset: source.asset }
          : { base64: (await $.fs.read(source.path, { as: 'bytes' })).base64, mime: MIME[source.ext] }
      started.resolve(true)
      await $.audio.play(clip, { gain: request.gain, signal: controller.signal })
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

function playSilently($: EngineInterface, ms: number): PlayHandle {
  const ended = deferred<PlayEnd>()
  const timer = $.clock.after(ms, () => ended.resolve('ok'))
  return {
    started: Promise.resolve(true),
    ended: ended.promise,
    stop: () => {
      timer.cancel()
      ended.resolve('stopped')
    },
  }
}

function playPowerShell($: EngineInterface, platform: Platform, request: PlayRequest): PlayHandle {
  const handle = powershellEnv($, platform, request).then(env =>
    playProcess($, ['powershell.exe', '-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', encodeUtf16LeBase64(WINDOWS_SCRIPT)], env, request.maxMs, null),
  )
  return {
    started: handle.then(h => h.started),
    ended: handle.then(h => h.ended),
    stop: () => void handle.then(h => h.stop()),
  }
}

/** A player process that prints `started` (or `pid <n>`) then ticks; stopping breaks the loop, which kills it. */
function playProcess(
  $: EngineInterface,
  argv: string[],
  env: Record<string, string>,
  maxMs: number,
  kill: ((pid: string) => Promise<unknown>) | null,
): PlayHandle {
  const started = deferred<boolean>()
  let isStopped = false
  let pid: string | null = null
  const stop = () => {
    if (isStopped) return
    isStopped = true
    if (pid !== null && kill !== null) void kill(pid).catch(() => undefined)
  }
  const ended = (async (): Promise<PlayEnd> => {
    const timer = $.clock.after(maxMs, stop)
    let hasStarted = false
    try {
      for await (const chunk of $.process.spawn({ argv, env })) {
        if (!hasStarted) {
          const match = /pid (\d+)/.exec(chunk.text)
          if (match !== null) pid = match[1]!
          if (match !== null || chunk.text.includes('started')) {
            hasStarted = true
            started.resolve(true)
          }
        }
        if (isStopped) {
          if (pid !== null && kill !== null) await kill(pid).catch(() => undefined)
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
export async function playDetached($: EngineInterface, platform: Platform, request: PlayRequest): Promise<void> {
  const path = filePathOf($.plugin.root, request.sound)
  if (platform.player === 'audio') {
    await $.process.run(['sh', '-c', 'afplay -v "$PT_GAIN" "$PT_FILE" >/dev/null 2>&1 &'], {
      env: { PT_FILE: path, PT_GAIN: request.gain.toFixed(2) },
    })
  } else if (platform.player === 'powershell') {
    const env = await powershellEnv($, platform, request)
    env.PT_SCRIPT = encodeUtf16LeBase64(WINDOWS_SCRIPT)
    if (env.WSLENV !== undefined) env.WSLENV += ':PT_SCRIPT'
    await $.process.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', DETACH_COMMAND], { env })
  } else if (platform.player !== 'none') {
    await $.process.run(['sh', '-c', '"$@" >/dev/null 2>&1 &', 'pt-play', ...linuxPlayerArgv(platform.player, path, request.gain)])
  }
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `claude plugin test plugin`
Expected: `tests/player.test.ts` all pass.

- [ ] **Step 6: Type-check and commit**

```bash
npx tsc -p . && git add plugin/hooks/platform.ts plugin/hooks/player.ts plugin/tests/player.test.ts
git commit -m "feat: detect the platform and route playback per OS

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Pipeline and event wiring (`stage.ts`, `pipeline.ts`, `register.tsx`)

**Files:**
- Create: `plugin/hooks/stage.ts`, `plugin/hooks/pipeline.ts`
- Modify: `plugin/hooks/register.tsx` (replace it completely)
- Test: `plugin/tests/pipeline.test.ts`

**Interfaces:**
- **Consumes:**
  - `ensureLoaded`, `loadFromStore`, `changeSettings` (Task 4)
  - `resolveSound` (Task 6)
  - `detectPlatform`, `play`, `playDetached`, `PlayHandle`, `PlayEnd` (Task 7)
  - the trigger functions and `Hit` (Task 3)
  - `act`, `toastOnce`, `logError` (Task 1)
  - the atoms
  - from `tests/world.tsx`: `world`, `bash`, `committed`
- **Produces from `stage.ts`:**
  - `isLive(np: NowPlaying | null, now: number): boolean`. True when the entry holds the stage for claims: not ended and not past its deadline.
  - `isOnStage(np: NowPlaying, now: number): boolean`. True when the band should show the entry: started, and neither past its tail nor past its deadline.
- **Produces from `pipeline.ts`:**
  - `isCoolingDown(cooldowns, key, now): boolean`
  - `fire($, hit: Hit, toolUseId?: string | null): Promise<void>`. A hit with `key: 'preview'` interrupts and skips the cooldown.
  - `firePreview($, sound: SoundId): Promise<void>`
  - `fireDetached($, hit: Hit): Promise<void>`
  - `stopCurrent(): void`
  - `toggleMute($): Promise<Settings>`, an atomic flip that stops the clip when muting
  - `recoverStage($): Promise<void>`, the reload handling called by `session.start`
- **Hooks in `register.tsx`:**
  - `session.start`
  - `tool.call` (Bash), with `.catch`
  - `classic.PostModelSwitch`, `classic.SessionStart`, `classic.Stop`
  - `session.end`
  - `command.run` for `mute` / `tags-mute`

Task 10 adds one line to `fire` (start the band animation).

- [ ] **Step 1: Write the failing tests**

`plugin/tests/pipeline.test.ts`:
```ts
import { describe, expect, test } from 'claude-code/testing'

import { CATALOG } from '../hooks/catalog'
import { LINUX_WRAPPER } from '../hooks/player'
import type { NowPlaying } from '../types'
import { bash, committed, world, type World } from './world'

const pushed = { result: { stdout: '', stderr: '', interrupted: false, gitOperation: { push: { branch: 'main' } } } }
const playing = (w: World) => w.state.get('nowPlaying') as NowPlaying | null | undefined
const asset = (id: string) => ({ asset: CATALOG.find(c => c.id === id)!.file })
const durationOf = (id: string) => CATALOG.find(c => c.id === id)!.durationMs
const run = (command: string) => ({ command, args: '' }) as never

describe('macOS playback', () => {
  test('a commit plays its tag after the tool call settles, at 80%, and the result is untouched', async ($, on) => {
    const w = world(on, { audioMs: 3000 })
    await $.session.start({} as never)
    w.bash = committed()
    const result = await $.tool.call({ tool: 'Bash', command: 'git commit -m x' } as never)
    expect(result).toMatchObject(committed())
    expect(w.plays).toHaveLength(0)
    await w.clock.settle()
    expect(w.plays).toEqual([{ clip: asset('pt:anthropic-trust'), gain: 0.8 }])
    expect(playing(w)).toMatchObject({ key: 'git.commit', endedAt: null })
    expect(playing(w)?.startedAt).toBeGreaterThan(0)
    await w.clock.advance(3000)
    expect(playing(w)?.endedAt).toBeGreaterThan(0)
    await w.clock.advance(1000)
    expect(playing(w)).toBeNull()
  })

  test('the badge is written for the tool call that started a tag', async ($, on) => {
    const w = world(on)
    await $.session.start({} as never)
    const id = await bash($, w, 'git commit -m x', committed())
    expect(w.state.get(`tagged:${id}`)).toBe('pt:anthropic-trust')
  })

  test('30 s cooldown per trigger', async ($, on) => {
    const w = world(on)
    await $.session.start({} as never)
    await bash($, w, 'git commit -m a', committed())
    await w.clock.advance(1000)
    await bash($, w, 'git commit -m b', committed())
    expect(w.plays).toHaveLength(1)
    await w.clock.advance(30_000)
    await bash($, w, 'git commit -m c', committed())
    expect(w.plays).toHaveLength(2)
  })

  test('a tag that fires while another plays is dropped, not queued', async ($, on) => {
    const w = world(on, { audioMs: 3000 })
    await $.session.start({} as never)
    await bash($, w, 'git commit -m x', committed())
    await bash($, w, 'git push', pushed)
    await w.clock.advance(6000)
    expect(w.plays).toHaveLength(1)
  })

  test('two tags claimed in the same tick: exactly one plays', async ($, on) => {
    const w = world(on, { audioMs: 3000 })
    await $.session.start({} as never)
    w.bashBy = { 'git commit -m x': committed(), 'git push': pushed }
    await Promise.all([
      $.tool.call({ tool: 'Bash', command: 'git commit -m x' } as never),
      $.tool.call({ tool: 'Bash', command: 'git push' } as never),
    ])
    await w.clock.settle()
    expect(w.plays).toHaveLength(1)
  })

  test('a clip that never reports its end stops blocking at its deadline; session.start clears it', async ($, on) => {
    const w = world(on, { audioMs: 600_000 })
    await $.session.start({} as never)
    await bash($, w, 'git commit -m x', committed())
    await w.clock.advance(durationOf('pt:anthropic-trust') + 1001)
    await $.session.start({} as never)
    expect(playing(w)).toBeNull()
    await bash($, w, 'git push', pushed)
    expect(w.plays).toHaveLength(2)
  })

  test('an entry orphaned by a reload mid-clip is cleared at its deadline', async ($, on) => {
    const w = world(on, { audioMs: 600_000 })
    await $.session.start({} as never)
    await bash($, w, 'git commit -m x', committed())
    await $.session.start({} as never)
    expect(playing(w)).not.toBeNull()
    await w.clock.advance(durationOf('pt:anthropic-trust') + 1001)
    expect(playing(w)).toBeNull()
  })

  test('/mute toggles and silences', async ($, on) => {
    const w = world(on)
    await $.session.start({} as never)
    expect(w.registered).toContain('mute')
    expect((await $.command.run(run('mute'))).text).toBe('Tags muted.')
    expect(w.stored.get('settings')).toMatchObject({ muted: true })
    await bash($, w, 'git commit -m x', committed())
    expect(w.plays).toHaveLength(0)
    expect((await $.command.run(run('mute'))).text).toBe('Tags unmuted.')
  })

  test('/tags-mute when /mute is taken', async ($, on) => {
    const w = world(on, { refuse: ['mute'] })
    await $.session.start({} as never)
    expect(w.registered).toContain('tags-mute')
    expect((await $.command.run(run('tags-mute'))).text).toBe('Tags muted.')
  })

  test('imports play as base64 with their MIME type; a missing import falls back and toasts once', async ($, on) => {
    const imports = [
      { id: 'user:mine', name: 'mine', file: '/x/mine.mp3', ext: 'mp3', bytes: 3, durationMs: null, peaks: null, isCopy: true },
      { id: 'user:gone', name: 'gone', file: '/x/gone.wav', ext: 'wav', bytes: 3, durationMs: 1000, peaks: null, isCopy: true },
    ]
    const w = world(on, {
      files: { '/x/mine.mp3': { base64: 'SUQz' } },
      store: { imports, settings: { triggers: { 'git.commit': { enabled: true, sound: 'user:mine' }, 'git.push': { enabled: true, sound: 'user:gone' } } } },
    })
    await $.session.start({} as never)
    await bash($, w, 'git commit -m x', committed())
    expect(w.plays[0]!.clip).toEqual({ base64: 'SUQz', mime: 'audio/mpeg' })
    await w.clock.advance(20_000)
    await bash($, w, 'git push', pushed)
    expect(w.plays[1]!.clip).toEqual(asset('pt:did-it-again'))
    expect(w.toasts.filter(t => t.includes('gone is missing'))).toHaveLength(1)
  })

  test('a failed play toasts once, clears the claim and removes the badge', async ($, on) => {
    const w = world(on, { audioFails: true })
    await $.session.start({} as never)
    const id = await bash($, w, 'git commit -m x', committed())
    await w.clock.advance(2000)
    expect(w.toasts.filter(t => t.includes('could not play'))).toHaveLength(1)
    expect(playing(w)).toBeNull()
    expect(w.state.get(`tagged:${id}`)).toBeNull()
  })

  test(
    'tool calls made by other plugins never fire tags',
    {
      plugins: [
        {
          name: 'other',
          register(on) {
            on('session.start', async ($, e, next) => {
              await $.tool.call({ tool: 'Bash', command: 'git commit -m x' } as never)
              return next(e)
            })
          },
        },
      ],
    },
    async ($, on) => {
      const w = world(on)
      w.bash = committed()
      await $.session.start({} as never)
      await w.clock.settle()
      expect(w.toolUseIds).toHaveLength(1)
      expect(w.plays).toHaveLength(0)
    },
  )
})

describe('other platforms', () => {
  test('linux: pw-play inside the tick wrapper; mute kills the pid and ends the process', { timeoutMs: 20_000 }, async ($, on) => {
    const w = world(on, { os: 'linux', linuxPlayer: 'pw-play', spawnTicks: 50 })
    await $.session.start({} as never)
    await bash($, w, 'git commit -m x', committed())
    const spawn = w.spawns[0]!
    expect(spawn.argv.slice(0, 4)).toEqual(['sh', '-c', LINUX_WRAPPER, 'pt-play'])
    expect(spawn.argv.slice(4)).toEqual(['pw-play', '--volume', '0.80', expect.stringMatching(/sounds\/anthropic-trust\.wav$/)])
    await $.command.run(run('mute'))
    await w.clock.advance(100)
    expect(w.runs.some(r => r.argv[0] === 'kill' && r.argv[1] === '4242')).toBe(true)
    expect(spawn.isEnded).toBe(true)
  })

  test('a clip still playing at 15 s is stopped (the cap)', { timeoutMs: 20_000 }, async ($, on) => {
    const w = world(on, { os: 'linux', spawnTicks: 400 })
    await $.session.start({} as never)
    await bash($, w, 'git commit -m x', committed())
    await w.clock.advance(15_200)
    expect(w.spawns[0]!.isEnded).toBe(true)
    expect(w.runs.some(r => r.argv[0] === 'kill')).toBe(true)
    expect(playing(w)?.endedAt ?? 0).toBeGreaterThan(0)
  })

  test('linux without a player: captions only, one toast', async ($, on) => {
    const w = world(on, { os: 'linux', linuxPlayer: 'none' })
    await $.session.start({} as never)
    await bash($, w, 'git commit -m x', committed())
    expect(w.spawns).toHaveLength(0)
    expect(playing(w)?.startedAt).toBeGreaterThan(0)
    expect(w.toasts.filter(t => t.includes('no audio player'))).toHaveLength(1)
  })

  test('wsl: powershell -STA -EncodedCommand with data in env and WSLENV path translation', async ($, on) => {
    const w = world(on, { os: 'wsl', env: { WSLENV: 'USERPROFILE/p' } })
    await $.session.start({} as never)
    await bash($, w, 'git commit -m x', committed())
    const spawn = w.spawns[0]!
    expect(spawn.argv.slice(0, 5)).toEqual(['powershell.exe', '-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand'])
    expect(spawn.env).toMatchObject({ PT_GAIN: '0.80', PT_CAP: '15000', WSLENV: 'USERPROFILE/p:PT_FILE/p:PT_GAIN:PT_MS:PT_CAP' })
    expect(spawn.env?.PT_FILE).toMatch(/sounds\/anthropic-trust\.wav$/)
  })

  test('windows: powershell without WSLENV', async ($, on) => {
    const w = world(on, { os: 'windows' })
    await $.session.start({} as never)
    await bash($, w, 'git commit -m x', committed())
    expect(w.spawns[0]!.argv[0]).toBe('powershell.exe')
    expect(w.spawns[0]!.env?.WSLENV).toBeUndefined()
  })
})

describe('non-Bash triggers', () => {
  test('model switch to Fable plays; turn.done and session.open are off by default', async ($, on) => {
    const w = world(on)
    await $.session.start({} as never)
    await $.classic.PostModelSwitch({ from_model: 'claude-opus-5-5', to_model: 'claude-fable-5-1', requested_model: 'fable', source: 'command', context_tokens: 0 } as never)
    await w.clock.settle()
    expect(w.plays.map(p => p.clip)).toEqual([asset('pt:fable-on-beat')])
    await w.clock.advance(2000)
    await $.classic.Stop({ stop_hook_active: false } as never)
    await $.classic.SessionStart({ source: 'startup' } as never)
    await w.clock.settle()
    expect(w.plays).toHaveLength(1)
  })

  test('exit plays the outro detached through afplay; /clear does not', async ($, on) => {
    const w = world(on)
    await $.session.start({} as never)
    await $.session.end({ reason: 'clear', sessionId: 's', resume: {} } as never)
    await w.clock.settle()
    expect(w.runs.filter(r => r.argv[2]?.includes('afplay'))).toHaveLength(0)
    await $.session.end({ reason: 'prompt_input_exit', sessionId: 's', resume: {} } as never)
    await w.clock.settle()
    const outro = w.runs.find(r => r.argv[0] === 'sh' && r.argv[2]?.includes('afplay'))
    expect(outro?.env).toMatchObject({ PT_GAIN: '0.80' })
    expect(outro?.env?.PT_FILE).toMatch(/claude-outta\.wav$/)
  })
})
```

Subagent Bash calls fire tags because the hook never checks `agentId`. The test kit drops `agentId` on `$.tool.call`, so that case can't be expressed here. It is covered by Task 15's live checklist.

- [ ] **Step 2: Run the tests to see them fail**

Run: `claude plugin test plugin`
Expected: FAIL in `tests/pipeline.test.ts`. For example, the first test's `expect(w.plays).toEqual([...])` sees an empty array.

- [ ] **Step 3: Implement `stage.ts`**

`plugin/hooks/stage.ts`:
```ts
import type { NowPlaying } from '../types'
import { END_TAIL_MS } from './constants'

/** Holds the stage for claims: not ended and not past its deadline (spec §5). */
export function isLive(np: NowPlaying | null, now: number): boolean {
  return np !== null && np.endedAt === null && now < np.deadline
}

/** Shown by the band: started, and neither past its tail nor past its deadline (spec §8.3). */
export function isOnStage(np: NowPlaying, now: number): boolean {
  if (np.startedAt === null || now >= np.deadline) return false
  return np.endedAt === null || now < np.endedAt + END_TAIL_MS
}
```

- [ ] **Step 4: Implement `pipeline.ts`**

`plugin/hooks/pipeline.ts`:
```ts
import { memberOf, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { ImportedSound, NowPlaying, Settings, SoundId, TriggerKey } from '../types'
import { CLAIM_GRACE_MS, COOLDOWN_MS, END_TAIL_MS, FALLBACK_SOUND, MAX_CLIP_MS, TRIGGERS } from './constants'
import { resolveSound, type ResolvedSound } from './library'
import { act, toastOnce } from './notify'
import { detectPlatform } from './platform'
import { play, playDetached, type PlayEnd, type PlayHandle } from './player'
import { changeSettings, ensureLoaded } from './settings'
import { isLive } from './stage'
import { cooldownsAtom, nowPlayingAtom, taggedAtom } from './state'
import type { Hit } from './triggers'

let current: { token: string; handle: PlayHandle } | null = null

export function isCoolingDown(cooldowns: Partial<Record<TriggerKey, number>>, key: TriggerKey, now: number): boolean {
  const last = cooldowns[key]
  return last !== undefined && now - last < COOLDOWN_MS
}

function defaultSoundFor(key: TriggerKey): SoundId {
  return TRIGGERS.find(t => t.id === key)?.sound ?? FALLBACK_SOUND
}

/** Changes `nowPlaying` only while it is still this clip's. */
function updateIfMine($: EngineInterface, token: string, change: (np: NowPlaying) => NowPlaying | null) {
  return update($, nowPlayingAtom, np => (np?.token === token ? change(np) : np))
}

async function setTag($: EngineInterface, toolUseId: string | null, sound: SoundId | null): Promise<void> {
  if (toolUseId !== null) await update($, memberOf(taggedAtom, { requestId: toolUseId }), () => sound)
}

async function failPlayback($: EngineInterface, token: string, toolUseId: string | null): Promise<void> {
  await updateIfMine($, token, () => null)
  await setTag($, toolUseId, null)
  await toastOnce($, 'playback-failed', 'Producer Tags: this machine could not play the tag.')
}

async function resolveOrFallback($: EngineInterface, hit: Hit, imports: readonly ImportedSound[]): Promise<ResolvedSound | null> {
  const wanted = resolveSound(hit.sound, imports)
  if (wanted !== null && (wanted.source.kind === 'asset' || (await $.fs.exists(wanted.source.path)))) return wanted
  if (wanted !== null) await toastOnce($, `missing:${wanted.id}`, `Producer Tags: ${wanted.caption} is missing, so the default plays.`)
  return resolveSound(defaultSoundFor(hit.key), imports)
}

/** Plays a hit. Triggers respect the cooldown and the claim; previews (`key: 'preview'`) interrupt and skip the cooldown (spec §5). */
export async function fire($: EngineInterface, hit: Hit, toolUseId: string | null = null): Promise<void> {
  const isPreview = hit.key === 'preview'
  const { settings, imports } = await ensureLoaded($)
  if (settings.muted) return
  const now = await $.clock.now()
  if (!isPreview && isCoolingDown(await read($, cooldownsAtom), hit.key, now)) return
  const sound = await resolveOrFallback($, hit, imports)
  if (sound === null) return

  const token = `${sound.id}:${now}:${Math.random().toString(36).slice(2, 8)}`
  const mine: NowPlaying = {
    token,
    soundId: sound.id,
    key: hit.key,
    caption: sound.caption,
    riff: sound.riff,
    claimedAt: now,
    startedAt: null,
    endedAt: null,
    durationMs: sound.durationMs,
    deadline: now + CLAIM_GRACE_MS,
    peaks: sound.peaks,
    toolUseId,
  }
  if (isPreview) {
    stopCurrent()
    await update($, nowPlayingAtom, () => mine)
  } else {
    const claimed = await update($, nowPlayingAtom, np => (isLive(np, now) ? np : mine))
    if (claimed?.token !== token) return
    await update($, cooldownsAtom, cooldowns => ({ ...cooldowns, [hit.key]: now }))
  }

  const platform = await detectPlatform($)
  if (platform.player === 'none') {
    await toastOnce($, 'no-player', 'Producer Tags: no audio player found, so tags show as captions only.')
  }
  const handle = play($, platform, { sound, gain: settings.volume / 100, maxMs: MAX_CLIP_MS })
  current = { token, handle }
  if (!(await handle.started)) {
    await failPlayback($, token, null)
    return
  }
  const startedAt = await $.clock.now()
  await updateIfMine($, token, np => ({ ...np, startedAt, deadline: startedAt + (sound.durationMs ?? MAX_CLIP_MS) + END_TAIL_MS }))
  await setTag($, toolUseId, sound.id)
  void handle.ended.then(result => act($, 'finish', () => finish($, token, toolUseId, result)))
}

async function finish($: EngineInterface, token: string, toolUseId: string | null, result: PlayEnd): Promise<void> {
  if (current?.token === token) current = null
  if (result === 'failed') {
    await failPlayback($, token, toolUseId)
    return
  }
  const endedAt = await $.clock.now()
  await updateIfMine($, token, np => ({ ...np, endedAt }))
  $.clock.after(END_TAIL_MS, () => act($, 'clear', () => updateIfMine($, token, () => null)))
}

export function stopCurrent(): void {
  current?.handle.stop()
}

export function firePreview($: EngineInterface, sound: SoundId): Promise<void> {
  return fire($, { key: 'preview', sound })
}

/** The session.close outro: detached so it outlives the exit (spec §6.3). */
export async function fireDetached($: EngineInterface, hit: Hit): Promise<void> {
  const { settings, imports } = await ensureLoaded($)
  if (settings.muted) return
  const sound = resolveSound(hit.sound, imports) ?? resolveSound(defaultSoundFor(hit.key), imports)
  if (sound === null) return
  await playDetached($, await detectPlatform($), { sound, gain: settings.volume / 100, maxMs: MAX_CLIP_MS })
}

export async function toggleMute($: EngineInterface): Promise<Settings> {
  const settings = await changeSettings($, s => ({ ...s, muted: !s.muted }))
  if (settings.muted) stopCurrent()
  return settings
}

/**
 * On a (re)load the fresh module owns no player: forget the old handle, drop an entry already
 * past its end, and clear an unfinished one at its deadline so the band can never stick (spec §5).
 */
export async function recoverStage($: EngineInterface): Promise<void> {
  current = null
  const np = await read($, nowPlayingAtom)
  if (np === null) return
  const now = await $.clock.now()
  const clearAt = np.endedAt === null ? np.deadline : np.endedAt + END_TAIL_MS
  if (now >= clearAt) {
    await updateIfMine($, np.token, () => null)
    return
  }
  const token = np.token
  $.clock.after(clearAt - now, () => act($, 'recover', () => updateIfMine($, token, () => null)))
}
```

- [ ] **Step 5: Replace `register.tsx`**

`plugin/hooks/register.tsx`:
```tsx
import type { EngineInterface, Register } from 'claude-code'

import type { Settings } from '../types'
import { act, logError } from './notify'
import { fire, fireDetached, recoverStage, toggleMute } from './pipeline'
import { ensureLoaded, loadFromStore } from './settings'
import {
  bashFacts,
  hitFor,
  modelTrigger,
  pickBashHit,
  sessionCloseTrigger,
  sessionOpenTrigger,
  turnDoneTrigger,
  type Hit,
} from './triggers'

let muteCommand: 'mute' | 'tags-mute' = 'mute'

async function registerMute($: EngineInterface): Promise<'mute' | 'tags-mute'> {
  const description = 'Mute or unmute Producer Tags'
  try {
    await $.command.register({ name: 'mute', description, immediate: true })
    return 'mute'
  } catch {
    await $.command.register({ name: 'tags-mute', description, immediate: true })
    return 'tags-mute'
  }
}

/** Runs tag work in its own dispatch once the current one resolves (spec §3). */
function schedule($: EngineInterface, pick: (settings: Settings) => Hit | null, toolUseId: string | null = null): void {
  $.clock.after(0, () =>
    act($, 'trigger', async () => {
      const { settings } = await ensureLoaded($)
      const hit = pick(settings)
      if (hit !== null) await fire($, hit, toolUseId)
    }),
  )
}

async function muteAnswer($: EngineInterface): Promise<{ text: string }> {
  try {
    const settings = await toggleMute($)
    return { text: settings.muted ? 'Tags muted.' : 'Tags unmuted.' }
  } catch (error) {
    logError($, 'mute', error)
    return { text: 'Producer Tags hit an error.' }
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await loadFromStore($)
      await recoverStage($)
      muteCommand = await registerMute($)
    } catch (error) {
      logError($, 'session.start', error)
    }
    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (next.origin.plugin === 'engine') {
      const input = { command: e.command, run_in_background: e.run_in_background, isAborted: next.signal.aborted }
      schedule($, settings => pickBashHit(settings, bashFacts(input, ran)), e.tool_use_id)
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('classic.PostModelSwitch', ($, e, next) => {
    schedule($, settings => hitFor(settings, modelTrigger(e)))
    return next(e)
  })
  on('classic.SessionStart', ($, e, next) => {
    schedule($, settings => hitFor(settings, sessionOpenTrigger(e.source)))
    return next(e)
  })
  on('classic.Stop', ($, e, next) => {
    schedule($, settings => hitFor(settings, turnDoneTrigger(e.stop_hook_active === true)))
    return next(e)
  })

  // The outro is launched, not awaited: session.end has one short budget for every hook (spec §6.3).
  on('session.end', ($, e, next) => {
    act($, 'session.end', async () => {
      const { settings } = await ensureLoaded($)
      const hit = hitFor(settings, sessionCloseTrigger(e.reason))
      if (hit !== null) await fireDetached($, hit)
    })
    return next(e)
  })

  on('command.run', { command: 'mute' }, async ($, e, next) => (muteCommand === 'mute' ? muteAnswer($) : next(e)))
  on('command.run', { command: 'tags-mute' }, async $ => muteAnswer($))
}
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `claude plugin test plugin`
Expected: `tests/pipeline.test.ts` all pass, and earlier files still pass.

How to read the common failures:
- **"hook skipped … no implementation for X":** `world()` is missing a fake for noun X. Add it beside the others in `world.tsx`.
- **A `toMatchObject` on the tool result fails because of extra engine-set fields:** keep `toMatchObject`, never `toEqual`.
- **A test times out:** the mock clock has more waits to step through than expected. Raise that test's `timeoutMs`; don't shorten the advance.

- [ ] **Step 7: Type-check, validate, commit**

Run: `npx tsc -p . && claude plugin validate plugin`
Expected:
- `validate` lists `tool.call{tool=Bash}` under "gating hook with .catch".
- It lists `command.run{command=mute}` as a gate, because that hook reads `next`.
- Validation passes.

```bash
git add plugin/hooks/stage.ts plugin/hooks/pipeline.ts plugin/hooks/register.tsx plugin/tests/pipeline.test.ts
git commit -m "feat: fire tags from Bash, model switch, session and stop events

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Importing and deleting user sounds (`imports.ts`)

**Files:**
- Create: `plugin/hooks/imports.ts`
- Test: `plugin/tests/imports.test.ts` (the pure parts). The import flows that need `$` are tested through the pane in Task 12, which is the only caller.

**Interfaces:**
- **Consumes:**
  - `detectPlatform`
  - `ensureLoaded`, `changeImports`, `changeSettings`
  - `allowedExts`, `extOf`, `basename`, `slugify`, `parseWav`
  - `decodeBase64`
  - `MAX_IMPORT_BYTES`, `TRIGGERS`, `FALLBACK_SOUND`
- **Produces:**
  - `type ImportResult = { ok: true; sound: ImportedSound; warning: string | null } | { ok: false; error: string }`
  - `cleanPastedPath(raw: string, os: OsName): string`, which trims, unquotes, and unescapes a pasted path
  - `expandPath($, raw: string, platform: Platform): Promise<string>`, which applies `cleanPastedPath`, then `~`, then `wslpath -u` for `C:\` paths on WSL
  - `soundsDir($, platform): Promise<{ dir: string; sep: '/' | '\\' }>`
  - `importSound($, rawPath: string): Promise<ImportResult>`
  - `deleteImport($, id: SoundId): Promise<void>`
  - `resetSound(settings: Settings, id: SoundId): Settings`

- [ ] **Step 1: Write the failing tests**

`plugin/tests/imports.test.ts`:
```ts
import { describe, expect, test } from 'claude-code/testing'

import { cleanPastedPath, resetSound } from '../hooks/imports'
import { defaultSettings } from '../hooks/settings'

describe('cleanPastedPath', () => {
  test('drag-and-drop: surrounding quotes, escaped spaces and brackets, stray whitespace', () => {
    expect(cleanPastedPath("  '/Users/me/My Tags/x.wav' ", 'mac')).toBe('/Users/me/My Tags/x.wav')
    expect(cleanPastedPath('"/Users/me/My Tags/x.wav"', 'linux')).toBe('/Users/me/My Tags/x.wav')
    expect(cleanPastedPath('/Users/me/My\\ Tags/tag\\ \\(final\\).wav', 'mac')).toBe('/Users/me/My Tags/tag (final).wav')
  })
  test('windows paths keep their backslashes', () => {
    expect(cleanPastedPath('"C:\\Users\\me\\My Tags\\x.wav"', 'windows')).toBe('C:\\Users\\me\\My Tags\\x.wav')
  })
  test('a lone quote is not unquoted', () => {
    expect(cleanPastedPath("'", 'mac')).toBe("'")
  })
})

describe('resetSound', () => {
  test('points triggers and custom triggers using a deleted sound back at their defaults', () => {
    const s = defaultSettings()
    s.triggers['git.push'].sound = 'user:x'
    s.custom = [{ id: 'c1', pattern: 'x', outcome: 'any', sound: 'user:x', enabled: true, isInvalid: false }]
    const reset = resetSound(s, 'user:x')
    expect(reset.triggers['git.push'].sound).toBe('pt:did-it-again')
    expect(reset.custom[0]!.sound).toBe('pt:808-boom')
    expect(reset.triggers['git.commit']).toEqual(s.triggers['git.commit'])
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `claude plugin test plugin`
Expected: FAIL. `tests/imports.test.ts` cannot resolve `../hooks/imports`.

- [ ] **Step 3: Implement `imports.ts`**

`plugin/hooks/imports.ts`:
```ts
import type { EngineInterface } from 'claude-code'

import type { ImportedSound, OsName, Platform, Settings, SoundId } from '../types'
import { decodeBase64 } from './codec'
import { FALLBACK_SOUND, MAX_IMPORT_BYTES, TRIGGERS } from './constants'
import { allowedExts, basename, extOf, parseWav, slugify } from './library'
import { detectPlatform } from './platform'
import { changeImports, changeSettings, ensureLoaded } from './settings'

export type ImportResult =
  | { ok: true; sound: ImportedSound; warning: string | null }
  | { ok: false; error: string }

/** What a terminal pastes for a dropped file: maybe quoted, maybe with backslash-escaped spaces. */
export function cleanPastedPath(raw: string, os: OsName): string {
  let path = raw.trim()
  const first = path[0]
  if (path.length >= 2 && (first === "'" || first === '"') && path.endsWith(first)) path = path.slice(1, -1)
  if (os !== 'windows') path = path.replace(/\\([ '"()&[\]])/g, '$1')
  return path
}

async function home($: EngineInterface, platform: Platform): Promise<string> {
  return (platform.os === 'windows' ? await $.env.get('USERPROFILE') : await $.env.get('HOME')) ?? '.'
}

export async function expandPath($: EngineInterface, raw: string, platform: Platform): Promise<string> {
  let path = cleanPastedPath(raw, platform.os)
  if (path === '~' || path.startsWith('~/') || path.startsWith('~\\')) path = `${await home($, platform)}${path.slice(1)}`
  if (platform.os === 'wsl' && /^[A-Za-z]:[\\/]/.test(path)) {
    const converted = await $.process.run(['wslpath', '-u', path]).catch(() => null)
    if (converted?.exitCode === 0) path = converted.stdout.trim()
  }
  return path
}

export async function soundsDir($: EngineInterface, platform: Platform): Promise<{ dir: string; sep: '/' | '\\' }> {
  const sep = platform.os === 'windows' ? '\\' : '/'
  const config = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${await home($, platform)}${sep}.claude`
  return { dir: `${config}${sep}producer-tags${sep}sounds`, sep }
}

/** Copies with every path in env (never in the command text). */
async function copyInto($: EngineInterface, platform: Platform, source: string, dir: string, target: string): Promise<boolean> {
  const env = { PT_DIR: dir, PT_SRC: source, PT_DST: target }
  const argv =
    platform.os === 'windows'
      ? ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', 'New-Item -ItemType Directory -Force -Path $env:PT_DIR | Out-Null; Copy-Item -LiteralPath $env:PT_SRC -Destination $env:PT_DST']
      : ['sh', '-c', 'mkdir -p -- "$PT_DIR" && cp -- "$PT_SRC" "$PT_DST"']
  const result = await $.process.run(argv, { env }).catch(() => null)
  return result?.exitCode === 0
}

async function namesOnDisk($: EngineInterface, dir: string): Promise<string[]> {
  const entries = await $.fs.list(dir).catch(() => [])
  return entries.map(entry => entry.name.replace(/\.[^.]*$/, ''))
}

export async function importSound($: EngineInterface, rawPath: string): Promise<ImportResult> {
  const platform = await detectPlatform($)
  const path = await expandPath($, rawPath, platform)
  if (path === '') return { ok: false, error: 'Enter the path of an audio file.' }
  const stat = await $.fs.stat(path).catch(() => null)
  if (stat === null || stat.kind !== 'file') return { ok: false, error: `No file at ${path}.` }
  const ext = extOf(path)
  const allowed = allowedExts(platform.os, platform.player)
  if (ext === null || !allowed.includes(ext)) return { ok: false, error: `Use one of: ${allowed.join(', ')}.` }
  if (stat.size > MAX_IMPORT_BYTES) return { ok: false, error: 'Files must be 4 MB or smaller.' }

  const { imports } = await ensureLoaded($)
  const { dir, sep } = await soundsDir($, platform)
  const name = basename(path)
  const taken = new Set([...imports.map(sound => sound.id.slice('user:'.length)), ...(await namesOnDisk($, dir))])
  const slug = slugify(name, taken)
  const target = `${dir}${sep}${slug}.${ext}`
  const isCopy = await copyInto($, platform, path, dir, target)
  const file = isCopy ? target : path

  let durationMs: number | null = null
  let peaks: number[] | null = null
  if (ext === 'wav') {
    const bytes = await $.fs.read(file, { as: 'bytes' }).catch(() => $.fs.read(path, { as: 'bytes' }).catch(() => null))
    const info = bytes === null ? null : parseWav(decodeBase64(bytes.base64))
    durationMs = info?.durationMs ?? null
    peaks = info?.peaks ?? null
  }
  const sound: ImportedSound = { id: `user:${slug}`, name: name.replace(/\.[^.]*$/, ''), file, ext, bytes: stat.size, durationMs, peaks, isCopy }
  await changeImports($, list => [...list, sound])
  return {
    ok: true,
    sound,
    warning: isCopy ? null : 'Could not copy the file, so it is used from where it is; moving it will break this tag.',
  }
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

export async function deleteImport($: EngineInterface, id: SoundId): Promise<void> {
  const { imports } = await ensureLoaded($)
  const sound = imports.find(s => s.id === id)
  if (sound === undefined) return
  if (sound.isCopy) {
    const platform = await detectPlatform($)
    const argv =
      platform.os === 'windows'
        ? ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', 'Remove-Item -LiteralPath $env:PT_DST -Force']
        : ['rm', '-f', '--', sound.file]
    await $.process.run(argv, platform.os === 'windows' ? { env: { PT_DST: sound.file } } : undefined).catch(() => null)
  }
  await changeImports($, list => list.filter(s => s.id !== id))
  await changeSettings($, settings => resetSound(settings, id))
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `claude plugin test plugin`
Expected: `tests/imports.test.ts` all pass.

- [ ] **Step 5: Type-check and commit**

```bash
npx tsc -p . && git add plugin/hooks/imports.ts plugin/tests/imports.test.ts
git commit -m "feat: import and delete user sounds safely across platforms

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Now-playing band, animation, and mode label

**Files:**
- Create: `plugin/hooks/ui/visual.ts`, `plugin/hooks/ui/animate.ts`, `plugin/hooks/ui/band.tsx`, `plugin/hooks/ui/mode.tsx`
- Modify: `plugin/hooks/pipeline.ts` (start the animation when a clip starts), `plugin/hooks/register.tsx` (register the band and the mode label)
- Test: `plugin/tests/visual.test.ts`, `plugin/tests/band.test.tsx`

**Interfaces:**
- **Consumes:**
  - `isOnStage` (Task 8, `stage.ts`)
  - `act`, `logError`
  - the atoms
  - `FRAME_MS`
  - from `tests/world.tsx`: `world`, `bash`, `committed`, `BAND`
- **Produces from `visual.ts`:**
  - `BAR_GLYPHS`
  - `progressOf(np, now): number`
  - `levelsAt(peaks, progress, count, seed): number[]`, where each level is 0–7
  - `barsText(levels): string`
  - `waveformLevels(peaks, width): number[]`
  - `captionWordAt(np, now): number`, where -1 means no highlight
- **Produces from `animate.ts`:** `EQ_COLUMNS = 10`, `startAnimation($, token)`, `stopAnimation()`.
- **Produces from `band.tsx` / `mode.tsx`:** `registerBand(on)` and `registerMode(on)`. The band's row Box key is `pt-band`.

- [ ] **Step 1: Write the failing tests**

`plugin/tests/visual.test.ts`:
```ts
import { describe, expect, test } from 'claude-code/testing'

import { BAR_GLYPHS, barsText, captionWordAt, levelsAt, progressOf, waveformLevels } from '../hooks/ui/visual'
import type { NowPlaying } from '../types'

const np = (over: Partial<NowPlaying> = {}): NowPlaying => ({
  token: 't', soundId: 'pt:x', key: 'git.commit', caption: 'one two three four', riff: 'r',
  claimedAt: 0, startedAt: 1000, endedAt: null, durationMs: 2000, deadline: 9999, peaks: [0, 0.5, 1, 0.25], toolUseId: null, ...over,
})

describe('visual', () => {
  test('progress and caption word follow the clip', () => {
    expect(progressOf(np(), 1000)).toBe(0)
    expect(progressOf(np(), 2000)).toBe(0.5)
    expect(progressOf(np(), 9000)).toBe(1)
    expect(captionWordAt(np(), 1000)).toBe(0)
    expect(captionWordAt(np(), 2100)).toBe(2)
    expect(captionWordAt(np(), 9000)).toBe(3)
    expect(captionWordAt(np({ durationMs: null }), 2000)).toBe(-1)
  })
  test('levels stay in 0..7 and follow the peaks', () => {
    expect(levelsAt([0, 0, 0, 0], 0.5, 10, 3).every(l => l === 0)).toBe(true)
    const loud = levelsAt([1, 1, 1, 1], 0.5, 10, 3)
    expect(loud).toHaveLength(10)
    expect(loud.every(l => l >= 4 && l <= 7)).toBe(true)
    expect(levelsAt(null, 0.5, 10, 3).every(l => l >= 0 && l <= 7)).toBe(true)
  })
  test('bars and waveform text', () => {
    expect(barsText([0, 7, 3])).toBe(`${BAR_GLYPHS[0]}${BAR_GLYPHS[7]}${BAR_GLYPHS[3]}`)
    expect(waveformLevels([0, 1], 4)).toEqual([0, 0, 7, 7])
    expect(waveformLevels(null, 3)).toEqual([0, 0, 0])
  })
})
```

`plugin/tests/band.test.tsx`:
```tsx
import { describe, expect, test } from 'claude-code/testing'

import { CATALOG } from '../hooks/catalog'
import { BAND, bash, committed, world } from './world'

const COMMIT = CATALOG.find(c => c.id === 'pt:anthropic-trust')!
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const RIFF = new RegExp(`riffing on ${escape(COMMIT.riff)}`)
const FIRST_WORD = new RegExp(escape(COMMIT.caption.split(/\s+/)[0]!))

describe('now-playing band', () => {
  test('nothing playing: only the engine draws', async ($, on) => {
    world(on)
    await $.session.start({} as never)
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await ui.find({ text: /riffing on/ })).toBeUndefined()
    expect(await ui.find({ text: 'ENGINE' })).toBeDefined()
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    test(`a playing tag shows caption, riff and equalizer bars (${surface}), then leaves after the tail`, { timeoutMs: 20_000 }, async ($, on) => {
      const w = world(on, { audioMs: COMMIT.durationMs })
      await $.session.start({} as never)
      await bash($, w, 'git commit -m x', committed())
      const ui = await $.ui.mount({ ...BAND, surface })
      expect(await ui.find({ text: RIFF })).toBeDefined()
      expect(await ui.find({ text: FIRST_WORD })).toBeDefined()
      expect(await ui.find({ text: /[▁▂▃▄▅▆▇█]{10}/ })).toBeDefined()
      expect(await ui.find({ text: 'ENGINE' })).toBeDefined()
      await w.clock.advance(COMMIT.durationMs + 1100)
      expect(await ui.find({ text: /riffing on/ })).toBeUndefined()
    })
  }

  test('the frame counter and caption highlight move forward while the clip plays', { timeoutMs: 20_000 }, async ($, on) => {
    const w = world(on, { audioMs: COMMIT.durationMs })
    await $.session.start({} as never)
    await bash($, w, 'git commit -m x', committed())
    await $.ui.mount({ ...BAND, surface: 'terminal' })
    await w.clock.advance(100)
    const early = { frame: w.state.get('bandFrame') as number, word: w.state.get('captionWord') as number }
    await w.clock.advance(Math.floor(COMMIT.durationMs * 0.8))
    expect(w.state.get('bandFrame') as number).toBeGreaterThan(early.frame)
    expect(w.state.get('captionWord') as number).toBeGreaterThan(early.word)
  })

  test('an entry past its deadline is not shown, even if its end was never reported', { timeoutMs: 20_000 }, async ($, on) => {
    const w = world(on, { audioMs: 600_000 })
    await $.session.start({} as never)
    await bash($, w, 'git commit -m x', committed())
    await w.clock.advance(COMMIT.durationMs + 1001)
    expect(await (await $.ui.mount({ ...BAND, surface: 'terminal' })).find({ text: /riffing on/ })).toBeUndefined()
  })

  test('hidden when Studio → band is off', async ($, on) => {
    const w = world(on, { audioMs: 3000, store: { settings: { studio: { band: false, badges: true } } } })
    await $.session.start({} as never)
    await bash($, w, 'git commit -m x', committed())
    expect(await (await $.ui.mount({ ...BAND, surface: 'terminal' })).find({ text: /riffing on/ })).toBeUndefined()
  })

  test('a survey wins over the band', async ($, on) => {
    const w = world(on, { audioMs: 3000 })
    await $.session.start({} as never)
    await bash($, w, 'git commit -m x', committed())
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, hasSurvey: true } })
    expect(await ui.find({ text: /riffing on/ })).toBeUndefined()
  })
})

describe('mode label', () => {
  test('adds ♫ tags, or ♫ muted', async ($, on) => {
    world(on)
    await $.session.start({} as never)
    const mode = { plugin: 'producer-tags', component: 'SessionMode' as const, props: { modes: ['plan'] } }
    expect((await (await $.ui.mount({ ...mode, surface: 'terminal' })).find({ type: 'Text' }))?.text).toBe('plan | ♫ tags')
    await $.command.run({ command: 'mute', args: '' } as never)
    expect((await (await $.ui.mount({ ...mode, surface: 'desktop' })).find({ type: 'Text' }))?.text).toBe('plan | ♫ muted')
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `claude plugin test plugin`
Expected: FAIL. `visual.test.ts` cannot resolve `../hooks/ui/visual`, and the band tests find no `riffing on` text.

- [ ] **Step 3: Implement `visual.ts`**

`plugin/hooks/ui/visual.ts`:
```ts
import type { NowPlaying } from '../../types'

export const BAR_GLYPHS = '▁▂▃▄▅▆▇█'

export function progressOf(np: NowPlaying, now: number): number {
  if (np.startedAt === null || np.durationMs === null || np.durationMs <= 0) return 0
  return Math.min(1, Math.max(0, (now - np.startedAt) / np.durationMs))
}

function pseudoRandom(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

/** `count` bar heights (0–7) for this moment: the clip's loudness with a little per-bar motion. */
export function levelsAt(peaks: readonly number[] | null, progress: number, count: number, seed: number): number[] {
  return Array.from({ length: count }, (_, i) => {
    const wobble = 0.55 + 0.45 * pseudoRandom(seed * 31 + i)
    const loudness =
      peaks !== null && peaks.length > 0
        ? peaks[Math.min(peaks.length - 1, Math.floor(progress * peaks.length))]! * wobble
        : pseudoRandom(seed * 17 + i)
    return Math.min(7, Math.max(0, Math.round(loudness * 7)))
  })
}

export function barsText(levels: readonly number[]): string {
  return levels.map(level => BAR_GLYPHS[level]).join('')
}

/** The clip's peaks squeezed into `width` bars (0–7). */
export function waveformLevels(peaks: readonly number[] | null, width: number): number[] {
  if (peaks === null || peaks.length === 0) return new Array<number>(width).fill(0)
  return Array.from({ length: width }, (_, i) => {
    const from = Math.floor((i * peaks.length) / width)
    const to = Math.max(from + 1, Math.floor(((i + 1) * peaks.length) / width))
    return Math.min(7, Math.round(Math.max(...peaks.slice(from, to)) * 7))
  })
}

/** Which caption word is lit now; -1 when the clip's length is unknown (no highlight). */
export function captionWordAt(np: NowPlaying, now: number): number {
  if (np.durationMs === null || np.startedAt === null) return -1
  const words = np.caption.split(/\s+/).filter(Boolean).length
  return Math.min(words - 1, Math.floor(progressOf(np, now) * words))
}
```

- [ ] **Step 4: Implement `animate.ts`**

`plugin/hooks/ui/animate.ts`:
```ts
import { read, update } from 'claude-code'
import type { EngineInterface, Timer } from 'claude-code'

import { FRAME_MS } from '../constants'
import { act } from '../notify'
import { isOnStage } from '../stage'
import { bandFrameAtom, captionWordAtom, nowPlayingAtom } from '../state'
import { captionWordAt } from './visual'

export const EQ_COLUMNS = 10

let running: { token: string; timer: Timer } | null = null

export function stopAnimation(): void {
  running?.timer.cancel()
  running = null
}

/** Redraws the band (and a previewing pane row) from state 10 times a second until the clip leaves the stage (spec §8.3). */
export function startAnimation($: EngineInterface, token: string): void {
  stopAnimation()
  act($, 'band frame', () => update($, captionWordAtom, () => -1))
  running = { token, timer: $.clock.every(FRAME_MS, () => act($, 'band frame', () => frame($, token))) }
}

async function frame($: EngineInterface, token: string): Promise<void> {
  const np = await read($, nowPlayingAtom)
  const now = await $.clock.now()
  if (np === null || np.token !== token || !isOnStage(np, now)) {
    if (running?.token !== token) return
    stopAnimation()
    await update($, bandFrameAtom, n => n + 1) // one last redraw, so a band past its deadline hides
    return
  }
  await update($, bandFrameAtom, n => n + 1)
  const word = captionWordAt(np, now)
  if (word !== (await read($, captionWordAtom))) await update($, captionWordAtom, () => word)
}
```

- [ ] **Step 5: Implement `band.tsx` and `mode.tsx`**

`plugin/hooks/ui/band.tsx`:
```tsx
import { read } from 'claude-code'
import type { On } from 'claude-code'

import { logError } from '../notify'
import { isOnStage } from '../stage'
import { bandFrameAtom, captionWordAtom, nowPlayingAtom, settingsAtom } from '../state'
import { EQ_COLUMNS } from './animate'
import { barsText, levelsAt, progressOf } from './visual'

export function registerBand(on: On): void {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    try {
      const np = await read($, nowPlayingAtom)
      const settings = await read($, settingsAtom)
      const frame = await read($, bandFrameAtom)
      const word = await read($, captionWordAtom)
      const now = await $.clock.now()
      if (np === null || !isOnStage(np, now) || settings?.studio.band === false || e.props.hasSurvey) return next(e)

      const { Box, Text } = $.ui.resolve(e)
      const bars = barsText(levelsAt(np.peaks, progressOf(np, now), EQ_COLUMNS, frame))
      const words = np.caption.split(/\s+/).filter(Boolean)
      const lit = word < 0 ? 0 : word + 1
      const engine = await next(e)
      return (
        <Box flexDirection="column">
          <Box key="pt-band" gap={1}>
            <Text color="claude">♫ {bars}</Text>
            <Text>
              "<Text bold>{words.slice(0, lit).join(' ')}</Text>
              {lit > 0 && lit < words.length ? ' ' : ''}
              <Text dimColor={word >= 0}>{words.slice(lit).join(' ')}</Text>"
            </Text>
            <Text dimColor>— riffing on {np.riff}</Text>
          </Box>
          {engine}
        </Box>
      )
    } catch (error) {
      logError($, 'band', error)
      return next(e)
    }
  })
}
```

`plugin/hooks/ui/mode.tsx`:
```tsx
import { read } from 'claude-code'
import type { On } from 'claude-code'

import { settingsAtom } from '../state'

export function registerMode(on: On): void {
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const settings = await read($, settingsAtom).catch(() => null)
    if (settings === null) return next(e)
    return next({ ...e, props: { ...e.props, modes: [...e.props.modes, settings.muted ? '♫ muted' : '♫ tags'] } })
  })
}
```

- [ ] **Step 6: Wire them in**

In `plugin/hooks/pipeline.ts`, add `import { startAnimation } from './ui/animate'`. In `fire`, directly after `await setTag($, toolUseId, sound.id)`, add:
```ts
  startAnimation($, token)
```

In `plugin/hooks/register.tsx`, add:
```tsx
import { registerBand } from './ui/band'
import { registerMode } from './ui/mode'
```
At the top of the `register` body, add:
```tsx
  registerBand(on)
  registerMode(on)
```

- [ ] **Step 7: Run the tests to see them pass**

Run: `claude plugin test plugin`
Expected: `visual` and `band` pass, along with all earlier files.

If `ui.find({ text: RIFF })` fails because `.text` of nested `Text` elements is reported per element, find the row instead and match its text: `(await ui.find({ type: 'Box', key: 'pt-band' }))?.text` with `toMatch(RIFF)`.

- [ ] **Step 8: Type-check, validate, commit**

```bash
npx tsc -p . && claude plugin validate plugin
git add plugin/hooks/ui plugin/hooks/pipeline.ts plugin/hooks/register.tsx plugin/tests/visual.test.ts plugin/tests/band.test.tsx
git commit -m "feat: add the now-playing band with equalizer and the mode label

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Tool-row badges

**Files:**
- Create: `plugin/hooks/ui/badges.tsx`
- Modify: `plugin/hooks/register.tsx` (call `registerBadges(on)`)
- Test: `plugin/tests/badges.test.tsx`

**Interfaces:**
- **Consumes:** `taggedAtom`, `memberOf`, `settingsAtom`, `importsAtom`, `resolveSound`, `firePreview`, `act`, `logError`.
- **Produces:** `registerBadges(on)`. Element keys:
  - badge Box: `pt-badge`
  - replay Button: `pt-replay`
  - hover-card Box: `pt-card`, sitting below the chip

- [ ] **Step 1: Write the failing tests**

`plugin/tests/badges.test.tsx`:
```tsx
import { describe, expect, test } from 'claude-code/testing'

import { CATALOG } from '../hooks/catalog'
import { bash, committed, world } from './world'

const COMMIT = CATALOG.find(c => c.id === 'pt:anthropic-trust')!
const row = (id: string) => ({
  plugin: 'producer-tags',
  component: 'ToolUse' as const,
  requestId: id,
  props: { tool_use_id: id, tool: 'Bash', input: { command: 'git commit -m x' }, isRunning: false, isErrored: false, isInterrupted: false },
})

describe('tool-row badges', () => {
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    test(`a tagged row keeps the engine's row and adds a replayable chip (${surface})`, async ($, on) => {
      const w = world(on)
      await $.session.start({} as never)
      const id = await bash($, w, 'git commit -m x', committed())
      const ui = await $.ui.mount({ ...row(id), surface })
      expect(await ui.find({ text: 'ENGINE' })).toBeDefined()
      expect((await ui.find({ type: 'Button', key: 'pt-replay' }))?.text).toContain(COMMIT.riff)
      await w.clock.advance(1000)
      await ui.press({ key: 'pt-replay' })
      expect(w.plays).toHaveLength(2)
    })
  }

  test('untagged rows and Studio → badges off draw only the engine', async ($, on) => {
    const w = world(on, { store: { settings: { studio: { band: true, badges: false } } } })
    await $.session.start({} as never)
    const id = await bash($, w, 'git commit -m x', committed())
    expect(await (await $.ui.mount({ ...row(id), surface: 'terminal' })).find({ key: 'pt-replay' })).toBeUndefined()
    expect(await (await $.ui.mount({ ...row('other'), surface: 'terminal' })).find({ key: 'pt-replay' })).toBeUndefined()
  })

  test('a muted tag earns no badge', async ($, on) => {
    const w = world(on, { store: { settings: { muted: true } } })
    await $.session.start({} as never)
    const id = await bash($, w, 'git commit -m x', committed())
    expect(await (await $.ui.mount({ ...row(id), surface: 'terminal' })).find({ key: 'pt-replay' })).toBeUndefined()
  })

  test('the hover card holds the caption, hidden until hovered', async ($, on) => {
    const w = world(on)
    await $.session.start({} as never)
    const id = await bash($, w, 'git commit -m x', committed())
    const ui = await $.ui.mount({ ...row(id), surface: 'terminal' })
    expect((await ui.find({ type: 'Box', key: 'pt-card' }))?.props.display).toBe('none')
    expect(await ui.find({ type: 'Text', text: COMMIT.caption })).toBeDefined()
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `claude plugin test plugin`
Expected: FAIL. No `pt-replay` button is found.

- [ ] **Step 3: Implement**

`plugin/hooks/ui/badges.tsx`:
```tsx
import { memberOf, read } from 'claude-code'
import type { On } from 'claude-code'

import { resolveSound } from '../library'
import { act, logError } from '../notify'
import { firePreview } from '../pipeline'
import { importsAtom, settingsAtom, taggedAtom } from '../state'

export function registerBadges(on: On): void {
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    try {
      const soundId = await read($, memberOf(taggedAtom, e))
      if (soundId === null) return next(e)
      const settings = await read($, settingsAtom)
      if (settings?.studio.badges === false) return next(e)
      const sound = resolveSound(soundId, (await read($, importsAtom)) ?? [])
      if (sound === null) return next(e)

      const { Box, Button, Text } = $.ui.resolve(e)
      const scope = `pt-${e.requestId}`.slice(0, 64)
      const engine = await next(e)
      return (
        <Box flexDirection="column">
          {engine}
          <Box key="pt-badge" flexDirection="column">
            <Button key="pt-replay" plain hover={{ scope, bold: true }} onPress={() => act($, 'replay', () => firePreview($, soundId))}>
              ♫ {sound.riff} ▶
            </Button>
            <Box key="pt-card" display="none" hover={{ scope, display: 'flex' }}>
              <Text dimColor>{sound.caption}</Text>
            </Box>
          </Box>
        </Box>
      )
    } catch (error) {
      logError($, 'badge', error)
      return next(e)
    }
  })
}
```

In `register.tsx`, add `import { registerBadges } from './ui/badges'` and call `registerBadges(on)` after `registerMode(on)`.

**If Task 0 recorded "R4 no"** (no hover on the main screen), delete the `pt-card` Box and the Button's `hover` prop, along with the hover-card test.

- [ ] **Step 4: Run the tests to see them pass**

Run: `claude plugin test plugin`
Expected: `badges.test.tsx` all pass.

Possible failures:
- **Mobile refuses `hover` on `Button`:** gate the `hover` prop and the card on `e.surface !== 'mobile'`, then rerun.
- **`ui.find({ type: 'Text', text: COMMIT.caption })` doesn't match:** the card's `Text` is the only element holding the caption, so check whether `.text` of a hidden Box is reported, and assert on the `pt-card` Box's `children` instead.

- [ ] **Step 5: Type-check, validate, commit**

```bash
npx tsc -p . && claude plugin validate plugin
git add plugin/hooks/ui/badges.tsx plugin/hooks/register.tsx plugin/tests/badges.test.tsx
git commit -m "feat: badge tagged tool rows with replay and a hover caption

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: The `/tags` pane

**Files:**
- Create: `plugin/hooks/ui/pane-actions.ts`, `plugin/hooks/ui/pane.tsx`
- Modify: `plugin/hooks/register.tsx` (register `/tags` and call `registerPane(on)`)
- Test: `plugin/tests/pane-actions.test.ts`, `plugin/tests/pane.test.tsx` (also the `$`-level import flows for Task 9)

**Interfaces:**
- **Consumes:**
  - `changeSettings`, `loadFromStore`, `validatePattern`
  - `importSound`, `deleteImport`
  - `firePreview`, `toggleMute`
  - `isOnStage`
  - `soundOptions`, `soundLabel`, `padSounds`, `resolveSound`
  - `barsText`, `waveformLevels`, `progressOf`
  - `act`, `logError`
  - the atoms, `EMPTY_DRAFT`
  - from `tests/world.tsx`: `world`, `bash`, `committed`, `PANE`, `EMPTY_WAV`
- **Produces from `pane-actions.ts`, pure functions:**
  - `toggleTrigger(s, id)`, `setTriggerSound(s, id, sound)`
  - `setVolume(s, volume)`, `stepVolume(s, delta)`
  - `toggleStudio(s, key)`
  - `addCustom(s, trigger)`, `removeCustom(s, id)`, `toggleCustom(s, id)`, `setCustomSound(s, id, sound)`
  - `newCustomId(existing)`
- **Produces from `pane-actions.ts`, async actions:** `setDraft($, change)`, `saveCustom($, submitted)`, `runImport($, submitted)`, `removeImport($, id)`.
- **Produces from `pane.tsx`:**
  - `openPane($)`
  - `registerPane(on)`, which hooks `command.run{tags}` and `ui.render{Pane, producer-tags}`
  - the internal `type View` and section functions, which Task 13 extends with the fader
- **Element keys:**

  | Area | Keys |
  |---|---|
  | Header | `vol-down`, `vol-up`, `mute` |
  | Trigger rows | `toggle-<id>`, `sound-<id>`, `play-<id>`, `wave-<id>` |
  | Custom triggers | `custom-add`, `custom-pattern`, `custom-outcome`, `custom-sound`, `custom-save`, `custom-cancel`, `ctoggle-<id>`, `csound-<id>`, `cplay-<id>`, `cdel-<id>` |
  | Imports | `import-path`, `import-go`, `impplay-<id>`, `impdel-<id>` |
  | Messages | `pane-message` |
  | Pads and Studio | `pad-1`…`pad-9`, `studio-band`, `studio-badges` |

- [ ] **Step 1: Write the failing pure tests**

`plugin/tests/pane-actions.test.ts`:
```ts
import { describe, expect, test } from 'claude-code/testing'

import { defaultSettings } from '../hooks/settings'
import { addCustom, newCustomId, setVolume, stepVolume, toggleCustom } from '../hooks/ui/pane-actions'
import type { CustomTrigger } from '../types'

const custom = (id: string, over: Partial<CustomTrigger> = {}): CustomTrigger => ({ id, pattern: 'x', outcome: 'any', sound: 'pt:riser', enabled: true, isInvalid: false, ...over })

describe('pane state transforms', () => {
  test('volume is clamped to 0..100 and rounded', () => {
    expect(stepVolume(stepVolume(defaultSettings(), 10), 50).volume).toBe(100)
    expect(stepVolume(defaultSettings(), -200).volume).toBe(0)
    expect(setVolume(defaultSettings(), 47.6).volume).toBe(48)
  })
  test('at most 20 custom triggers; ids fill gaps', () => {
    let s = defaultSettings()
    for (let i = 0; i < 25; i++) s = addCustom(s, custom(newCustomId(s.custom)))
    expect(s.custom).toHaveLength(20)
    expect(newCustomId([custom('c1'), custom('c3')])).toBe('c2')
  })
  test('an invalid custom trigger never toggles on', () => {
    const s = { ...defaultSettings(), custom: [custom('c9', { enabled: false, isInvalid: true })] }
    expect(toggleCustom(s, 'c9').custom[0]!.enabled).toBe(false)
  })
})
```

- [ ] **Step 2: Write the failing UI tests**

`plugin/tests/pane.test.tsx`:
```tsx
import type { On } from 'claude-code'
import { describe, expect, test, type Engine } from 'claude-code/testing'

import { TRIGGERS } from '../hooks/constants'
import type { ImportedSound, NowPlaying, Settings } from '../types'
import { EMPTY_WAV, PANE, bash, committed, world, type WorldOptions } from './world'

const settingsOf = (w: { state: Map<string, unknown> }) => w.state.get('settings') as Settings
const importsOf = (w: { state: Map<string, unknown> }) => w.state.get('imports') as ImportedSound[]

async function openOn($: Engine, on: On, surface: 'terminal' | 'desktop' | 'vscode' | 'mobile', options: WorldOptions = {}) {
  const w = world(on, options)
  await $.session.start({} as never)
  return { w, ui: await $.ui.mount({ ...PANE, surface }) }
}

describe('/tags', () => {
  test('registers, opens the pane and answers briefly', async ($, on) => {
    const w = world(on)
    await $.session.start({} as never)
    expect(w.registered).toContain('tags')
    expect((await $.command.run({ command: 'tags', args: '' } as never)).text).toBe('Opened Producer Tags.')
    expect(w.opened).toEqual(['producer-tags'])
  })
})

describe('pane on terminal and desktop', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`trigger rows toggle, pick sounds and preview (${surface})`, async ($, on) => {
      const { w, ui } = await openOn($, on, surface)
      for (const t of TRIGGERS) expect(await ui.find({ key: `toggle-${t.id}` }), t.id).toBeDefined()
      await ui.press({ key: 'toggle-git.commit' })
      expect(settingsOf(w).triggers['git.commit'].enabled).toBe(false)
      expect((w.stored.get('settings') as Settings).triggers['git.commit'].enabled).toBe(false)
      await ui.select({ key: 'sound-git.push', value: 'pt:riser' })
      expect(settingsOf(w).triggers['git.push'].sound).toBe('pt:riser')
      await ui.press({ key: 'play-git.push' })
      await ui.press({ key: 'play-git.push' })
      expect(w.plays).toHaveLength(2)
    })

    test(`volume buttons, mute and studio (${surface})`, async ($, on) => {
      const { w, ui } = await openOn($, on, surface)
      await ui.press({ key: 'vol-up' })
      expect(settingsOf(w).volume).toBe(90)
      await ui.press({ key: 'vol-down' })
      await ui.press({ key: 'vol-down' })
      expect(settingsOf(w).volume).toBe(70)
      await ui.press({ key: 'mute' })
      expect(settingsOf(w).muted).toBe(true)
      expect((await ui.find({ key: 'mute' }))?.props.label).toBe('Unmute')
      await ui.press({ key: 'studio-badges' })
      expect(settingsOf(w).studio.badges).toBe(false)
    })

    test(`custom triggers: invalid pattern errors inline, valid one is added and removable (${surface})`, async ($, on) => {
      const { w, ui } = await openOn($, on, surface)
      await ui.press({ key: 'custom-add' })
      await ui.input({ key: 'custom-pattern', text: '(' })
      expect(await ui.find({ type: 'Text', text: 'That is not a valid regular expression.' })).toBeDefined()
      expect(settingsOf(w).custom).toHaveLength(0)
      await ui.input({ key: 'custom-pattern', text: 'docker compose up' })
      expect(settingsOf(w).custom).toEqual([{ id: 'c1', pattern: 'docker compose up', outcome: 'success', sound: 'pt:808-boom', enabled: true, isInvalid: false }])
      expect(await ui.find({ text: /docker compose up/ })).toBeDefined()
      await ui.press({ key: 'cdel-c1' })
      expect(settingsOf(w).custom).toHaveLength(0)
    })

    test(`pads have hotkeys 1–9 and play (${surface})`, async ($, on) => {
      const { w, ui } = await openOn($, on, surface)
      for (let i = 1; i <= 9; i++) expect((await ui.find({ key: `pad-${i}` }))?.props.hotkey).toBe(String(i))
      await ui.press({ key: 'pad-1' })
      expect(w.plays).toHaveLength(1)
    })
  }

  test('a preview interrupts a playing tag and skips the cooldown', async ($, on) => {
    const w = world(on, { audioMs: 3000 })
    await $.session.start({} as never)
    await bash($, w, 'git commit -m x', committed())
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 'play-git.commit' })
    expect(w.plays).toHaveLength(2)
    expect((w.state.get('nowPlaying') as NowPlaying).key).toBe('preview')
    await ui.press({ key: 'play-git.commit' })
    expect(w.plays).toHaveLength(3)
  })

  test('waveforms are text on every surface; narrow panes hide them', async ($, on) => {
    world(on)
    await $.session.start({} as never)
    for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
      const wave = await (await $.ui.mount({ ...PANE, surface })).find({ key: 'wave-git.commit' })
      expect(wave?.type, surface).toBe('Box')
    }
    const narrow = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, bodyColumns: 60 } })
    expect(await narrow.find({ key: 'wave-git.commit' })).toBeUndefined()
  })
})

describe('importing through the pane', () => {
  test('copies into the config dir with env-passed paths; the row deletes the copy', async ($, on) => {
    const { w, ui } = await openOn($, on, 'terminal', { files: { '/home/dev/Music/My Tag.wav': { base64: EMPTY_WAV } } })
    await ui.input({ key: 'import-path', text: '~/Music/My Tag.wav' })
    expect(await ui.find({ type: 'Text', text: 'Imported "My Tag".' })).toBeDefined()
    expect(importsOf(w)).toEqual([
      expect.objectContaining({ id: 'user:my-tag', ext: 'wav', isCopy: true, file: '/home/dev/.claude/producer-tags/sounds/my-tag.wav' }),
    ])
    expect(w.runs.find(r => r.argv[0] === 'sh' && r.argv[2]?.includes('cp --'))?.env).toEqual({
      PT_DIR: '/home/dev/.claude/producer-tags/sounds',
      PT_SRC: '/home/dev/Music/My Tag.wav',
      PT_DST: '/home/dev/.claude/producer-tags/sounds/my-tag.wav',
    })
    await ui.press({ key: 'impdel-user:my-tag' })
    expect(w.runs.some(r => r.argv.join(' ') === 'rm -f -- /home/dev/.claude/producer-tags/sounds/my-tag.wav')).toBe(true)
    expect(importsOf(w)).toEqual([])
    expect(w.stored.get('imports')).toEqual([])
  })

  test('CLAUDE_CONFIG_DIR wins over HOME', async ($, on) => {
    const { w, ui } = await openOn($, on, 'terminal', { env: { CLAUDE_CONFIG_DIR: '/cfg' }, files: { '/a/x.wav': { base64: EMPTY_WAV } } })
    await ui.input({ key: 'import-path', text: '/a/x.wav' })
    expect(importsOf(w)[0]?.file).toBe('/cfg/producer-tags/sounds/x.wav')
  })

  test('emoji names get clean slugs; the same name again gets -2', async ($, on) => {
    const { w, ui } = await openOn($, on, 'terminal', { files: { '/a/Mi tag ✨ (final).wav': { base64: EMPTY_WAV } } })
    await ui.input({ key: 'import-path', text: '/a/Mi tag ✨ (final).wav' })
    await ui.input({ key: 'import-path', text: '/a/Mi tag ✨ (final).wav' })
    expect(importsOf(w).map(s => s.id)).toEqual(['user:mi-tag-final', 'user:mi-tag-final-2'])
  })

  test('validation errors show inline', async ($, on) => {
    const { ui } = await openOn($, on, 'terminal', { files: { '/a/notes.txt': 'hi', '/a/big.wav': { base64: 'A'.repeat(6_000_000) } } })
    for (const [path, message] of [
      ['', 'Enter the path of an audio file.'],
      ['/a/none.wav', 'No file at /a/none.wav.'],
      ['/a/notes.txt', 'Use one of: wav, mp3, m4a, aiff.'],
      ['/a/big.wav', 'Files must be 4 MB or smaller.'],
    ] as const) {
      await ui.input({ key: 'import-path', text: path })
      expect(await ui.find({ type: 'Text', text: message }), path).toBeDefined()
    }
  })

  test('a failed copy keeps the original with a warning, and deleting it removes nothing from disk', async ($, on) => {
    const { w, ui } = await openOn($, on, 'terminal', { files: { '/a/x.wav': { base64: EMPTY_WAV } }, runExit: argv => (argv[0] === 'sh' ? 1 : 0) })
    await ui.input({ key: 'import-path', text: '/a/x.wav' })
    expect(importsOf(w)[0]).toMatchObject({ file: '/a/x.wav', isCopy: false })
    expect(await ui.find({ type: 'Text', text: /Could not copy the file/ })).toBeDefined()
    await ui.press({ key: 'impdel-user:x' })
    expect(w.runs.some(r => r.argv[0] === 'rm')).toBe(false)
  })

  test('windows copies with -LiteralPath through env', async ($, on) => {
    const { w, ui } = await openOn($, on, 'terminal', { os: 'windows', files: { 'C:\\m\\[x].wav': { base64: EMPTY_WAV } } })
    await ui.input({ key: 'import-path', text: 'C:\\m\\[x].wav' })
    const copy = w.runs.find(r => r.argv[0] === 'powershell.exe')
    expect(copy?.argv[4]).toContain('Copy-Item -LiteralPath $env:PT_SRC')
    expect(copy?.env?.PT_SRC).toBe('C:\\m\\[x].wav')
  })

  test('wsl converts a pasted C:\\ path', async ($, on) => {
    const { w, ui } = await openOn($, on, 'terminal', { os: 'wsl', files: { '/mnt/c/m/x.wav': { base64: EMPTY_WAV } } })
    await ui.input({ key: 'import-path', text: 'C:\\m\\x.wav' })
    expect(importsOf(w)[0]?.name).toBe('x')
  })
})

describe('other surfaces', () => {
  test('vscode: the buttons set volume', async ($, on) => {
    const { w, ui } = await openOn($, on, 'vscode')
    await ui.press({ key: 'vol-up' })
    expect(settingsOf(w).volume).toBe(90)
  })
  test('mobile: one line and a mute button', async ($, on) => {
    const { w, ui } = await openOn($, on, 'mobile')
    expect(await ui.find({ text: 'Open /tags in the terminal or desktop app to edit.' })).toBeDefined()
    await ui.press({ key: 'mute' })
    expect(settingsOf(w).muted).toBe(true)
  })
})
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `claude plugin test plugin`
Expected: FAIL. `pane-actions.test.ts` cannot resolve `../hooks/ui/pane-actions`, and `pane.test.tsx` sees `tags` unregistered.

- [ ] **Step 4: Implement `pane-actions.ts`**

`plugin/hooks/ui/pane-actions.ts`:
```ts
import { read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { CustomTrigger, PaneDraft, Settings, SoundId, TriggerId } from '../../types'
import { MAX_CUSTOM } from '../constants'
import { deleteImport, importSound } from '../imports'
import { changeSettings, validatePattern } from '../settings'
import { EMPTY_DRAFT, paneDraftAtom } from '../state'

export function toggleTrigger(s: Settings, id: TriggerId): Settings {
  return { ...s, triggers: { ...s.triggers, [id]: { ...s.triggers[id], enabled: !s.triggers[id].enabled } } }
}

export function setTriggerSound(s: Settings, id: TriggerId, sound: SoundId): Settings {
  return { ...s, triggers: { ...s.triggers, [id]: { ...s.triggers[id], sound } } }
}

export function setVolume(s: Settings, volume: number): Settings {
  return { ...s, volume: Math.round(Math.min(100, Math.max(0, volume))) }
}

export function stepVolume(s: Settings, delta: number): Settings {
  return setVolume(s, s.volume + delta)
}

export function toggleStudio(s: Settings, key: 'band' | 'badges'): Settings {
  return { ...s, studio: { ...s.studio, [key]: !s.studio[key] } }
}

export function addCustom(s: Settings, trigger: CustomTrigger): Settings {
  return s.custom.length >= MAX_CUSTOM ? s : { ...s, custom: [...s.custom, trigger] }
}

export function removeCustom(s: Settings, id: string): Settings {
  return { ...s, custom: s.custom.filter(c => c.id !== id) }
}

export function toggleCustom(s: Settings, id: string): Settings {
  return { ...s, custom: s.custom.map(c => (c.id === id && !c.isInvalid ? { ...c, enabled: !c.enabled } : c)) }
}

export function setCustomSound(s: Settings, id: string, sound: SoundId): Settings {
  return { ...s, custom: s.custom.map(c => (c.id === id ? { ...c, sound } : c)) }
}

export function newCustomId(existing: readonly CustomTrigger[]): string {
  for (let n = 1; ; n++) if (!existing.some(c => c.id === `c${n}`)) return `c${n}`
}

export async function setDraft($: EngineInterface, change: (draft: PaneDraft) => PaneDraft): Promise<void> {
  await update($, paneDraftAtom, change)
}

export async function saveCustom($: EngineInterface, submitted: string | null): Promise<void> {
  const draft = await read($, paneDraftAtom)
  const pattern = (submitted ?? draft.customPattern).trim()
  const error = validatePattern(pattern)
  if (error !== null) {
    await setDraft($, d => ({ ...d, customPattern: pattern, message: { kind: 'error', text: error } }))
    return
  }
  await changeSettings($, s =>
    addCustom(s, { id: newCustomId(s.custom), pattern, outcome: draft.customOutcome, sound: draft.customSound, enabled: true, isInvalid: false }),
  )
  await setDraft($, () => ({ ...EMPTY_DRAFT, message: { kind: 'ok', text: `Added /${pattern}/.` } }))
}

export async function runImport($: EngineInterface, submitted: string | null): Promise<void> {
  const path = submitted ?? (await read($, paneDraftAtom)).importPath
  const result = await importSound($, path)
  await setDraft($, d =>
    result.ok
      ? { ...d, importPath: '', message: { kind: 'ok', text: result.warning ?? `Imported "${result.sound.name}".` } }
      : { ...d, importPath: path, message: { kind: 'error', text: result.error } },
  )
}

export async function removeImport($: EngineInterface, id: SoundId): Promise<void> {
  await deleteImport($, id)
  await setDraft($, d => ({ ...d, message: { kind: 'ok', text: 'Removed.' } }))
}
```

- [ ] **Step 5: Implement `pane.tsx`**

`plugin/hooks/ui/pane.tsx`:
```tsx
import { read } from 'claude-code'
import type { Elements, EngineInterface, On } from 'claude-code'

import type { ImportedSound, Outcome, PaneDraft, Settings, SoundId } from '../../types'
import { MAX_CUSTOM, PANE_ID, TRIGGERS, WINDOWS_ENGINE } from '../constants'
import { padSounds, resolveSound, soundLabel, soundOptions } from '../library'
import { act, logError } from '../notify'
import { firePreview, toggleMute } from '../pipeline'
import { changeSettings, loadFromStore } from '../settings'
import { isOnStage } from '../stage'
import { bandFrameAtom, importsAtom, nowPlayingAtom, paneDraftAtom, platformAtom, settingsAtom } from '../state'
import {
  removeCustom,
  removeImport,
  runImport,
  saveCustom,
  setCustomSound,
  setDraft,
  setTriggerSound,
  stepVolume,
  toggleCustom,
  toggleStudio,
  toggleTrigger,
} from './pane-actions'
import { barsText, progressOf, waveformLevels } from './visual'

const WAVE_COLUMNS = 16
const OUTCOME_LABEL: Record<Outcome, string> = { success: 'on success', fail: 'on failure', any: 'either way' }
const OUTCOME_OPTIONS = Object.entries(OUTCOME_LABEL).map(([value, label]) => ({ value, label }))

/** Set while a render has asked for the store to load, so redraws don't ask again. */
let isLoading = false

/** What every section of the pane draws from. */
type View = {
  $: EngineInterface
  els: Pick<Elements['terminal'], 'Box' | 'Button' | 'Input' | 'Select' | 'Text'>
  settings: Settings
  imports: ImportedSound[]
  draft: PaneDraft
  options: { value: string; label: string }[]
  preview: { soundId: SoundId; progress: number } | null
  isWide: boolean
  hasVolume: boolean
}

export async function openPane($: EngineInterface): Promise<void> {
  await $.ui.open({ id: PANE_ID, title: 'Producer Tags', focus: true, closeOnEscape: true })
}

const change = (v: View, where: string, fn: (s: Settings) => Settings) => () => act(v.$, where, () => changeSettings(v.$, fn))

function header(v: View): JSX.Element {
  const { Box, Button, Text } = v.els
  return (
    <Box key="header" gap={1}>
      <Text bold>Producer Tags</Text>
      {v.hasVolume && <Button key="vol-down" label="−" onPress={change(v, 'volume', s => stepVolume(s, -10))} />}
      {v.hasVolume && <Text>{v.settings.volume}%</Text>}
      {v.hasVolume && <Button key="vol-up" label="+" onPress={change(v, 'volume', s => stepVolume(s, 10))} />}
      <Button key="mute" label={v.settings.muted ? 'Unmute' : 'Mute'} onPress={() => act(v.$, 'mute', () => toggleMute(v.$))} />
    </Box>
  )
}

/** The clip's waveform; during its preview, the part already played is lit. */
function wave(v: View, soundId: SoundId, key: string): JSX.Element | null {
  if (!v.isWide) return null
  const { Box, Text } = v.els
  const bars = barsText(waveformLevels(resolveSound(soundId, v.imports)?.peaks ?? null, WAVE_COLUMNS))
  const played = v.preview?.soundId === soundId ? Math.ceil(v.preview.progress * WAVE_COLUMNS) : 0
  return (
    <Box key={key}>
      <Text color="claude">{bars.slice(0, played)}</Text>
      <Text dimColor>{bars.slice(played)}</Text>
    </Box>
  )
}

function triggerRows(v: View): JSX.Element[] {
  const { Box, Button, Select, Text } = v.els
  return TRIGGERS.map(t => {
    const setting = v.settings.triggers[t.id]
    return (
      <Box key={`row-${t.id}`} gap={1}>
        <Button key={`toggle-${t.id}`} plain label={setting.enabled ? '●' : '○'} onPress={change(v, 'toggle', s => toggleTrigger(s, t.id))} />
        <Text>{t.label.padEnd(16)}</Text>
        <Select key={`sound-${t.id}`} options={v.options} value={setting.sound} onSelect={value => change(v, 'sound', s => setTriggerSound(s, t.id, value))()} />
        <Button key={`play-${t.id}`} plain label="▶" onPress={() => act(v.$, 'preview', () => firePreview(v.$, setting.sound))} />
        {wave(v, setting.sound, `wave-${t.id}`)}
      </Box>
    )
  })
}

function customSection(v: View): JSX.Element {
  const { Box, Button, Input, Select, Text } = v.els
  let footer: JSX.Element
  if (v.draft.isAdding) {
    footer = (
      <Box key="custom-form" gap={1}>
        <Input
          key="custom-pattern"
          label="pattern"
          placeholder="docker compose up"
          value={v.draft.customPattern}
          onInput={value => act(v.$, 'draft', () => setDraft(v.$, d => ({ ...d, customPattern: value })))}
          onSubmit={value => act(v.$, 'custom', () => saveCustom(v.$, value))}
        />
        <Select key="custom-outcome" options={OUTCOME_OPTIONS} value={v.draft.customOutcome} onSelect={value => act(v.$, 'draft', () => setDraft(v.$, d => ({ ...d, customOutcome: value as Outcome })))} />
        <Select key="custom-sound" options={v.options} value={v.draft.customSound} onSelect={value => act(v.$, 'draft', () => setDraft(v.$, d => ({ ...d, customSound: value })))} />
        <Button key="custom-save" label="Save" variant="primary" onPress={() => act(v.$, 'custom', () => saveCustom(v.$, null))} />
        <Button key="custom-cancel" label="Cancel" onPress={() => act(v.$, 'draft', () => setDraft(v.$, d => ({ ...d, isAdding: false, customPattern: '', message: null })))} />
      </Box>
    )
  } else if (v.settings.custom.length < MAX_CUSTOM) {
    footer = <Button key="custom-add" label="+ Add" onPress={() => act(v.$, 'draft', () => setDraft(v.$, d => ({ ...d, isAdding: true, message: null })))} />
  } else {
    footer = <Text dimColor>20 custom triggers is the limit.</Text>
  }
  return (
    <Box key="custom" flexDirection="column">
      <Text bold>Custom</Text>
      {v.settings.custom.map(c => (
        <Box key={`custom-${c.id}`} gap={1}>
          <Button key={`ctoggle-${c.id}`} plain label={c.enabled ? '●' : '○'} onPress={change(v, 'custom', s => toggleCustom(s, c.id))} />
          <Text>
            /{c.pattern}/ · {OUTCOME_LABEL[c.outcome]}
          </Text>
          {c.isInvalid && <Text color="error">⚠ invalid</Text>}
          <Select key={`csound-${c.id}`} options={v.options} value={c.sound} onSelect={value => change(v, 'custom', s => setCustomSound(s, c.id, value))()} />
          <Button key={`cplay-${c.id}`} plain label="▶" onPress={() => act(v.$, 'preview', () => firePreview(v.$, c.sound))} />
          <Button key={`cdel-${c.id}`} plain label="✕" onPress={change(v, 'custom', s => removeCustom(s, c.id))} />
        </Box>
      ))}
      {footer}
    </Box>
  )
}

function importSection(v: View): JSX.Element {
  const { Box, Button, Input, Text } = v.els
  return (
    <Box key="imports" flexDirection="column">
      <Text bold>Import</Text>
      <Box key="import" gap={1}>
        <Input
          key="import-path"
          placeholder="~/Music/mytag.wav"
          value={v.draft.importPath}
          onInput={value => act(v.$, 'draft', () => setDraft(v.$, d => ({ ...d, importPath: value })))}
          onSubmit={value => act(v.$, 'import', () => runImport(v.$, value))}
        />
        <Button key="import-go" label="Import" onPress={() => act(v.$, 'import', () => runImport(v.$, null))} />
      </Box>
      {v.imports.map(sound => (
        <Box key={`imp-${sound.id}`} gap={1}>
          <Text>{sound.name}</Text>
          <Button key={`impplay-${sound.id}`} plain label="▶" onPress={() => act(v.$, 'preview', () => firePreview(v.$, sound.id))} />
          <Button key={`impdel-${sound.id}`} plain label="✕" onPress={() => act(v.$, 'delete', () => removeImport(v.$, sound.id))} />
        </Box>
      ))}
      {v.draft.message !== null && (
        <Box key="pane-message">
          <Text color={v.draft.message.kind === 'error' ? 'error' : 'success'}>{v.draft.message.text}</Text>
        </Box>
      )}
    </Box>
  )
}

function padsAndStudio(v: View): JSX.Element {
  const { Box, Button, Text } = v.els
  return (
    <Box key="pads-studio" flexDirection="column">
      <Text bold>Pads</Text>
      <Box key="pads" gap={1}>
        {padSounds().map((id, i) => (
          <Button key={`pad-${i + 1}`} hotkey={String(i + 1)} label={soundLabel(id, v.imports)} onPress={() => act(v.$, 'pad', () => firePreview(v.$, id))} />
        ))}
      </Box>
      <Text bold>Studio</Text>
      <Box key="studio" gap={1}>
        <Button key="studio-band" plain label={`${v.settings.studio.band ? '●' : '○'} now-playing band`} onPress={change(v, 'studio', s => toggleStudio(s, 'band'))} />
        <Button key="studio-badges" plain label={`${v.settings.studio.badges ? '●' : '○'} tool badges`} onPress={change(v, 'studio', s => toggleStudio(s, 'badges'))} />
      </Box>
    </Box>
  )
}

export function registerPane(on: On): void {
  on('command.run', { command: 'tags' }, async $ => {
    try {
      await openPane($)
      return { text: 'Opened Producer Tags.' }
    } catch (error) {
      logError($, '/tags', error)
      return { text: 'Producer Tags hit an error.' }
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    try {
      const settings = await read($, settingsAtom)
      const imports = (await read($, importsAtom)) ?? []
      if (settings === null) {
        if (!isLoading) {
          isLoading = true
          $.clock.after(0, () => act($, 'pane load', () => loadFromStore($).finally(() => (isLoading = false))))
        }
        const { Text } = $.ui.resolve(e)
        return <Text dimColor>Loading Producer Tags…</Text>
      }
      if (e.surface === 'mobile') {
        const { Box, Button, Text } = $.ui.resolve(e)
        return (
          <Box flexDirection="column">
            <Text>Open /tags in the terminal or desktop app to edit.</Text>
            <Button key="mute" label={settings.muted ? 'Unmute' : 'Mute'} onPress={() => act($, 'mute', () => toggleMute($))} />
          </Box>
        )
      }

      const { Box, Button, Input, Select, Text } = $.ui.resolve(e)
      const platform = await read($, platformAtom)
      const np = await read($, nowPlayingAtom)
      const now = await $.clock.now()
      const preview = np !== null && np.key === 'preview' && isOnStage(np, now) ? { soundId: np.soundId, progress: progressOf(np, now) } : null
      if (preview !== null) await read($, bandFrameAtom)
      const view: View = {
        $,
        els: { Box, Button, Input, Select, Text },
        settings,
        imports,
        draft: await read($, paneDraftAtom),
        options: soundOptions(imports),
        preview,
        isWide: e.props.bodyColumns >= 80,
        hasVolume: !((platform?.os === 'windows' || platform?.os === 'wsl') && WINDOWS_ENGINE === 'soundplayer'),
      }
      return (
        <Box flexDirection="column">
          {header(view)}
          {triggerRows(view)}
          {customSection(view)}
          {importSection(view)}
          {padsAndStudio(view)}
        </Box>
      )
    } catch (error) {
      logError($, 'pane', error)
      const { Text } = $.ui.resolve(e)
      return <Text color="error">Producer Tags could not draw this pane.</Text>
    }
  })
}
```

- [ ] **Step 6: Register `/tags` and the pane in `register.tsx`**

Add `import { registerPane } from './ui/pane'` and call `registerPane(on)` after `registerBadges(on)`. In the `session.start` hook, before `muteCommand = await registerMute($)`, add:
```tsx
      await $.command.register({ name: 'tags', description: 'Open the Producer Tags pane' })
```

- [ ] **Step 7: Run the tests to see them pass**

Run: `claude plugin test plugin`
Expected: `pane-actions.test.ts` and `pane.test.tsx` pass, and so does everything else.

How to read the likely failures:
- **"a prop it does not take: gap":** remove that prop.
- **Typing errors in `View.els`:** desktop's or vscode's element table isn't assignable to terminal's. Type `els` as `ReturnType<typeof $.ui.resolve>` narrowed by `Exclude<RenderSurface, 'mobile'>`, or pass the five constructors as separate fields.
- **`ui.input` on `custom-pattern` finds nothing:** the press on `custom-add` has to redraw first. Acts resolve after the redraw, so check that `setDraft` wrote `isAdding: true`.
- **`find({ type: 'Text', text })` misses a message:** match the `pane-message` Box's `.text` instead.

- [ ] **Step 8: Type-check, validate, commit**

```bash
npx tsc -p . && claude plugin validate plugin
git add plugin/hooks/ui/pane-actions.ts plugin/hooks/ui/pane.tsx plugin/hooks/register.tsx plugin/tests/pane-actions.test.ts plugin/tests/pane.test.tsx
git commit -m "feat: add the /tags pane with triggers, custom rules, imports, pads and studio

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: Pointer volume fader (Client module)

**Files:**
- Create: `plugin/hooks/ui/fader.client.tsx`
- Modify: `plugin/hooks/ui/pane.tsx`, to draw the fader in the header and receive its messages
- Test: `plugin/tests/fader.test.tsx`

**Interfaces:**
- **Consumes:**
  - The pane's `View`, `header`, and `registerPane` (Task 12).
  - `changeSettings($, fn, { persist })` (Task 4).
  - `setVolume` (Task 12).
- **Produces:**
  - The default export `Fader: ClientModule<{ volume: number }, { volume: number; isDragging: boolean }>`.
  - The posts `{ volume: number, isFinal: boolean }`, read by a `ui.message` hook in `pane.tsx`.
  - The element key `fader`.

- [ ] **Step 1: Write the failing tests**

`plugin/tests/fader.test.tsx`:
```tsx
import { describe, expect, test } from 'claude-code/testing'

import type { Settings } from '../types'
import { PANE, world } from './world'

describe('fader', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`drag updates live, persists on release; arrows step by 5 from the current volume (${surface})`, async ($, on) => {
      const w = world(on)
      await $.session.start({} as never)
      const ui = await $.ui.mount({ ...PANE, surface })
      await ui.resize({ columns: 24, rows: 1, in: 'fader' })
      await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'fader' })
      await ui.pointer({ type: 'move', x: 19, y: 0, button: 'left', in: 'fader' })
      expect((w.state.get('settings') as Settings).volume).toBe(100)
      expect((w.stored.get('settings') as Settings | undefined)?.volume).not.toBe(100)
      await ui.pointer({ type: 'up', x: 19, y: 0, button: 'left', in: 'fader' })
      expect((w.stored.get('settings') as Settings).volume).toBe(100)
      await ui.key({ key: 'left', in: 'fader' })
      expect((w.stored.get('settings') as Settings).volume).toBe(95)
      await ui.press({ key: 'vol-down' })
      await ui.key({ key: 'right', in: 'fader' })
      expect((w.stored.get('settings') as Settings).volume).toBe(90)
    })
  }

  test('vscode and mobile have no pointer fader', async ($, on) => {
    world(on)
    await $.session.start({} as never)
    for (const surface of ['vscode', 'mobile'] as const) {
      expect(await (await $.ui.mount({ ...PANE, surface })).find({ key: 'fader' }), surface).toBeUndefined()
    }
  })
})
```

**The arithmetic:**
- A 24-column region gives `width = 19`, so `x = 19` is 100%.
- `left` from 100 is 95.
- `vol-down` brings it to 85, then `right` gives 90. That only passes if the key listener reads the *current* props.

- [ ] **Step 2: Run the tests to see them fail**

Run: `claude plugin test plugin`
Expected: FAIL. `ui.resize` rejects because the drawing holds no `Client` keyed `fader`.

- [ ] **Step 3: Implement the Client module**

`plugin/hooks/ui/fader.client.tsx`:
```tsx
import type { ClientModule } from 'claude-code'

type Props = { volume: number }
type State = { volume: number; isDragging: boolean }

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)))

/** Drag (or ←/→ once clicked) to set the volume: posts live values while dragging, and a final one on release or key. */
const Fader: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const state = surface.state ?? { volume: props.volume, isDragging: false }
  const width = Math.max(4, surface.columns - 5)

  // Set again on every call (each replaces the last), so they read this call's props.
  surface.onPointer(event => {
    const now = surface.state ?? state
    if (event.type === 'down' || (event.type === 'move' && event.button === 'left')) {
      const volume = clamp(((event.fine?.x ?? event.x) / width) * 100)
      surface.setState({ volume, isDragging: true })
      surface.post({ volume, isFinal: false })
    } else if (event.type === 'up' && now.isDragging) {
      surface.setState({ ...now, isDragging: false })
      surface.post({ volume: now.volume, isFinal: true })
    }
  })
  surface.onKey(event => {
    const step = event.key === 'right' ? 5 : event.key === 'left' ? -5 : 0
    if (step === 0) return
    const volume = clamp(props.volume + step)
    surface.setState({ volume, isDragging: false })
    surface.post({ volume, isFinal: true })
  })

  const volume = state.isDragging ? state.volume : props.volume
  const filled = Math.round((volume / 100) * width)
  return (
    <Box>
      <Text color="claude">{'━'.repeat(filled)}</Text>
      <Text>●</Text>
      <Text dimColor>{'─'.repeat(Math.max(0, width - filled))}</Text>
      <Text> {String(volume).padStart(3)}%</Text>
    </Box>
  )
}

export default Fader
```

- [ ] **Step 4: Draw it in the pane and receive its posts**

In `plugin/hooks/ui/pane.tsx`, make these edits:

1. Add `fader: JSX.Element | null` to the `View` type.
2. In `header`, after the `vol-up` Button line, add:
   ```tsx
         {v.fader}
   ```
3. Add `setVolume` to the `./pane-actions` import.
4. In the `ui.render` hook, before `const view: View = {`, add:
   ```tsx
      let fader: JSX.Element | null = null
      const hasVolume = !((platform?.os === 'windows' || platform?.os === 'wsl') && WINDOWS_ENGINE === 'soundplayer')
      if (hasVolume && (e.surface === 'terminal' || e.surface === 'desktop')) {
        const { Client } = $.ui.resolve(e)
        fader = <Client key="fader" module="./fader.client.tsx" props={{ volume: settings.volume }} width={24} height={1} />
      }
   ```
   Then replace the view's `hasVolume: !(…)` line with `hasVolume,` and add `fader,` to the view.
5. In `registerPane`, after the `command.run` hook, add:
   ```tsx
     on('ui.message', async ($, e, next) => {
       if (e.requestId !== PANE_ID || e.element !== 'fader') return next(e)
       try {
         const data = e.data as { volume?: unknown; isFinal?: unknown }
         if (typeof data.volume === 'number') {
           const volume = data.volume
           await changeSettings($, s => setVolume(s, volume), { persist: data.isFinal === true })
         }
       } catch (error) {
         logError($, 'fader', error)
       }
       return {}
     })
   ```

**If Task 0 recorded "R4 no"** (no pointer events on the main screen), change the fader condition to `hasVolume && e.viewport?.isFullscreen === true && (e.surface === 'terminal' || e.surface === 'desktop')`, and pass `viewport: { columns: 120, rows: 40, isFullscreen: true }` in the fader tests' mounts.

- [ ] **Step 5: Run the tests to see them pass**

Run: `claude plugin test plugin`
Expected: `fader.test.tsx` passes on both surfaces, and Task 12's pane tests still pass.

- [ ] **Step 6: Type-check, validate, commit**

```bash
npx tsc -p . && claude plugin validate plugin
git add plugin/hooks/ui/fader.client.tsx plugin/hooks/ui/pane.tsx plugin/tests/fader.test.tsx
git commit -m "feat: add a pointer and keyboard volume fader

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: Docs, CI, and release files

**Files:**
- Create:
  - `README.md` (replace the stub)
  - `docs/ROADMAP.md`
  - `CHANGELOG.md`
  - `LICENSE`
  - `.github/workflows/ci.yml`
- Test: CI runs everything. Locally, run the commands in Step 6.

**Interfaces:**
- **Consumes:**
  - every command, file and constant above
  - Task 0's §14 results, for the known-limitations list
  - Task 5's approved captions, for the trigger table

- [ ] **Step 1: `LICENSE` (MIT)**

```text
MIT License

Copyright (c) 2026 Kevin Lee

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2: `docs/ROADMAP.md`**

```markdown
# Roadmap

Ideas past v0.1, roughly in the order we expect to build them. None are promised.

## v1.1
- **Effects rack**: per-trigger chopped & screwed, stutter ("fix th-th-this"), reverse, bitcrush and echo, computed at play time.
- **Discography**: a `/tags-stats` card with counts and streaks, and Gold / Platinum / Diamond plaques at 10 / 100 / 1000 commits.

## Later
- Spinner slang ("Writin' hooks…", "Layin' tracks…") and turn-duration slang ("Cooked up in 3s").
- Drag-to-trim clips on their waveform.
- AI ad-libs: a fresh tag line written from the commit message (opt-in; costs tokens).
- Spoken custom tags with a beat bed (macOS `say`).
- Cover art per pack, with a pixel-art fallback for terminals without image support.
- A desktop SVG visualizer.
- More triggers: context nearly full ("run it back"), compaction, API errors, permission prompts.
- A `/config` row for picking a tag pack.
- Ad-libs under Claude's reply when tests pass.
- Neural-TTS voice packs (the generator already has a backend slot for them).
```

- [ ] **Step 3: `CHANGELOG.md`**

```markdown
# Changelog

## 0.1.0 — unreleased

First release.

- Tags on git commit, push and merge (from Claude Code's own git detection), passing tests, model switches, and exit.
- Off by default: session start, turn done, failed commands.
- Custom triggers: a regex over the Bash command, on success, failure or either.
- `/tags` pane:
  - per-trigger sound, preview and waveform
  - volume (buttons, plus a drag fader in the terminal and desktop app)
  - mute
  - imports
  - pads 1–9
  - studio toggles
- Now-playing band with an equalizer and lit-up captions.
- Badges on tagged tool rows, with replay.
- `/mute` (or `/tags-mute` when `/mute` is taken), which works mid-turn.
- Platforms: macOS (tier 1), Linux with PipeWire, PulseAudio, ffplay or aplay (tier 2), Windows and WSL via PowerShell (tier 3).
```

- [ ] **Step 4: `README.md`**

Fill the trigger table's Tag column from the approved `tools/generate-tags/tags.json` captions. Fill "Known limitations" from Task 0's §14 results (drop any line that turned out not to apply).

````markdown
# Producer Tags for Claude Code

Claude commits. *"If Anthropic don't trust you, I'm gon' shoot you."*

Producer Tags is a Claude Code mod that drops a parody producer tag when Claude does something worth a tag: committing, pushing, merging, getting the tests green, switching models, or signing off.

> Unofficial parody fan project. Not affiliated with or endorsed by Anthropic or any producer or artist.

![The now-playing band and the /tags pane](docs/demo.gif)

## Install

In a Claude Code terminal session:

```
/plugin install producer-tags --marketplace kevinlee2198/claude-code-producer-tags
```

Answer `y` to add the marketplace, then pick a scope (user scope is the usual choice). The tags are live at once.

## Use

- `/tags` opens the pane:
  - turn triggers on or off
  - pick each trigger's sound, preview it (▶) and see its waveform
  - set the volume or mute
  - add custom triggers
  - import your own sounds
  - play pads `1`–`9`
- `/mute` mutes or unmutes everything, even mid-turn. If another plugin already owns `/mute`, it is `/tags-mute`. Mute is remembered across sessions.

### Triggers

| Trigger | When | Default | Tag |
|---|---|---|---|
| git commit | Claude Code reports a commit (amends and cherry-picks too) | on | "If Anthropic don't trust you, I'm gon' shoot you" |
| git merge | a merge, or `gh pr merge` completing (not `--auto`) | on | "Oh Lord, Claude just merged another one" |
| git push | a push | on | "Claude Code, you did it again" |
| tests pass | a known test runner finishes green | on | "We got tests passin' on the track" |
| → Opus / Fable / Sonnet / Haiku | you switch to a different model family | on | one tag each |
| → other model | you switch to a model outside those families | on | "Who let this model on the track?" |
| exit | you leave Claude Code (`/exit`, ctrl+c, ctrl+d) | on | "Claude outta here" |
| session start | a session starts or resumes | off | "Claude Code, Claude Code, Claude Code-ah" |
| turn done | Claude finishes a reply | off | "Another one" |
| command fails | a Bash command errors | off | "Tay Keith, fix this" |

**Rules for when a tag plays:**
- One tag plays per event; the biggest moment wins: merge, then push, then commit, then tests, then fail.
- Each trigger rests 30 s before it can fire again.
- A tag that fires while another is playing is skipped, not queued.

**What does not fire a tag:**
- commands running in the background, or that hit their timeout
- interrupted commands
- tool calls made by other plugins

Commands run by subagents do fire tags.

### Custom triggers

In `/tags`, under **Custom**, press **+ Add** and enter a pattern:
- **Pattern:** a regular expression without slashes, case-insensitive, matched anywhere in the Bash command, for example `docker compose up`.
- **When:** on success, on failure, or either way.
- **Limits:** up to 20 custom triggers. A custom trigger wins over the built-in ones.
- **Heredocs:** text inside heredocs (such as commit messages) is ignored, so `deploy` won't fire because a commit message mentions deploying.

### Your own sounds

Under **Import**, paste a file path (`~` works, as do paths your terminal pastes in quotes or with escaped spaces) and press **Import**.

- **Formats:**

  | Platform | Formats |
  |---|---|
  | macOS | wav, mp3, m4a, aiff |
  | Windows / WSL | wav, mp3 |
  | Linux | depends on the player: wav everywhere; mp3 and m4a with ffplay |

- **Size:** up to 4 MB. Clips longer than 15 s are cut off at 15 s.
- **Storage:** the file is copied to `~/.claude/producer-tags/sounds/` (or under `CLAUDE_CONFIG_DIR`), so moving the original does no harm.
- **Removing:** removing an import deletes that copy and puts any trigger using it back on its default.

## Platforms

| Tier | Platform | How it plays |
|---|---|---|
| 1 | macOS | Claude Code's own player (`afplay`) |
| 2 | Linux | the first of `pw-play`, `paplay`, `ffplay`, `aplay`; with none, tags show as captions only |
| 3 | Windows, WSL | PowerShell (WPF MediaPlayer) |

## Known limitations

- **Exit outro:** it plays from a detached process. If your system kills child processes on exit, you may not hear it.
- **Band timing:** the band and captions are timed from when playback starts. On Windows, PowerShell starts in about a second, so the band appears a moment after the command finishes.
- **Badge replay:** clicking the ▶ on a transcript badge needs Claude Code's fullscreen mode. The pane's ▶ works everywhere.
- **Several sessions:** with more than one Claude Code session open, the last settings change wins.

## Privacy

No network access and no telemetry. Patterns only ever run against command text on your machine.

## Contributing

```bash
npm install                      # TypeScript for type-checking only
npm run typecheck                # tsc against typings/claude-code.d.ts (Claude Code 2.1.296)
npm test                         # claude plugin test plugin
npm run validate                 # claude plugin validate plugin
python3 -I -m unittest discover -s tools/generate-tags -p 'test_*.py'
python3 -I tools/generate-tags/smoke_test.py
```

- **Running from your checkout:** `claude --plugin-dir ./plugin`.

**Regenerating the default tags.** Run `python3 -I tools/generate-tags/generate.py --voice sapi`, from Windows or WSL, or use `--voice say` on macOS. Use `--only <id>` for one tag. Edit lines in `tools/generate-tags/tags.json`. Then commit the WAVs and the regenerated `plugin/hooks/catalog.ts`.

**Manual checklist before a release.** Do this on macOS and Linux; Windows is best-effort.
- Each default-on trigger plays: commit, push, merge, tests (direct and `| tail`), each model switch, `/exit`.
- `/mute` mid-clip stops the sound.
- Import a wav and an mp3, preview them, assign one, then delete it.
- The band's equalizer moves and the caption lights up.
- The badge shows on a commit row, and its hover card shows when hovered.
- The fader drags (and in fullscreen mode).
- Pads `1`–`9` play, and digits typed into the pane's text fields stay in the field.
````

Record a GIF of the band and the pane on macOS for `docs/demo.gif`. This needs a person and a screen recorder. Commit it with the README, or open a follow-up issue and remove the image line until it exists.

- [ ] **Step 5: `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx tsc -p .

  generator:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      - run: python3 -I -m unittest discover -s tools/generate-tags -p 'test_*.py'
      - run: python3 -I tools/generate-tags/smoke_test.py

  plugin:
    runs-on: ubuntu-latest
    # Task 0 / R6: set to true (with this comment kept) if the CLI asks for credentials in CI.
    continue-on-error: false
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm install -g @anthropic-ai/claude-code@2.1.296
      - run: claude plugin validate plugin
      - run: claude plugin test plugin
```

- [ ] **Step 6: Run everything locally**

Run:
```bash
npx tsc -p . && claude plugin validate . && claude plugin validate plugin && claude plugin test plugin \
  && python3 -I -m unittest discover -s tools/generate-tags -p 'test_*.py' && python3 -I tools/generate-tags/smoke_test.py
```
Expected:
- all pass
- `claude plugin validate .` reads the marketplace file and finds `producer-tags` at `./plugin`

If `claude plugin validate .` refuses a root with no `plugin.json`, drop it from the command and check the marketplace instead: in a session, run `/plugin marketplace add ./` and confirm `producer-tags` is listed.

- [ ] **Step 7: Commit**

```bash
git add README.md docs/ROADMAP.md CHANGELOG.md LICENSE .github/workflows/ci.yml
git commit -m "docs: add README, roadmap, changelog, license and CI

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 15: End-to-end verification and handoff

**Files:**
- Modify: `docs/superpowers/specs/2026-10-10-producer-tags-design.md` (status line), `CHANGELOG.md` (only if verification changed anything)

- [ ] **Step 1: Run the live session on this machine (WSL, tier 3)**

Ask the user to run `claude --plugin-dir ./plugin` from the repo, then walk through README's manual checklist together. That covers every default-on trigger, plus `/mute` mid-clip, import/preview/delete, the band, badges, the fader, and pads.

Record each item as pass or fail. A failure gets a fix through superpowers:systematic-debugging, with a regression test where the test kit can express it, and a commit.

- [ ] **Step 2: Run the tier 1 and tier 2 checks (needs the user's Mac and a Linux box)**

Ask the user to run the same checklist on:
- macOS (required)
- Linux with PipeWire (required)
- Linux with PulseAudio (required)

Also finish Task 0's pending macOS rows (R1, R3, R4). Record every result in the spec's §14 table. Fix failures the same way as in Step 1.

If a required machine isn't available, record "pending" in §14. Don't mark the spec Implemented in Step 4, and say so to the user.

- [ ] **Step 2b: Apply the conditional spec items**

- **Windows check (R0):** if a Windows install is available, check whether native sessions run commands through `Bash` or a `PowerShell` tool. If it's `PowerShell`:
  - add it to the `tool.call` matcher (`{ tool: ['Bash', 'PowerShell'] }`)
  - add a `;`-only segmenter for it
  - add a regex git fallback for results without `gitOperation` (`git commit`, `git push`, `git merge`, `gh pr merge` at segment start)

  Each gets tests in `triggers.test.ts` and `pipeline.test.ts`. If no Windows install is available, record R0 as "pending" and add it to README's known limitations.
- **WSL path check (R2):** if only the `\\wsl.localhost` path failed in Task 0, copy the clip to `%TEMP%\producer-tags\<file>` once per sound before playing. Use `Copy-Item -LiteralPath`, with the paths passed in env. Add a `pipeline.test.ts` case for the WSL argv.

- [ ] **Step 3: Full suite, final time**

Run: `npx tsc -p . && claude plugin validate plugin && claude plugin test plugin && python3 -I tools/generate-tags/smoke_test.py`
Expected: all pass.

- [ ] **Step 4: Mark the spec implemented and commit**

Change the spec's status line to `**Status:** Implemented in v0.1.0 (see CHANGELOG.md)`, then commit:
```bash
git add docs/superpowers/specs/2026-10-10-producer-tags-design.md CHANGELOG.md
git commit -m "docs: mark the producer tags spec implemented

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: Finish the branch**

Use superpowers:finishing-a-development-branch. The user chooses one of these: merge to `main`, open a PR to `kevinlee2198/claude-code-producer-tags`, or keep the branch. Pushing and publishing are the user's call.

- [ ] **Step 6: Smoke-test the published install (after the user pushes)**

In a fresh terminal session, run `/plugin install producer-tags --marketplace kevinlee2198/claude-code-producer-tags`. Answer `y`, pick user scope, have Claude make one commit in a scratch repo, and confirm the tag plays and the badge shows.
