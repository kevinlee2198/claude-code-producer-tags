"""Mixes recorded voice takes into producer tags: 44.1 kHz stereo WAVs in plugin/sounds/.

python3 -I tools/generate-tags/mix.py [--takes <dir>] [--only <id> ...]

Each take is takes/<id>.wav (any rate, mono or stereo, 16-bit PCM), mixed with its tag's preset from
tags.json. Needs the packages in requirements-mix.txt. Afterwards, run generate.py --catalog-only.
"""
from __future__ import annotations

import argparse
import json
import wave
import zlib
from math import gcd
from pathlib import Path

import numpy as np
from pedalboard import (Compressor, Distortion, HighpassFilter, HighShelfFilter, Limiter,
                        LowpassFilter, PeakFilter, Pedalboard, PitchShift, Reverb)
from scipy.signal import resample_poly

HERE = Path(__file__).resolve().parent
SOUNDS = HERE.parent.parent / 'plugin' / 'sounds'
SR = 44100
WIN = SR // 100  # 10 ms envelope frames

PRESETS = {
    # semis: pitch shift; drive: grit; octave: octave-down layer (dB); verb: reverb send;
    # swell: reverse reverb into the first word; throw: (gap s, repeats) echoes of the last word;
    # boom: where the 808 lands; riser: noise build before the voice; lowpass: darken the voice.
    'tag': dict(semis=-2, drive=12, octave=-15, verb=0.18, swell=True, throw=(0.32, 3), boom='last', riser=False, lowpass=None),
    'hype': dict(semis=-1, drive=16, octave=-13, verb=0.15, swell=False, throw=(0.27, 3), boom='first', riser=True, lowpass=None),
    'quick': dict(semis=-1, drive=9, octave=-18, verb=0.07, swell=False, throw=(0.11, 2), boom='first', riser=False, lowpass=None),
    'dark': dict(semis=-4, drive=18, octave=-9, verb=0.30, swell=True, throw=(0.40, 3), boom='last', riser=False, lowpass=5000),
}


