const fs = require('fs');
const path = require('path');
const https = require('https');
const { WORKSPACE_DIR } = require('./config');
const { log } = require('./logger');

const TOKEN_FILE = path.join(WORKSPACE_DIR, '.config', 'github-token');
const SETTINGS_FILE = path.join(WORKSPACE_DIR, '.config', 'settings.json');

// ─── Token Management ───────────────────────────────────────────────────────
function getGitHubToken() {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      return fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    }
  } catch {}
  return process.env.GITHUB_TOKEN || '';
}

function setGitHubToken(token) {
  const dir = path.dirname(TOKEN_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(TOKEN_FILE, token.trim(), 'utf8');
  log('info', 'GitHub token saved');
}

function clearGitHubToken() {
  try { if (fs.existsSync(TOKEN_FILE)) fs.unlinkSync(TOKEN_FILE); } catch {}
}

// ─── GitHub API ──────────────────────────────────────────────────────────────
function githubApi(endpoint, token) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: endpoint,
      method: 'GET',
      headers: {
        'User-Agent': 'vscode-railway',
        'Accept': 'application/vnd.github.v3+json',
        ...(token ? { 'Authorization': `token ${token}` } : {}),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 400) {
            reject(new Error(json.message || `GitHub API error ${res.statusCode}`));
          } else {
            resolve(json);
          }
        } catch {
          reject(new Error('Invalid GitHub API response'));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('GitHub API timeout')); });
    req.end();
  });
}

// ─── Create Repo ─────────────────────────────────────────────────────────────
async function createRepo(token, { name, description, private: isPrivate, auto_init }) {
  const body = JSON.stringify({ name, description, private: isPrivate, auto_init });
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: '/user/repos',
      method: 'POST',
      headers: {
        'User-Agent': 'vscode-railway',
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `token ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 400) reject(new Error(json.message || `GitHub API error ${res.statusCode}`));
          else resolve(json);
        } catch { reject(new Error('Invalid response')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(body);
    req.end();
  });
}

// ─── List Repos ──────────────────────────────────────────────────────────────
async function listRepos(token) {
  const repos = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const data = await githubApi(`/user/repos?per_page=${perPage}&page=${page}&sort=updated&direction=desc`, token);
    if (!data || data.length === 0) break;
    repos.push(...data.map(r => ({
      name: r.name,
      full_name: r.full_name,
      url: r.clone_url,
      private: r.private,
      description: r.description || '',
      language: r.language || '',
      updated_at: r.updated_at,
      default_branch: r.default_branch,
    })));
    if (data.length < perPage) break;
    page++;
    if (page > 5) break; // Max 500 repos
  }

  return repos;
}

// ─── List Orgs ───────────────────────────────────────────────────────────────
async function listOrgs(token) {
  return githubApi('/user/orgs', token);
}

// ─── List Org Repos ──────────────────────────────────────────────────────────
async function listOrgRepos(token, org) {
  const repos = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const data = await githubApi(`/orgs/${org}/repos?per_page=${perPage}&page=${page}&sort=updated&direction=desc`, token);
    if (!data || data.length === 0) break;
    repos.push(...data.map(r => ({
      name: r.name,
      full_name: r.full_name,
      url: r.clone_url,
      private: r.private,
      description: r.description || '',
      language: r.language || '',
      updated_at: r.updated_at,
      default_branch: r.default_branch,
    })));
    if (data.length < perPage) break;
    page++;
    if (page > 5) break;
  }

  return repos;
}

// ─── Clone Repo ──────────────────────────────────────────────────────────────
function cloneRepo(url, targetDir, token) {
  return new Promise((resolve, reject) => {
    const { spawn } = require('child_process');
    // Inject token into URL for private repos
    let cloneUrl = url;
    if (token && url.startsWith('https://github.com/')) {
      cloneUrl = url.replace('https://', `https://x-access-token:${token}@`);
    }

    const args = ['clone', '--depth', '1', cloneUrl, targetDir];
    log('info', `Cloning ${url} -> ${targetDir}`);

    const proc = spawn('git', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    proc.stdout.on('data', d => stdout += d.toString());
    proc.stderr.on('data', d => stderr += d.toString());
    proc.on('error', reject);
    proc.on('exit', (code) => {
      if (code === 0) {
        log('info', `Clone success: ${targetDir}`);
        resolve({ ok: true, dir: targetDir });
      } else {
        log('error', `Clone failed: ${stderr}`);
        reject(new Error(stderr || 'Clone failed'));
      }
    });
  });
}

// ─── Settings ────────────────────────────────────────────────────────────────
function getSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    }
  } catch {}
  return { defaultDir: path.join(WORKSPACE_DIR, 'projects') };
}

function saveSettings(settings) {
  const dir = path.dirname(SETTINGS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
}

// ─── List Workspace Projects ────────────────────────────────────────────────
function listWorkspaceProjects() {
  const projectsDir = path.join(WORKSPACE_DIR, 'projects');
  if (!fs.existsSync(projectsDir)) return [];
  try {
    return fs.readdirSync(projectsDir).filter(name => {
      const full = path.join(projectsDir, name);
      return fs.statSync(full).isDirectory();
    }).map(name => ({
      name,
      path: path.join(projectsDir, name),
      isGit: fs.existsSync(path.join(projectsDir, name, '.git')),
    }));
  } catch { return []; }
}

module.exports = {
  getGitHubToken, setGitHubToken, clearGitHubToken,
  githubApi, createRepo,
  listRepos, listOrgs, listOrgRepos,
  cloneRepo, getSettings, saveSettings,
  listWorkspaceProjects,
};
