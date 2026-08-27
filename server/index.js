const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const { PORT, CODE_SERVER_HOST, CODE_SERVER_PORT, WEB_PASSWORD, WORKSPACE_DIR } = require('./config');
const { log } = require('./logger');
const { handleRequest, handleUpgrade } = require('./routes');

// Expose globals for routes
global.__codeServerReady = false;
global.__webPassword = WEB_PASSWORD;

if (!WEB_PASSWORD) {
  log('error', 'WEB_PASSWORD not set. Exiting.');
  process.exit(1);
}

let codeServerProcess = null;
let shuttingDown = false;

// ─── Start code-server ──────────────────────────────────────────────────────
function startCodeServer() {
  return new Promise((resolve, reject) => {
    log('info', `Starting code-server on ${CODE_SERVER_HOST}:${CODE_SERVER_PORT}...`);

    const args = [
      '--bind-addr', `${CODE_SERVER_HOST}:${CODE_SERVER_PORT}`,
      '--auth', 'none',
      '--disable-telemetry',
      '--disable-update-check',
      '--locale', 'en',
      '--disable-extension', 'github.vscode-pull-request-github',
      WORKSPACE_DIR,
    ];

    const env = {
      ...process.env,
      HOME: WORKSPACE_DIR,
      XDG_DATA_HOME: `${WORKSPACE_DIR}/.local/share`,
      XDG_CONFIG_HOME: `${WORKSPACE_DIR}/.config`,
      XDG_CACHE_HOME: `${WORKSPACE_DIR}/.cache`,
    };
    delete env.PORT;

    codeServerProcess = spawn('code-server', args, { stdio: ['ignore', 'pipe', 'pipe'], env });
    let resolved = false, buf = '';

    function checkReady(data) {
      if (resolved) return;
      buf += data.toString();
      data.toString().split('\n').forEach(l => { if (l.trim()) log('debug', `[cs] ${l.trim()}`); });
      if (buf.includes('HTTP server listening on')) {
        resolved = true;
        global.__codeServerReady = true;
        log('info', 'code-server ready');
        resolve();
      }
    }

    codeServerProcess.stdout.on('data', checkReady);
    codeServerProcess.stderr.on('data', checkReady);
    codeServerProcess.on('error', (e) => { log('error', `cs spawn: ${e.message}`); if (!resolved) reject(e); });
    codeServerProcess.on('exit', (c, s) => {
      log('error', `cs exit code=${c} sig=${s}`);
      global.__codeServerReady = false;
      codeServerProcess = null;
      if (!shuttingDown) { log('error', 'cs crashed, exiting for restart'); process.exit(1); }
    });
    setTimeout(() => { if (!resolved) { resolved = true; reject(new Error('cs timeout')); } }, 60000);
  });
}

function waitForPort(host, port, max = 30, ms = 1000) {
  return new Promise((resolve, reject) => {
    let n = 0;
    function try_() {
      const s = new net.Socket();
      s.setTimeout(2000);
      s.once('connect', () => { s.destroy(); resolve(); });
      s.once('error', () => { s.destroy(); if (++n >= max) reject(new Error(`port ${port} unavailable`)); else setTimeout(try_, ms); });
      s.once('timeout', () => { s.destroy(); if (++n >= max) reject(new Error(`port ${port} timeout`)); else setTimeout(try_, ms); });
      s.connect(port, host);
    }
    try_();
  });
}

// ─── Graceful Shutdown ──────────────────────────────────────────────────────
function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log('info', `Received ${signal}. Shutting down...`);
  server.close(() => {
    log('info', 'HTTP closed');
    if (!codeServerProcess) { process.exit(0); return; }
    codeServerProcess.on('exit', () => process.exit(0));
    codeServerProcess.kill('SIGTERM');
    setTimeout(() => { if (codeServerProcess) codeServerProcess.kill('SIGKILL'); process.exit(0); }, 10000);
  });
  setTimeout(() => process.exit(1), 15000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ─── HTTP Server ────────────────────────────────────────────────────────────
const server = http.createServer(handleRequest);
server.on('upgrade', handleUpgrade);

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  log('info', '=== VS Code Railway - Starting ===');
  log('info', `Workspace: ${WORKSPACE_DIR}`);
  if (!fs.existsSync(WORKSPACE_DIR)) fs.mkdirSync(WORKSPACE_DIR, { recursive: true });

  try { await startCodeServer(); } catch (e) { log('error', `cs fail: ${e.message}`); process.exit(1); }
  try { await waitForPort(CODE_SERVER_HOST, CODE_SERVER_PORT, 20, 500); log('info', 'cs port confirmed'); }
  catch (e) { log('error', `port fail: ${e.message}`); process.exit(1); }

  server.listen(PORT, '0.0.0.0', () => {
    log('info', `Listening on 0.0.0.0:${PORT}`);
    log('info', '=== Ready ===');
  });
}

main().catch((e) => { log('error', `Fatal: ${e.message}`); process.exit(1); });
