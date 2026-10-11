# Producer Tags: Design

**Date:** 2026-10-10
**Status:** Draft, awaiting review
**Target:** Claude Code mod API, build 2.1.296

## 1. Summary

Producer Tags is a public, open-source Claude Code mod. It plays short parody "producer tags" when Claude Code does something notable, such as committing, merging, pushing, passing tests, switching models, or ending a session. It ships with original default tags. Users can assign any tag to any trigger, add their own triggers that match Bash commands, and import their own audio files. Everything is managed from a `/tags` pane.

It is an **unofficial parody fan project**, not affiliated with Anthropic or any producer. The default tags are original lines recorded in our own (synthesized) voice that riff on famous tags. No audio from real tags is used.

### Goals

- Tags fire reliably on the v1 triggers on **macOS (first priority)** and **Windows**. WSL and Linux are best-effort.
- Users can install with one command and set everything up from one pane.
- The mod never slows down, blocks, or changes Claude Code's real work.
- Default sounds are restrained: frequent events start off.

### Non-goals (v1)

The following are deferred to `docs/ROADMAP.md`:

- Spinner and turn-duration slang
- Effects rack
- Clip trimming
- AI-generated ad-libs
- Spoken custom tags and beat beds
- Cover art
- Discography stats and plaques
- Desktop SVG visualizer
- Extra trigger events
- `/config` pack picker
- Reply ad-libs

## 2. Repository layout

The repository is both the plugin marketplace and the mod.

```
.claude-plugin/marketplace.json
plugin/
  .claude-plugin/plugin.json        name "producer-tags", types "./types/index.d.ts"
  hooks/hooks.json                  { "modules": ["./register.tsx"] }
  hooks/register.tsx                wires units to events; no logic of its own
  hooks/triggers.ts                 event → trigger id (pure)
  hooks/director.ts                 settings/cooldown/overlap → play decision (pure + clock)
  hooks/player.ts                   OS detection + playback routing
  hooks/library.ts                  bundled + imported sounds, WAV parsing, peaks
  hooks/settings.ts                 store load/defaults/migrate/save
  hooks/ui/pane.tsx                 /tags pane
  hooks/ui/band.tsx                 now-playing band (AbovePrompt)
  hooks/ui/badges.tsx               ToolUse row badges
  hooks/ui/mode.tsx                 SessionMode label
  hooks/ui/fader.client.tsx         Client module: mouse/keyboard volume fader
  hooks/*.test.ts                   claude plugin test suites
  sounds/*.wav
  sounds/catalog.json
  types/index.d.ts                  PluginState contract
tools/generate-tags/                Python (stdlib only) tag generator
  tags.json                         source of truth for voice drops
  generate.py, voices/, fx/
docs/ROADMAP.md
docs/superpowers/specs/…            this document
README.md, LICENSE (MIT), CHANGELOG.md
```

Install: `/plugin install producer-tags --marketplace <owner>/claude-code-producer-tags`.

## 3. Data flow

1. **Events in.** These come from:
   - the `tool.call` hook (Bash)
   - `classic.PostModelSwitch`
   - `classic.SessionStart`
   - `classic.SessionEnd`
   - `classic.Stop`
2. **`triggers.ts`** turns an event into a `TriggerHit`: `{ triggerId, toolUseId? }`, or `null` when nothing matches.
3. **`director.ts`** turns the hit plus settings, cooldowns, and `nowPlaying` into either `{ play: soundId, gain }` or `{ skip: reason }`.
4. **`library.ts`** turns the sound ID into a clip: `{ asset }`, `{ path }`, or `{ base64, mime }`, plus `durationMs`, `caption`, and `peaks`.
5. **`player.ts`** plays the clip on the detected OS.
6. **State is set in parallel:** `nowPlaying` and `tagged[toolUseId]` are written to `$.state`. The band and the badges redraw from that.

In the `tool.call` hook, `await next(e)` runs first and its result is returned unchanged. The trigger pipeline runs afterward, **without being awaited**, and is wrapped in try/catch.

## 4. Triggers

### 4.1 Built-in triggers

