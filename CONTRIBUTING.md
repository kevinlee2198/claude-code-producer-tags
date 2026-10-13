# Contributing

## Setup and checks

```bash
npm install                      # TypeScript for type-checking only
npm run typecheck                # tsc against typings/claude-code.d.ts (Claude Code 2.1.296)
npm test                         # claude plugin test plugin
npm run validate                 # claude plugin validate plugin
python3 -I -m unittest discover -s tools/generate-tags -p 'test_*.py'
python3 -I tools/generate-tags/smoke_test.py
```

- **Running from your checkout:** `claude --plugin-dir ./plugin`.

## Regenerating the default tags

The voices are recorded outside the repo (currently with [Chatterbox](https://github.com/resemble-ai/chatterbox)) and kept as raw takes in `tools/generate-tags/takes/<id>.wav`. To change one:

1. Put a 16-bit WAV of the new line at `tools/generate-tags/takes/<id>.wav`. Any sample rate works; convert with `ffmpeg -i in.mp3 -c:a pcm_s16le takes/<id>.wav`.
2. Mix it: `pip install -r tools/generate-tags/requirements-mix.txt`, then `python3 -I tools/generate-tags/mix.py --only <id>`. The mix uses the tag's `preset` in `tags.json`.
3. Rebuild the catalog: `python3 -I tools/generate-tags/generate.py --catalog-only`.
4. Commit the take, the WAV in `plugin/sounds/` and `plugin/hooks/catalog.ts`.

`generate.py` without `--catalog-only` re-renders everything with the old system-voice path (`--voice sapi` on Windows or WSL, `--voice say` on macOS), which overwrites the mixed tags.

The README banner (`docs/assets/banner.svg`) is a hand-made SVG whose waveform was copied from the commit tag's peaks; it doesn't update when that tag changes.

## Manual checklist before a release

Do this on macOS and Linux; Windows is best-effort.

- Each default-on trigger plays: commit, push, merge, tests (direct and `| tail`), each model switch, `/exit`.
- `/mute` mid-clip stops the sound.
- Import a wav and an mp3, preview them, assign one, then delete it.
- The band's equalizer moves and the caption lights up.
- The badge shows on a commit row, and its hover card shows when hovered.
- The fader drags (and in fullscreen mode).
- Pads `1`–`9` play, and digits typed into the pane's text fields stay in the field.
- Hot reload: with `claude --plugin-dir ./plugin`, save any file under `plugin/hooks/` while a tag plays. The band clears by the clip's deadline, the next commit plays its tag, and the pane's buttons still work.
