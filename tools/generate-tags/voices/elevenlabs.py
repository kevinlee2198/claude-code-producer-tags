"""Neural TTS, for later (spec §11): the slot exists so a voice pack can be re-rendered with one flag."""
from __future__ import annotations

from pathlib import Path


def render(text: str, out: Path) -> None:
    raise SystemExit('elevenlabs: not implemented yet; set ELEVENLABS_API_KEY and implement voices/elevenlabs.py')
