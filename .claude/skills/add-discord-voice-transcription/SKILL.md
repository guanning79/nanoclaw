---
name: add-discord-voice-transcription
description: Add voice message transcription to Discord channel using faster-whisper (CUDA). Audio attachments are downloaded and transcribed locally. Delivered to the agent as [Voice: <transcript>].
---

# Add Discord Voice Transcription

Adds automatic voice message transcription to NanoClaw's Discord channel using faster-whisper running locally with CUDA. Audio attachments are downloaded, transcribed offline, and delivered to the agent as `[Voice: <transcript>]`.

## Requirements

- NVIDIA GPU with CUDA (CPU fallback supported but slow)
- Python 3.10+
- `faster-whisper` Python package

## Phase 1: Pre-flight

### Check if already applied

Check if `src/discord-transcription.ts` exists. If it does, skip to Phase 3.

### Check Python and faster-whisper

```bash
python --version
python -c "import faster_whisper; print('ok')"
```

If faster-whisper is missing:

```bash
pip install faster-whisper
```

Check CUDA availability:

```bash
python -c "import ctranslate2; print('CUDA devices:', ctranslate2.get_cuda_device_count())"
```

## Phase 2: Apply Code Changes

### Create scripts/transcribe.py

Create the transcription script at `scripts/transcribe.py`. It accepts `<audio_file> [model_size]` arguments, loads the model with CUDA (falls back to CPU), and prints the transcript to stdout.

### Create src/discord-transcription.ts

Create the Node.js transcription module that:
1. Downloads audio from Discord CDN URL to a temp file
2. Calls `python scripts/transcribe.py <tmpfile> <model>` via `execFile`
3. Returns the transcript string or null on failure
4. Cleans up the temp file

### Modify src/channels/discord.ts

1. Import `transcribeDiscordAudio` from `../discord-transcription.js`
2. Change audio attachment handling from sync `.map()` to async `Promise.all()` + `.map(async ...)`
3. Replace `[Audio: filename]` placeholder with actual transcription call
4. On success: return `[Voice: <transcript>]`
5. On failure: return `[Voice: transcription unavailable]`

### Build and verify

```bash
npm run build
```

## Phase 3: Configure

### Set Python path (if needed)

If Python is not on the default PATH, add to `.env`:

```
WHISPER_PYTHON=C:/Program Files/Python313/python.exe
WHISPER_MODEL=large-v3
```

`WHISPER_PYTHON` defaults to `C:/Program Files/Python313/python.exe`.
`WHISPER_MODEL` defaults to `large-v3`. Other options: `medium`, `small`, `base`, `tiny`.

### First run — model download

On first use, faster-whisper downloads the model from HuggingFace (~3GB for large-v3). This is automatic and cached at `~/.cache/huggingface/`.

### Restart service

```bash
# Windows: restart the NanoClaw process
# macOS: launchctl kickstart -k gui/$(id -u)/com.nanoclaw
# Linux: systemctl --user restart nanoclaw
```

## Phase 4: Verify

Send a voice message in a registered Discord channel. The agent should receive it as `[Voice: <transcript>]`.

Check logs:

```bash
tail -f logs/nanoclaw.log | grep -i voice
```

Look for:
- `Discord voice message transcribed` — success with char count
- `Discord voice transcription failed` — check Python path and faster-whisper install

## Troubleshooting

### `[Voice: transcription unavailable]`

1. Check `WHISPER_PYTHON` points to the Python that has faster-whisper installed
2. Test manually: `python scripts/transcribe.py <audio_file>`
3. Check logs for the specific error

### Slow transcription (CPU mode)

CTranslate2 fell back to CPU — CUDA not available. Verify CUDA drivers and that ctranslate2 detects the GPU:
```bash
python -c "import ctranslate2; print(ctranslate2.get_cuda_device_count())"
```

### Model download stuck

Check HuggingFace connectivity. The model is cached after first download at `~/.cache/huggingface/hub/`.