| Trigger ID | Source | Condition | Default | Default sound |
|---|---|---|---|---|
| `git.commit` | Bash | a segment runs `git commit` (excluding `--dry-run`), and the result has no `isError` | on | `pt:anthropic-trust` |
| `git.push` | Bash | a segment runs `git push`, no `isError` | on | `pt:did-it-again` |
| `git.merge` | Bash | a segment runs `git merge` or `gh pr merge`, no `isError` | on | `pt:just-merged` |
| `tests.pass` | Bash | a segment runs a known test runner, no `isError` | on | `pt:tests-passin` |
| `command.fail` | Bash | result has `isError: true` (any cause, including a user interrupt) | **off** | `pt:tay-keith-fix` |
| `model.opus` | PostModelSwitch | `to_model` contains `opus` | on | `pt:opus-come-out` |
| `model.fable` | PostModelSwitch | `to_model` contains `fable` | on | `pt:fable-on-beat` |
| `model.sonnet` | PostModelSwitch | `to_model` contains `sonnet` | on | `pt:sonnet-booth` |
| `model.haiku` | PostModelSwitch | `to_model` contains `haiku` | on | `pt:haiku-quick` |
| `model.other` | PostModelSwitch | none of the families above match | on | `pt:who-let-model` |
| `session.start` | SessionStart | `source` is `startup` or `resume` | **off** | `pt:khaled-claude` |
| `session.end` | SessionEnd | any | on | `pt:claude-outta` |
| `turn.done` | Stop | any | **off** | `pt:another-one` |

**Model switches** only fire when `source` is `command`, `picker`, or `sdk`. They are ignored when:
- `source` is `resume` (a model restored when resuming) or `auto` (an automatic fallback), or
- `from_model === to_model`.

**Known test runners**, checked at the start of a segment:
- `npm test`, `npm run test`
- `pnpm test`, `yarn test`, `bun test`
- `npx jest|vitest|mocha`, or bare `jest|vitest|mocha`
- `pytest`, `python -m pytest`
- `cargo test`, `go test`
- `dotnet test`, `mvn test`, `gradle test`, `./gradlew test`
- `rspec`, `bundle exec rspec`
- `phpunit`, `mix test`, `make test`

### 4.2 Command segmentation

A Bash command is split on `&&`, `||`, `;`, and `|`. This is a best-effort split that ignores separators inside quotes.

A segment **matches** a command name only if it starts with that command, after removing:
- leading whitespace
- `VAR=value` environment assignments
- `sudo`/`time`/`command` prefixes

Examples:
- `echo "git commit"`, `grep commit`, and `git log --grep commit` do **not** match.
- `cd repo && git add -A && git commit -m x` **does** match.

### 4.3 Custom triggers

`{ id, pattern, outcome: "success" | "fail" | "any", sound, enabled }`

- `pattern` is a JavaScript regular expression, case-insensitive, tested against the **whole** command string.
- An invalid regex is rejected in the pane with an inline error.
- At most 20 custom triggers.

### 4.4 One sound per event

When an event matches several triggers, one sound plays. The winner is decided in this order:

1. **Custom triggers win**, first matching custom trigger in list order.
2. Then `git.merge` > `git.push` > `git.commit` > `tests.pass` > `command.fail`.

Disabled triggers are skipped before the winner is chosen. A lower-priority enabled trigger can therefore still fire when a higher one is off.

## 5. Director rules

- **Mute:** when `muted`, everything is skipped, and nothing is recorded as playing.
- **Overlap:** if `nowPlaying` is set and its clip hasn't finished, the new tag is **dropped**. It is not queued.
- **Cooldown:** 30 s per trigger ID. This is session-only and is not persisted.
- **Previews (▶) and pads bypass:**
  - They skip the cooldown.
  - They **interrupt** whatever is playing (abort the current clip) instead of being dropped.
  - They still respect mute.
- **Gain** is `volume / 100`.

## 6. Playback

### 6.1 OS detection

Detection runs once per session in `session.start`, and the result is cached in `$.state`:

1. If `$.env.get("OS") === "Windows_NT"`, the OS is `windows`.
2. Otherwise, run `$.process.run(["uname", "-s"])`:
   - `Darwin` → `mac`
   - `Linux` → read `/proc/version`; if it contains `microsoft` → `wsl`, otherwise `linux`.
3. On Linux, look for the first player that exists, in this order: `paplay`, `aplay`, `ffplay`. Detection uses `command -v` run through `sh -c`.

### 6.2 Routes

