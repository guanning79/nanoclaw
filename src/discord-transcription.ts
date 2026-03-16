/**
 * Discord voice transcription using a persistent faster-whisper HTTP server.
 * On first call the server is spawned and the model is loaded (~15s cold start).
 * Subsequent calls skip loading and go straight to inference (~1-2s).
 *
 * Falls back to one-shot subprocess if the HTTP server is unavailable.
 */
import { execFile, execSync, spawn } from 'child_process';
import { createWriteStream, readdirSync, existsSync } from 'fs';
import { unlink, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

import { readEnvFile } from './env.js';
import { logger } from './logger.js';
import { WHISPER_PORT, WHISPER_IDLE_TIMEOUT_MIN } from './config.js';

const execFileAsync = promisify(execFile);

function getConfig(): {
  python: string;
  model: string;
  language: string;
  scriptPath: string;
  serverScriptPath: string;
} {
  const envVars = readEnvFile([
    'WHISPER_PYTHON',
    'WHISPER_MODEL',
    'WHISPER_LANGUAGE',
  ]);
  const python =
    process.env.WHISPER_PYTHON ||
    envVars.WHISPER_PYTHON ||
    'C:/Program Files/Python313/python.exe';
  const model =
    process.env.WHISPER_MODEL || envVars.WHISPER_MODEL || 'large-v3-turbo';
  const language =
    process.env.WHISPER_LANGUAGE || envVars.WHISPER_LANGUAGE || '';
  const base = new URL('.', import.meta.url).pathname.slice(1) + '..';
  const scriptPath = join(base, 'scripts', 'transcribe.py');
  const serverScriptPath = join(base, 'scripts', 'whisper-server.py');
  return { python, model, language, scriptPath, serverScriptPath };
}

// --- Persistent server management ---

let serverProcess: ReturnType<typeof spawn> | null = null;
let serverStarting = false;
let serverStartPromise: Promise<void> | null = null;

async function isServerHealthy(): Promise<boolean> {
  try {
    const resp = await fetch(`http://127.0.0.1:${WHISPER_PORT}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

async function waitForServer(timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isServerHealthy()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Whisper server did not become healthy in time');
}

// Find all nvidia/{pkg}/bin dirs under Python site-packages (CUDA DLLs for ctranslate2)
function findCudaDllPaths(python: string): string {
  try {
    const sitePackages = execSync(
      `"${python}" -c "import site; print('\\n'.join(site.getsitepackages() + [site.getusersitepackages()]))"`,
      { encoding: 'utf8', timeout: 5000 },
    ).trim().split('\n');
    const bins: string[] = [];
    for (const sp of sitePackages) {
      const nvidiaDir = sp.trim().replace(/\\/g, '/') + '/nvidia';
      if (existsSync(nvidiaDir)) {
        for (const pkg of readdirSync(nvidiaDir)) {
          const binDir = nvidiaDir + '/' + pkg + '/bin';
          if (existsSync(binDir)) bins.push(binDir.replace(/\//g, '\\'));
        }
      }
    }
    return bins.join(';');
  } catch {
    return '';
  }
}

function spawnServer(): void {
  const { python, model, serverScriptPath } = getConfig();
  logger.info({ model, port: WHISPER_PORT }, 'Whisper server starting');

  const cudaDllPaths = findCudaDllPaths(python);
  if (cudaDllPaths) {
    logger.debug({ cudaDllPaths }, 'Adding CUDA DLL paths to whisper server PATH');
  }

  const existingPath = process.env.PATH || '';
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    WHISPER_MODEL: model,
    WHISPER_PORT: String(WHISPER_PORT),
    WHISPER_IDLE_TIMEOUT: String(WHISPER_IDLE_TIMEOUT_MIN),
    PYTHONIOENCODING: 'utf-8',
    PATH: cudaDllPaths ? `${cudaDllPaths};${existingPath}` : existingPath,
  };

  const proc = spawn(python, [serverScriptPath], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  proc.stdout?.on('data', (d: Buffer) =>
    logger.debug({ src: 'whisper-server' }, d.toString().trim()),
  );
  proc.stderr?.on('data', (d: Buffer) =>
    logger.warn({ src: 'whisper-server' }, d.toString().trim()),
  );
  proc.on('exit', (code) => {
    logger.info({ code }, 'Whisper server exited');
    serverProcess = null;
  });
  proc.unref();
  serverProcess = proc;
}

async function ensureWhisperServer(): Promise<void> {
  if (await isServerHealthy()) return;

  // Deduplicate concurrent start attempts
  if (serverStarting) {
    await serverStartPromise;
    return;
  }

  serverStarting = true;
  serverStartPromise = (async () => {
    try {
      spawnServer();
      await waitForServer(60_000);
      logger.info({ port: WHISPER_PORT }, 'Whisper server ready');
    } finally {
      serverStarting = false;
    }
  })();
  await serverStartPromise;
}

/** Kill the server on NanoClaw shutdown */
export function stopWhisperServer(): void {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
}

// --- Audio download ---

async function downloadToTemp(url: string, ext: string): Promise<string> {
  const dir = join(tmpdir(), 'nanoclaw-discord');
  await mkdir(dir, { recursive: true });
  const tmpPath = join(
    dir,
    `voice_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`,
  );
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download audio: HTTP ${response.status}`);
  }
  const dest = createWriteStream(tmpPath);
  await pipeline(
    Readable.fromWeb(response.body as import('stream/web').ReadableStream),
    dest,
  );
  return tmpPath;
}

// --- Fallback: one-shot subprocess ---

async function transcribeFallback(
  tmpPath: string,
  filename: string,
): Promise<string | null> {
  const { python, model, language, scriptPath } = getConfig();
  const args = [scriptPath, tmpPath, model];
  if (language) args.push(language);
  const { stdout } = await execFileAsync(python, args, {
    timeout: 120_000,
    encoding: 'utf8',
  });
  const transcript = stdout.trim();
  logger.info({ filename, chars: transcript.length }, 'Discord voice message transcribed (fallback)');
  return transcript || null;
}

// --- Main export ---

export async function transcribeDiscordAudio(
  url: string,
  filename: string,
): Promise<string | null> {
  const ext = filename.includes('.') ? `.${filename.split('.').pop()}` : '.ogg';
  let tmpPath: string | null = null;
  const t0 = Date.now();

  try {
    tmpPath = await downloadToTemp(url, ext);
    const downloadMs = Date.now() - t0;

    const t1 = Date.now();
    let transcript: string | null = null;

    try {
      await ensureWhisperServer();
      const resp = await fetch(`http://127.0.0.1:${WHISPER_PORT}/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: tmpPath }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = (await resp.json()) as { transcript?: string; error?: string };
      if (data.error) throw new Error(data.error);
      transcript = data.transcript?.trim() || null;
    } catch (serverErr) {
      logger.warn({ err: serverErr }, 'Whisper server failed, falling back to subprocess');
      transcript = await transcribeFallback(tmpPath, filename);
    }

    const whisperMs = Date.now() - t1;
    if (!transcript) return null;

    logger.info(
      { filename, chars: transcript.length, downloadMs, whisperMs, totalMs: Date.now() - t0 },
      'Discord voice message transcribed',
    );
    return transcript;
  } catch (err) {
    logger.error({ filename, err }, 'Discord voice transcription failed');
    return null;
  } finally {
    if (tmpPath) unlink(tmpPath).catch(() => {});
  }
}
