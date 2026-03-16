#!/usr/bin/env python3
"""
Persistent Whisper HTTP server. Loads the model once and serves transcription requests.

Endpoints:
  GET  /health       → 200 OK (ready)
  POST /transcribe   → {"path": "/tmp/audio.ogg"} → {"transcript": "..."}

Env vars (read at startup):
  WHISPER_PORT          default 3002
  WHISPER_MODEL         default large-v3-turbo
  WHISPER_IDLE_TIMEOUT  idle minutes before self-exit, default 15
  WHISPER_PYTHON        (unused here, just for reference)
"""
import sys
import os
import json
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler

# Force UTF-8 stdout/stderr
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

PORT = int(os.environ.get('WHISPER_PORT', '3002'))
MODEL_SIZE = os.environ.get('WHISPER_MODEL', 'large-v3-turbo')
IDLE_TIMEOUT_SEC = int(os.environ.get('WHISPER_IDLE_TIMEOUT', '15')) * 60

# Add nvidia CUDA DLL directories (installed via pip as nvidia-*-cu12 packages)
# Required on Windows when spawned from a process that doesn't have these on PATH
import site, glob
for site_dir in site.getsitepackages() + [site.getusersitepackages()]:
    for dll_dir in glob.glob(os.path.join(site_dir, 'nvidia', '*', 'bin')):
        if os.path.isdir(dll_dir):
            try:
                os.add_dll_directory(dll_dir)
                print(f'[whisper-server] Added DLL dir: {dll_dir}', flush=True)
            except Exception as e:
                print(f'[whisper-server] Could not add DLL dir {dll_dir}: {e}', flush=True)

print(f'[whisper-server] Loading model {MODEL_SIZE}...', flush=True)

from faster_whisper import WhisperModel

def load_model():
    try:
        m = WhisperModel(MODEL_SIZE, device='cuda', compute_type='float16')
        print(f'[whisper-server] Model loaded on CUDA (float16)', flush=True)
        return m
    except Exception as e:
        print(f'[whisper-server] CUDA failed ({e}), falling back to CPU', file=sys.stderr, flush=True)
        return WhisperModel(MODEL_SIZE, device='cpu', compute_type='int8')

model = load_model()
print(f'[whisper-server] Ready on port {PORT}, idle timeout {IDLE_TIMEOUT_SEC}s', flush=True)

# Idle timer — exit after IDLE_TIMEOUT_SEC seconds of no requests
idle_timer: threading.Timer | None = None
idle_lock = threading.Lock()

def idle_exit():
    print(f'[whisper-server] Idle timeout reached, exiting', flush=True)
    os._exit(0)

def reset_idle_timer():
    global idle_timer
    with idle_lock:
        if idle_timer is not None:
            idle_timer.cancel()
        idle_timer = threading.Timer(IDLE_TIMEOUT_SEC, idle_exit)
        idle_timer.daemon = True
        idle_timer.start()

reset_idle_timer()

class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Suppress default access log
        pass

    def do_GET(self):
        if self.path == '/health':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"status":"ok"}')
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path != '/transcribe':
            self.send_response(404)
            self.end_headers()
            return

        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length)
        try:
            req = json.loads(body)
            audio_path = req.get('path', '')
            if not audio_path or not os.path.exists(audio_path):
                raise ValueError(f'File not found: {audio_path}')

            segments, _ = model.transcribe(audio_path, beam_size=5)
            transcript = ' '.join(s.text.strip() for s in segments).strip()

            reset_idle_timer()

            resp = json.dumps({'transcript': transcript}).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            print(f'[whisper-server] Transcribed {os.path.basename(audio_path)}: {len(transcript)} chars', flush=True)
        except Exception as e:
            print(f'[whisper-server] Error: {e}', file=sys.stderr, flush=True)
            err = json.dumps({'error': str(e)}).encode('utf-8')
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(err)))
            self.end_headers()
            self.wfile.write(err)

server = HTTPServer(('127.0.0.1', PORT), Handler)
server.serve_forever()