| OS | How it plays | Formats | Volume | Stop |
|---|---|---|---|---|
| mac | `$.audio.play({ asset })` for bundled sounds; `$.audio.play({ base64, mime })` for imports (read with `$.fs.read(..., { as: "bytes" })`) | wav, mp3, m4a, aiff | `gain` | AbortSignal |
| windows | `$.process.spawn` of `powershell.exe -NoProfile -NonInteractive -Command <script>`. The script uses WPF `System.Windows.Media.MediaPlayer`: open the file, set `Volume`, play, wait for the natural duration, then exit | wav, mp3 | `Volume` | end the stream loop (kills the child) |
| wsl | same as windows, with the path converted by `wslpath -w` | wav, mp3 | same | same |
| linux | the detected player (`paplay` / `aplay` / `ffplay -nodisp -autoexit`) | depends on the player | `paplay --volume`, `ffplay -volume`; `aplay` has no volume control | kill the child |
| none | nothing plays; the band still shows the caption | — | — | — |

On Windows, file paths are passed to the script through an environment variable. They are never interpolated into the script text, to avoid quoting and injection problems.

### 6.3 Session end

The `session.end` tag is awaited for up to 3 s. If shutdown happens sooner, the clip may be cut off, and on Windows the module unloading kills the child process. This is documented in the README as a known limitation.

## 7. Sound library

### 7.1 Bundled tags

These live in `sounds/catalog.json`. Each entry has:
- `id`, `file`, `caption`, `riff`, `durationMs`
- `peaks`: 64 values from 0 to 1

The generator writes this file.

| ID | Caption | Riffing on |
|---|---|---|
| `pt:anthropic-trust` | "If Anthropic don't trust you, I'm gon' shoot you" | Metro Boomin |
| `pt:just-merged` | "Oh Lord, Claude just merged another one" | Jetsonmade |
| `pt:did-it-again` | "Claude Code, you did it again" | Mike WiLL Made-It |
| `pt:tests-passin` | "We got tests passin' on the track" | (original) |
| `pt:opus-come-out` | "Yo Opus, you wanna come out here?" | Pi'erre Bourne |
| `pt:fable-on-beat` | "Fable on the beat, so it's a banger" | Murda Beatz |
| `pt:sonnet-booth` | "Sonnet in the booth, write it down" | (original) |
| `pt:haiku-quick` | "Haiku on the beat, make it quick" | (original) |
| `pt:who-let-model` | "Who let this model on the track?" | (original) |
| `pt:claude-outta` | "Claude outta here" | Wheezy |
| `pt:khaled-claude` | "Claude Code, Claude Code, Claude Code-ah" | DJ Khaled |
| `pt:another-one` | "Another one" | DJ Khaled |
| `pt:tay-keith-fix` | "Tay Keith, fix this—" | Tay Keith |
| `pt:808-boom` | (effect) | — |
| `pt:riser` | (effect) | — |
| `pt:scratch` | (effect) | — |

### 7.2 Imports

1. The user enters a path in the pane. `~` is expanded using `HOME`, or `USERPROFILE` on Windows.
2. **Validation.** The import is rejected with an inline message if:
   - the file is missing
   - the extension is not one of `wav|mp3|m4a|aiff` (Windows: `wav|mp3`)
   - the file is larger than 4 MiB
3. **Copy.** The file is copied to `~/.claude/producer-tags/sounds/<slug>.<ext>`:
   - macOS and Linux use `cp`; Windows uses `powershell Copy-Item`.
   - The copy is needed because `$.fs.write` only writes text.
   - The slug comes from the file name. On a name collision, `-2`, `-3`, and so on are appended.
   - If the copy fails, the mod falls back to referencing the original path and shows a warning.
4. **WAV files** have their header parsed to get `durationMs` and `peaks`. Other formats get a flat waveform and an assumed length of 3000 ms.
5. The import is recorded in the store's `imports` list with the ID `user:<slug>`.

**Deleting an import:**
- The copied file is removed.
- Every trigger that used it is reset to its default sound.

**A missing file at play time:**
- The trigger falls back to its default sound.
- One toast is shown per sound per session.

## 8. Interface

### 8.1 Commands

- `/tags` opens the pane with `focus` and `closeOnEscape`. It does not set `holdToasts`.
- `/mute` toggles mute and aborts any current clip. It is registered with `immediate: true`. If the name is refused, it is registered as `/tags-mute` instead.

### 8.2 `/tags` pane

**Header**
- Title
- Volume fader: `fader.client.tsx`
  - Works with pointer drag and ←/→ keys.
  - Sends values with `surface.post` → `ui.message`.
  - On VS Code it is a `Select` with 0–100 in steps of 10.
