const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');

// ─── Configuration ───────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '8080', 10);
const CODE_SERVER_PORT = parseInt(process.env.CODE_SERVER_PORT || '8180', 10);
const CODE_SERVER_HOST = '127.0.0.1';
const WEB_PASSWORD = process.env.WEB_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const LOGIN_ATTEMPTS_MAX = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || '/workspace';

// ─── State ───────────────────────────────────────────────────────────────────
let codeServerProcess = null;
let codeServerReady = false;
let shuttingDown = false;

// ─── Logging ─────────────────────────────────────────────────────────────────
const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLogLevel = LOG_LEVELS[LOG_LEVEL] ?? 1;

function log(level, msg) {
  if (LOG_LEVELS[level] >= currentLogLevel) {
    const ts = new Date().toISOString();
    const tag = level.toUpperCase().padEnd(5);
    console.log(`[${ts}] [${tag}] ${msg}`);
  }
}

// ─── Validate Config ─────────────────────────────────────────────────────────
if (!WEB_PASSWORD) {
  log('error', 'WEB_PASSWORD environment variable is not set. Exiting.');
  process.exit(1);
}
log('info', 'Authentication: enabled');

// ─── Session Store (in-memory) ──────────────────────────────────────────────
const sessions = new Map();

function generateSessionId() {
  return crypto.randomBytes(32).toString('hex');
}

function createSession(res) {
  const sessionId = generateSessionId();
  const session = {
    id: sessionId,
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_MAX_AGE_MS,
  };
  sessions.set(sessionId, session);
  const isSecure = !!(process.env.RAILWAY_STATIC_URL || process.env.CODESPACE_NAME);
  const cookie = [
    `session=${sessionId}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${Math.floor(SESSION_MAX_AGE_MS / 1000)}`,
    isSecure ? 'Secure' : '',
  ].filter(Boolean).join('; ');
  res.setHeader('Set-Cookie', cookie);
  return session;
}

function getSessionFromReq(req) {
  const cookies = parseCookies(req);
  const sessionId = cookies.session;
  if (!sessionId) return null;
  const session = sessions.get(sessionId);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    sessions.delete(sessionId);
    return null;
  }
  return session;
}

function destroySession(req) {
  const cookies = parseCookies(req);
  const sessionId = cookies.session;
  if (sessionId) {
    sessions.delete(sessionId);
  }
}

function parseCookies(req) {
  const cookieHeader = req.headers.cookie;
  const obj = {};
  if (typeof cookieHeader === 'string') {
    cookieHeader.split(';').forEach(pair => {
      const idx = pair.indexOf('=');
      if (idx > 0) {
        const key = pair.substring(0, idx).trim();
        const val = pair.substring(idx + 1).trim();
        obj[key] = val;
      }
    });
  }
  return obj;
}

// ─── Rate Limiting ──────────────────────────────────────────────────────────
const loginAttempts = new Map();

function checkLoginRateLimit(ip) {
  const record = loginAttempts.get(ip);
  if (!record) return { allowed: true, attempts: 0 };
  if (Date.now() > record.lockedUntil) {
    loginAttempts.delete(ip);
    return { allowed: true, attempts: 0 };
  }
  return {
    allowed: record.attempts < LOGIN_ATTEMPTS_MAX,
    attempts: record.attempts,
    lockedUntil: record.lockedUntil,
  };
}

function recordLoginAttempt(ip) {
  let record = loginAttempts.get(ip);
  if (!record) {
    record = { attempts: 0, lockedUntil: 0 };
    loginAttempts.set(ip, record);
  }
  record.attempts++;
  if (record.attempts >= LOGIN_ATTEMPTS_MAX) {
    record.lockedUntil = Date.now() + LOGIN_LOCKOUT_MS;
    log('warn', `Rate limit triggered for IP: ${ip}`);
  }
}

function resetLoginAttempts(ip) {
  loginAttempts.delete(ip);
}

