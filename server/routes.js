const fs = require('fs');
const path = require('path');
const { WORKSPACE_DIR } = require('./config');
const { log } = require('./logger');
const session = require('./session');
const github = require('./github');
const { proxyHttp, proxyWs } = require('./proxy');

// ─── Load HTML files ────────────────────────────────────────────────────────
function loadHtml(name) {
  try { return fs.readFileSync(path.join(__dirname, '..', 'public', name), 'utf8'); }
  catch { return `<h1>${name} not found</h1>`; }
}

const loginHtml = loadHtml('login.html');
const settingsHtml = loadHtml('settings.html');

// ─── Send JSON ──────────────────────────────────────────────────────────────
function sendJson(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

// ─── Security Headers ──────────────────────────────────────────────────────
function setSecHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
}

// ─── Read POST body ─────────────────────────────────────────────────────────
function readBody(req, max = 4096) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => { body += c.toString(); if (body.length > max) { req.destroy(); reject(new Error('Too large')); } });
    req.on('end', () => resolve(body));
  });
}

// ─── Main Request Handler ──────────────────────────────────────────────────
async function handleRequest(req, res) {
  const url = req.url || '/';
  const method = req.method;

  try {
    // ── Health ────────────────────────────────────────────────────────────
    if (url === '/health' || url === '/ready') {
      const ok = global.__codeServerReady;
      res.writeHead(ok ? 200 : 503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ status: ok ? 'ok' : 'starting' }));
      return;
    }

    // ── Auth routes ───────────────────────────────────────────────────────
    if (url === '/login' && method === 'POST') {
      const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
      if (!session.checkRateLimit(ip).allowed) return sendJson(res, 429, { error: 'Too many attempts' });

      const body = await readBody(req);
      try {
        const { password } = JSON.parse(body);
        if (!password || password !== global.__webPassword) {
          session.recordAttempt(ip);
          log('warn', `Failed login: ${ip}`);
          return sendJson(res, 401, { error: 'Invalid password' });
        }
        session.loginAttempts.delete(ip);
        log('info', `Login OK: ${ip}`);
        session.createSession(res);
        sendJson(res, 200, { ok: true });
      } catch { sendJson(res, 400, { error: 'Invalid request' }); }
      return;
    }

    if (url === '/logout' && method === 'GET') {
      session.destroySession(req);
      res.writeHead(302, { Location: '/' });
      res.end();
      return;
    }

    // ── Check session for everything else ─────────────────────────────────
    const sess = session.getSessionFromReq(req);

    // Serve login/settings pages for unauthenticated
    if (!sess) {
      const accept = req.headers.accept || '';
      const isNav = accept.includes('text/html') || url === '/' || url === '/index.html';
      if (isNav) {
        setSecHeaders(res);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(loginHtml);
        return;
      }
      res.writeHead(401);
      res.end();
      return;
    }

    // ── Settings page ─────────────────────────────────────────────────────
    if (url === '/settings' && method === 'GET') {
      setSecHeaders(res);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(settingsHtml);
      return;
    }

    // ── GitHub API routes ─────────────────────────────────────────────────
    if (url === '/api/github/token' && method === 'POST') {
      const body = await readBody(req);
      const { token } = JSON.parse(body);
      if (token) github.setGitHubToken(token);
      else github.clearGitHubToken();
      sendJson(res, 200, { ok: true });
      return;
    }

    if (url === '/api/github/token' && method === 'GET') {
      const token = github.getGitHubToken();
      sendJson(res, 200, { hasToken: !!token });
      return;
    }

    if (url === '/api/github/repos' && method === 'GET') {
      const token = github.getGitHubToken();
      if (!token) return sendJson(res, 400, { error: 'No GitHub token configured' });
      try {
        const repos = await github.listRepos(token);
        sendJson(res, 200, { repos });
      } catch (e) {
        sendJson(res, 500, { error: e.message });
      }
      return;
    }

    if (url === '/api/github/orgs' && method === 'GET') {
      const token = github.getGitHubToken();
      if (!token) return sendJson(res, 400, { error: 'No GitHub token configured' });
      try {
        const orgs = await github.listOrgs(token);
        sendJson(res, 200, { orgs: orgs.map(o => ({ login: o.login, avatar_url: o.avatar_url })) });
      } catch (e) {
        sendJson(res, 500, { error: e.message });
      }
      return;
    }

    if (url.startsWith('/api/github/orgs/') && url.endsWith('/repos') && method === 'GET') {
      const org = url.split('/')[3];
      const token = github.getGitHubToken();
      if (!token) return sendJson(res, 400, { error: 'No GitHub token configured' });
      try {
        const repos = await github.listOrgRepos(token, org);
        sendJson(res, 200, { repos });
      } catch (e) {
        sendJson(res, 500, { error: e.message });
      }
      return;
    }

    if (url === '/api/github/clone' && method === 'POST') {
      const body = await readBody(req);
      const { url: repoUrl, name } = JSON.parse(body);
      if (!repoUrl) return sendJson(res, 400, { error: 'Missing repo URL' });

      const token = github.getGitHubToken();
      const targetDir = path.join(WORKSPACE_DIR, 'projects', name || repoUrl.split('/').pop().replace('.git', ''));

      if (fs.existsSync(targetDir)) return sendJson(res, 409, { error: 'Directory already exists' });

      try {
        await github.cloneRepo(repoUrl, targetDir, token);
        sendJson(res, 200, { ok: true, dir: targetDir });
      } catch (e) {
        sendJson(res, 500, { error: e.message });
      }
      return;
    }

    if (url === '/api/projects' && method === 'GET') {
      const projects = github.listWorkspaceProjects();
      sendJson(res, 200, { projects });
      return;
    }

    // ── Proxy to code-server ──────────────────────────────────────────────
    setSecHeaders(res);
    proxyHttp(req, res);

  } catch (err) {
    log('error', `route error: ${err.message}`);
    if (!res.headersSent) { res.writeHead(500); res.end('Internal error'); }
  }
}

// ─── WebSocket Upgrade ──────────────────────────────────────────────────────
function handleUpgrade(req, socket, head) {
  const sess = session.getSessionFromReq(req);
  if (!sess) {
    log('warn', `WS rejected: no session | ${req.url}`);
    socket.destroy();
    return;
  }
  proxyWs(req, socket, head);
}

module.exports = { handleRequest, handleUpgrade };
