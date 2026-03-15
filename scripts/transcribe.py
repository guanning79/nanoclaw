#!/usr/bin/env python3
"""
Discord voice transcription using faster-whisper with CUDA.
Usage: python transcribe.py <audio_file_path> [model_size]
Prints transcript to stdout, errors to stderr.
"""
import sys
import os
import io

# Force UTF-8 stdout so Chinese/non-ASCII transcripts don't crash on Windows
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

def transcribe(audio_path: str, model_size: str = "large-v3", language: str | None = None) -> str:
    from faster_whisper import WhisperModel

    def run_with_device(device, compute_type):
        model = WhisperModel(model_size, device=device, compute_type=compute_type)
        segments, info = model.transcribe(audio_path, beam_size=5, language=language or None)
        return " ".join(segment.text.strip() for segment in segments).strip()

    # Try CUDA first, fall back to CPU on any error (missing DLLs, OOM, etc.)
    try:
        return run_with_device("cuda", "float16")
    except Exception as e:
        print(f"CUDA failed ({e}), falling back to CPU", file=sys.stderr)
        return run_with_device("cpu", "int8")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: transcribe.py <audio_file> [model_size] [language]", file=sys.stderr)
        sys.exit(1)

    audio_path = sys.argv[1]
    model_size = sys.argv[2] if len(sys.argv) > 2 else "large-v3"
    language = sys.argv[3] if len(sys.argv) > 3 else None

    if not os.path.exists(audio_path):
        print(f"File not found: {audio_path}", file=sys.stderr)
        sys.exit(1)

    result = transcribe(audio_path, model_size, language)
    print(result)