def load(path: Path) -> np.ndarray:
    with wave.open(str(path), 'rb') as w:
        rate, channels, width = w.getframerate(), w.getnchannels(), w.getsampwidth()
        raw = w.readframes(w.getnframes())
    if width != 2:
        raise SystemExit(f'{path}: expected 16-bit PCM, got {width * 8}-bit')
    mono = (np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768).reshape(-1, channels).mean(axis=1)
    g = gcd(SR, rate)
    return resample_poly(mono, SR // g, rate // g).astype(np.float32)


def save(path: Path, stereo: np.ndarray) -> None:
    pcm = (np.clip(stereo.T, -1, 1) * 32767).astype(np.int16)
    with wave.open(str(path), 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def run(board: Pedalboard, mono: np.ndarray) -> np.ndarray:
    return board(mono[np.newaxis, :].astype(np.float32), SR)[0]


def env_db(mono: np.ndarray) -> np.ndarray:
    """Loudness of each 10 ms frame, in dB below the loudest frame."""
    n = len(mono) // WIN
    rms = np.sqrt((mono[:n * WIN].reshape(n, WIN) ** 2).mean(axis=1) + 1e-12)
    return 20 * np.log10(rms / rms.max())


def loud_span(mono: np.ndarray, floor_db: float) -> tuple[int, int]:
    """First and last sample of the frames louder than floor_db."""
    loud = np.flatnonzero(env_db(mono) > floor_db)
    return int(loud[0]) * WIN, (int(loud[-1]) + 1) * WIN


def last_word(voice: np.ndarray) -> int:
    """Where the final word starts: after the last pause of 50 ms or more, 0.15–0.7 s from the end."""
    quiet = env_db(voice) < -30
    run_len, seen_loud = 0, False
    for i in range(len(quiet) - 1, -1, -1):
        if not quiet[i]:
            seen_loud, run_len = True, 0
        elif seen_loud:
            run_len += 1
            if run_len >= 5:
                return int(np.clip((i + run_len) * WIN, len(voice) - SR * 0.7, len(voice) - SR * 0.15))
    return int(len(voice) - SR * 0.35)


def boom_808(seconds: float) -> np.ndarray:
    t = np.arange(int(SR * seconds)) / SR
    freq = 44 + 18 * np.exp(-t * 9)
    body = np.tanh(2.5 * np.sin(2 * np.pi * np.cumsum(freq) / SR)) * np.exp(-t * 2.6)
    click = 0.4 * np.exp(-t * 400) * np.sin(2 * np.pi * 180 * t)
    return (body + click).astype(np.float32)


def riser(seconds: float, rng: np.random.Generator) -> np.ndarray:
    """Noise whose band sweeps up in 16 steps while it swells."""
    n = int(SR * seconds)
    noise = rng.uniform(-1, 1, n).astype(np.float32)
    out = np.empty(n, dtype=np.float32)
    for k, cut in enumerate(np.geomspace(400, 9000, 16)):
        a, b = k * n // 16, (k + 1) * n // 16
        out[a:b] = run(Pedalboard([LowpassFilter(cut), HighpassFilter(cut / 6)]), noise[a:b])
    return out * np.linspace(0.05, 1, n, dtype=np.float32) ** 2


def pan(mono: np.ndarray, position: float) -> np.ndarray:
    """Constant-power pan; position runs from -1 (left) to 1 (right)."""
    theta = (position + 1) * np.pi / 4
    return np.stack([mono * np.cos(theta), mono * np.sin(theta)])


def place(track: np.ndarray, clip: np.ndarray, at: int, gain: float = 1.0) -> None:
    """Adds a stereo clip into the stereo track at sample `at`, clipped to the track."""
    start, skip = max(at, 0), max(-at, 0)
    end = min(track.shape[1], at + clip.shape[1])
    if end > start:
        track[:, start:end] += clip[:, skip:skip + end - start] * gain


def mix(raw: np.ndarray, preset: str, rng: np.random.Generator) -> np.ndarray:
    p = PRESETS[preset]
    a, b = loud_span(raw, -40)
    voice = raw[max(0, a - WIN):b + WIN]

    chain = [HighpassFilter(90), PitchShift(p['semis']), Compressor(-24, 4, 3, 80),
             PeakFilter(3200, 3.5, 1.0), HighShelfFilter(9000, 2.5)]
    if p['lowpass']:
        chain.append(LowpassFilter(p['lowpass']))
    lead = run(Pedalboard(chain), voice)
    grit = run(Pedalboard([Distortion(p['drive']), LowpassFilter(6500), HighpassFilter(200)]), lead)
    octave = run(Pedalboard([PitchShift(p['semis'] - 12), LowpassFilter(1400), Compressor(-20, 3)]), voice)
    lead = lead + 0.28 * grit + 10 ** (p['octave'] / 20) * octave

    pre = int(SR * (1.0 if p['riser'] else 0.6 if p['swell'] else 0.0))
    out = np.zeros((2, pre + len(lead) + SR * 3), dtype=np.float32)
    place(out, pan(lead, 0), pre)
    place(out, pan(run(Pedalboard([PitchShift(p['semis'] + 0.12)]), voice), -0.8), pre + int(SR * 0.014), 0.32)
    place(out, pan(run(Pedalboard([PitchShift(p['semis'] - 0.12)]), voice), 0.8), pre + int(SR * 0.021), 0.32)

    room = Pedalboard([HighpassFilter(250), Reverb(room_size=0.78, damping=0.45, wet_level=1.0, dry_level=0.0)])
    verb_in = np.concatenate([lead, np.zeros(SR * 2, dtype=np.float32)])
    place(out, room(np.stack([verb_in, verb_in]), SR), pre, p['verb'])

    if p['swell']:
        first = np.concatenate([lead[:int(SR * 0.45)], np.zeros(SR, dtype=np.float32)])
        swell = room(np.stack([first, first]), SR)[:, ::-1][:, -int(SR * 0.6):]
        swell = swell * np.linspace(0, 1, swell.shape[1], dtype=np.float32) ** 1.5
        place(out, swell, pre - swell.shape[1] + int(SR * 0.03), 0.55)

    word_at = last_word(lead)
    gap, repeats = p['throw']
    thin = Pedalboard([HighpassFilter(350), LowpassFilter(3800)])
    for r in range(1, repeats + 1):
        place(out, pan(run(thin, lead[word_at:]) * 0.55 ** r, -0.7 if r % 2 else 0.7), pre + word_at + int(SR * gap * r))

    if p['riser']:
        place(out, pan(riser(pre / SR, rng), -0.5), 0, 0.22)
        place(out, pan(riser(pre / SR, rng), 0.5), 0, 0.22)
    boom = boom_808(1.0 if preset == 'quick' else 1.5)
    place(out, np.stack([boom, boom]), pre if p['boom'] == 'first' else pre + word_at, 0.75)

    out = Pedalboard([Compressor(-14, 2.5, 10, 120), Limiter(-1.5, 80)])(out, SR)
    out *= 10 ** (-1 / 20) / np.abs(out).max()
    a, b = loud_span(out.mean(axis=0), -48)
    out = out[:, a:b]
    fade_in, fade_out = SR * 2 // 1000, SR * 25 // 1000  # keep the 808's attack
    out[:, :fade_in] *= np.linspace(0, 1, fade_in, dtype=np.float32)
    out[:, -fade_out:] *= np.linspace(1, 0, fade_out, dtype=np.float32)
    return out


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--takes', type=Path, default=HERE / 'takes')
    parser.add_argument('--only', action='append', help='mix just these ids')
    args = parser.parse_args(argv)
    spec = json.loads((HERE / 'tags.json').read_text(encoding='utf-8'))
    for tag in spec['tags']:
        if args.only and tag['id'] not in args.only:
            continue
        rng = np.random.default_rng(zlib.crc32(f"{spec['seed']}:{tag['id']}".encode()))
        stereo = mix(load(args.takes / f"{tag['id']}.wav"), tag['preset'], rng)
        save(SOUNDS / f"{tag['id']}.wav", stereo)
        print(f"mixed {tag['id']} [{tag['preset']}] {stereo.shape[1] / SR:.2f}s")


if __name__ == '__main__':
    main()
