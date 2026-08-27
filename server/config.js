const PORT = parseInt(process.env.PORT || '8080', 10);
const CODE_SERVER_PORT = parseInt(process.env.CODE_SERVER_PORT || '8180', 10);
const CODE_SERVER_HOST = '127.0.0.1';
const WEB_PASSWORD = process.env.WEB_PASSWORD;
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const LOGIN_ATTEMPTS_MAX = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || '/workspace';

// Sandbox settings
const SANDBOX = {
  enabled: process.env.SANDBOX_ENABLED !== 'false',
  maxFileSize: parseInt(process.env.SANDBOX_MAX_FILE_SIZE || '104857600', 10), // 100MB
  allowedPaths: (process.env.SANDBOX_ALLOWED_PATHS || '/workspace,/tmp').split(','),
  blockedCommands: (process.env.SANDBOX_BLOCKED_COMMANDS || 'mkfs,fdisk,dd').split(','),
  networkAccess: process.env.SANDBOX_NETWORK !== 'false',
};

// OpenRouter API settings
const OPENROUTER = {
  apiKey: process.env.OPENROUTER_API_KEY || '',
  baseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
};

module.exports = {
  PORT, CODE_SERVER_PORT, CODE_SERVER_HOST, WEB_PASSWORD,
  SESSION_MAX_AGE_MS, LOGIN_ATTEMPTS_MAX, LOGIN_LOCKOUT_MS,
  LOG_LEVEL, WORKSPACE_DIR, SANDBOX, OPENROUTER,
};
