const crypto = require('crypto');
const { SESSION_MAX_AGE_MS, LOGIN_ATTEMPTS_MAX, LOGIN_LOCKOUT_MS } = require('./config');
const { log } = require('./logger');

const sessions = new Map();
const loginAttempts = new Map();

function generateSessionId() {
  return crypto.randomBytes(32).toString('hex');
}

function createSession(res) {
  const id = generateSessionId();
  sessions.set(id, { id, createdAt: Date.now(), expiresAt: Date.now() + SESSION_MAX_AGE_MS });
  const isSecure = !!(process.env.RAILWAY_STATIC_URL || process.env.CODESPACE_NAME);
  res.setHeader('Set-Cookie', [
    `session=${id}`, 'HttpOnly', 'SameSite=Lax', 'Path=/',
    `Max-Age=${Math.floor(SESSION_MAX_AGE_MS / 1000)}`,
    isSecure ? 'Secure' : '',
  ].filter(Boolean).join('; '));
  return id;
}

function getSessionFromReq(req) {
  const sid = parseCookies(req).session;
  if (!sid) return null;
  const s = sessions.get(sid);
  if (!s) return null;
  if (Date.now() > s.expiresAt) { sessions.delete(sid); return null; }
  return s;
}

function destroySession(req) {
  const sid = parseCookies(req).session;
  if (sid) sessions.delete(sid);
}

function parseCookies(req) {
  const h = req.headers.cookie;
  const obj = {};
  if (typeof h === 'string') {
    h.split(';').forEach(p => {
      const i = p.indexOf('=');
      if (i > 0) obj[p.substring(0, i).trim()] = p.substring(i + 1).trim();
    });
  }
  return obj;
}

function checkRateLimit(ip) {
  const r = loginAttempts.get(ip);
  if (!r) return { allowed: true };
  if (Date.now() > r.lockedUntil) { loginAttempts.delete(ip); return { allowed: true }; }
  return { allowed: r.attempts < LOGIN_ATTEMPTS_MAX };
}

function recordAttempt(ip) {
  let r = loginAttempts.get(ip);
  if (!r) { r = { attempts: 0, lockedUntil: 0 }; loginAttempts.set(ip, r); }
  r.attempts++;
  if (r.attempts >= LOGIN_ATTEMPTS_MAX) {
    r.lockedUntil = Date.now() + LOGIN_LOCKOUT_MS;
    log('warn', `Rate limit: ${ip}`);
  }
}

function cleanup() {
  const now = Date.now();
  for (const [id, s] of sessions) if (now > s.expiresAt) sessions.delete(id);
  for (const [ip, r] of loginAttempts) if (now > r.lockedUntil && r.attempts >= LOGIN_ATTEMPTS_MAX) loginAttempts.delete(ip);
}

setInterval(cleanup, 60 * 60 * 1000);

module.exports = {
  createSession, getSessionFromReq, destroySession, parseCookies,
  checkRateLimit, recordAttempt, loginAttempts,
};
