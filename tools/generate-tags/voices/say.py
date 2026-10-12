"""macOS `say`, rendered straight to 22.05 kHz 16-bit WAV."""
from __future__ import annotations

import os
import subprocess
from pathlib import Path

VOICE = os.environ.get('PT_SAY_VOICE', 'Fred')


def render(text: str, out: Path) -> None:
    subprocess.run(['say', '-v', VOICE, '--file-format=WAVE', '--data-format=LEI16@22050', '-o', str(out), text], check=True)
