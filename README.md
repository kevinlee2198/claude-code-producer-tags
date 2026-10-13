# Producer Tags for Claude Code

Claude commits. *"If Anthropic don't trust you, I'm gon' shoot you."*

Producer Tags is a Claude Code mod that drops a parody producer tag when Claude does something worth a tag: committing, pushing, merging, getting the tests green, switching models, or signing off.

> Unofficial parody fan project. Not affiliated with or endorsed by Anthropic or any producer or artist.

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
| → Opus | you switch to a different model family | on | "Yo Opus, you wanna come out here?" |
| → Fable | same | on | "Fable on the beat, so it's a banger" |
| → Sonnet | same | on | "Sonnet in the booth, write it down" |
| → Haiku | same | on | "Haiku on the beat, make it quick" |
| → other model | you switch to a model outside those families | on | "Who let this model on the track?" |
| exit | you leave Claude Code (`/exit`, ctrl+c, ctrl+d) or log out | on | "Claude outta here" |
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

Quiet git commands (`git commit -q`, `git push -q`) still fire tags, through a fallback: Claude Code's own git detection reads git's output, and `-q` silences it. A quiet push that was already up to date may still play.

### Custom triggers

In `/tags`, under **Custom**, press **+ Add** and enter a pattern:
- **Pattern:** a regular expression without slashes, case-insensitive, matched anywhere in the Bash command, for example `docker compose up`. It's matched with a linear-time engine, so no pattern can hang Claude Code; backreferences and lookarounds aren't supported.
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
  | Linux | depends on the player: wav and aiff with `pw-play` or `paplay`; every format with `ffplay`; wav only with `aplay` |

- **Size:** up to 4 MB. Clips longer than 15 s are cut off at 15 s.
- **Storage:** the file is copied to `~/.claude/producer-tags/sounds/` (or under `CLAUDE_CONFIG_DIR`), so moving the original does no harm.
- **Removing:** removing an import deletes that copy and puts any trigger using it back on its default (custom triggers that used it get the 808 boom).

## Platforms

| Tier | Platform | How it plays |
|---|---|---|
| 1 | macOS | Claude Code's own audio player (the exit outro uses `afplay`) |
| 2 | Linux | the first of `pw-play`, `paplay`, `ffplay`, `aplay`; with none, tags show as captions only |
| 3 | Windows, WSL | PowerShell (WPF MediaPlayer) |

## Known limitations

- **Exit outro:** it plays from a detached process and is best-effort. It works on WSL; macOS is unverified, and if your system kills child processes on exit you may not hear it.
- **Native Windows (not WSL):** untested. If Claude Code runs commands through a PowerShell tool there, Bash triggers may not fire.
- **Band timing:** the band and captions are timed from when playback starts. On Windows and WSL, playback waits for the file to open, which can take up to about 1.5 s on a cold start, so the band appears a moment after the command finishes.
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

**Regenerating the default tags.** The voices are recorded outside the repo (currently with [Chatterbox](https://github.com/resemble-ai/chatterbox)) and kept as raw takes in `tools/generate-tags/takes/<id>.wav`. To change one:

1. Put a 16-bit WAV of the new line at `tools/generate-tags/takes/<id>.wav`. Any sample rate works; convert with `ffmpeg -i in.mp3 -c:a pcm_s16le takes/<id>.wav`.
2. Mix it: `pip install -r tools/generate-tags/requirements-mix.txt`, then `python3 -I tools/generate-tags/mix.py --only <id>`. The mix uses the tag's `preset` in `tags.json`.
3. Rebuild the catalog: `python3 -I tools/generate-tags/generate.py --catalog-only`.
4. Commit the take, the WAV in `plugin/sounds/` and `plugin/hooks/catalog.ts`.

`generate.py` without `--catalog-only` re-renders everything with the old system-voice path (`--voice sapi` on Windows or WSL, `--voice say` on macOS), which overwrites the mixed tags.

**Manual checklist before a release.** Do this on macOS and Linux; Windows is best-effort.
- Each default-on trigger plays: commit, push, merge, tests (direct and `| tail`), each model switch, `/exit`.
- `/mute` mid-clip stops the sound.
- Import a wav and an mp3, preview them, assign one, then delete it.
- The band's equalizer moves and the caption lights up.
- The badge shows on a commit row, and its hover card shows when hovered.
- The fader drags (and in fullscreen mode).
- Pads `1`–`9` play, and digits typed into the pane's text fields stay in the field.
- Hot reload: with `claude --plugin-dir ./plugin`, save any file under `plugin/hooks/` while a tag plays. The band clears by the clip's deadline, the next commit plays its tag, and the pane's buttons still work.