// Cleanup expired sessions & rate limit entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now > session.expiresAt) sessions.delete(id);
  }
  for (const [ip, record] of loginAttempts) {
    if (now > record.lockedUntil && record.attempts >= LOGIN_ATTEMPTS_MAX) {
      loginAttempts.delete(ip);
    }
  }
}, 60 * 60 * 1000);

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
      '--disable-workspace-trust',
      WORKSPACE_DIR,
    ];

    const codeServerEnv = {
      ...process.env,
      HOME: WORKSPACE_DIR,
      XDG_DATA_HOME: `${WORKSPACE_DIR}/.local/share`,
      XDG_CONFIG_HOME: `${WORKSPACE_DIR}/.config`,
      XDG_CACHE_HOME: `${WORKSPACE_DIR}/.cache`,
    };
    // Remove vars that could confuse code-server
    delete codeServerEnv.PORT;

    codeServerProcess = spawn('code-server', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: codeServerEnv,
    });

    let resolved = false;
    let outputBuf = '';

    function checkReady(data) {
      if (resolved) return;
      const text = data.toString();
      outputBuf += text;
      text.split('\n').forEach(line => {
        if (line.trim()) log('debug', `[code-server] ${line.trim()}`);
      });
      // code-server outputs this when ready
      if (outputBuf.includes('HTTP server listening on') || outputBuf.includes('Server started')) {
        resolved = true;
        codeServerReady = true;
        log('info', 'code-server is ready');
        resolve();
      }
    }

    codeServerProcess.stdout.on('data', checkReady);
    codeServerProcess.stderr.on('data', checkReady);

    codeServerProcess.on('error', (err) => {
      log('error', `code-server spawn error: ${err.message}`);
      if (!resolved) reject(err);
    });

    codeServerProcess.on('exit', (code, signal) => {
      log('error', `code-server exited code=${code} signal=${signal}`);
      codeServerReady = false;
      codeServerProcess = null;
      if (!shuttingDown) {
        log('error', 'code-server crashed. Exiting for Railway restart.');
        process.exit(1);
      }
    });

    // Timeout
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        reject(new Error('code-server startup timeout (60s)'));
      }
    }, 60000);
  });
}

// ─── Wait for port ──────────────────────────────────────────────────────────
function waitForPort(host, port, maxRetries = 30, intervalMs = 1000) {
  return new Promise((resolve, reject) => {
    let retries = 0;
    function tryConnect() {
      const socket = new net.Socket();
      socket.setTimeout(2000);
      socket.once('connect', () => { socket.destroy(); resolve(); });
      socket.once('error', () => {
        socket.destroy();
        retries++;
        if (retries >= maxRetries) reject(new Error(`Port ${port} unavailable after ${maxRetries} retries`));
        else setTimeout(tryConnect, intervalMs);
      });
      socket.once('timeout', () => {
        socket.destroy();
        retries++;
        if (retries >= maxRetries) reject(new Error(`Port ${port} timeout after ${maxRetries} retries`));
        else setTimeout(tryConnect, intervalMs);
      });
      socket.connect(port, host);
    }
    tryConnect();
  });
}

// ─── HTTP Proxy ─────────────────────────────────────────────────────────────
const httpProxy = require('http-proxy');
const proxy = httpProxy.createProxyServer({
  target: `http://${CODE_SERVER_HOST}:${CODE_SERVER_PORT}`,
  ws: true,
  changeOrigin: true,
  autoRewrite: true,
});

proxy.on('error', (err, req, res) => {
  log('error', `Proxy error: ${err.message}`);
  if (res && typeof res.writeHead === 'function' && !res.headersSent) {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('Bad Gateway');
  }
});

proxy.on('proxyReq', (proxyReq) => {
  // Strip our session cookie from upstream - code-server runs with auth=none
  proxyReq.removeHeader('cookie');
});

// ─── Login HTML ─────────────────────────────────────────────────────────────
let loginHtml = '';
try {
  loginHtml = fs.readFileSync(path.join(__dirname, 'public', 'login.html'), 'utf8');
} catch {
  loginHtml = '<html><body><h1>Login page not found</h1></body></html>';
}

// ─── Security Headers ──────────────────────────────────────────────────────
function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // CSP tuned for VS Code web: needs unsafe-inline/eval for Monaco editor
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self' https:; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: https:; " +
    "font-src 'self' data:; " +
    "connect-src 'self' ws: wss: https:; " +
    "frame-src 'self' https:;"
  );
}

