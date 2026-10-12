"""Windows SAPI voices through powershell.exe, from Windows or WSL. Text and paths travel in env vars."""
from __future__ import annotations

import base64
import os
import subprocess
from pathlib import Path

VOICE = os.environ.get('PT_SAPI_VOICE', 'Microsoft David Desktop')
RATE = os.environ.get('PT_SAPI_RATE', '0')

SCRIPT = r'''
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voices = $s.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name }
if ($env:PT_VOICE -and ($voices -contains $env:PT_VOICE)) { $s.SelectVoice($env:PT_VOICE) }
$s.Rate = [int]$env:PT_RATE
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(22050, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$s.SetOutputToWaveFile($env:PT_OUT, $format)
$s.Speak($env:PT_TEXT)
$s.Dispose()
'''


def _is_wsl() -> bool:
    try:
        return 'microsoft' in Path('/proc/version').read_text().lower()
    except OSError:
        return False


def render(text: str, out: Path) -> None:
    env = {**os.environ, 'PT_TEXT': text, 'PT_OUT': str(out.resolve()), 'PT_VOICE': VOICE, 'PT_RATE': RATE}
    if _is_wsl():
        env['WSLENV'] = ':'.join(filter(None, [os.environ.get('WSLENV', ''), 'PT_TEXT', 'PT_OUT/p', 'PT_VOICE', 'PT_RATE']))
    encoded = base64.b64encode(SCRIPT.encode('utf-16-le')).decode()
    done = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
                          env=env, capture_output=True, text=True)
    if done.returncode != 0:
        raise SystemExit(f'sapi failed for {text!r}:\n{done.stderr.strip()}')