- Mute button

**Trigger rows** (one per built-in trigger)
- On/off toggle (●/○)
- Sound `Select`, listing bundled sounds then imports
- ▶ preview
- Waveform:
  - Terminal: a `Raster`, 16×1 cells, with a playhead that sweeps across during preview via `$.ui.blit`.
  - Desktop and VS Code: block-character `Text`.
  - Hidden below 80 body columns.

**Custom section**
- One row per custom trigger: pattern, outcome, sound `Select`, ▶, ✕.
- `[+ Add]` reveals an inline form: pattern `Input`, outcome `Select`, sound `Select`, and `[Save]`, with inline validation errors.

**Import section**
- Path `Input` and `[Import]`.
- One inline status line, for success or error.

**Pads**
- Buttons with `hotkey` 1–9, mapped to the first nine bundled voice tags.
- They are active only while the pane holds the keyboard.
- They are not placed in the band, because a digit typed into an empty prompt would conflict.

**Studio**
- Toggles for the now-playing band and the tool badges. Both are on by default.

**Mobile**
- Read-only list with toggles, ▶, and mute. Mobile has no `Input`/`Select`, so these are omitted.

### 8.3 Now-playing band (`AbovePrompt`)

- **When it shows:** while `nowPlaying` is set, plus 1 s after the clip ends. It defers to `hasSurvey`. It is hidden when Studio → band is off.
- **Layout:** `♫ <equalizer> "<caption>" — riffing on <riff>`
- **Equalizer** (terminal):
  - A 10×1 `Raster`, repainted with `$.ui.blit` at about 30 fps.
  - Bar heights come from the clip's `peaks`, looked up by `now − startedAt`.
  - The `requestId` used for blitting is captured from `e.requestId` at draw time.
  - The animation timer stops when the clip ends.
  - **Fallback:** if a blit rejects, switch to `$.ui.invalidate` redraws at 10/s.
- **Desktop:** `Text` block characters, redrawn at 10/s.
- **Caption:** words are highlighted progressively over `durationMs`. The highlighted-word index is held in `$.state` and written only when it changes.

### 8.4 Tool-row badges (`ToolUse`)

- **When shown:** for a Bash `tool_use_id` present in `tagged`, and only while Studio → badges is on.
- **Drawing:** `<Box>{await next(e)}<chip/></Box>`, so the engine's row is always kept.
- **Chip:** `♫ <riff> ▶`, where ▶ replays the tag (a preview: it interrupts and bypasses the cooldown).
- **Hover:** a hover-revealed absolute card shows the caption. If the terminal reports no hover, it simply never appears.

### 8.5 Mode label (`SessionMode`)

`🎛 tags` normally, or `🔇 muted` when muted.

## 9. Settings and state

### 9.1 `$.store` (persistent)

```ts
settings: {
  version: 1,
  muted: boolean,                  // default false
  volume: number,                  // 0–100, default 80
  triggers: Record<TriggerId, { enabled: boolean; sound: SoundId }>,
  custom: CustomTrigger[],         // max 20
  studio: { band: boolean; badges: boolean },   // default true, true
}
imports: ImportedSound[]           // { id, name, file, ext, bytes, durationMs, peaks, isCopy }
```

**On load:**
- The stored value is deep-merged over the defaults, so triggers added in later versions appear with their defaults.
- `migrate(version)` is applied.
- An unknown sound ID resets that trigger to its default sound.
- If the stored value is corrupt or the wrong type, the defaults are used and one toast is shown.

### 9.2 `$.state` (session, declared in `types/index.d.ts`)

- `settings`: mirrors the store; the UI reads from here.
- `imports`
- `nowPlaying`: `{ soundId, triggerId, caption, riff, startedAt, durationMs, toolUseId? } | null`
- `captionWord: number`
- `tagged: StateFamily<SoundId>`, keyed by `tool_use_id`
- `platform`: `{ os, player }`
- `cooldowns: Record<TriggerId, number>`
- `paneDraft`: `{ customPattern, customOutcome, customSound, importPath, message }`

### 9.3 Writes

UI handlers write `$.state` first, using `update` so writes are safe under concurrency, and then persist to `$.store`.

With several sessions open:
- Each session loads the store in `session.start`.
- The last write wins.
- This is documented in the README.

### 9.4 Privacy

- No network access.
- No telemetry.
- Patterns run locally against command strings only.

## 10. Error handling

