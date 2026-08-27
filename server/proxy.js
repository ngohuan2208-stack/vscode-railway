const http = require('http');
const net = require('net');
const { CODE_SERVER_HOST, CODE_SERVER_PORT } = require('./config');
const { log } = require('./logger');

// ─── HTTP Proxy ─────────────────────────────────────────────────────────────
function proxyHttp(req, res) {
  const headers = {};
  for (const [key, val] of Object.entries(req.headers)) {
    if (key.toLowerCase() !== 'cookie') {
      headers[key] = val;
    } else {
      // Filter out our session cookie, pass through rest
      const filtered = val.split(';').map(c => c.trim()).filter(c => !c.startsWith('session=')).join('; ');
      if (filtered) headers[key] = filtered;
    }
  }
  headers['host'] = `${CODE_SERVER_HOST}:${CODE_SERVER_PORT}`;

  const proxyReq = http.request({
    hostname: CODE_SERVER_HOST,
    port: CODE_SERVER_PORT,
    path: req.url,
    method: req.method,
    headers,
  }, (proxyRes) => {
    const respHeaders = {};
    for (const [k, v] of Object.entries(proxyRes.headers)) {
      if (!['connection', 'transfer-encoding'].includes(k.toLowerCase())) {
        respHeaders[k] = v;
      }
    }
    res.writeHead(proxyRes.statusCode, respHeaders);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    log('error', `http proxy: ${err.message}`);
    if (!res.headersSent) { res.writeHead(502); res.end('Bad Gateway'); }
  });

  req.pipe(proxyReq);
}

// ─── WebSocket Proxy ────────────────────────────────────────────────────────
function proxyWs(req, socket, head) {
  log('debug', `ws upgrade -> ${req.url}`);

  const target = net.connect(CODE_SERVER_PORT, CODE_SERVER_HOST, () => {
    // Build clean HTTP upgrade request for code-server
    const lines = [];
    lines.push(`${req.method} ${req.url} HTTP/${req.httpVersion}`);

    // Skip hop-by-hop headers and our session cookie
    const skip = new Set([
      'connection', 'proxy-connection', 'keep-alive',
      'transfer-encoding', 'te', 'trailer', 'upgrade',
      'proxy-authorization', 'proxy-authenticate',
    ]);

    // Forward original headers (minus hop-by-hop)
    for (const [key, val] of Object.entries(req.headers)) {
      const lower = key.toLowerCase();
      if (skip.has(lower)) continue;
      // Filter out our session cookie
      if (lower === 'cookie') {
        const filtered = val.split(';').map(c => c.trim()).filter(c => !c.startsWith('session=')).join('; ');
        if (filtered) lines.push(`${key}: ${filtered}`);
        continue;
      }
      lines.push(`${key}: ${val}`);
    }

    // Set WebSocket upgrade headers
    lines.push('Connection: Upgrade');
    lines.push('Upgrade: websocket');
    lines.push('');
    lines.push('');

    const raw = lines.join('\r\n');
    target.write(raw);

    // Forward any buffered data from client
    if (head && head.length > 0) {
      target.write(head);
    }

    // Bidirectional pipe
    socket.pipe(target);
    target.pipe(socket);
  });

  target.on('error', (err) => {
    log('error', `ws target error: ${err.message}`);
    socket.destroy();
  });

  socket.on('error', (err) => {
    log('error', `ws client error: ${err.message}`);
    target.destroy();
  });

  socket.on('close', () => { try { target.destroy(); } catch {} });
  target.on('close', () => { try { socket.destroy(); } catch {} });
}

module.exports = { proxyHttp, proxyWs };
