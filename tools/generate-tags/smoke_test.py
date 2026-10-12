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
