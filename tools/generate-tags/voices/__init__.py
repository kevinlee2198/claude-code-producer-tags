"""Text-to-speech backends: each exposes render(text, out_wav) -> None, writing a WAV file."""
from __future__ import annotations

from typing import Callable
from pathlib import Path

from . import sapi, say

Backend = Callable[[str, Path], None]

BACKENDS: dict[str, Backend] = {'sapi': sapi.render, 'say': say.render}
