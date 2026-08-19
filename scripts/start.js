const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const electronPath = require('electron');
const appRoot = path.resolve(__dirname, '..');
const tempProfileDir = path.join(os.tmpdir(), `nexa-browser-dev-profile-${Date.now()}-${process.pid}`);
const lockErrorPattern = /Lock file can not be created! Error code: 5/;

fs.mkdirSync(tempProfileDir, { recursive: true });

function safeWrite(stream, chunk) {
  if (!stream || stream.destroyed || stream.writableEnded) return;
  try {
    stream.write(chunk);
  } catch (err) {
    if (!err || err.code !== 'EPIPE') throw err;
  }
}

function launch(args, useTempProfile) {
  const child = spawn(electronPath, args, {
    cwd: appRoot,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false
  });

  let stderr = '';

  child.stdout.on('data', (chunk) => {
    safeWrite(process.stdout, chunk);
  });

  child.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    stderr += text;
    safeWrite(process.stderr, text);
  });

  child.on('error', (err) => {
    console.error('[launcher] failed to start Electron:', err);
    process.exit(1);
  });

  child.on('exit', (code, signal) => {
    if (!useTempProfile && lockErrorPattern.test(stderr)) {
      console.error('[launcher] perfil bloqueado, relanzando con perfil temporal limpio');
      launch([appRoot, `--user-data-dir=${tempProfileDir}`], true);
      return;
    }

    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 0);
  });
}

// GPU/hardware-acceleration flags are NOT forced here — electron/main.js
// already decides that itself from data.settings.hardwareAcceleration
// (defaults to real GPU rendering) and from NEXA_FORCE_SOFTWARE=1 for anyone
// who explicitly needs a software-rendering fallback. Forcing swiftshader
// unconditionally on every `npm start` used to pin the main process at
// 100%+ CPU continuously (confirmed live) for no documented reason.
launch([appRoot], false);
