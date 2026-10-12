# Changelog

## 0.1.0 — unreleased

First release.

- Tags on git commit, push and merge (from Claude Code's own git detection), passing tests, model switches, and exit.
- Off by default: session start, turn done, failed commands.
- Custom triggers: a regex over the Bash command, on success, failure or either.
- Custom triggers use a linear-time regex engine, so no pattern can hang Claude Code (backreferences and lookarounds aren't supported). Only the first 2 KB of a command is matched.
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
