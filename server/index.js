const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
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
      '--max-memory=192m',
      WORKSPACE_DIR,
    ];

    const env = {
      HOME: process.env.HOME || '/home/ide',
      NPM_CONFIG_PREFIX: '/workspace/.npm-global',
      XDG_DATA_HOME: `${WORKSPACE_DIR}/.local/share`,
      XDG_CONFIG_HOME: `${WORKSPACE_DIR}/.config`,
      XDG_CACHE_HOME: `${WORKSPACE_DIR}/.cache`,
      PATH: process.env.PATH,
      NODE_ENV: 'production',
      NODE_OPTIONS: '--max-old-space-size=192',
    };

    codeServerProcess = spawn('code-server', args, { stdio: ['ignore', 'pipe', 'pipe'], env });
    let resolved = false, buf = '';

    function checkReady(data) {
      if (resolved) return;
      buf += data.toString();
      if (buf.includes('HTTP server listening on')) {
        resolved = true;
        global.__codeServerReady = true;
        log('info', 'code-server ready');
        resolve();
      }
    }

    codeServerProcess.stdout.on('data', (data) => {
      const text = data.toString();
      text.split('\n').forEach(l => { if (l.trim()) log('debug', `[cs] ${l.trim()}`); });
      checkReady(data);
    });
    codeServerProcess.stderr.on('data', (data) => {
      const text = data.toString();
      text.split('\n').forEach(l => { if (l.trim()) log('debug', `[cs] ${l.trim()}`); });
      checkReady(data);
    });
    codeServerProcess.on('error', (e) => {
      log('error', `cs spawn: ${e.message}`);
      if (!resolved) reject(e);
    });
    codeServerProcess.on('exit', (c, s) => {
      log('error', `cs exit code=${c} sig=${s}`);
      global.__codeServerReady = false;
      codeServerProcess = null;
      if (!shuttingDown) {
        log('error', 'cs crashed, exiting for restart');
        process.exit(1);
      }
    });
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        reject(new Error('cs timeout after 60s'));
      }
    }, 60000);
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

// ─── Memory Info ────────────────────────────────────────────────────────────
function getMemoryInfo() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const processMem = process.memoryUsage();

  let swapInfo = { total: 0, used: 0, free: 0 };
  try {
    const meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
    const swapTotal = meminfo.match(/SwapTotal:\s+(\d+)/);
    const swapFree = meminfo.match(/SwapFree:\s+(\d+)/);
    if (swapTotal) swapInfo.total = parseInt(swapTotal[1]) * 1024;
    if (swapFree) swapInfo.free = parseInt(swapFree[1]) * 1024;
    swapInfo.used = swapInfo.total - swapInfo.free;
  } catch {}

  return {
    system: {
      total: totalMem,
      used: usedMem,
      free: freeMem,
      totalMB: Math.round(totalMem / 1024 / 1024),
      usedMB: Math.round(usedMem / 1024 / 1024),
      freeMB: Math.round(freeMem / 1024 / 1024),
    },
    swap: {
      total: swapInfo.total,
      used: swapInfo.used,
      free: swapInfo.free,
      totalMB: Math.round(swapInfo.total / 1024 / 1024),
      usedMB: Math.round(swapInfo.used / 1024 / 1024),
      freeMB: Math.round(swapInfo.free / 1024 / 1024),
    },
    node: {
      rss: processMem.rss,
      heapUsed: processMem.heapUsed,
      heapTotal: processMem.heapTotal,
      rssMB: Math.round(processMem.rss / 1024 / 1024),
      heapUsedMB: Math.round(processMem.heapUsed / 1024 / 1024),
    },
    codeServerReady: global.__codeServerReady,
    uptime: Math.round(process.uptime()),
  };
}

// ─── Graceful Shutdown ──────────────────────────────────────────────────────
function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log('info', `Received ${signal}. Shutting down...`);

  server.close(() => {
    log('info', 'HTTP server closed');
    if (!codeServerProcess) { process.exit(0); return; }
    codeServerProcess.on('exit', () => process.exit(0));
    codeServerProcess.kill('SIGTERM');
    setTimeout(() => {
      if (codeServerProcess) {
        log('warn', 'cs did not exit, sending SIGKILL');
        codeServerProcess.kill('SIGKILL');
      }
      process.exit(0);
    }, 10000);
  });

  setTimeout(() => process.exit(1), 15000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ─── HTTP Server ────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  // Memory endpoint (authenticated)
  if (req.url === '/api/system/memory' && req.method === 'GET') {
    const session = require('./session');
    const sess = session.getSessionFromReq(req);
    if (!sess) { res.writeHead(401); res.end(); return; }
    const info = getMemoryInfo();
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(info));
    return;
  }
  handleRequest(req, res);
});
server.on('upgrade', handleUpgrade);

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  log('info', '=== VS Code Railway - Starting ===');
  log('info', `Workspace: ${WORKSPACE_DIR}`);
  log('info', `Node options: ${process.env.NODE_OPTIONS || 'default'}`);

  const mem = getMemoryInfo();
  log('info', `System RAM: ${mem.system.totalMB}MB total, ${mem.system.freeMB}MB free`);
  if (mem.swap.totalMB > 0) {
    log('info', `Swap: ${mem.swap.totalMB}MB total, ${mem.swap.freeMB}MB free`);
  } else {
    log('warn', 'No swap available - npm install may OOM on heavy packages');
  }

  if (!fs.existsSync(WORKSPACE_DIR)) fs.mkdirSync(WORKSPACE_DIR, { recursive: true });

  try {
    await startCodeServer();
  } catch (e) {
    log('error', `code-server failed to start: ${e.message}`);
    process.exit(1);
  }

  try {
    await waitForPort(CODE_SERVER_HOST, CODE_SERVER_PORT, 20, 500);
    log('info', 'code-server port confirmed');
  } catch (e) {
    log('error', `port check failed: ${e.message}`);
    process.exit(1);
  }

  server.listen(PORT, '0.0.0.0', () => {
    log('info', `Listening on 0.0.0.0:${PORT}`);
    log('info', '=== Ready ===');
  });
}

main().catch((e) => {
  log('error', `Fatal: ${e.message}`);
  process.exit(1);
});
