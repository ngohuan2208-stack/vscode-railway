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
const pickerHtml = loadHtml('picker.html');

// ─── Helpers ────────────────────────────────────────────────────────────────
function sendJson(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function setSecHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
}

function readBody(req, max = 8192) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => { body += c.toString(); if (body.length > max) { req.destroy(); reject(new Error('Too large')); } });
    req.on('end', () => resolve(body));
  });
}

function hasGitHubToken() {
  return !!(process.env.GITHUB_TOKEN || github.getGitHubToken());
}

// Configure git user for a repo directory
function configureGitUser(repoDir) {
  try {
    const gitConfig = path.join(repoDir, '.git', 'config');
    if (fs.existsSync(gitConfig)) {
      let config = fs.readFileSync(gitConfig, 'utf8');
      if (!config.includes('[user]')) {
        config += '\n[user]\n  name = VS Code User\n  email = user@vscode-railway.local\n';
        fs.writeFileSync(gitConfig, config, 'utf8');
      }
    }
  } catch {}
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

    // ── Login ─────────────────────────────────────────────────────────────
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
        // Tell frontend where to go
        const redirect = hasGitHubToken() ? '/picker' : '/';
        sendJson(res, 200, { ok: true, redirect });
      } catch { sendJson(res, 400, { error: 'Invalid request' }); }
      return;
    }

    if (url === '/logout' && method === 'GET') {
      session.destroySession(req);
      res.writeHead(302, { Location: '/' });
      res.end();
      return;
    }

    // ── Auth required below ──────────────────────────────────────────────
    const sess = session.getSessionFromReq(req);

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

    // ── Picker page ───────────────────────────────────────────────────────
    if (url === '/picker' && method === 'GET') {
      if (!hasGitHubToken()) {
        res.writeHead(302, { Location: '/' });
        res.end();
        return;
      }
      setSecHeaders(res);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(pickerHtml);
      return;
    }

    // ── Settings page ─────────────────────────────────────────────────────
    if (url === '/settings' && method === 'GET') {
      setSecHeaders(res);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(settingsHtml);
      return;
    }

    // ── GitHub API ────────────────────────────────────────────────────────
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

    if (url === '/api/github/user' && method === 'GET') {
      const token = github.getGitHubToken();
      if (!token) return sendJson(res, 400, { error: 'No token' });
      try {
        const user = await github.githubApi('/user', token);
        sendJson(res, 200, { login: user.login, avatar_url: user.avatar_url, name: user.name });
      } catch (e) { sendJson(res, 500, { error: e.message }); }
      return;
    }

    if (url === '/api/github/repos' && method === 'GET') {
      const token = github.getGitHubToken();
      if (!token) return sendJson(res, 400, { error: 'No GitHub token' });
      try {
        const repos = await github.listRepos(token);
        sendJson(res, 200, { repos });
      } catch (e) { sendJson(res, 500, { error: e.message }); }
      return;
    }

    if (url === '/api/github/orgs' && method === 'GET') {
      const token = github.getGitHubToken();
      if (!token) return sendJson(res, 400, { error: 'No GitHub token' });
      try {
        const orgs = await github.listOrgs(token);
        sendJson(res, 200, { orgs: orgs.map(o => ({ login: o.login, avatar_url: o.avatar_url })) });
      } catch (e) { sendJson(res, 500, { error: e.message }); }
      return;
    }

    if (url.startsWith('/api/github/orgs/') && url.endsWith('/repos') && method === 'GET') {
      const org = url.split('/')[3];
      const token = github.getGitHubToken();
      if (!token) return sendJson(res, 400, { error: 'No GitHub token' });
      try {
        const repos = await github.listOrgRepos(token, org);
        sendJson(res, 200, { repos });
      } catch (e) { sendJson(res, 500, { error: e.message }); }
      return;
    }

    // ── Clone + Open (main flow) ──────────────────────────────────────────
    if (url === '/api/github/clone' && method === 'POST') {
      const body = await readBody(req);
      const { url: repoUrl, name } = JSON.parse(body);
      if (!repoUrl) return sendJson(res, 400, { error: 'Missing repo URL' });

      const token = github.getGitHubToken();
      const repoName = name || repoUrl.split('/').pop().replace('.git', '');
      const projectsDir = path.join(WORKSPACE_DIR, 'projects');
      const targetDir = path.join(projectsDir, repoName);

      // Ensure projects dir exists
      if (!fs.existsSync(projectsDir)) fs.mkdirSync(projectsDir, { recursive: true });

      // If already exists, just return the path
      if (fs.existsSync(targetDir)) {
        configureGitUser(targetDir);
        log('info', `Repo exists: ${targetDir}`);
        sendJson(res, 200, { ok: true, dir: targetDir, folder: targetDir });
        return;
      }

      try {
        await github.cloneRepo(repoUrl, targetDir, token);
        configureGitUser(targetDir);
        // Verify clone
        if (!fs.existsSync(targetDir)) {
          throw new Error('Clone succeeded but directory not found');
        }
        log('info', `Cloned: ${repoName} -> ${targetDir}`);
        sendJson(res, 200, { ok: true, dir: targetDir, folder: targetDir });
      } catch (e) {
        log('error', `Clone error: ${e.message}`);
        sendJson(res, 500, { error: e.message });
      }
      return;
    }

    if (url === '/api/projects' && method === 'GET') {
      const projects = github.listWorkspaceProjects();
      sendJson(res, 200, { projects });
      return;
    }

    // ── Root: redirect to picker if has token ─────────────────────────────
    if (url === '/' && method === 'GET') {
      // Let code-server handle it via proxy (it serves the IDE)
      setSecHeaders(res);
      proxyHttp(req, res);
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
