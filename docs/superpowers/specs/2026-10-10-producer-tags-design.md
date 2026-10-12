# Producer Tags: Design

**Date:** 2026-10-10
**Status:** Draft, revised after spec review (rev 4: the Host pattern)
**Target:** Claude Code mod API, build 2.1.296

## 1. Summary

Producer Tags is a public, open-source Claude Code mod. It plays short parody "producer tags" when Claude Code does something notable: committing, merging, pushing, passing tests, switching models, or exiting. It ships with original default tags. Users can assign any tag to any trigger, add their own triggers that match Bash commands, and import their own audio files. Everything is managed from a `/tags` pane.

It is an **unofficial parody fan project**. It is not affiliated with Anthropic or any producer. The default tags are original lines recorded in our own synthesized voice that riff on famous tags. No audio from real tags is used.

### Goals

- Tags fire reliably on the v1 triggers. Platform tiers:
  - **Tier 1, macOS:** every feature is tested and polished first.
  - **Tier 2, Linux:** fully supported and on the manual checklist.
  - **Tier 3, Windows and WSL:** supported and expected to work; known rough edges are documented, not blockers for release.
- Users can install with one command and set everything up from one pane.
- The mod never slows down, blocks, or changes Claude Code's real work.
- Sound defaults are restrained: frequent events start off.

### Non-goals for v1

These are deferred to `docs/ROADMAP.md`:

- spinner and turn-duration slang
- effects rack
- clip trimming
- AI-generated ad-libs
- spoken custom tags and beat beds
- cover art
- discography stats and plaques
- desktop SVG visualizer
- extra trigger events
- `/config` pack picker
- reply ad-libs

## 2. Repository layout

The repository is both the marketplace and the mod.

```
.claude-plugin/marketplace.json     marketplace listing (source ./plugin)
.github/workflows/ci.yml            typecheck + generator tests + plugin validate/test
.gitignore
package.json, tsconfig.json         dev-only: TypeScript for type-checking
typings/claude-code.d.ts            pinned API snapshot (2.1.296) for tsc in CI; not shipped
plugin/
  .claude-plugin/plugin.json        name "producer-tags", types "./types/index.d.ts"
  hooks/hooks.json                  { "modules": ["./register.tsx"] }
  hooks/register.tsx                THE HOOK FILE: every $.state atom, hostOf($), the stored
                                    host, and every hook, each handing plain functions a Host
  hooks/host.ts                     type Host: the engine calls the mod uses (§3)
  hooks/constants.ts, state.ts      ids, defaults, timings; the atoms' shared initial values
  hooks/notify.ts, codec.ts         toastOnce/logError/act over the Host; base64
  hooks/shell.ts                    command tokenizer/segmenter (pure)
  hooks/triggers.ts                 event → trigger hit (pure)
  hooks/stage.ts                    claims, deadlines, isLive / isOnStage, cooldowns (pure)
  hooks/pipeline.ts                 settings/cooldown/claim → play; finish; mute
  hooks/platform.ts, player.ts      OS detection; playback routing
  hooks/library.ts                  bundled + imported sounds, WAV parsing, peaks
  hooks/catalog.ts                  GENERATED catalog of bundled sounds
  hooks/imports.ts                  import and delete user sounds
  hooks/settings.ts                 store load/migrate/merge/save
  hooks/ui/visual.ts, animate.ts    bar/waveform text; the 10 fps band loop
  hooks/ui/pane.tsx, pane-actions.ts  /tags pane view and its state transforms
  hooks/ui/band.tsx                 now-playing band view (AbovePrompt)
  hooks/ui/badges.tsx               ToolUse row badge view
  hooks/ui/mode.ts                  SessionMode label
  hooks/ui/fader.client.tsx         Client module: pointer volume fader
  sounds/*.wav                      GENERATED
  tests/*.test.ts(x), tests/world.tsx, tests/fake-host.ts  test suites; engine fakes; a fake Host
  types/index.d.ts                  shared types + PluginState contract
tools/generate-tags/                Python (stdlib only) tag generator
docs/ROADMAP.md
README.md, LICENSE (MIT), CHANGELOG.md
```

- `plugin/.claude-plugin/types/` is written by the engine and is listed in `.gitignore`.
- Install command: `/plugin install producer-tags --marketplace kevinlee2198/claude-code-producer-tags`.

## 3. Data flow

1. **Events in:**
   - the `tool.call` hook on `Bash`, plus `PowerShell` if that tool exists (§14, risk 0)
   - `classic.PostModelSwitch`
   - `classic.SessionStart`
   - `session.end`
   - `classic.Stop`
2. **`triggers.ts`** turns the event into a `Hit` (`{ key, sound }`) or `null`.
3. **`pipeline.ts`** combines the hit with settings, cooldowns, and a claim on `nowPlaying` (`stage.ts`), then plays it or skips it.
4. **`library.ts`** resolves the sound ID to a clip: `{ asset | path | base64+mime }`, `durationMs`, `caption`, `riff`, `peaks`.
5. **`player.ts`** plays it. It reports when playback actually starts and when it ends.
6. **State:** when playback starts, `nowPlaying.startedAt` is set and `tagged[toolUseId]` is written. When it ends, `nowPlaying` is cleared by compare-and-swap on `token`.

