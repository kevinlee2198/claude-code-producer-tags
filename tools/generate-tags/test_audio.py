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
