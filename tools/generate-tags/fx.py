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