**The Host**

The engine follows `$` only into functions declared in the same file as the hook, and reads an atom only from a const of that file (§14). The mod therefore follows the pattern of Anthropic's own mods (`mods/diff`, `code-modernization`):

- **`register.tsx` is the one hook file.** `hostOf($)` returns a `Host`, an object whose every member is one `$.noun.event(...)` call (`now: () => $.clock.now()`, `run: (argv, init) => $.process.run(argv, init)`, `env.home: () => $.env.get('HOME')`, `state.nowPlaying.update: f => update($, nowPlayingAtom, f)`, …). Every `$.state` atom is declared there.
- **Everything else is plain functions over the Host.** `settings`, `platform`, `player`, `pipeline`, `imports`, `ui/animate`, and the pane's actions take a `host` where they would have taken `$`. The views (`ui/band`, `ui/badges`, `ui/pane`) take an element table, plain data and closures. Tests stand in a fake Host for the plain functions, and the engine kit runs the whole mod.
- **State stays in `$.state`** (§9.2), reached through `host.state.<key>` (`read`, `update` by compare-and-swap). The render hooks read it with their own `$`, so a write redraws only the drawings that read it; the band's 10 fps loop never invalidates every badge.
- **Which binding a call uses.** `session.start` binds a host and stores it in `register`'s closure. Pane and badge buttons, the fader, timers and scheduled work act through the host they were handed. A hook passes `host ?? hostOf($)`: the stored binding, or its own `$` while none is stored (before `session.start`, or after a hot reload until `session.start` rebinds). `session.end` binds its own `$`, so the outro launch is one of that dispatch's calls (§6.3).
- **A hot reload** re-runs `register` (the stored host is gone, as are the clip handle and timers of the old module; the engine cancels the old timers) and then `session.start`, which binds afresh and runs `recoverStage` (§5).
- **No noun.** Nothing crosses a file boundary that a plain function over the Host cannot carry, so the mod adds nothing to `$`.

**The `tool.call` hook:**

- It runs `const r = await next(e)` and returns `r` unchanged.
- It schedules the pipeline with `$.clock.after(0, …)`. That runs it in its own dispatch once the tool call's dispatch resolves, so it is not tied to the tool call's abort signal or its state snapshot.
- It has `.catch(($, e, next) => next(e))`, which replays the settled result.
- The pipeline is wrapped in try/catch.

**Which calls fire tags:**

- Bash calls made by **subagents** fire tags, since that is still Claude's work.
- Calls made through another plugin's `$.tool.call` (`next.origin` is a plugin) are ignored.

## 4. Triggers

### 4.1 Skip rules (all tool-based triggers)

A tool result fires nothing if any of these hold:

- `e.run_in_background`
- `result.backgroundTaskId`
- `result.timedOutAfterMs`
- `result.backgroundedByUser`
- `result.interrupted`
- the tool call's dispatch was aborted (`next.signal.aborted`). An interrupt usually comes back as `isError` with no record, so `result.interrupted` alone misses it.

Those results come back before the command has finished, or after the user stopped it.

### 4.2 Built-in triggers

| Trigger ID | Condition | Default | Default sound |
|---|---|---|---|
| `git.commit` | `result.gitOperation.commit` is present, with any `kind` | on | `pt:anthropic-trust` |
| `git.push` | `result.gitOperation.push` is present | on | `pt:did-it-again` |
| `git.merge` | `gitOperation.branch.action === "merged"` or `gitOperation.pr.action === "merged"` (not `auto-merge-enabled`) | on | `pt:just-merged` |
| `tests.pass` | a test-runner segment succeeded (§4.4) | on | `pt:tests-passin` |
| `command.fail` | `isError: true` (not interrupted, per §4.1) | **off** | `pt:tay-keith-fix` |
| `model.opus` / `.fable` / `.sonnet` / `.haiku` | `PostModelSwitch` where the family of `to_model` is the one named and differs from the family of `from_model` | on | `pt:opus-come-out` / `pt:fable-on-beat` / `pt:sonnet-booth` / `pt:haiku-quick` |
| `model.other` | `PostModelSwitch` where `to_model` matches no known family and its normalized ID differs from `from_model`'s | on | `pt:who-let-model` |
| `session.open` | `classic.SessionStart` with `source` of `startup` or `resume` | **off** | `pt:khaled-claude` |
| `session.close` | `session.end` with `reason` of `prompt_input_exit` or `logout` (not `clear`, `resume`, or `other`) | on | `pt:claude-outta` |
| `turn.done` | `classic.Stop` without `stop_hook_active` | **off** | `pt:another-one` |

