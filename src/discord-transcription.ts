/**
 * Discord voice transcription using faster-whisper via Python subprocess.
 * Requires: pip install faster-whisper (CUDA auto-detected)
 * Configure via .env: WHISPER_PYTHON (default: python), WHISPER_MODEL (default: large-v3)
 */
import { execFile } from 'child_process';
import { createWriteStream } from 'fs';
import { unlink, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

import { readEnvFile } from './env.js';
import { logger } from './logger.js';

const execFileAsync = promisify(execFile);

function getConfig(): { python: string; model: string; language: string; scriptPath: string } {
  const envVars = readEnvFile(['WHISPER_PYTHON', 'WHISPER_MODEL', 'WHISPER_LANGUAGE']);
  const python =
    process.env.WHISPER_PYTHON ||
    envVars.WHISPER_PYTHON ||
    'C:/Program Files/Python313/python.exe';
  const model =
    process.env.WHISPER_MODEL || envVars.WHISPER_MODEL || 'large-v3';
  const language =
    process.env.WHISPER_LANGUAGE || envVars.WHISPER_LANGUAGE || '';
  // Resolve script path relative to project root (two levels up from src/)
  const scriptPath = join(
    new URL('.', import.meta.url).pathname.slice(1),
    '..',
    'scripts',
    'transcribe.py',
  );
  return { python, model, language, scriptPath };
}

/**
 * Download a URL to a temp file and return the temp file path.
 */
async function downloadToTemp(url: string, ext: string): Promise<string> {
  const dir = join(tmpdir(), 'nanoclaw-discord');
  await mkdir(dir, { recursive: true });
  const tmpPath = join(dir, `voice_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);

  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download audio: HTTP ${response.status}`);
  }

  const dest = createWriteStream(tmpPath);
  await pipeline(Readable.fromWeb(response.body as import('stream/web').ReadableStream), dest);
  return tmpPath;
}

/**
 * Transcribe an audio attachment from a Discord CDN URL.
 * Returns the transcript string, or null on failure.
 */
export async function transcribeDiscordAudio(
  url: string,
  filename: string,
): Promise<string | null> {
  const ext = filename.includes('.') ? `.${filename.split('.').pop()}` : '.ogg';
  let tmpPath: string | null = null;

  try {
    tmpPath = await downloadToTemp(url, ext);
    const { python, model, language, scriptPath } = getConfig();
    const args = [scriptPath, tmpPath, model];
    if (language) args.push(language);

    const { stdout } = await execFileAsync(python, args, {
      timeout: 120_000,
      encoding: 'utf8',
    });

    const transcript = stdout.trim();
    if (!transcript) return null;

    logger.info(
      { filename, chars: transcript.length },
      'Discord voice message transcribed',
    );
    return transcript;
  } catch (err) {
    logger.error({ filename, err }, 'Discord voice transcription failed');
    return null;
  } finally {
    if (tmpPath) {
      unlink(tmpPath).catch(() => {});
    }
  }
}