// ─── Create HTTP Server ─────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const url = req.url || '/';

  // Health check - always accessible, no auth required
  if (url === '/health' || url === '/ready') {
    const status = codeServerReady ? 'ok' : 'starting';
    const code = codeServerReady ? 200 : 503;
    res.writeHead(code, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify({ status }));
    return;
  }

  // Logout
  if (url === '/logout' && req.method === 'GET') {
    destroySession(req);
    res.writeHead(302, { Location: '/' });
    res.end();
    return;
  }

  // Login POST
  if (url === '/login' && req.method === 'POST') {
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
      || req.socket.remoteAddress || 'unknown';

    const rl = checkLoginRateLimit(ip);
    if (!rl.allowed) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Too many login attempts. Try again later.' }));
      return;
    }

    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 2048) {
        req.destroy();
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Request too large' }));
      }
    });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        const password = parsed.password;

        if (!password || password !== WEB_PASSWORD) {
          recordLoginAttempt(ip);
          log('warn', `Failed login from IP: ${ip}`);
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid password' }));
          return;
        }

        resetLoginAttempts(ip);
        log('info', `Login success from IP: ${ip}`);
        const session = createSession(res);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request' }));
      }
    });
    return;
  }

  // All other routes: require session
  const session = getSessionFromReq(req);

  if (!session) {
    // Serve login page for navigation requests
    const accept = req.headers.accept || '';
    const isNavigation = accept.includes('text/html') || url === '/' || url === '/index.html';
    if (isNavigation) {
      setSecurityHeaders(res);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(loginHtml);
      return;
    }
    // Block non-HTML unauthenticated requests
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Authentication required' }));
    return;
  }

  // Authenticated: proxy everything to code-server
  setSecurityHeaders(res);
  proxy.web(req, res);
});

// ─── WebSocket Upgrade ──────────────────────────────────────────────────────
server.on('upgrade', (req, socket, head) => {
  const session = getSessionFromReq(req);
  if (!session) {
    log('warn', 'WebSocket rejected: no valid session');
    socket.destroy();
    return;
  }
  proxy.upgrade(req, socket, head);
});

// ─── Graceful Shutdown ──────────────────────────────────────────────────────
function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log('info', `Received ${signal}. Shutting down...`);

  // Stop accepting new connections
  server.close(() => {
    log('info', 'HTTP server closed');
    stopCodeServer();
  });

  // Force close after 15s
  setTimeout(() => {
    log('error', 'Forced exit after timeout');
    process.exit(1);
  }, 15000);
}

function stopCodeServer() {
  if (!codeServerProcess) {
    log('info', 'Shutdown complete');
    process.exit(0);
    return;
  }
  log('info', 'Stopping code-server...');
  codeServerProcess.on('exit', () => {
    log('info', 'Shutdown complete');
    process.exit(0);
  });
  codeServerProcess.kill('SIGTERM');
  setTimeout(() => {
    if (codeServerProcess) {
      log('warn', 'Force killing code-server');
      codeServerProcess.kill('SIGKILL');
    }
    process.exit(0);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  log('info', '=== VS Code Railway - Starting ===');
  log('info', `Workspace: ${WORKSPACE_DIR}`);

  // Ensure workspace exists
  if (!fs.existsSync(WORKSPACE_DIR)) {
    fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
  }

  // Start code-server
  try {
    await startCodeServer();
  } catch (err) {
    log('error', `Failed to start code-server: ${err.message}`);
    process.exit(1);
  }

  // Wait for port to confirm
  try {
    await waitForPort(CODE_SERVER_HOST, CODE_SERVER_PORT, 20, 500);
    log('info', 'code-server port confirmed');
  } catch (err) {
    log('error', `Port check failed: ${err.message}`);
    process.exit(1);
  }

  // Start proxy server
  server.listen(PORT, '0.0.0.0', () => {
    log('info', `Listening on 0.0.0.0:${PORT}`);
    log('info', 'Health check: /health');
    log('info', '=== VS Code Railway - Ready ===');
  });
}

main().catch((err) => {
  log('error', `Fatal: ${err.message}`);
  process.exit(1);
});