**Git triggers** use the engine's structured `gitOperation`, never regex. That covers `git -C x commit`, aliases, amends, merges that were "Already up to date" (no `branch` action), `gh pr merge --auto`, and dry runs. Regex segmentation is used for git only on a tool that has no `gitOperation`, such as a PowerShell tool.

**Model switches:**

- Fire only when `source` is one of `command`, `picker`, or `sdk`.
- Ignore `resume` and `auto`.
- **Family** is the first of `opus`, `fable`, `sonnet`, or `haiku` found in the lowercased ID.
- **Normalized ID** means the ID with any `[...]` suffix removed.

### 4.3 Shell tokenizer (`shell.ts`)

The tokenizer is best-effort, and pure.

**Quotes:**

- It handles `'…'`, `"…"` (with `\` escapes), and `$'…'`.
- `$(…)` and backticks become opaque words. Their contents are not split.

**Heredocs:** `<<EOF` / `<<'EOF'` / `<<-EOF` bodies are removed before anything else runs.

**Separators:** newline, `;`, `&`, `&&`, `||`, `|`, and `|&`.

- Longest match wins, so `||` is read before `|`.
- Each segment records the operator that follows it.

**Grouping:** `(`, `)`, `{`, and `}` are dropped as standalone tokens. `bash -c "…"` and `sh -c "…"` are recursed into once.

**Prefix stripping** happens before matching. It removes:

- `VAR=value` assignments
- `env [VAR=value…]`
- `sudo`, `time`, `nice`, `nohup`, `exec`, `command`
- `timeout <n>`

**Matching** compares a segment's leading tokens against a pattern's tokens, token by token, never as a string prefix:

- `npm run test` matches `npm run test`.
- `npm run testing-setup` and `npm run test:unit` do not match it.

### 4.4 `tests.pass`

**Runners**, matched as tokens:

| Ecosystem | Runners |
|---|---|
| npm, pnpm, yarn, bun | `npm test`, `npm t`, `npm run test`, `pnpm test`, `pnpm run test`, `yarn test`, `yarn run test`, `bun test` |
| JS test tools | `npx` or `bunx` + `jest`, `vitest`, `mocha`, or `playwright test`; bare `jest`, `vitest`, or `mocha` |
| Python | `pytest`, `python -m pytest`, `python3 -m pytest`, `uv run pytest`, `poetry run pytest` |
| Compiled languages and build tools | `cargo test`, `cargo nextest run`, `go test`, `dotnet test`, `mvn test`, `gradle test`, `./gradlew test` |
| Others | `rspec`, `bundle exec rspec`, `phpunit`, `mix test`, `make test` |

**Non-runs:** a runner segment with any of `--help`, `-h`, `--listTests`, `--collect-only`, `--watch`, or `-w` doesn't count.

**Deciding success:**

1. **Attributable.** The exit status belongs to the runner when the runner segment is not piped into anything and every segment after it is joined by `&&`. In that case, success means there is no `isError`.
2. **Not attributable.** This covers `| tail`, `; echo`, and `|| true`. The decision comes from the output text (`result.stdout` + `stderr`, or `text`):
   - It **fails** if the output matches a failure marker: `/\b[1-9]\d* (failed|failing|errors?)\b/i`, `/^FAIL\b/m`, `/\bFAILED\b/`, `/panicked at/`, `/^Traceback/m`, or `/test result: FAILED/`.
   - Otherwise it **passes** only if the output matches a pass marker: `/\b\d+ (passed|passing)\b/i`, `/test result: ok/`, `/^ok\s/m`, `/^PASS\b/m`, `/\bOK \(\d+ tests?\)/`, or `/Tests:\s+\d+ passed/`.
   - With no marker either way, it does **not** fire.

### 4.5 Custom triggers

Shape: `{ id, pattern, outcome: "success" | "fail" | "any", sound, enabled }`.

**Pattern:**

- It is the source of a JavaScript regex, without `/…/` delimiters.
- It is compiled with the `i` flag.
- It is at most 200 characters.

**Matching:**

- The pattern is tested against the command with heredoc bodies removed, so commit messages don't trigger it.
- **Success** means no `isError`.

**Limits and validation:**

- At most 20 custom triggers.
- Patterns are validated when entered (an inline error in the pane) and again on load. A stored pattern that fails to compile is disabled and marked in the pane.

### 4.6 One sound per event

1. **Custom triggers win**, first match in list order.
2. Otherwise the order is `git.merge` > `git.push` > `git.commit` > `tests.pass` > `command.fail`.
3. Disabled triggers are dropped before ranking.

## 5. Director: claims, cooldowns, mute

**Mute**

- When muted, the director skips everything.
- `muted` is saved, so it **persists across sessions**. The README says so.

**Claiming playback**

- `nowPlaying` is claimed with `update($, nowPlaying, cur => isLive(cur) ? cur : mine)`.
- The claim succeeds only if the stored value afterwards is `mine`. The test compares `token`, which is `soundId + ":" + claimedAt`.
- A live entry means the new tag is **dropped**, not queued.

**When an entry is live**

An entry counts as live while `now < deadline`. The deadline is set in two steps:

- At claim time: `claimedAt + 5000` ms. This covers startup latency.
- At start: `startedAt + durationMs + 1000` ms. When `durationMs` is unknown (a non-WAV import), the 15 s cap is used in its place.

Entries past their deadline are treated as absent everywhere. This means a clip orphaned by a hot reload can never block later tags or keep the band up.

**Cooldown**

- 30 s per trigger ID.
- Session only: it lives in `$.state` and is not saved.

**Previews, pads, and badge replays**

These bypass the cooldown. They **interrupt** the current clip: they abort the old one, then overwrite the claim unconditionally. They still respect mute.

**Volume**

- Gain is `volume / 100`.
- A change of volume affects the next clip, not one already playing.

**Clip length**

Clips are capped at **15 s**. A longer import is stopped at 15 s.

## 6. Playback

### 6.1 OS detection

Detection is lazy: a promise memoized on first use and cached in `$.state.platform`.

1. If `$.env.get("OS") === "Windows_NT"`, the OS is `windows`.
2. Otherwise, run `$.process.run(["uname", "-s"])`:
   - `Darwin` → `mac`
   - `Linux` → read `/proc/version`. If it contains `microsoft`, the OS is `wsl`; otherwise it is `linux`.
3. On Linux, the player is the first of `pw-play`, `paplay`, `ffplay`, or `aplay` found via `sh -c 'command -v …'`.

### 6.2 Routes

Every route reports `started` and `ended` back to the director.

**mac**

- Bundled sounds: `$.audio.play({ asset })`. Imports: `$.audio.play({ base64, mime })`.
- MIME types: wav `audio/wav`, mp3 `audio/mpeg`, m4a `audio/mp4`, aiff `audio/aiff`.
- `started` is reported on the call. `ended` is reported when the promise resolves.
- Stopping is done with the AbortSignal, held by a module-level `AbortController`.

**windows**

- Playback runs through `$.process.spawn` of `powershell.exe -NoProfile -NonInteractive -STA -EncodedCommand <constant script>`.
- All data travels in environment variables: `PT_FILE`, `PT_GAIN`, `PT_MS`, `PT_CAP`. Nothing is interpolated into the script.
- The script uses WPF `MediaPlayer`. It prints `started` after `Play()`, then `t` every 100 ms.
- It ends after `PT_MS`. When `PT_MS` is `0` (an mp3 import, length unknown), it ends instead when `NaturalDuration` is reached. Either way it stops at `PT_CAP` (15 s).
- **Stopping:** the director sets an abort flag. On the next `t` tick, the stream loop breaks, which kills the child.

**wsl**

- Same as windows.
- The environment adds `WSLENV=<existing>:PT_FILE/p:PT_GAIN:PT_MS:PT_CAP`. The `/p` flag translates the path.
- If MediaPlayer can't open a `\\wsl.localhost\…` path, the file is copied once to `%TEMP%\producer-tags\` (§14).

**linux**

The player runs inside `sh -c` wrapper. The wrapper:

- starts the player in the background,
- prints `pid <n>`, then `t` every 100 ms while the player is alive,
- exits when the player exits, and kills the player if the wrapper itself is killed (a `trap`), so a reload never orphans it.

To stop it, run `kill <n>` via `$.process.run`, then break the loop.

| Player | Formats | Volume |
|---|---|---|
| `pw-play` (PipeWire) | wav, aiff (libsndfile; no mp3) | `--volume` 0.0–1.0 |
| `paplay` | wav, aiff (libsndfile; no mp3) | `--volume` 0–65536 |
| `ffplay -nodisp -autoexit -loglevel quiet` | all | `-volume` 0–100 |
| `aplay` | wav only | none |

**none**

Nothing plays. The band still shows the caption, and a toast appears once per session.

**Fallback if MediaPlayer is unreliable** (§14, risk 3)

- Windows and WSL use `System.Media.SoundPlayer`: `Play()`, then the same `t` ticks until `PT_MS` (or `PT_CAP`), then `Stop()`.
- SoundPlayer is WAV only and has no volume control. The pane then hides the fader on Windows, and imports there are limited to WAV.
- The spec accepts either outcome; the decision comes from that early check.

### 6.3 `session.close`

`session.end` gives one 1.5 s budget to every hook and to core, and in-flight `$` calls are aborted when it expires. So the close tag is fired **detached**: the hook starts the launch without awaiting it and returns `next(e)` immediately:

- **mac:** `$.process.run(["sh", "-c", 'afplay -v "$PT_GAIN" "$PT_FILE" >/dev/null 2>&1 &'], { env })`. Bundled files are referenced by their path under `$.plugin.root`.
- **linux:** the same pattern, using the detected player.
- **windows/wsl:** `powershell.exe -NoProfile -Command "Start-Process -WindowStyle Hidden powershell.exe -ArgumentList '-NoProfile','-STA','-EncodedCommand',$env:PT_SCRIPT"`. The data travels in env, as in §6.2.

Whether a detached child survives exit has to be checked early (§14). If it doesn't, `session.close` is documented as best-effort.

## 7. Sound library

### 7.1 Bundled tags (`hooks/catalog.ts`)

Each entry: `{ id, file, caption, riff, durationMs, peaks: number[64], isVoice }`. The generator writes the file as a TS module, because a hooks module cannot import JSON.

| ID | Caption (provisional; final lines are reviewed while generating, §11) | Riffing on |
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
| `pt:808-boom`, `pt:riser`, `pt:scratch` | (effects) | — |

### 7.2 Imports

**Location**

Imported files are kept in `<configDir>/producer-tags/sounds/`:

- `configDir` is `$.env.get("CLAUDE_CONFIG_DIR")` when that is set.
- Otherwise it is `HOME/.claude`, or `USERPROFILE\.claude` on Windows.

**Steps**

1. **Read the path.**
   - Expand a leading `~`.
   - On WSL, convert `C:\…` input with `wslpath -u`.
2. **Validate.** Each failure shows an inline message:
   - The file must exist (`$.fs.stat`).
   - The extension must be in the allowed list:
     - mac: `wav`, `mp3`, `m4a`, `aiff`
     - windows/wsl: `wav`, `mp3`, or `wav` only under the fallback in §6.2
     - linux: depends on the player
   - The size must be ≤ 4 MiB.
3. **Make a slug.**
   - Lowercase the name, keep `[a-z0-9-]`, and collapse runs of dashes.
   - At most 40 characters. An empty result becomes `sound`.
   - Windows reserved names get a `-1` suffix.
   - On collision, add `-2`, `-3`, and so on. Collisions are checked case-insensitively against both `imports` and the files on disk.
4. **Copy** (`$.fs.write` writes only text). Paths always travel in env, never in the command string.
   - mac/linux: `mkdir -p -- "$PT_DIR" && cp -- "$PT_SRC" "$PT_DST"`
   - windows: `New-Item -ItemType Directory -Force -Path $env:PT_DIR; Copy-Item -LiteralPath $env:PT_SRC -Destination $env:PT_DST` (`New-Item` has no `-LiteralPath` in Windows PowerShell 5.1; the directory name is ours, so `-Path` is safe)
   - If the copy fails, the import references the original file (`isCopy: false`) and a warning is shown.
5. **Analyze.** WAV files are parsed (below) to get `durationMs` and `peaks`. Other formats get a flat waveform, and `durationMs` is unknown: the band runs to the clip's real end, capped at 15 s.
6. **Record.** The import is saved as `user:<slug>` in `imports`.

**WAV parser.** It reads the RIFF chunks in order, honoring pad bytes and skipping `LIST` and `fact`. It accepts:

- PCM at 8, 16, or 24 bits, or float32
- mono or stereo
- `WAVE_FORMAT_EXTENSIBLE`

`durationMs = dataBytes / byteRate * 1000`. Anything else falls back to a flat waveform. Base64 decoding uses the mod's own decoder in `library.ts`. It does not rely on `Uint8Array.fromBase64`, which this build doesn't declare.

**Deleting an import**

- If `isCopy` is true, the file is removed: `rm -f -- <file>` (argv, no shell) on mac/linux, `Remove-Item -LiteralPath $env:PT_DST` on Windows.
- The entry is removed from `imports`.
- Every trigger that used it goes back to its default sound.

**A missing file at play time**

- The trigger falls back to its default sound.
- A toast appears once per sound per session.

## 8. Interface

### 8.1 Commands

**`/tags`**

- Opens the pane with `focus` and `closeOnEscape`, without `holdToasts`.
- Answers with `{ text: "Opened Producer Tags." }`.

**`/mute`**

- Registered with `immediate: true`.
- Toggles mute and stops any current clip.
- Answers `"Tags muted."` or `"Tags unmuted."`.
- If the name is refused, it is registered as `/tags-mute` instead.

Command answers are kept to a few words because the model also reads them.

### 8.2 `/tags` pane

**Header**

- Title.
- Volume:
  - **Every surface:** `[−]` / `[+]` buttons in steps of 10, plus a percentage readout. They work by keyboard and on every surface.
  - **Terminal and desktop:** a pointer fader as an extra, `fader.client.tsx`.
    - It updates `$.state` on every move.
    - It saves to the store on pointer up, and on each arrow-key step.
    - It sends values through `surface.post` → `ui.message`.
  - The volume controls are hidden on Windows under the SoundPlayer fallback.
- Mute button.

**Trigger rows**

- On/off toggle (●/○).
- Sound `Select`: bundled sounds first, then imports.
- ▶ preview.
- Waveform:
  - 16 block characters (`▁▂▃▄▅▆▇█`) drawn from `peaks`, on every surface. During a preview, the part already played is drawn in the accent colour, redrawn from the `bandFrame` state as in §8.3.
  - Hidden below 80 body columns.

**Custom section**

- One row per custom trigger: pattern, outcome, sound `Select`, ▶, ✕, plus a "⚠ invalid" mark if the pattern doesn't compile.
- `[+ Add]` reveals a form: a pattern `Input`, an outcome `Select`, a sound `Select`, and `[Save]`, with inline errors.

**Import section**

A path `Input`, an `[Import]` button, and one status line.

**Pads**

- Buttons with `hotkey` 1–9, mapped to the first nine bundled voice tags.
- A focused `Input` takes every printable key (`InputProps`), so digits typed into a pattern or path never fire pads.

**Studio**

Toggles for the now-playing band and for the tool badges. Both are on by default.

**Mobile**

A single line, "Open /tags in the terminal or desktop app to edit", plus the mute button.

### 8.3 Now-playing band (`AbovePrompt`, terminal and desktop only)

The band is only raised on terminal and desktop. VS Code and mobile get no band and no mode label.

**When it shows**

- While `nowPlaying` is on stage: from `started` until `ended` plus 1 s, and never past its `deadline`.
- Only if Studio → band is on.
- Not while `hasSurvey` is true.
- Otherwise the hook returns `next(e)`.

**Layout**

`<Box flexDirection="column">{ours}{await next(e)}</Box>`, so other plugins' band content stays visible.

**Line**

`♫ <equalizer> "<caption>" — riffing on <riff>`

**Animation**

- One loop on every surface: a `bandFrame: number` key in `$.state`, written up to 10 times a second by `$.clock.every`. Only the band and pane instances that read it redraw.
  - The equalizer is 10 block characters chosen from `peaks[(now − startedAt) / durationMs]`, drawn as `Text`.
  - For imports of unknown length, the bars are pseudo-random from a seed.
- `$.ui.invalidate` is **never** used for animation, because it is plugin-wide and would redraw every badge.
- The loop stops once the entry is off stage: past `endedAt` plus the tail, or past its `deadline`.

**Caption highlight**

The caption is highlighted word by word over `durationMs`. The current word is stored in `captionWord` in `$.state`, written only when it changes. For clips of unknown length, the whole caption is shown without highlighting.

### 8.4 Tool-row badges (`ToolUse`)

- **When:** shown for a `tool_use_id` whose `tagged` value is not null, and only while Studio → badges is on. A badge is written only for tags that actually **started**; dropped or muted tags get none.
- **Layout:** `<Box flexDirection="column">{await next(e)}<chip/></Box>`. The chip sits on its own line under the row: `♫ <riff> ▶`.
- **Replay:** ▶ replays the tag as a preview. Clicking needs the fullscreen terminal; the README says so.
- **Hover:** a hover card shows the caption. It is drawn inside the row's own bounds, below the chip, and does nothing where the terminal doesn't report hover.

### 8.5 Mode label (`SessionMode`, terminal and desktop only)

`♫ tags`, or `♫ muted` when muted. No emoji presentation characters, so the column width stays stable.

## 9. Settings and state

### 9.1 `$.store` (persistent)

```ts
settings: {
  version: 1,
  muted: boolean,                  // default false; persists across sessions
  volume: number,                  // 0–100, default 80
  triggers: Record<TriggerId, { enabled: boolean; sound: SoundId }>,
  custom: CustomTrigger[],         // max 20
  studio: { band: boolean; badges: boolean },   // default true, true
}
imports: ImportedSound[]  // { id, name, file, ext, bytes, durationMs | null, peaks | null, isCopy }
```

**Loading** happens in this order:

1. Read the raw value.
2. Apply `migrate(raw.version)` to the raw value.
3. Deep-merge the result over the defaults. Objects merge key by key; **arrays replace** rather than merge.
4. Validate:
   - unknown sound IDs → reset to the trigger's default
   - patterns → recompiled; invalid ones are disabled
5. If the value is corrupt or the wrong type, use the defaults and show one toast.

**Who loads:**

- `session.start` loads the store into `$.state`.
- Any reader that finds `settings` undefined in state loads it from the store itself. That covers ordering between `classic.SessionStart` and `session.start`, and the case of `/clear`. The pane, which may not write state while it draws, asks for the load on a timer and shows "Loading…".

### 9.2 `$.state` (session; declared in `types/index.d.ts`)

| Key | Contents |
|---|---|
| `settings` | Mirror of the stored settings |
| `imports` | Mirror of the stored imports |
| `nowPlaying` | `{ token, soundId, triggerId, caption, riff, claimedAt, startedAt \| null, durationMs \| null, deadline, toolUseId? } \| null` |
| `bandFrame` | `number` |
| `captionWord` | `number` |
| `tagged` | `StateFamily<SoundId \| null>`, keyed by `tool_use_id`. Entries accumulate for the session; that is acceptable at session scale. |
| `platform` | `{ os, player } \| null` |
| `cooldowns` | `Record<TriggerId, number>` |
| `paneDraft` | `{ isAdding, customPattern, customOutcome, customSound, importPath, message }` |
| `toasted` | the toast causes already shown this session |

The atoms are declared in `register.tsx`, the one file that reads and writes them (§14); their initial values come from `state.ts`.

### 9.3 Writes

- Every write that could race uses `update`, which is compare-and-swap.
- UI handlers write `$.state` first, then save to the store.
- `session.start` clears any `nowPlaying` entry that is past its deadline. This event fires again after a hot reload.
- With several sessions open, each loads on start and the last write wins. The README says so.

### 9.4 Privacy

- No network access and no telemetry.
- Patterns run locally against command strings only.

## 10. Error handling

- Every hook body is wrapped in try/catch. Errors go to `$.ui.log(…, { to: "debug" })`.
- **Toasts:** at most one per cause per session. The causes are:
  - no audio player
  - a missing imported file
  - corrupt settings
  - playback failure on this OS
- **`tool.call`:** the hook never denies or rewrites a call and never awaits tag work. Its `.catch` replays the result.
- **Pane forms:** problems are shown inline; nothing throws.

## 11. Default tag generation (`tools/generate-tags`)

Python 3, standard library only. Randomness is seeded so the committed WAVs can be reproduced exactly.

**`tags.json`** entries have the shape `{ id, text, riff, trigger, preset }`.

**Voice backends** each expose `render(text, out_wav)`:

- **`sapi`** (Windows and WSL; used for v1):
  - Runs through `powershell.exe` using `System.Speech`.
  - Calls `SetOutputToWaveFile(path, new SpeechAudioFormatInfo(22050, Sixteen, Mono))`.
  - On WSL, the output path is converted to a Windows path.
- **`say`** (macOS): `say --file-format=WAVE --data-format=LEI16@22050 -o`.
- **`elevenlabs`:** a stub for later that exits with "not implemented yet". The real backend will read its API key from the environment.

**Effects**

Presets are chains of these effects:

- pitch shift by resampling
- delay echo on the last word
- Schroeder reverb
- a synthesized 808 (a sine sweep with soft clipping)
- a noise riser
- a scratch (a modulated noise burst)

Every output is then normalized to a −1 dBFS peak and given 10 ms fades.

**Output**

- 22.05 kHz, 16-bit mono WAV, written to `plugin/sounds/`.
- The generator also writes `plugin/hooks/catalog.ts` (`durationMs` plus 64 peaks per sound).
- The WAVs are committed.

**Smoke test**

Each WAV must open with `wave`, match its catalog entry, and be shorter than 6 s.

**Line review**

Every caption in §7.1 is provisional. The lines are reviewed with the user while generating, by listening to each render, and finalized before they are committed.

## 12. Testing

### 12.1 Test suites

`claude plugin test plugin` runs these suites. Tests have no real file system, network, or processes. A shared `tests/world.tsx` fakes every `$` operation the mod uses, beneath the plugin, per OS.

| Suite | Covers |
|---|---|
| `codec`, `shell`, `triggers`, `settings`, `stage`, `library`, `platform`, `player`, `visual`, `pane-actions` | the pure units (tokenizer, trigger rules, settings merge, claims and deadlines, WAV parsing and slugs, player argv/env, drawing helpers, pane transforms), and over a fake Host: settings load and save, platform detection, `fire`'s refusals |
| `pipeline` | end-to-end through `register.tsx` per OS: the tool result returns untouched before a slow play; claims under concurrency; drop-while-playing; cooldown; deadline expiry; previews interrupt and bypass cooldown; mute and `/tags-mute`; imports and missing-file fallback; failed plays; the 15 s cap; Linux kill; WSL/Windows argv and env; model/session/stop events; the detached outro; other plugins' calls ignored |
| `imports` | the pure path cleaning (drag-and-drop quotes and escapes), the import checks, the copy and delete commands per OS, `resetSound`; import and delete over a fake Host |
| `band`, `badges`, `pane`, `fader` | each surface they render on; the import flows through the pane; the orphaned-entry deadline in the band |

### 12.2 Type checks and validation

- `npx tsc -p .` type-checks against `typings/claude-code.d.ts`, a pinned snapshot of this build's API, with the tsconfig from the snapshot's header.
- `claude plugin validate plugin` runs in CI. Whether the CLI needs authentication in CI is checked early (§14).

### 12.3 Generator

`python3 -I tools/generate-tags/smoke_test.py`.

### 12.4 Manual checklist (README, contributing section)

The test kit can't check these:

- hover cards
- painted output
- the pointer fader
- real playback, in tier order, on macOS (required for release), Linux with PipeWire and PulseAudio (required for release), and Windows (best effort before release): each trigger, imports, mute mid-clip, the band animation, and the `session.close` outro

The WSL route is verified on the author's machine.

## 13. Release

- **README:**
  - the install command
  - a GIF of the band and the pane
  - the trigger table
  - custom triggers and imports
  - platform notes
  - known limitations: the `session.close` outro is best-effort; band timing is estimated; clicking replay in the transcript needs fullscreen; mute persists; with several sessions, the last write wins
  - the disclaimer: "Unofficial parody fan project. Not affiliated with or endorsed by Anthropic or any producer or artist."
- **License:** MIT.
- **Also:** `CHANGELOG.md`, and `docs/ROADMAP.md` with every deferred idea from §1.
- **Version:** 0.1.0.

## 14. Risks to verify first (first implementation task: one throwaway spike, then update this spec)

0. **Windows tool name** (tier 3; a failure here is documented, not a release blocker). Does a native Windows session run commands through `Bash` or a `PowerShell` tool? If it's PowerShell, add it to the `tool.call` matcher, a `;`-only segmenter, and a regex git fallback for results without `gitOperation`.
1. **Detached dispatch.** Does `$.clock.after(0, …)` from a `tool.call` hook run outside the call's dispatch, and can its work outlast 10 s? If not, the pipeline needs a re-plan before it is built.
2. **Windows MediaPlayer.** Does it play to the end headless with `-STA` and the `t` ticks? Does it play from a `\\wsl.localhost` path? Is volume respected? If not, use the SoundPlayer fallback (§6.2); if only the UNC path fails, copy to `%TEMP%\producer-tags\` once per sound.
3. **Detached process.** Does a detached `afplay` or `Start-Process` child, launched without awaiting it, survive Claude Code exiting?
4. **Pointer and hover.** Do pointer and hover events work on the terminal's main screen? If not, the fader shows only in fullscreen and the badge has no hover card; the −/+ buttons remain.
5. **`/mute`.** Is the name accepted with `immediate: true`?
6. **CI.** Do `claude plugin validate` and `claude plugin test` run in CI without authentication?
7. **SAPI quality.** Are the SAPI voices good enough after effects? If not, render with `say` on a Mac before release.

Resolved by reading the API, so not spiked: a focused `Input` takes every printable key, so pad hotkeys cannot steal typed digits. Dropped from v1: the 30 fps `Raster` + `$.ui.blit` equalizer (the 10 fps state loop repaints the band anyway).

Resolved by reading the API and running `claude plugin validate` and `claude plugin test` on a scratch build (rev 4):

- **`$` stays in its file.** A module that passes `$` to an imported function is refused at load (and by validate and the test kit). `$` goes only into functions declared at the top of the same file, and is always written `$.noun.event(...)`; `read` and `update` from `claude-code` are the exceptions. Hence the Host (§3), as in Anthropic's own mods.
- **Atoms are per file.** `read`/`update` take only an atom built by `atom(...)` in a const of the same file (or an inline `{ plugin, key }` literal ref), so all of them live in `register.tsx`.
- **One unmatched hook per event** per plugin; a second one without a matcher is refused (any matcher, even `{}`, lifts the limit). `hooks.json` lists one module.
- **`$.env.get` takes a literal name.**
- **A Host bound in `session.start` works later** from a `tool.call`'s scheduled work, a button's closure and a `$.clock` timer (the test kit; Task 8's live smoke test checks a real session). A call on a plugin noun from such a closure or timer would skip the plugin's own hooks, which is one more reason the mod declares no noun.
- **Name clash:** inside `declare module 'claude-code'`, `Settings` is the engine's own type (`Readonly<Record<string, unknown>>`), which had made the `settings` atom untyped. The contract names ours `ProducerTagsSettings` there.
- **Paths in tests:** the test kit resolves a `C:\…` path against the plugin folder on a Linux host, so the Windows copy command is tested as pure argv, not through the pane.

### Spike results (Task 0, 2026-10-11)

| Risk | Result (WSL) | Result (macOS) | Consequence |
|---|---|---|---|
| R0 Windows tool name | pending (no native Windows install) | — | Checked in Task 15; listed in README known limitations until then |
| R1 Detached dispatch | yes: `$.clock.after(0)` work ran ~12 s after the tool call, and a later continuation ran | pending (mac) | Pipeline as designed |
| R2 Windows MediaPlayer | yes: `started`, ticks, exit 0 at gain 0.2 and 1.0; a `\\wsl.localhost` path opened; sound heard (loudness difference not confirmed) | n/a | `WINDOWS_ENGINE = 'mediaplayer'`; Task 15 rechecks that volume changes |
| R3 Detached process | yes: marker read `prompt_input_exit` after `/exit` | pending (mac) | The exit outro is launched detached |
| R4 Pointer and hover | yes, on the main screen | pending (mac) | Fader and badge hover card stay; no "R4 no" edits |
| R5 `/mute` | registered with `immediate: true` | — | `/tags-mute` stays as the fallback only |
| R6 CI without credentials | yes: validate and test pass with an empty `HOME` (`test` exits 1 when no test files exist) | — | CI plugin job keeps `continue-on-error: false` |
| R7 SAPI quality | deferred to Task 5's listening review | — | — |
