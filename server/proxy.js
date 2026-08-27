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
  log('debug', `ws -> ${CODE_SERVER_HOST}:${CODE_SERVER_PORT}${req.url}`);

  const target = net.connect(CODE_SERVER_PORT, CODE_SERVER_HOST, () => {
    const reqLines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
    const hopByHop = new Set(['connection', 'proxy-connection', 'keep-alive', 'transfer-encoding', 'te', 'trailer']);

    for (const [key, val] of Object.entries(req.headers)) {
      if (!hopByHop.has(key.toLowerCase())) {
        reqLines.push(`${key}: ${val}`);
      }
    }
    reqLines.push('Connection: Upgrade');
    reqLines.push('Upgrade: websocket');
    reqLines.push('', '');

    target.write(reqLines.join('\r\n'));
    if (head && head.length > 0) target.write(head);

    socket.pipe(target);
    target.pipe(socket);
  });

  target.on('error', (err) => { log('error', `ws target: ${err.message}`); socket.destroy(); });
  socket.on('error', (err) => { log('error', `ws client: ${err.message}`); target.destroy(); });
  socket.on('close', () => target.destroy());
  target.on('close', () => socket.destroy());
}

module.exports = { proxyHttp, proxyWs };
