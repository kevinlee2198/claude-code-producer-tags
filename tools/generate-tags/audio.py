"""Mono float audio at 22.05 kHz: WAV I/O, resampling, mixing, envelopes, peaks."""
from __future__ import annotations

import array
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