- Every hook body is wrapped in try/catch. Errors go to `$.ui.log(..., { to: "debug" })`.
- **User-facing toasts** are limited to one per cause per session. The causes are:
  - no audio player
  - missing imported file
  - corrupt settings
  - playback failure on the current OS
- The `tool.call` hook can never deny or rewrite a call, and never awaits tag work.
- Failures in pane forms show inline and never throw.

## 11. Default tag generation (`tools/generate-tags`)

- **Language:** Python 3, standard library only (`wave`, `struct`, `math`, `array`, `random`).
- **`tags.json` entries:** `{ id, text, riff, trigger, preset }`.
- **Voice backends**, each a module exposing `render(text, out_wav)`:
  - `sapi`: `powershell.exe` with `System.Speech` `SetOutputToWaveFile`. Works on Windows and WSL; used for v1.
  - `say`: `say --data-format=LEI16@22050 -o`. macOS only.
  - `elevenlabs`: placeholder interface; reads its API key from the environment. Later.
- **Effects:** preset chains built from:
  - resample-based pitch shift
  - tail delay echo on the last word
  - Schroeder reverb
  - a synthesized 808 hit (sine sweep plus soft clip)
  - a noise riser
  - a scratch made from a modulated noise burst
  - peak normalization to −1 dBFS, then 10 ms fades
- **Output:** 22.05 kHz, 16-bit mono WAV, written to `plugin/sounds/`. The generator also writes `catalog.json` with `durationMs` and 64 peaks per sound.
- **Committed:** the generated WAVs are committed, so users never run the generator.
- **Smoke test:** each output file opens with `wave`, matches its catalog entry, and is shorter than 6 s.

## 12. Testing

`claude plugin test plugin/` runs these suites:

| Suite | Covers |
|---|---|
| `triggers.test.ts` | about 40 command cases (chains, env prefixes, false positives, `--dry-run`, every test runner, failures); model-switch cases (each family, `resume`/`auto` ignored, same-model ignored); session and stop |
| `director.test.ts` | mute, overlap drop, 30 s cooldown on the mocked clock, priority order, custom triggers winning, disabled triggers skipped, previews interrupting and bypassing the cooldown |
| `settings.test.ts` | defaults, deep merge with new triggers, migration, corrupt values, unknown sound reset |
| `library.test.ts` | WAV header parsing and peaks; import validation (missing file, bad extension, larger than 4 MiB); slug collisions; deleting an import resets its triggers; missing file falls back |
| `player.test.ts` | OS detection branches and the exact argv/env for each route, with `$.process` and `$.audio` faked |
| `ui.test.ts` | pane, band, badges, and mode label drawn on `terminal` and `desktop`; toggling, previewing, adding a custom trigger (valid and invalid), importing, mute |

**Other checks**
- `tsc -p plugin` type-checks the mod.
- `claude plugin validate plugin` validates it.
- The generator smoke test: `python3 -I tools/generate-tags/smoke_test.py`.

**Manual checklist (in the README's contributing section)**
- macOS and Windows: each trigger, import, mute, and the band animation.
- WSL route: verified on the author's machine.

## 13. Release

- **README:**
  - install command
  - GIF of the band and the pane
  - trigger table
  - custom triggers and imports
  - platform notes and known limitations (cut-off at session end; band timing is estimated)
  - **disclaimer:** "Unofficial parody fan project. Not affiliated with or endorsed by Anthropic or any producer or artist."
- **License:** MIT.
- `CHANGELOG.md`
- `docs/ROADMAP.md` listing every deferred idea from §1.
- **Version:** 0.1.0.

## 14. Open risks to verify early in implementation

1. **`$.ui.blit` in a live session.** Check that it works for a `Raster` in the `AbovePrompt` band and in the pane. The test kit has no blit. The invalidate fallback is designed in.
2. **Pointer/hover outside fullscreen.** Check pointer and hover events on the terminal's main screen. They affect the fader and the badge hover. The keyboard fallbacks are designed in.
3. **Windows `MediaPlayer` from `powershell.exe`.** Check that it plays to completion headless. If not, fall back to `System.Media.SoundPlayer` for WAV only, and document that MP3 needs WAV conversion.
4. **`/mute` with `immediate: true`.** Check that the name is accepted; otherwise use `/tags-mute`.
5. **SAPI voice quality.** The SAPI voices (David/Zira) may sound too weak even with effects. If so, render on macOS with `say` before release.
